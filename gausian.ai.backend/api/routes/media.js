// api/routes/media.js
import express from "express";
import fetch from "node-fetch";
import { Readable } from "node:stream";
import pool from "../db.js";
import { getRegenMapping, deleteRegenMapping } from "../lib/regenMap.js";
import { requireAuth } from "../middleware/auth.js";
import multer from "multer";
import { uploadBufferToS3, presignPutUrl, presignGetUrl, isS3Configured, publicUrlForKey } from "../services/s3.js";
import mediaMonitor from "../services/mediaMonitor.js";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { spawn } from "node:child_process";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

const router = express.Router();
// Note: requireAuth applied to most routes, but modal-upload needs to be public

// Multer instance for true browser uploads (field name: "file")
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Number(process.env.UPLOAD_MAX_BYTES || 1024 * 1024 * 1024) }, // 1GB default
});

/** ACL helper: owner or member */
async function hasAccess(projectId, userId) {
  const { rows } = await pool.query(
    `
    SELECT 1
    FROM projects p
    WHERE p.id = $1 AND (
      p.owner_id = $2 OR EXISTS (
        SELECT 1 FROM project_members pm
        WHERE pm.project_id = p.id AND pm.user_id = $2
      )
    )
    LIMIT 1
    `,
    [projectId, userId]
  );
  return !!rows.length;
}

/** GET /api/projects/:id/media -> media list */
router.get("/projects/:id/media", requireAuth, async (req, res) => {
  const userId = req.user.sub;
  const projectId = req.params.id;

  if (!(await hasAccess(projectId, userId))) {
    return res.status(404).json({ error: "Project not found" });
  }

  const { rows } = await pool.query(
    `
    SELECT id, project_id, user_id, kind, filename, remote_url, storage_backend, storage_path, meta, created_at
    FROM media
    WHERE project_id = $1
    ORDER BY created_at DESC
    `,
    [projectId]
  );
  // Enrich media with generation settings if missing by looking up generation_prompts via filename_prefix
  const enriched = await Promise.all(rows.map(async (m) => {
    try {
      let meta = m.meta || {};
      const gs = (meta && meta.generation_settings) || null;
      const hasPrompts = gs && (gs.prompt || gs.negative_prompt || typeof gs.seed !== 'undefined');
      if (hasPrompts) return m; // already has settings

      const fn = m.filename || '';
      const mm = fn.match(/(u[a-f0-9\-]+_p[a-f0-9\-]+_g[a-zA-Z0-9]+_s\d+_sf\d+_df\d+_fps\d+)/);
      const prefix = mm ? mm[1] : null;
      if (!prefix) return m;

      const q = await pool.query(
        `SELECT positive_prompt, negative_prompt, seed, width, height, length, fps
         FROM generation_prompts
         WHERE project_id = $1 AND filename_prefix = $2
         ORDER BY created_at DESC
         LIMIT 1`,
        [projectId, prefix]
      );
      if (!q.rows.length) return m;
      const gp = q.rows[0];
      const resolution = (gp.width && gp.height) ? `${gp.width}x${gp.height}` : undefined;
      meta = meta || {};
      meta.generation_settings = {
        ...(meta.generation_settings || {}),
        resolution,
        width: gp.width,
        height: gp.height,
        fps: gp.fps,
        prompt: gp.positive_prompt,
        negative_prompt: gp.negative_prompt,
        seed: gp.seed,
        length: gp.length,
        duration_frames: gp.length,
        source: (meta.generation_settings && meta.generation_settings.source) || 'modal_generated',
      };
      return { ...m, meta };
    } catch {
      return m;
    }
  }));

  return res.json({ ok: true, media: enriched });
});

/**
 * POST /api/projects/:id/media
 * Body: { kind?, filename?, remote_url, storage_backend?, storage_path?, meta? }
 * Inserts a media row for the project (manual add/reference).
 */
