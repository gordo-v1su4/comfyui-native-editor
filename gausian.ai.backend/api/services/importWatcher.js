// api/services/importWatcher.js
import { ListObjectsV2Command, HeadObjectCommand } from '@aws-sdk/client-s3';
import pool from '../db.js';
import { getS3Client, isS3Configured, publicUrlForKey } from '../services/s3.js';
import { getRegenMapping, deleteRegenMapping } from '../lib/regenMap.js';

/**
 * ImportWatcher scans the S3/Backblaze bucket for newly uploaded
 * modal-generated files and imports them when /api/modal-upload notifications
 * fail or are delayed. It also performs timeline replacement using the same
 * logic as the modal-upload route.
 */
class ImportWatcher {
  constructor() {
    this.running = false;
    this.intervalMs = Number(process.env.IMPORT_WATCH_INTERVAL_MS || 30000); // 30s
    this.prefix = process.env.IMPORT_WATCH_PREFIX || 'modal-generated/';
    this._timer = null;
  }

  start() {
    if (this.running) return;
    if (!isS3Configured()) {
      console.warn('[ImportWatcher] S3 not configured; skipping import watcher');
      return;
    }
    this.running = true;
    console.log('[ImportWatcher] Starting import watcher…');
    this._schedule();
  }

  stop() {
    this.running = false;
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
  }

  _schedule() {
    if (!this.running) return;
    this._timer = setTimeout(() => this._tick().catch(console.error).finally(() => this._schedule()), this.intervalMs);
  }

  async _tick() {
    const client = getS3Client();
    try {
      const resp = await client.send(new ListObjectsV2Command({ Bucket: process.env.S3_BUCKET, Prefix: this.prefix, MaxKeys: 100 }));
      const contents = Array.isArray(resp.Contents) ? resp.Contents : [];
      if (!contents.length) return;

      for (const obj of contents) {
        const key = obj.Key;
        if (!key || !key.endsWith('.mp4')) continue;

        // Extract original filename portion after prefix
        const baseName = key.split('/').pop();
        const filename = baseName || key;
        // Must contain our structured prefix u<user>_p<project>_g…
        if (!/(u[a-f0-9\-]+_p[a-f0-9\-]+_g[\w]+_s\d+_sf\d+_df\d+_fps\d+)/.test(filename)) continue;

        // Derive project/user ids from filename
        const m = filename.match(/u([a-f0-9\-]+)_p([a-f0-9\-]+)_/);
        if (!m) continue;
        let userId = m[1];
        const projectId = m[2];
        if (userId && !userId.startsWith('a') && userId.length === 35) userId = 'a' + userId;

        // Skip if media row already exists for this key in this project
        const { rows: existing } = await pool.query(
          `SELECT id FROM media WHERE project_id=$1 AND storage_backend='s3' AND storage_path=$2 LIMIT 1`,
          [projectId, key]
        );
        if (existing.length) continue;

        // Basic HEAD to ensure object is non-tiny
        try {
          const head = await client.send(new HeadObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
          const len = Number(head.ContentLength || 0);
          const min = Number(process.env.MIN_VIDEO_BYTES || 4096);
          if (len && len < min) {
            console.warn('[ImportWatcher] Skipping tiny object', { key, len });
            continue;
          }
        } catch (e) {
          console.warn('[ImportWatcher] HEAD failed for', key, e?.message || e);
        }

        // Build remote URL
        const remote_url = publicUrlForKey(key);

        // Try to fetch generation prompts for this file prefix
        const prefixMatch = filename.match(/(u[a-f0-9\-]+_p[a-f0-9\-]+_g[\w]+_s\d+_sf\d+_df\d+_fps\d+)/);
        const filenamePrefix = prefixMatch ? prefixMatch[1] : null;

        let generationPrompt = null;
        let mappingForPrompts = null;
        if (filenamePrefix) {
          try {
            const gpq = await pool.query(
              `SELECT positive_prompt, negative_prompt, seed, width, height, length, fps
               FROM generation_prompts
               WHERE project_id=$1 AND filename_prefix=$2
               ORDER BY created_at DESC LIMIT 1`,
              [projectId, filenamePrefix]
            );
            if (gpq.rows.length) generationPrompt = gpq.rows[0];
          } catch {}
          try {
            const mapp = getRegenMapping(filenamePrefix);
            if (!generationPrompt && mapp && mapp.projectId === projectId && mapp.settings) mappingForPrompts = mapp.settings;
          } catch {}
        }

        // Insert media row
        const meta = {
          source: 'modal_generated',
          uploaded_at: new Date().toISOString(),
          auto_imported: true,
          generation_settings: {
            resolution: generationPrompt ? `${generationPrompt.width}x${generationPrompt.height}` : (mappingForPrompts ? `${mappingForPrompts.width}x${mappingForPrompts.height}` : '512x384'),
            fps: generationPrompt ? generationPrompt.fps : (mappingForPrompts ? mappingForPrompts.fps : 12),
            source: 'modal_generated',
            prompt: generationPrompt ? generationPrompt.positive_prompt : (mappingForPrompts ? mappingForPrompts.prompt : null),
            negative_prompt: generationPrompt ? generationPrompt.negative_prompt : (mappingForPrompts ? mappingForPrompts.negative : null),
            seed: generationPrompt ? generationPrompt.seed : (mappingForPrompts ? mappingForPrompts.seed : null),
            width: generationPrompt ? generationPrompt.width : (mappingForPrompts ? mappingForPrompts.width : undefined),
            height: generationPrompt ? generationPrompt.height : (mappingForPrompts ? mappingForPrompts.height : undefined),
            duration_frames: generationPrompt ? generationPrompt.length : (mappingForPrompts ? mappingForPrompts.length : null),
          },
        };

        const ins = await pool.query(
          `INSERT INTO media (project_id, user_id, kind, filename, remote_url, storage_backend, storage_path, meta)
           VALUES ($1,$2,'video',$3,$4,'s3',$5,$6)
           RETURNING id`,
          [projectId, userId, filename, remote_url, key, JSON.stringify(meta)]
        );
        const newMediaId = ins.rows[0]?.id;
        if (!newMediaId) continue;

        // Attempt replacement if mapping exists or prompts encode placement
        let replaced = false;
        if (filenamePrefix) {
          try {
            const mapping = getRegenMapping(filenamePrefix);
            if (mapping && mapping.projectId === projectId) {
              const targetItemId = mapping.timelineItemId;
              const upd = await pool.query(
                `UPDATE timeline_items SET ref_id=$1 WHERE id=$2 AND project_id=$3 RETURNING id, project_id, user_id, type, ref_id, payload, created_at`,
                [newMediaId, targetItemId, projectId]
              );
              if (upd.rows.length) {
                replaced = true;
                deleteRegenMapping(filenamePrefix);
                try {
                  const { getIO } = await import('../server.js');
                  const io = getIO();
                  if (io) io.emit('timeline:new', { projectId, timelineItem: upd.rows[0] });
                } catch {}
              }
            }
          } catch {}
          if (!replaced) {
            const m = filenamePrefix.match(/s(\d+)_sf(\d+)_df(\d+)_fps(\d+)/);
            if (m) {
              const startFrame = parseInt(m[2], 10);
              const durationFrames = parseInt(m[3], 10);
              const fps = parseInt(m[4], 10);
              const upd2 = await pool.query(
                `UPDATE timeline_items
                 SET ref_id=$1
                 WHERE project_id=$2 AND type LIKE 'placed_%'
                   AND (payload->>'start_frame')::int=$3
                   AND (payload->>'duration_frames')::int=$4
                   AND ((payload->>'fps')::int = $5 OR (payload->>'fps') IS NULL)
                 RETURNING id, project_id, user_id, type, ref_id, payload, created_at`,
                [newMediaId, projectId, startFrame, durationFrames, fps]
              );
              if (upd2.rows.length) {
                replaced = true;
                try {
                  const { getIO } = await import('../server.js');
                  const io = getIO();
                  if (io) io.emit('timeline:new', { projectId, timelineItem: upd2.rows[0] });
                } catch {}
              }
            }
          }
        }

        // Emit media:new so importer and panels refresh without manual force
        try {
          const { getIO } = await import('../server.js');
          const io = getIO();
          if (io) io.emit('media:new', { projectId, media: { id: newMediaId, filename, kind: 'video', remote_url, storage_backend: 's3', storage_path: key, meta } });
        } catch {}
      }
    } catch (e) {
      console.warn('[ImportWatcher] list error:', e?.message || e);
    }
  }
}

export const importWatcher = new ImportWatcher();
export default importWatcher;