router.post("/projects/:id/media", requireAuth, async (req, res) => {
  const userId = req.user.sub;
  const projectId = req.params.id;
  if (!(await hasAccess(projectId, userId))) {
    return res.status(404).json({ error: "Project not found" });
  }
  const { kind = "video", filename, remote_url, storage_backend = "remote", storage_path = null, meta = {} } = req.body || {};
  if (!remote_url && !storage_path) {
    return res.status(400).json({ error: "Missing remote_url or storage_path" });
  }
  try {
    const name = filename || (remote_url ? (remote_url.split('/').pop() || kind) : kind);
    const { rows } = await pool.query(
      `INSERT INTO media (project_id, user_id, kind, filename, remote_url, storage_backend, storage_path, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (project_id, remote_url) DO UPDATE SET meta = media.meta || EXCLUDED.meta
       RETURNING id, project_id, user_id, kind, filename, remote_url, storage_backend, storage_path, meta, created_at`,
      [projectId, userId, kind, name, remote_url || null, storage_backend, storage_path, JSON.stringify(meta || {})]
    );
    return res.status(201).json({ ok: true, media: rows[0] });
  } catch (e) {
    console.error("media add error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /api/projects/:id/media/:mediaId/stream
 * Streams the media by proxying remote_url (Modal /files).
 * Accepts Range and passes it upstream.
 */
router.get("/projects/:id/media/:mediaId/stream", requireAuth, async (req, res) => {
  const userId = req.user.sub;
  const projectId = req.params.id;
  const mediaId = req.params.mediaId;

  if (!(await hasAccess(projectId, userId))) {
    console.warn("[media stream] access denied", { projectId, userId });
    return res.status(404).json({ error: "Project not found" });
  }

  // pinpoint: log request context after ACL pass
  console.log("[stream] request", { projectId, mediaId, userId });

  // Look up the media row
  const { rows } = await pool.query(
    `SELECT id, project_id, kind, filename, remote_url, storage_backend, storage_path
     FROM media
     WHERE id = $1 AND project_id = $2
     LIMIT 1`,
    [mediaId, projectId]
  );
  // pinpoint: how many rows we got back
  console.log("[stream] db rows", rows.length);
  const row = rows[0];

  if (!row) {
    console.warn("[stream] media row not found", { projectId, mediaId });
    return res.status(404).json({ error: "Not found" });
  }
  if (!row.remote_url && row.storage_backend !== 's3') {
    console.warn("[stream] remote_url missing", { projectId, mediaId });
    return res.status(404).json({ error: "Not found" });
  }

  try {
    // If S3-backed media: proxy the presigned URL instead of redirecting
    if (row.storage_backend === 's3' && isS3Configured()) {
      const key = row.storage_path;
      if (!key) return res.status(404).json({ error: "Not found" });
      try {
        // Generate presigned URL and proxy it instead of redirecting
        const ps = await presignGetUrl({ key });
        console.log("[media stream] Proxying S3 presigned URL", { key, url: ps.url });
        
        // Use the presigned URL as the remote_url for proxying
        row.remote_url = ps.url;
      } catch (e) {
        console.warn('[stream] s3 presign failed, falling back to remote_url', e && e.message || e);
        if (!row.remote_url) {
          return res.status(404).json({ error: "Not found" });
        }
      }
    }
    
    // Backblaze URLs: prefer direct public URL when bucket is public; presign only when required
    const isBackblazeUrl = row.remote_url && (
      row.remote_url.includes('backblazeb2.com')
    );

    if (isBackblazeUrl) {
      const preferDirect = String(process.env.STREAM_BACKBLAZE_DIRECT || '1') === '1';
      if (preferDirect) {
        // Verify object looks sane; if HEAD fails or tiny, fall back to presign if possible
        try {
          const MIN_VIDEO_BYTES = Number(process.env.MIN_VIDEO_BYTES || 4096);
          const head = await fetch(row.remote_url, { method: 'HEAD' });
          if (head.ok) {
            const len = Number(head.headers.get('content-length') || 0);
            if (!len || len < MIN_VIDEO_BYTES) {
              console.warn('[media stream] Backblaze HEAD tiny or missing length; will attempt presign fallback');
              throw new Error('tiny');
            }
            // Keep original public URL
          } else {
            throw new Error(`HEAD ${head.status}`);
          }
        } catch {
          // Fall back to presign if configured
          if (isS3Configured()) {
            try {
              const urlParts = row.remote_url.split('/file/');
              if (urlParts.length === 2) {
                const pathAfterFile = urlParts[1];
                const bucket = process.env.S3_BUCKET || '';
                let key = pathAfterFile;
                if (bucket && key.startsWith(bucket + '/')) key = key.slice(bucket.length + 1);
                console.log("[media stream] Backblaze direct check failed; generating presigned URL", { url: row.remote_url, key });
                const presigned = await presignGetUrl({ key, expiresIn: 3600 });
                console.log("[media stream] Generated presigned URL for Backblaze", { originalUrl: row.remote_url, presignedUrl: presigned.url, expiresIn: presigned.expiresIn });
                row.remote_url = presigned.url;
              }
            } catch (e) {
              console.warn('[media stream] Backblaze presign fallback failed:', e?.message || e);
            }
          }
        }
      } else if (isS3Configured()) {
        // Legacy/private bucket path: presign immediately
        try {
          const urlParts = row.remote_url.split('/file/');
          if (urlParts.length === 2) {
            const pathAfterFile = urlParts[1];
            const bucket = process.env.S3_BUCKET || '';
            let key = pathAfterFile;
            if (bucket && key.startsWith(bucket + '/')) key = key.slice(bucket.length + 1);
            console.log("[media stream] Backblaze URL detected, generating presigned URL", { url: row.remote_url, key });
            const presigned = await presignGetUrl({ key, expiresIn: 3600 });
            console.log("[media stream] Generated presigned URL for Backblaze", { originalUrl: row.remote_url, presignedUrl: presigned.url, expiresIn: presigned.expiresIn });
            row.remote_url = presigned.url;
          }
        } catch (presignError) {
          console.warn("[media stream] Presigned URL generation failed for Backblaze", presignError?.message || presignError);
        }
      }
    }

    // Forward Range headers for partial content
    const headers = {};
    if (req.headers.range) headers["range"] = req.headers.range;
    // Some CDNs want a UA
    if (req.headers["user-agent"]) headers["user-agent"] = req.headers["user-agent"];
    if (req.headers.accept) headers["accept"] = req.headers.accept;

    // Retry logic for streaming with exponential backoff
    const fetchWithRetry = async (url, retries = 3) => {
      for (let attempt = 0; attempt < retries; attempt++) {
        try {
          const response = await fetch(url, {
            method: "GET",
            headers,
            redirect: "follow",
          });
          
          // If successful or not a range/availability issue, return immediately
          if (response.ok || (response.status !== 416 && response.status !== 404)) {
            return response;
          }
          
          // For 416 (Range Not Satisfiable) or 404, retry with exponential backoff
          if (attempt < retries - 1) {
            const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
            console.log(`[media-stream] Retry ${attempt + 1}/${retries} for ${url} after ${delay}ms (status: ${response.status})`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        } catch (error) {
          if (attempt === retries - 1) throw error;
          const delay = Math.pow(2, attempt) * 1000;
          console.log(`[media-stream] Retry ${attempt + 1}/${retries} for ${url} after ${delay}ms (error: ${error.message})`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
      
      // Final attempt
      return await fetch(url, {
        method: "GET",
        headers,
        redirect: "follow",
      });
    };

    const upstream = await fetchWithRetry(row.remote_url);

    // Bubble up the upstream status
    res.status(upstream.status);

    // Forward important headers so the browser can play/seek
    const copy = [
      "content-type",
      "content-length",
      "accept-ranges",
      "content-range",
      "etag",
      "last-modified",
      "cache-control",
    ];
    copy.forEach((h) => {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    });

    // Helpful trace headers
    res.setHeader("x-proxied-from", row.remote_url);
    res.setHeader("x-media-id", row.id);

    const MIN_VIDEO_BYTES = Number(process.env.MIN_VIDEO_BYTES || 4096);
    const upstreamLen = Number(upstream.headers.get('content-length') || 0);

    if (upstream.ok && upstreamLen && upstreamLen < MIN_VIDEO_BYTES) {
      console.warn("[media stream] upstream too small", { url: row.remote_url, len: upstreamLen });
      return res.json({ error: 'Upstream object too small', status: 502, tiny_object: true, proxied_from: row.remote_url, content_length: upstreamLen });
    }

    if (!upstream.ok) {
      // Don’t stream HTML error pages; send a small JSON with reason
      const text = await upstream.text().catch(() => "");
      console.warn("[media stream] upstream error", {
        status: upstream.status,
        url: row.remote_url,
        range: req.headers.range,
        text: text && text.slice(0, 200),
      });
      return res.json({
        error: "Upstream fetch failed",
        status: upstream.status,
      });
    }

    // Stream the body (support Node.js web streams and classic)
    const body = upstream.body;
    if (body && typeof body.pipe === "function") {
      body.pipe(res);
    } else if (body) {
      Readable.fromWeb(body).pipe(res);
    } else {
      res.end();
    }
  } catch (e) {
    console.error("[media stream] proxy error", e);
    res.status(502).json({ error: "Proxy failed" });
  }
});

/**
 * GET /api/projects/:id/media/:mediaId
 * Cheap existence/details check used by frontend readiness probing.
 */
router.get("/projects/:id/media/:mediaId", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const projectId = req.params.id;
    const mediaId = req.params.mediaId;

    if (!(await hasAccess(projectId, userId))) {
      return res.status(404).json({ error: "Project not found" });
    }

    const { rows } = await pool.query(
      `SELECT id, project_id, user_id, kind, filename, remote_url, storage_backend, storage_path, meta, created_at
       FROM media
       WHERE id = $1 AND project_id = $2
       LIMIT 1`,
      [mediaId, projectId]
    );

    if (!rows.length) return res.status(404).json({ error: "Not found" });
    return res.json({ ok: true, media: rows[0] });
  } catch (e) {
    console.error("[media get one] error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /api/projects/:id/media/:mediaId/prompts
 * Returns generation prompts/settings for a given media item.
 * Priority: media.meta.generation_settings -> generation_prompts by filename_prefix -> in-memory regen map.
 */
router.get("/projects/:id/media/:mediaId/prompts", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const projectId = req.params.id;
    const mediaId = req.params.mediaId;

    if (!(await hasAccess(projectId, userId))) {
      return res.status(404).json({ error: "Project not found" });
    }

    const { rows } = await pool.query(
      `SELECT id, project_id, user_id, kind, filename, meta
       FROM media
       WHERE id = $1 AND project_id = $2
       LIMIT 1`,
      [mediaId, projectId]
    );

    if (!rows.length) return res.status(404).json({ error: "Not found" });
    const media = rows[0];

    // 1) Directly from media.meta
    const gs = media?.meta?.generation_settings || null;
    if (gs && (gs.prompt || gs.negative_prompt || typeof gs.seed !== 'undefined')) {
      return res.json({ ok: true, source: 'media_meta', prompts: {
        positive_prompt: gs.prompt || null,
        negative_prompt: gs.negative_prompt || null,
        seed: gs.seed ?? null,
        width: gs.width ?? null,
        height: gs.height ?? null,
        length: gs.length ?? gs.duration_frames ?? null,
        fps: gs.fps ?? null,
      }});
    }

    // 2) From generation_prompts via filename_prefix parsed from filename
    let prefix = null;
    try {
      const fn = media.filename || '';
      const mm = fn.match(/(u[a-f0-9\-]+_p[a-f0-9\-]+_g[a-zA-Z0-9]+_s\d+_sf\d+_df\d+_fps\d+)/);
      prefix = mm ? mm[1] : null;
    } catch {}

    if (prefix) {
      try {
        const g = await pool.query(
          `SELECT positive_prompt, negative_prompt, seed, width, height, length, fps
           FROM generation_prompts
           WHERE project_id = $1 AND filename_prefix = $2
           ORDER BY created_at DESC LIMIT 1`,
          [projectId, prefix]
        );
        if (g.rows.length) {
          const gp = g.rows[0];
          return res.json({ ok: true, source: 'generation_prompts', filename_prefix: prefix, prompts: {
            positive_prompt: gp.positive_prompt,
            negative_prompt: gp.negative_prompt,
            seed: gp.seed,
            width: gp.width,
            height: gp.height,
            length: gp.length,
            fps: gp.fps,
          }});
        }
      } catch {}
      // 3) Fallback to in-memory regen map if present
      try {
        const m = getRegenMapping(prefix);
        if (m && m.projectId === projectId && m.settings) {
          const s = m.settings;
          return res.json({ ok: true, source: 'regen_map', filename_prefix: prefix, prompts: {
            positive_prompt: s.prompt ?? null,
            negative_prompt: s.negative ?? null,
            seed: s.seed ?? null,
            width: s.width ?? null,
            height: s.height ?? null,
            length: s.length ?? null,
            fps: s.fps ?? null,
          }});
        }
      } catch {}
    }

    return res.json({ ok: true, prompts: null });
  } catch (e) {
    console.error("[media prompts] error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/media/pending-upload
 * Handle pending uploads from Modal fallback storage
 */
router.post("/pending-upload", async (req, res) => {
  try {
    const { type, path, filename, status } = req.body || {};
    
    if (type !== "pending_upload") {
      return res.status(400).json({ error: "Invalid request type" });
    }
    
    console.log(`[PENDING-UPLOAD] Received pending upload notification: ${filename}`, {
      path,
      status
    });
    
    // Store pending upload info in database for monitoring
    const { rows } = await pool.query(
      `INSERT INTO pending_uploads (filename, path, status, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT (filename) DO UPDATE SET
         status = $3,
         updated_at = NOW()
       RETURNING id`,
      [filename, path, status]
    );
    
    // Notify user via WebSocket if possible
    if (global.io) {
      // Extract project info from filename if possible
      const match = filename.match(/ua([a-f0-9\-]+)_p([a-f0-9\-]+)_/);
      if (match) {
        const userId = match[1];
        const projectId = match[2];
        
        global.io.to(`project:${projectId}`).emit('upload-status', {
          type: 'pending',
          filename,
          message: 'Video uploaded to temporary storage, retrying upload to cloud...',
          status: 'pending_retry'
        });
      }
    }
    
    res.json({ ok: true, message: "Pending upload recorded" });
    
  } catch (e) {
    console.error("pending-upload error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/media/modal-upload
 * Receive upload notifications from Modal app
 */
router.post("/modal-upload", async (req, res) => {
  try {
    const { key, remote_url, filename, kind = "video", source = "modal_generated", project_id, user_id } = req.body || {};
    
    if (!key || !remote_url || !filename) {
      return res.status(400).json({ error: "Missing required fields: key, remote_url, filename" });
    }
    
    // Restrict imports to only Backblaze URLs - reject Modal URLs
    if (!remote_url.includes('backblazeb2.com')) {
      console.log(`[MODAL-UPLOAD] Rejected non-Backblaze URL: ${remote_url}`);
      return res.status(400).json({ error: "Only Backblaze URLs are allowed for video imports" });
    }
    
    // Basic safety: reject obviously tiny objects before inserting media rows
    try {
      const MIN_VIDEO_BYTES = Number(process.env.MIN_VIDEO_BYTES || 4096);
      const head = await fetch(remote_url, { method: 'HEAD' });
      if (head.ok) {
        const len = Number(head.headers.get('content-length') || 0);
        if (len && len < MIN_VIDEO_BYTES) {
          console.warn(`[MODAL-UPLOAD] Rejected tiny object (${len} bytes) for ${filename}`);
          return res.status(409).json({ error: 'Object too small, retry upload', contentLength: len });
        }
      }
    } catch (e) {
      console.warn('[MODAL-UPLOAD] HEAD check failed, continuing:', e?.message || e);
    }

    // Extract project and user info from the filename if not provided
    let finalProjectId = project_id;
    let finalUserId = user_id;
    
    // Parse project and user IDs from filename format: u{userId}_p{projectId}_...
    // Note: earlier versions mistakenly documented 'ua{userId}'. The actual prefix is 'u{userId}'.
    if (!finalProjectId || !finalUserId) {
      const match = filename.match(/u([a-f0-9\-]+)_p([a-f0-9\-]+)_/);
      if (match) {
        finalUserId = finalUserId || match[1];
        finalProjectId = finalProjectId || match[2];
        console.log(`[MODAL-UPLOAD] Extracted from filename - User: ${finalUserId}, Project: ${finalProjectId}`);
      }
    }
    
    // Ensure UUIDs are properly formatted (add missing 'a' prefix if needed)
    if (finalUserId && !finalUserId.startsWith('a') && finalUserId.length === 35) {
      finalUserId = 'a' + finalUserId;
      console.log(`[MODAL-UPLOAD] Fixed user ID format: ${finalUserId}`);
    }
    
    // Extract filename prefix to link with generation prompts and replacement mapping
    // Be tolerant of leading counters or path segments before the u..._p... pattern
    const filenamePrefixMatch = filename.match(/(u[a-f0-9\-]+_p[a-f0-9\-]+_g[a-zA-Z0-9]+_s\d+_sf\d+_df\d+_fps\d+)/);
    const filenamePrefix = filenamePrefixMatch ? filenamePrefixMatch[1] : null;
    
    // Look up generation prompts for this filename prefix
    let generationPrompt = null;
    let mappingForPrompts = null;
    if (filenamePrefix) {
      try {
        const { rows: promptRows } = await pool.query(
          `SELECT positive_prompt, negative_prompt, seed, width, height, length, fps, created_at
           FROM generation_prompts 
           WHERE filename_prefix = $1 AND project_id = $2
           ORDER BY created_at DESC LIMIT 1`,
          [filenamePrefix, finalProjectId]
        );
        if (promptRows.length > 0) {
          generationPrompt = promptRows[0];
          console.log(`[MODAL-UPLOAD] Found generation prompt for ${filenamePrefix}`);
        }
      } catch (e) {
        console.warn(`[MODAL-UPLOAD] Failed to lookup generation prompt: ${e.message}`);
      }
      // Fallback: use in-memory regen mapping if DB lookup failed
      try {
        const m = getRegenMapping(filenamePrefix);
        if (!generationPrompt && m && m.projectId === finalProjectId && m.settings) {
          mappingForPrompts = m.settings;
          console.log(`[MODAL-UPLOAD] Using in-memory mapping for prompts: ${filenamePrefix}`);
        }
      } catch {}
    }

    // Create media entry associated with the correct project and user
    const { rows } = await pool.query(
      `INSERT INTO media (project_id, user_id, kind, filename, remote_url, storage_backend, storage_path, meta)
       VALUES ($1, $2, $3, $4, $5, 's3', $6, $7)
       RETURNING id, project_id, user_id, kind, filename, remote_url, storage_backend, storage_path, created_at`,
      [
        finalProjectId, 
        finalUserId, 
        kind, 
        filename, 
        remote_url, 
        key, 
        JSON.stringify({ 
          source, 
          uploaded_at: new Date().toISOString(),
          auto_imported: true,
          generation_settings: {
            resolution: generationPrompt ? `${generationPrompt.width}x${generationPrompt.height}` : (mappingForPrompts ? `${mappingForPrompts.width}x${mappingForPrompts.height}` : "512x384"),
            fps: generationPrompt ? generationPrompt.fps : (mappingForPrompts ? mappingForPrompts.fps : 12),
            source: "modal_generated",
            prompt: generationPrompt ? generationPrompt.positive_prompt : (mappingForPrompts ? mappingForPrompts.prompt : null),
            negative_prompt: generationPrompt ? generationPrompt.negative_prompt : (mappingForPrompts ? mappingForPrompts.negative : null),
            seed: generationPrompt ? generationPrompt.seed : (mappingForPrompts ? mappingForPrompts.seed : null),
            width: generationPrompt ? generationPrompt.width : (mappingForPrompts ? mappingForPrompts.width : undefined),
            height: generationPrompt ? generationPrompt.height : (mappingForPrompts ? mappingForPrompts.height : undefined),
            duration_frames: generationPrompt ? generationPrompt.length : (mappingForPrompts ? mappingForPrompts.length : null)
          }
        })
      ]
    );
    
    console.log(`[MODAL-UPLOAD] Auto-imported video: ${filename} -> Project: ${finalProjectId}`);
    console.log(`[MODAL-UPLOAD] Media ID: ${rows[0].id} | URL: ${remote_url}`);
    
    // Replacement path: if a regeneration mapping exists for this filenamePrefix,
    // update the existing timeline item instead of inserting a new one.
    let replaced = false;
    if (filenamePrefix) {
      try {
        const mapping = getRegenMapping(filenamePrefix);
        if (mapping && mapping.projectId === finalProjectId) {
          const targetItemId = mapping.timelineItemId;
          // Update the existing timeline item to point to the new media
          const upd = await pool.query(
            `UPDATE timeline_items
             SET ref_id = $1
             WHERE id = $2 AND project_id = $3
             RETURNING id, project_id, user_id, type, ref_id, payload, created_at`,
            [rows[0].id, targetItemId, finalProjectId]
          );
          if (upd.rows.length) {
            replaced = true;
            deleteRegenMapping(filenamePrefix);
            // Emit timeline update
            try {
              const { getIO } = await import('../server.js');
              const io = getIO();
              if (io) {
                io.emit('timeline:new', {
                  projectId: finalProjectId,
                  userId: finalUserId,
                  timelineItem: upd.rows[0],
                });
              }
            } catch (e) {
              console.warn('[MODAL-UPLOAD] Replacement timeline event failed:', e?.message || e);
            }
          }
        } else if (generationPrompt && generationPrompt.replace_item_id) {
          // Persistent replacement when server restarted between submission and upload
          const targetItemId = generationPrompt.replace_item_id;
          const upd = await pool.query(
            `UPDATE timeline_items
             SET ref_id = $1
             WHERE id = $2 AND project_id = $3
             RETURNING id, project_id, user_id, type, ref_id, payload, created_at`,
            [rows[0].id, targetItemId, finalProjectId]
          );
          if (upd.rows.length) {
            replaced = true;
            try {
              const { getIO } = await import('../server.js');
              const io = getIO();
              if (io) {
                io.emit('timeline:new', {
                  projectId: finalProjectId,
                  userId: finalUserId,
                  timelineItem: upd.rows[0],
                });
              }
            } catch (e) {
              console.warn('[MODAL-UPLOAD] Persist replacement timeline event failed:', e?.message || e);
            }
          }
        }

        // Heuristic fallback: if still not replaced, match by placement window encoded in filename
        if (!replaced) {
          const m = filenamePrefix.match(/s(\d+)_sf(\d+)_df(\d+)_fps(\d+)/);
          if (m) {
            const startFrame = parseInt(m[2], 10);
            const durationFrames = parseInt(m[3], 10);
            const fps = parseInt(m[4], 10);
            const upd2 = await pool.query(
              `UPDATE timeline_items
               SET ref_id = $1
               WHERE project_id = $2
                 AND type LIKE 'placed_%'
                 AND (payload->>'start_frame')::int = $3
                 AND (payload->>'duration_frames')::int = $4
                 AND ((payload->>'fps')::int = $5 OR (payload->>'fps') IS NULL)
               RETURNING id, project_id, user_id, type, ref_id, payload, created_at`,
              [rows[0].id, finalProjectId, startFrame, durationFrames, fps]
            );
            if (upd2.rows.length) {
              replaced = true;
              try {
                const { getIO } = await import('../server.js');
                const io = getIO();
                if (io) {
                  io.emit('timeline:new', {
                    projectId: finalProjectId,
                    userId: finalUserId,
                    timelineItem: upd2.rows[0],
                  });
                }
              } catch (e) {
                console.warn('[MODAL-UPLOAD] Heuristic replacement timeline event failed:', e?.message || e);
              }
            }
          }
        }
      } catch (e) {
        console.warn('[MODAL-UPLOAD] Replacement mapping check failed:', e?.message || e);
      }
    }

    // Automatically add to timeline if this is a generated video and not replaced
    if (!replaced && filenamePrefix && generationPrompt) {
      try {
        // Extract shot information from filename
        const shotMatch = filenamePrefix.match(/s(\d+)_sf(\d+)_df(\d+)_fps(\d+)/);
        if (shotMatch) {
          const [, shotNumber, startFrame, durationFrames, fps] = shotMatch;
          
          // Add to timeline as a placed_video
          await pool.query(
            `INSERT INTO timeline_items (project_id, user_id, type, ref_id, payload)
             VALUES ($1, $2, 'placed_video', $3, $4)`,
            [
              finalProjectId,
              finalUserId,
              rows[0].id, // media ID
              JSON.stringify({
                track: 'Generated',
                start_frame: parseInt(startFrame),
                duration_frames: parseInt(durationFrames),
                fps: parseInt(fps),
                shot_number: parseInt(shotNumber)
              })
            ]
          );
          
          console.log(`[MODAL-UPLOAD] Added to timeline: shot ${shotNumber}, frames ${startFrame}-${parseInt(startFrame) + parseInt(durationFrames)}`);
          
          // Emit timeline update event
          try {
            const { getIO } = await import('../server.js');
            const io = getIO();
            if (io) {
              io.emit('timeline:new', {
                projectId: finalProjectId,
                userId: finalUserId,
                // Consumers generally reload timeline; we still provide minimal context
                timelineItem: { type: 'placed_video', ref_id: rows[0].id }
              });
              console.log(`[MODAL-UPLOAD] Timeline update event emitted`);
            }
          } catch (timelineError) {
            console.warn(`[MODAL-UPLOAD] Timeline event failed: ${timelineError.message}`);
          }
        }
      } catch (e) {
        console.warn(`[MODAL-UPLOAD] Failed to add to timeline: ${e.message}`);
      }
    }
    
    // If we have project/user info, emit a socket event for real-time updates
    if (finalProjectId && finalUserId) {
      try {
        // Import the socket.io instance
        const { getIO } = await import('../server.js');
        const io = getIO();
        
        if (io) {
          io.emit('media:new', {
            projectId: finalProjectId,
            userId: finalUserId,
            media: rows[0]
          });
          console.log(`[MODAL-UPLOAD] Socket event emitted for project ${finalProjectId}`);
        }
      } catch (socketError) {
        console.warn(`[MODAL-UPLOAD] Socket notification failed: ${socketError.message}`);
      }
    }
    
    return res.status(200).json({ ok: true, media: rows[0] });
  } catch (e) {
    console.error("modal-upload error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/media/:mediaId/metadata
 * Body: { durationMs?: number, width?: number, height?: number }
 * Merges into media.meta as JSONB. Requires membership to the owning project.
 */
router.post("/media/:mediaId/metadata", async (req, res) => {
  try {
    const userId = req.user.sub;
    const { mediaId } = req.params;
    const { durationMs, width, height } = req.body || {};

    const payload = {};
    if (Number.isFinite(Number(durationMs))) payload.duration_ms = Math.max(0, Number(durationMs));
    if (Number.isFinite(Number(width))) payload.width = Math.max(0, Number(width));
    if (Number.isFinite(Number(height))) payload.height = Math.max(0, Number(height));

    if (!Object.keys(payload).length) {
      return res.status(400).json({ error: "No valid metadata provided" });
    }

    const { rows } = await pool.query(
      `
      UPDATE media m
      SET meta = COALESCE(m.meta, '{}'::jsonb) || $2::jsonb
      FROM projects p
      WHERE m.id = $1
        AND p.id = m.project_id
        AND (
          p.owner_id = $3 OR EXISTS (
            SELECT 1 FROM project_members pm
            WHERE pm.project_id = p.id AND pm.user_id = $3
          )
        )
      RETURNING m.id, m.project_id, m.meta
      `,
      [mediaId, JSON.stringify(payload), userId]
    );

    const row = rows[0];
    if (!row) return res.status(404).json({ error: "Not found" });
    return res.json({ ok: true, media: row });
  } catch (e) {
    console.error("[media metadata] error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/extract-video-metadata
 * Body: { url?: string, dataUrl?: string }
 * Uses ffprobe if available; returns { ok, width?, height?, durationMs? }.
 */
router.post("/extract-video-metadata", async (req, res) => {
  try {
    const { url, dataUrl } = req.body || {};
    let probePath = null;
    let cleanup = null;

    if (typeof dataUrl === "string" && dataUrl.startsWith("data:")) {
      // Write data URL to a temp file
      const m = dataUrl.match(/^data:[^;]+;base64,(.+)$/);
      if (!m) return res.status(400).json({ ok: false, error: "Invalid dataUrl" });
      const buf = Buffer.from(m[1], "base64");
      const tmp = path.join(os.tmpdir(), `probe_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`);
      fs.writeFileSync(tmp, buf);
      probePath = tmp;
      cleanup = () => { try { fs.unlinkSync(tmp); } catch {} };
    } else if (typeof url === "string" && url) {
      probePath = url; // ffprobe can take http(s) urls if network is allowed
    } else {
      return res.status(400).json({ ok: false, error: "Missing url or dataUrl" });
    }

    const run = () => new Promise((resolve, reject) => {
      const args = [
        "-v", "error",
        "-print_format", "json",
        "-show_entries", "format=duration:stream=width,height",
        probePath,
      ];
      const p = spawn("ffprobe", args, { stdio: ["ignore", "pipe", "pipe"] });
      let out = ""; let err = "";
      p.stdout.on("data", (b) => out += b.toString());
      p.stderr.on("data", (b) => err += b.toString());
      p.on("error", reject);
      p.on("close", (code) => code === 0 ? resolve(out) : reject(new Error(err || `ffprobe exit ${code}`)));
    });

    let json = null;
    try { json = JSON.parse(await run()); }
    catch (e) { if (cleanup) cleanup(); return res.status(500).json({ ok: false, error: e.message }); }
    if (cleanup) cleanup();

    const streams = Array.isArray(json && json.streams) ? json.streams : [];
    const v = streams.find(s => (s.width && s.height));
    const width = v && v.width || null;
    const height = v && v.height || null;
    const duration = Number(json && json.format && json.format.duration || 0);
    const durationMs = Number.isFinite(duration) ? Math.round(duration * 1000) : null;
    return res.json({ ok: true, width, height, durationMs });
  } catch (e) {
    console.error("extract-video-metadata error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

/**
 * POST /api/projects/:id/bulk-upload
 * JSON variant: { items: [{ kind?, filename?, remote_url, meta? }, ...] }
 * Inserts multiple media references. Multipart upload is not supported in this build.
 */
router.post("/projects/:id/bulk-upload", upload.array("files"), async (req, res) => {
  const userId = req.user.sub;
  const projectId = req.params.id;
  if (!(await hasAccess(projectId, userId))) {
    return res.status(404).json({ error: "Project not found" });
  }
  const out = [];

  // Path A: multipart files
  if (Array.isArray(req.files) && req.files.length) {
    for (const f of req.files) {
      try {
        const safeName = (f.originalname || `upload_${Date.now()}`).replace(/[^A-Za-z0-9._-]/g, "_");
        const key = `user/${userId}/project/${projectId}/uploads/${Date.now()}_${Math.random().toString(36).slice(2)}_${safeName}`;
        const outS3 = await uploadBufferToS3({ key, body: f.buffer, contentType: f.mimetype || "application/octet-stream" });
        const { rows } = await pool.query(
          `INSERT INTO media (project_id, user_id, kind, filename, remote_url, storage_backend, storage_path, meta)
           VALUES ($1,$2,'video',$3,$4,'s3',$5,'{}')
           RETURNING id, project_id, user_id, kind, filename, remote_url, storage_backend, storage_path, created_at`,
          [projectId, userId, safeName, outS3.remote_url, outS3.key]
        );
        out.push(rows[0]);
      } catch (e) {
        console.warn("bulk-upload file failed", e && e.message || e);
      }
    }
    return res.status(201).json({ ok: true, items: out, count: out.length });
  }

  // Path B: JSON list of remote_url references
  const items = Array.isArray(req.body && req.body.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ error: "No items provided (files[] or JSON items[])" });
  for (const it of items) {
    if (!it || (!it.remote_url)) continue;
    
    // Validate remote_url - reject Modal URLs and only allow Backblaze URLs
    if (it.remote_url.includes('modal.run') || it.remote_url.includes('modal.com')) {
      console.warn(`[bulk-upload] Rejected Modal URL: ${it.remote_url}`);
      continue;
    }
    
    // Only allow Backblaze URLs for remote references
    if (!it.remote_url.includes('backblazeb2.com')) {
      console.warn(`[bulk-upload] Rejected non-Backblaze URL: ${it.remote_url}`);
      continue;
    }
    
    const kind = it.kind || "video";
    const name = it.filename || (it.remote_url.split('/').pop() || kind);
    try {
      const { rows } = await pool.query(
        `INSERT INTO media (project_id, user_id, kind, filename, remote_url, storage_backend, storage_path, meta)
         VALUES ($1,$2,$3,$4,$5,'s3',NULL,$6)
         ON CONFLICT (project_id, remote_url) DO UPDATE SET meta = media.meta || EXCLUDED.meta
         RETURNING id, project_id, user_id, kind, filename, remote_url, meta, created_at`,
        [projectId, userId, kind, name, it.remote_url, JSON.stringify(it.meta || {})]
      );
      out.push(rows[0]);
    } catch (e) {
      console.warn("bulk-upload insert failed", e && e.message || e);
    }
  }
  return res.status(201).json({ ok: true, items: out, count: out.length });
});

/**
 * POST /api/upload-video
 * JSON fallback: { projectId, filename?, remote_url?, dataUrl?, kind? }
 * If you need multipart file upload, wire Multer in a follow-up.
 */
router.post("/upload-video", upload.single("file"), async (req, res) => {
  try {
    const userId = req.user.sub;
    const { projectId, filename, remote_url, dataUrl, kind = "video" } = req.body || {};
    if (!projectId) return res.status(400).json({ error: "Missing projectId" });
    if (!(await hasAccess(projectId, userId))) {
      return res.status(404).json({ error: "Project not found" });
    }
    if (!req.file && !remote_url && !dataUrl) return res.status(400).json({ error: "Provide file, remote_url, or dataUrl" });

    let storage_backend = "remote";
    let storage_path = null;
    let finalRemote = remote_url || null;
    let name = filename || null;

    if (req.file && req.file.buffer) {
      // Upload to S3
      const safeName = (name || req.file.originalname || `upload_${Date.now()}`).replace(/[^A-Za-z0-9._-]/g, "_");
      const key = `user/${userId}/project/${projectId}/uploads/${Date.now()}_${Math.random().toString(36).slice(2)}_${safeName}`;
      const out = await uploadBufferToS3({ key, body: req.file.buffer, contentType: req.file.mimetype || "application/octet-stream" });
      storage_backend = "s3";
      storage_path = out.key;
      finalRemote = out.remote_url;
      name = safeName;
    } else if (dataUrl && typeof dataUrl === "string" && dataUrl.startsWith("data:")) {
      // Persist to a temp file to make it streamable (local-only demo)
      const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!m) return res.status(400).json({ error: "Invalid dataUrl" });
      const ext = m[1] === 'video/mp4' ? '.mp4' : '';
      const tmpDir = path.join(os.tmpdir(), 'uploads');
      fs.mkdirSync(tmpDir, { recursive: true });
      const file = path.join(tmpDir, `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
      fs.writeFileSync(file, Buffer.from(m[2], 'base64'));
      storage_backend = 'local';
      storage_path = file;
      name = name || path.basename(file);
    }

    const { rows } = await pool.query(
      `INSERT INTO media (project_id, user_id, kind, filename, remote_url, storage_backend, storage_path, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'{}')
       RETURNING id, project_id, user_id, kind, filename, remote_url, storage_backend, storage_path, created_at`,
      [projectId, userId, kind, name || kind, finalRemote, storage_backend, storage_path]
    );
    return res.status(201).json({ ok: true, media: rows[0] });
  } catch (e) {
    console.error("upload-video error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

// Project-scoped upload alias: POST /api/projects/:id/upload
router.post("/projects/:id/upload", upload.single("file"), async (req, res) => {
  try {
    const userId = req.user.sub;
    const projectId = req.params.id;
    const { filename, remote_url, dataUrl, kind = "video" } = req.body || {};
    if (!(await hasAccess(projectId, userId))) {
      return res.status(404).json({ error: "Project not found" });
    }
    if (!req.file && !remote_url && !dataUrl) return res.status(400).json({ error: "Provide file, remote_url, or dataUrl" });

    let storage_backend = "remote";
    let storage_path = null;
    let finalRemote = remote_url || null;
    let name = filename || null;

    // Validate remote_url if provided - reject Modal URLs
    if (finalRemote && (finalRemote.includes('modal.run') || finalRemote.includes('modal.com'))) {
      console.warn(`[project-upload] Rejected Modal URL: ${finalRemote}`);
      return res.status(400).json({ error: "Modal URLs are not allowed. Please use Backblaze URLs or upload files directly." });
    }

    if (req.file && req.file.buffer) {
      const safeName = (name || req.file.originalname || `upload_${Date.now()}`).replace(/[^A-Za-z0-9._-]/g, "_");
      const key = `user/${userId}/project/${projectId}/uploads/${Date.now()}_${Math.random().toString(36).slice(2)}_${safeName}`;
      const out = await uploadBufferToS3({ key, body: req.file.buffer, contentType: req.file.mimetype || "application/octet-stream" });
      storage_backend = "s3";
      storage_path = out.key;
      finalRemote = out.remote_url;
      name = safeName;
    } else if (dataUrl && typeof dataUrl === "string" && dataUrl.startsWith("data:")) {
      const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!m) return res.status(400).json({ error: "Invalid dataUrl" });
      const ext = m[1] === 'video/mp4' ? '.mp4' : '';
      const tmpDir = path.join(os.tmpdir(), 'uploads');
      fs.mkdirSync(tmpDir, { recursive: true });
      const file = path.join(tmpDir, `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
      fs.writeFileSync(file, Buffer.from(m[2], 'base64'));
      storage_backend = 'local';
      storage_path = file;
      name = name || path.basename(file);
    }

    const { rows } = await pool.query(
      `INSERT INTO media (project_id, user_id, kind, filename, remote_url, storage_backend, storage_path, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'{}')
       RETURNING id, project_id, user_id, kind, filename, remote_url, storage_backend, storage_path, created_at`,
      [projectId, userId, kind, name || kind, finalRemote, storage_backend, storage_path]
    );
    return res.status(201).json({ ok: true, media: rows[0] });
  } catch (e) {
    console.error("project upload error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /api/storage/s3/presign-upload?projectId&filename&contentType
 * Returns a presigned PUT URL to upload directly to S3 from the browser.
 */
router.get("/storage/s3/presign-upload", async (req, res) => {
  try {
    if (!isS3Configured()) return res.status(400).json({ error: "S3 not configured" });
    const userId = req.user.sub;
    const projectId = String(req.query.projectId || "");
    const filename = String(req.query.filename || "upload.bin").replace(/[^A-Za-z0-9._-]/g, "_");
    const contentType = String(req.query.contentType || "application/octet-stream");
    if (!projectId) return res.status(400).json({ error: "Missing projectId" });
    if (!(await hasAccess(projectId, userId))) return res.status(404).json({ error: "Project not found" });

    const key = `user/${userId}/project/${projectId}/uploads/${Date.now()}_${Math.random().toString(36).slice(2)}_${filename}`;
    const out = await presignPutUrl({ key, contentType });
    return res.json({ ok: true, ...out });
  } catch (e) {
    console.error("presign-upload error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /api/media/:mediaId/presign
 * Returns a presigned GET URL for S3-backed media (private bucket access).
 */
router.get("/media/:mediaId/presign", async (req, res) => {
  try {
    const userId = req.user.sub;
    const mediaId = req.params.mediaId;
    // Find media and project for ACL
    const { rows } = await pool.query(
      `SELECT m.id, m.project_id, m.storage_backend, m.storage_path
       FROM media m
       WHERE id = $1
       LIMIT 1`,
      [mediaId]
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ error: "Not found" });
    if (!(await hasAccess(row.project_id, userId))) return res.status(404).json({ error: "Not found" });
    if (row.storage_backend !== 's3' || !row.storage_path) return res.status(400).json({ error: "Not S3-backed" });
    const out = await presignGetUrl({ key: row.storage_path });
    return res.json({ ok: true, url: out.url, expiresIn: out.expiresIn });
  } catch (e) {
    console.error("media presign error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /api/media/upload-stats
 * Get upload statistics and monitoring data
 */
router.get("/upload-stats", async (req, res) => {
  try {
    const { uploadMonitor } = await import("../services/uploadMonitor.js");
    const stats = await uploadMonitor.getUploadStats();
    
    res.json({ 
      ok: true, 
      stats,
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    console.error("upload-stats error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /api/media/pending-uploads
 * Get list of pending uploads for monitoring
 */
router.get("/pending-uploads", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT 
        id,
        filename,
        status,
        retry_count,
        created_at,
        updated_at,
        last_error
      FROM pending_uploads 
      WHERE status IN ('pending', 'failed')
      ORDER BY created_at DESC
      LIMIT 50
    `);
    
    res.json({ 
      ok: true, 
      uploads: rows,
      count: rows.length
    });
  } catch (e) {
    console.error("pending-uploads error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /api/media/stats
 * Get media storage statistics and health information
 */
router.get("/stats", requireAuth, async (req, res) => {
  try {
    const stats = await mediaMonitor.getMediaStats();
    const problematicMedia = await mediaMonitor.getProblematicMedia();
    
    res.json({
      ok: true,
      stats,
      problematic_media: problematicMedia,
      summary: {
        total_media: stats.reduce((sum, stat) => sum + stat.total_count, 0),
        s3_media: stats.find(s => s.storage_backend === 's3')?.total_count || 0,
        remote_media: stats.find(s => s.storage_backend === 'remote')?.total_count || 0,
        local_media: stats.find(s => s.storage_backend === 'local')?.total_count || 0,
        modal_urls: problematicMedia.length
      }
    });
  } catch (e) {
    console.error("media stats error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /api/media/health
 * Check media storage health and return status
 */
router.get("/health", requireAuth, async (req, res) => {
  try {
    const stats = await mediaMonitor.getMediaStats();
    const problematicMedia = await mediaMonitor.getProblematicMedia();
    
    const health = {
      status: 'healthy',
      issues: [],
      recommendations: []
    };
    
    // Check for problematic storage backends
    const remoteStats = stats.find(s => s.storage_backend === 'remote');
    const localStats = stats.find(s => s.storage_backend === 'local');
    const s3Stats = stats.find(s => s.storage_backend === 's3');
    
    if (problematicMedia.length > 0) {
      health.status = 'warning';
      health.issues.push(`${problematicMedia.length} media files with Modal URLs (will expire)`);
      health.recommendations.push('Run migration script to handle expired Modal URLs');
    }
    
    if (localStats && localStats.total_count > 0) {
      health.status = 'warning';
      health.issues.push(`${localStats.total_count} media files stored locally (not persistent)`);
      health.recommendations.push('Migrate local media files to Backblaze for persistence');
    }
    
    if (remoteStats && remoteStats.total_count > 0) {
      health.status = 'warning';
      health.issues.push(`${remoteStats.total_count} media files using remote storage backend`);
      health.recommendations.push('Review remote media files and migrate to S3/Backblaze');
    }
    
    if (s3Stats && s3Stats.total_count > 0) {
      health.recommendations.push(`✅ ${s3Stats.total_count} media files properly stored in S3/Backblaze`);
    }
    
    res.json({
      ok: true,
      health,
      stats,
      problematic_media_count: problematicMedia.length
    });
  } catch (e) {
    console.error("media health error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/projects/:id/media/backfill-prompts
 * Body: { limit?: number, dryRun?: boolean }
 * For media in the project missing generation_settings, persist prompts from
 * generation_prompts by filename_prefix (or fallback to in-memory mapping).
 */
router.post("/projects/:id/media/backfill-prompts", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const projectId = req.params.id;
    const limit = Math.max(1, Math.min(500, Number(req.body?.limit || 200)));
    const dryRun = !!req.body?.dryRun;

    if (!(await hasAccess(projectId, userId))) {
      return res.status(404).json({ error: "Project not found" });
    }

    const { rows: mediaRows } = await pool.query(
      `SELECT id, filename, meta FROM media WHERE project_id = $1 ORDER BY created_at DESC`,
      [projectId]
    );

    const targets = [];
    for (const m of mediaRows) {
      const gs = m?.meta?.generation_settings || null;
      const hasPrompts = gs && (gs.prompt || gs.negative_prompt || typeof gs.seed !== 'undefined');
      if (!hasPrompts) targets.push(m);
      if (targets.length >= limit) break;
    }

    const updates = [];
    for (const m of targets) {
      let prefix = null;
      try {
        const fn = m.filename || '';
        const mm = fn.match(/(u[a-f0-9\-]+_p[a-f0-9\-]+_g[a-zA-Z0-9]+_s\d+_sf\d+_df\d+_fps\d+)/);
        prefix = mm ? mm[1] : null;
      } catch {}

      if (!prefix) continue;

      let gp = null;
      try {
        const q = await pool.query(
          `SELECT positive_prompt, negative_prompt, seed, width, height, length, fps
           FROM generation_prompts
           WHERE project_id = $1 AND filename_prefix = $2
           ORDER BY created_at DESC LIMIT 1`,
          [projectId, prefix]
        );
        if (q.rows.length) gp = q.rows[0];
      } catch {}

      // Fallback to in-memory mapping if present
      let mapSettings = null;
      try {
        const mm = getRegenMapping(prefix);
        if (mm && mm.projectId === projectId && mm.settings) mapSettings = mm.settings;
      } catch {}

      if (!gp && !mapSettings) continue;

      const current = (m.meta && m.meta.generation_settings) || {};
      const next = { ...current };
      const setIfMissing = (k, v) => { if (v != null && (next[k] == null)) next[k] = v; };

      if (gp) {
        setIfMissing('prompt', gp.positive_prompt);
        setIfMissing('negative_prompt', gp.negative_prompt);
        setIfMissing('seed', gp.seed);
        setIfMissing('width', gp.width);
        setIfMissing('height', gp.height);
        setIfMissing('length', gp.length);
        setIfMissing('duration_frames', gp.length);
        setIfMissing('fps', gp.fps);
        if (!next.resolution && gp.width && gp.height) next.resolution = `${gp.width}x${gp.height}`;
      } else if (mapSettings) {
        setIfMissing('prompt', mapSettings.prompt);
        setIfMissing('negative_prompt', mapSettings.negative);
        setIfMissing('seed', mapSettings.seed);
        setIfMissing('width', mapSettings.width);
        setIfMissing('height', mapSettings.height);
        setIfMissing('length', mapSettings.length);
        setIfMissing('duration_frames', mapSettings.length);
        setIfMissing('fps', mapSettings.fps);
        if (!next.resolution && mapSettings.width && mapSettings.height) next.resolution = `${mapSettings.width}x${mapSettings.height}`;
      }
      if (!next.source) next.source = 'modal_generated';

      // If nothing changed, skip
      const changed = Object.keys(next).some(k => (current?.[k] ?? null) !== (next?.[k] ?? null));
      if (!changed) continue;

      updates.push({ id: m.id, filename: m.filename, filename_prefix: prefix, generation_settings: next });
    }

    if (dryRun) {
      return res.json({ ok: true, dryRun: true, to_update: updates.length, samples: updates.slice(0, 10) });
    }

    let updated = 0;
    for (const u of updates) {
      try {
        const payload = { generation_settings: u.generation_settings };
        const q = await pool.query(
          `UPDATE media
           SET meta = COALESCE(meta, '{}'::jsonb) || $2::jsonb
           WHERE id = $1 AND project_id = $3
           RETURNING id`,
          [u.id, JSON.stringify(payload), projectId]
        );
        if (q.rows.length) updated++;
      } catch (e) {
        console.warn('[backfill-prompts] update failed for', u.id, e?.message || e);
      }
    }

    return res.json({ ok: true, updated, scanned: mediaRows.length, considered: updates.length });
  } catch (e) {
    console.error('[backfill-prompts] error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
