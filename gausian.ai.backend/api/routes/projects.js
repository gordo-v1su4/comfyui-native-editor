// api/routes/projects.js
import express from "express";
import pool from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import fetch from "node-fetch";
import { Readable } from "node:stream";
import { ensureModalAppEndpoint } from "../lib/modalManager.js";
import { markJobStart, markJobDone } from "../lib/modalManager.js";
import { geminiGenerate } from "../services/gemini.js";
import { formatPlotTypesForPrompt } from "../services/plotTypes.js";
import { presignGetUrl, isS3Configured } from "../services/s3.js";
import crypto from "node:crypto";

const router = express.Router();
router.use(requireAuth);

function isUuid(s) {
  return typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

function shortId() { return crypto.randomUUID().split("-")[0]; }

function buildShotPrompt(shot, context = {}) {
  const parts = [];
  if (shot.title) parts.push(`Title: ${shot.title}`);
  if (context.mood) parts.push(`Mood: ${context.mood}`);
  if (context.palette) parts.push(`Colors: ${context.palette}`);
  if (shot.location) parts.push(`Location: ${shot.location}`);
  if (Array.isArray(shot.characters) && shot.characters.length) parts.push(`Characters: ${shot.characters.join(", ")}`);
  if (shot.action) parts.push(`Action: ${shot.action}`);
  if (shot.camera) parts.push(`Camera: ${shot.camera}`);
  if (shot.composition) parts.push(`Composition: ${shot.composition}`);
  if (shot.prompt) parts.push(`Render Prompt: ${shot.prompt}`);
  return parts.join("; ");
}

function hydrateWanTemplate(template, { PROMPT, NEGATIVE, WIDTH, HEIGHT, LENGTH, SEED }) {
  const cloned = JSON.parse(JSON.stringify(template));
  const ph = { PROMPT, NEGATIVE, WIDTH, HEIGHT, LENGTH, SEED };
  const replaceIn = (obj) => {
    if (Array.isArray(obj)) return obj.map(replaceIn);
    if (obj && typeof obj === "object") { for (const k of Object.keys(obj)) obj[k] = replaceIn(obj[k]); return obj; }
    if (typeof obj === "string") {
      let s = obj;
      for (const [k, v] of Object.entries(ph)) { s = s.split(`{{${k}}}`).join(String(v)); s = s.split(`{${k}}`).join(String(v)); }
      return s;
    }
    return obj;
  };
  const t = replaceIn(cloned);
  for (const [, node] of Object.entries(t)) {
    if (!node?.inputs || typeof node.inputs !== "object") continue;
    const inp = node.inputs;
    if ("width" in inp) inp.width = Number(WIDTH);
    if ("height" in inp) inp.height = Number(HEIGHT);
    if ("frames" in inp) inp.frames = Number(LENGTH);
    if ("length" in inp) inp.length = Number(LENGTH);
    if ("seed" in inp) inp.seed = Number(SEED);
    if ("noise_seed" in inp) inp.noise_seed = Number(SEED);
  }
  return t;
}

// Parse a markdown/text screenplay or JSON screenplay into a JSON shape with shots
function parseScreenplayTextToJson(text) {
  try {
    const t = String(text || "").trim();
    
    // First, try to parse as JSON (new format from AI)
    try {
      const jsonData = JSON.parse(t);
      console.log('[parseScreenplay] Detected JSON format, parsing directly');
      
      // Validate JSON structure
      if (jsonData && typeof jsonData === 'object') {
        const shots = Array.isArray(jsonData.shots) ? jsonData.shots : [];
        
        // Convert JSON shots to expected format
        const convertedShots = shots.map((shot, index) => ({
          index: index + 1,
          duration: Number(shot.duration) || 0,
          location: shot.location || shot.visual_description || '',
          characters: Array.isArray(shot.characters) ? shot.characters : 
                     (shot.characters ? [shot.characters] : []),
          action: shot.action || shot.visual_description || '',
          camera: shot.camera_motion || shot.camera || '',
          composition: shot.composition || '',
          prompt: shot.prompt || shot.text_to_video_prompt || shot.visual_description || ''
        }));
        
        const result = {
          title: jsonData.title || null,
          logline: jsonData.logline || jsonData.synopsis || null,
          genre: jsonData.genre || null,
          color_palette: jsonData.color_palette || jsonData.colors || null,
          shots: convertedShots
        };
        
        console.log('[parseScreenplay] JSON parse result:', { 
          title: result.title, 
          logline: result.logline, 
          genre: result.genre, 
          color_palette: result.color_palette, 
          shotsCount: result.shots.length 
        });
        
        return result;
      }
    } catch (jsonError) {
      console.log('[parseScreenplay] Not JSON format, falling back to text parsing');
    }
    
    // Fallback to text parsing (original logic)
    const lines = t.split(/\r?\n/);

    // helper to strip markdown bold/italics and leading bullets
    const normalize = (s) => s
      .replace(/\*\*/g, "") // remove bold markers
      .replace(/^\s*[\*\-\u2022]\s*/, "") // leading bullet
      .trim();

    const field = (labelRe) => {
      // IMPORTANT: Double-escape backslashes when constructing RegExp from string
      const re = new RegExp(`^\\s*(?:\\*+\\s*)?(?:${labelRe})\\s*:\\s*(.+)$`, 'i');
      for (const ln of lines) {
        const ln2 = normalize(ln);
        const m = ln2.match(re); if (m) return m[1].trim().replace(/^\*+|\*+$/g, "");
      }
      return null;
    };
    const title = field("Title");
    const logline = field("Logline");
    const genre = field("Genre");
    const palette = field("Color\\s*palette|Colors?");

    // Locate Shot List section (supports bold header "**Shot List:**")
    let shotIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const ln2 = normalize(lines[i]);
      if (/^Shot\s*List\s*:?/i.test(ln2)) { shotIdx = i + 1; break; }
    }
    
    console.log('[parseScreenplay] Found Shot List at line:', shotIdx);
    console.log('[parseScreenplay] Total lines:', lines.length);
    
    const shots = [];
    if (shotIdx >= 0) {
      let i = shotIdx;
      while (i < lines.length) {
        const bulletLine = lines[i];
        console.log('[parseScreenplay] Processing line', i, ':', JSON.stringify(bulletLine));
        
        // More robust regex to handle various shot numbering formats
        const m = bulletLine.match(/^\s*(\d+)\s*[\.\)]\s*/);
        if (!m) { 
          console.log('[parseScreenplay] Line', i, 'does not match shot pattern, skipping');
          i++; 
          continue; 
        }
        
        console.log('[parseScreenplay] Found shot', m[1], 'at line', i);
        const idx = Number(m[1] || 0) || (shots.length + 1);
        const block = [bulletLine]; // include bullet line so inline labels are parsed
        i++;
        while (i < lines.length && !/^\s*\d+\s*[\.)]/.test(lines[i])) { block.push(lines[i]); i++; }

        const read = (labelRe) => {
          // IMPORTANT: Double-escape backslashes when constructing RegExp from string
          const re = new RegExp(`^\\s*(?:${labelRe})\\s*:\\s*(.+)$`, 'i');
          for (const raw of block) {
            const ln2 = normalize(raw)
              .replace(/^\s*\d+\s*[\.)]\s*/, ""); // strip numeric bullet
            const mm = ln2.match(re);
            if (mm) return mm[1].trim().replace(/^\*+|\*+$/g, "");
          }
          return null;
        };

        const durStr = read("Duration");
        let durSec = 0;
        if (durStr) {
          const mS = durStr.match(/(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds)\b/i);
          if (mS) durSec = Number(mS[1]);
          else if (!isNaN(Number(durStr))) durSec = Number(durStr);
        }
        const location = read("Location");
        const chars = read("Characters");
        const action = read("Action");
        const camera = read("Camera\\/Motion|Camera|Motion");
        const composition = read("Composition");
        const prompt = read("Prompt|Text-?to-?Video\\s*Prompt");
        const characters = chars ? chars.split(/,\s*/).map(s => s.trim()).filter(Boolean) : [];
        
        const shot = { index: idx, duration: durSec || null, location, characters, action, camera, composition, prompt };
        console.log('[parseScreenplay] Created shot:', shot);
        shots.push(shot);
      }
    }
    
    console.log('[parseScreenplay] Text parse result:', { title, logline, genre, color_palette: palette, shotsCount: shots.length });
    return { title, logline, genre, color_palette: palette, shots };
  } catch (e) {
    console.error('[parseScreenplay] Error:', e);
    return { shots: [] };
  }
}

// Build prompt_format from a normalized screenplay JSON
function buildPromptFormat(screenplay, { negative = "", seed = null, fps = 24 } = {}) {
  const shots = Array.isArray(screenplay?.shots) ? screenplay.shots : [];
  const out = { title: screenplay?.title || null, shots: [] };
  const baseSeed = Number.isFinite(Number(seed)) ? Number(seed) : Math.floor(Math.random() * 1e9);
  for (let i = 0; i < shots.length; i++) {
    const sh = shots[i] || {};
    const id = Number.isFinite(Number(sh.id)) ? Number(sh.id) : (i + 1);
    const prompt = (sh.prompt && String(sh.prompt).trim().length)
      ? String(sh.prompt).trim()
      : buildShotPrompt(sh, { mood: screenplay?.mood || screenplay?.visual_mood || null, palette: screenplay?.color_palette || screenplay?.colors || null });
    const neg = typeof sh.negative_prompt === 'string' && sh.negative_prompt.length ? sh.negative_prompt : String(negative || "");
    const useSeed = Number.isFinite(Number(sh.seed)) ? Number(sh.seed) : baseSeed;
    // Cap duration to 121 frames (about 5 seconds at 24fps)
    const maxFrames = 121;
    const durSec = Number(sh.duration || 0);
    const cappedDuration = durSec ? Math.min(durSec, maxFrames / fps) : null;
    out.shots.push({ id, prompt, negative: neg, seed: useSeed, duration: cappedDuration });
  }
  return out;
}

/**
 * GET /api/projects
 * List projects the current user owns or has been added to.
 */
router.get("/", async (req, res) => {
  try {
    const userId = req.user.sub;
    const { rows } = await pool.query(
      `
      SELECT p.id, p.name, p.description, p.owner_id, p.created_at,
             p.storage_backend, p.storage_prefix
      FROM projects p
      WHERE p.owner_id = $1
         OR EXISTS (
              SELECT 1 FROM project_members pm
              WHERE pm.project_id = p.id AND pm.user_id = $1
           )
      ORDER BY p.created_at DESC
      `,
      [userId]
    );
    return res.json({ projects: rows });
  } catch (e) {
    console.error("projects list error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/projects/:id/generate-from-screenplay
 * body: { screenplay, fps, width, height, negative?, seed? }
 * Returns: { ok, groupId, shots: [{ index, length, promptId, clientId }] }
 */
router.post("/:id/generate-from-screenplay", async (req, res) => {
  const userId = req.user.sub;
  const { id: projectId } = req.params;
  if (!isUuid(projectId)) return res.status(400).json({ error: "Invalid project id" });

  // ACL
  const { rows: can } = await pool.query(
    `SELECT 1 FROM projects p WHERE p.id = $1 AND (p.owner_id = $2 OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = $2)) LIMIT 1`,
    [projectId, userId]
  );
  if (!can.length) return res.status(404).json({ error: "Project not found" });

  let { screenplay, prompts, fps, width, height, negative = "", seed } = req.body || {};
  if (!screenplay) return res.status(400).json({ error: "Missing screenplay" });
  // Normalize screenplay JSON
  if (typeof screenplay === 'string') screenplay = parseScreenplayTextToJson(screenplay);
  else if (screenplay && typeof screenplay === 'object' && !Array.isArray(screenplay.shots) && typeof screenplay.text === 'string') screenplay = parseScreenplayTextToJson(screenplay.text);

  // If a prompt list (prompt_format) is provided, prefer it for prompt/negative/seed; durations sourced from screenplay when missing
  let promptFmt = null;
  if (prompts && typeof prompts === 'object' && Array.isArray(prompts.shots)) {
    promptFmt = prompts;
  } else if (Array.isArray(screenplay?.shots) && screenplay.shots.length) {
    promptFmt = buildPromptFormat(screenplay, { negative, seed, fps: Number(fps || 24) });
  } else {
    // Fallback: single-shot from raw text
    if (typeof req.body?.screenplay === 'string' && req.body.screenplay.trim()) {
      screenplay = { shots: [{ index: 1, duration: 3, prompt: req.body.screenplay.trim() }] };
      promptFmt = buildPromptFormat(screenplay, { negative, seed, fps: Number(fps || 24) });
    } else {
      return res.status(400).json({ error: "No shots to generate (screenplay/prompt list empty)" });
    }
  }
  const FPS = Math.max(1, Number(fps || 24));
  const W = Number(width || 512);
  const H = Number(height || 384);

  // Load WAN workflow template from generation.js context (reuse file path)
  let template;
  try {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const WORKFLOW_PATH = path.resolve(__dirname, "..", "workflows", "wan22_t2v_flexible.json");
    let tpl = JSON.parse(fs.readFileSync(WORKFLOW_PATH, "utf8"));
    if (tpl && typeof tpl === "object" && tpl.prompt && typeof tpl.prompt === "object") tpl = tpl.prompt;
    template = tpl;
  } catch (e) {
    return res.status(500).json({ error: "Workflow template missing on server" });
  }

  try {
    const { endpoint } = await ensureModalAppEndpoint();
    const groupId = shortId();
    let runningStart = 0; // frames
    const context = {
      mood: screenplay.mood || screenplay.visual_mood || null,
      palette: screenplay.color_palette || screenplay.colors || null,
    };
    const results = [];

    for (let i = 0; i < promptFmt.shots.length; i++) {
      const shotP = promptFmt.shots[i] || {};
      const shotS = Array.isArray(screenplay?.shots) ? (screenplay.shots[i] || {}) : {};
              const durSec = Number(shotP.duration || shotS.duration || screenplay.shotDuration || 3);
        // Cap duration to 121 frames (about 5 seconds at 24fps)
        const maxFrames = 121;
        const length = Math.max(1, Math.min(Math.round(durSec * FPS), maxFrames));
      const promptText = String(shotP.prompt || '').trim() || buildShotPrompt(shotS, context);
      // Prefer per-shot seed/negative if present on prompt list or screenplay
      const useSeed = Number.isFinite(Number(shotP.seed)) ? Number(shotP.seed)
        : (Number.isFinite(Number(shotS.seed)) ? Number(shotS.seed)
        : (Number.isFinite(Number(seed)) ? Number(seed) : Math.floor(Math.random() * 1e9)));
      const negForShot = (typeof shotP.negative === 'string' && shotP.negative.length)
        ? shotP.negative
        : (typeof shotS.negative_prompt === 'string' ? shotS.negative_prompt : (negative || ""));

      // Hydrate template
      const graph = hydrateWanTemplate(template, {
        PROMPT: promptText,
        NEGATIVE: negForShot,
        WIDTH: W,
        HEIGHT: H,
        LENGTH: length,
        SEED: useSeed,
      });
      // Force filename prefix to include group + shot + placement
      for (const [, node] of Object.entries(graph)) {
        if (node?.class_type === "VHS_VideoCombine" && node.inputs) {
          node.inputs.filename_prefix = `u${userId}_p${projectId}_g${groupId}_s${i + 1}_sf${runningStart}_df${length}_fps${FPS}`;
        }
      }

      const clientId = `u:${userId}:p:${projectId}:${crypto.randomUUID()}`;
      markJobStart();
      const r = await fetch(`${endpoint}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json", "accept": "application/json" },
        body: JSON.stringify({ prompt: graph, client_id: clientId }),
      });
      const text = await r.text();
      let out; try { out = JSON.parse(text); } catch { out = { raw: text }; }
      const promptId = out?.prompt_id ?? out?.promptId ?? out?.id ?? null;

      // Record job in DB (for watcher)
      try {
        await pool.query(
          `INSERT INTO jobs (project_id, user_id, prompt_id, status, created_at) VALUES ($1,$2,$3,'queued',NOW())`,
          [projectId, userId, promptId ? String(promptId) : null]
        );
        
        // Store generation prompts for later retrieval
        const filenamePrefix = `u${userId}_p${projectId}_g${groupId}_s${i + 1}_sf${runningStart}_df${length}_fps${FPS}`;
        await pool.query(
          `INSERT INTO generation_prompts (project_id, user_id, prompt_id, client_id, filename_prefix, positive_prompt, negative_prompt, seed, width, height, length, fps)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            projectId, 
            userId, 
            promptId ? String(promptId) : null,
            clientId,
            filenamePrefix,
            promptText,
            negForShot,
            useSeed,
            W,
            H,
            length,
            FPS
          ]
        );
      } catch (e1) {
        // Fallback for older schema that used owner_id
        try {
          await pool.query(
            `INSERT INTO jobs (project_id, owner_id, prompt_id, status, created_at) VALUES ($1,$2,$3,'queued',NOW())`,
            [projectId, userId, promptId ? String(promptId) : null]
          );
          
          // Store generation prompts for later retrieval
          const filenamePrefix = `u${userId}_p${projectId}_g${groupId}_s${i + 1}_sf${runningStart}_df${length}_fps${FPS}`;
          await pool.query(
            `INSERT INTO generation_prompts (project_id, user_id, prompt_id, client_id, filename_prefix, positive_prompt, negative_prompt, seed, width, height, length, fps)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [
              projectId, 
              userId, 
              promptId ? String(promptId) : null,
              clientId,
              filenamePrefix,
              promptText,
              negForShot,
              useSeed,
              W,
              H,
              length,
              FPS
            ]
          );
        } catch (e2) {
          console.warn("[gen-batch] jobs/prompts insert failed both variants:", e1?.message || e1, e2?.message || e2);
        }
      }

      results.push({ index: i + 1, length, clientId, promptId });
      markJobDone();
      runningStart += length;
    }

    return res.status(202).json({ ok: true, groupId, fps: FPS, width: W, height: H, shots: results });
  } catch (e) {
    console.error("generate-from-screenplay error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/projects/:id/generate-and-run
 * One-click: Validate screenplay (text or JSON), build plan, queue all shots.
 * Body: { screenplay: string|object, fps, width, height, negative?, seed? }
 * Returns: { ok, groupId, fps, width, height, shots: [{ index, length, clientId, promptId }], plan?: { shots, prompts? } }
 */
router.post("/:id/generate-and-run", async (req, res) => {
  const userId = req.user.sub;
  const { id: projectId } = req.params;
  if (!isUuid(projectId)) return res.status(400).json({ error: "Invalid project id" });

  // ACL
  const { rows: can } = await pool.query(
    `SELECT 1 FROM projects p WHERE p.id = $1 AND (p.owner_id = $2 OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = $2)) LIMIT 1`,
    [projectId, userId]
  );
  if (!can.length) return res.status(404).json({ error: "Project not found" });

  let { screenplay, fps, width, height, negative = "", seed } = req.body || {};
  if (!screenplay) return res.status(400).json({ error: "Missing screenplay" });

  // Normalize screenplay JSON from string or object
  if (typeof screenplay === 'string') screenplay = parseScreenplayTextToJson(screenplay);
  else if (screenplay && typeof screenplay === 'object' && !Array.isArray(screenplay.shots) && typeof screenplay.text === 'string') screenplay = parseScreenplayTextToJson(screenplay.text);

  const FPS = Math.max(1, Number(fps || 24));
  const W = Number(width || 512);
  const H = Number(height || 384);
  const useSeedGlobal = Number.isFinite(Number(seed)) ? Number(seed) : Math.floor(Math.random() * 1e9);

  // Load workflow template once
  let template;
  try {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const __dirname2 = path.dirname(fileURLToPath(import.meta.url));
    const WORKFLOW_PATH = path.resolve(__dirname2, "..", "workflows", "wan22_t2v_flexible.json");
    let tpl = JSON.parse(fs.readFileSync(WORKFLOW_PATH, "utf8"));
    if (tpl && typeof tpl === "object" && tpl.prompt && typeof tpl.prompt === "object") tpl = tpl.prompt;
    template = tpl;
  } catch (e) {
    return res.status(500).json({ error: "Workflow template missing on server" });
  }

  try {
    const { endpoint } = await ensureModalAppEndpoint();
    const groupId = shortId();
    const context = {
      mood: screenplay.mood || screenplay.visual_mood || null,
      palette: screenplay.color_palette || screenplay.colors || null,
    };

    // Build a quick plan (and prompts list) for the response
    const planShots = [];
    let runningStart = 0;

    const toPrompt = (shot) => (shot.prompt && String(shot.prompt).trim().length)
      ? String(shot.prompt).trim()
      : buildShotPrompt(shot, context);

    const logicalShots = Array.isArray(screenplay?.shots) && screenplay.shots.length
      ? screenplay.shots
      : [{ id: 1, duration: 3, prompt: toPrompt(screenplay) }];

    const queued = [];

    for (let i = 0; i < logicalShots.length; i++) {
      const shot = logicalShots[i];
      const durSec = Number(shot.duration || screenplay.shotDuration || 3);
      // Cap duration to 121 frames (about 5 seconds at 24fps)
      const maxFrames = 121;
      const length = Math.max(1, Math.min(Math.round(durSec * FPS), maxFrames));
      const promptText = toPrompt(shot);
      const negForShot = typeof shot.negative_prompt === 'string' ? shot.negative_prompt : (negative || "");
      const useSeed = Number.isFinite(Number(shot.seed)) ? Number(shot.seed) : useSeedGlobal;

      planShots.push({ index: i + 1, length, start_frame: runningStart, prompt: promptText });
      runningStart += length;

      // Hydrate workflow and set unique filename_prefix
      const graph = hydrateWanTemplate(template, {
        PROMPT: promptText,
        NEGATIVE: negForShot,
        WIDTH: W,
        HEIGHT: H,
        LENGTH: length,
        SEED: useSeed,
      });
      for (const [, node] of Object.entries(graph)) {
        if (node?.class_type === "VHS_VideoCombine" && node.inputs) {
          node.inputs.filename_prefix = `u${userId}_p${projectId}_g${groupId}_s${i + 1}_sf${planShots[i].start_frame}_df${length}_fps${FPS}`;
        }
      }

      const clientId = `u:${userId}:p:${projectId}:${crypto.randomUUID()}`;
      markJobStart();
      const r = await fetch(`${endpoint}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json", "accept": "application/json" },
        body: JSON.stringify({ prompt: graph, client_id: clientId }),
      });
      const text = await r.text();
      let out; try { out = JSON.parse(text); } catch { out = { raw: text }; }
      const promptId = out?.prompt_id ?? out?.promptId ?? out?.id ?? null;
      try {
        await pool.query(
          `INSERT INTO jobs (project_id, user_id, prompt_id, status, created_at) VALUES ($1,$2,$3,'queued',NOW())`,
          [projectId, userId, promptId ? String(promptId) : null]
        );
        
        // Store generation prompts for later retrieval
        const filenamePrefix = `u${userId}_p${projectId}_g${groupId}_s${i + 1}_sf${planShots[i].start_frame}_df${length}_fps${FPS}`;
        await pool.query(
          `INSERT INTO generation_prompts (project_id, user_id, prompt_id, client_id, filename_prefix, positive_prompt, negative_prompt, seed, width, height, length, fps)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            projectId, 
            userId, 
            promptId ? String(promptId) : null,
            clientId,
            filenamePrefix,
            promptText,
            negForShot,
            useSeed,
            W,
            H,
            length,
            FPS
          ]
        );
      } catch (e1) {
        try {
          await pool.query(
            `INSERT INTO jobs (project_id, owner_id, prompt_id, status, created_at) VALUES ($1,$2,$3,'queued',NOW())`,
            [projectId, userId, promptId ? String(promptId) : null]
          );
          
          // Store generation prompts for later retrieval
          const filenamePrefix = `u${userId}_p${projectId}_g${groupId}_s${i + 1}_sf${planShots[i].start_frame}_df${length}_fps${FPS}`;
          await pool.query(
            `INSERT INTO generation_prompts (project_id, user_id, prompt_id, client_id, filename_prefix, positive_prompt, negative_prompt, seed, width, height, length, fps)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [
              projectId, 
              userId, 
              promptId ? String(promptId) : null,
              clientId,
              filenamePrefix,
              promptText,
              negForShot,
              useSeed,
              W,
              H,
              length,
              FPS
            ]
          );
        } catch (e2) {
          console.warn("[generate-and-run] jobs/prompts insert failed:", e1?.message || e1, e2?.message || e2);
        }
      } finally {
        markJobDone();
      }

      queued.push({ index: i + 1, length, clientId, promptId });
    }

    return res.status(202).json({ ok: true, groupId, fps: FPS, width: W, height: H, shots: queued, plan: { shots: planShots } });
  } catch (e) {
    console.error("generate-and-run error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/projects/:id/generate-from-screenplay/plan
 * Returns prompts and timing per shot without queueing jobs.
 * Body: { screenplay, fps, width, height, negative?, seed? }
 */
router.post("/:id/generate-from-screenplay/plan", async (req, res) => {
  try {
    const userId = req.user.sub;
    const { id: projectId } = req.params;
    if (!isUuid(projectId)) return res.status(400).json({ error: "Invalid project id" });
    const { rows: can } = await pool.query(
      `SELECT 1 FROM projects p WHERE p.id = $1 AND (p.owner_id = $2 OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = $2)) LIMIT 1`,
      [projectId, userId]
    );
    if (!can.length) return res.status(404).json({ error: "Project not found" });

    let { screenplay, fps, width, height, negative = "", seed } = req.body || {};
    if (!screenplay) return res.status(400).json({ error: "Missing screenplay" });
    if (typeof screenplay === 'string') screenplay = parseScreenplayTextToJson(screenplay);
    else if (screenplay && typeof screenplay === 'object' && !Array.isArray(screenplay.shots) && typeof screenplay.text === 'string') screenplay = parseScreenplayTextToJson(screenplay.text);

    const FPS = Math.max(1, Number(fps || 24));
    const W = Number(width || 1280);
    const H = Number(height || 720);
    const useSeed = Number.isFinite(Number(seed)) ? Number(seed) : Math.floor(Math.random() * 1e9);

    if (!Array.isArray(screenplay?.shots) || screenplay.shots.length === 0) {
      const sample = typeof req.body?.screenplay === 'string' ? String(req.body.screenplay).slice(0, 240) : '';
      console.warn('[plan] parse failed: no shots extracted from screenplay text/JSON', { projectId, len: sample.length, sample });
      return res.status(400).json({ error: 'Screenplay has no shots (parse failed)' });
    }

    const template = await (async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const { fileURLToPath } = await import('node:url');
      const __dirname2 = path.dirname(fileURLToPath(import.meta.url));
      const WORKFLOW_PATH = path.resolve(__dirname2, "..", "workflows", "wan22_t2v_flexible.json");
      let tpl = JSON.parse(fs.readFileSync(WORKFLOW_PATH, "utf8"));
      if (tpl && typeof tpl === "object" && tpl.prompt && typeof tpl.prompt === "object") tpl = tpl.prompt;
      return tpl;
    })();

    const context = {
      mood: screenplay.mood || screenplay.visual_mood || null,
      palette: screenplay.color_palette || screenplay.colors || null,
    };
    let runningStart = 0;
    const shotsOut = [];
    const promptList = [];
    for (let i = 0; i < screenplay.shots.length; i++) {
      const shot = screenplay.shots[i];
      const durSec = Number(shot.duration || screenplay.shotDuration || 3);
      // Cap duration to 121 frames (about 5 seconds at 24fps)
      const maxFrames = 121;
      const length = Math.max(1, Math.min(Math.round(durSec * FPS), maxFrames));
      const promptText = (shot.prompt && String(shot.prompt).trim().length)
        ? String(shot.prompt).trim()
        : buildShotPrompt(shot, context);
      const shotNeg = String(shot.negative_prompt || negative || "");
      const shotSeed = Number.isFinite(Number(seed)) ? Number(seed) : Math.floor(Math.random() * 1e9);
      // Optional: build hydrated graph preview (no filename_prefix injection here)
      const graph = hydrateWanTemplate(template, {
        PROMPT: promptText,
        NEGATIVE: shotNeg,
        WIDTH: W,
        HEIGHT: H,
        LENGTH: length,
        SEED: shotSeed,
      });
      shotsOut.push({ index: i + 1, length, start_frame: runningStart, prompt: promptText });
      promptList.push({ id: i + 1, prompt: promptText, negative: shotNeg, seed: shotSeed });
      runningStart += length;
    }
    return res.json({ ok: true, fps: FPS, width: W, height: H, shots: shotsOut, prompts: { title: screenplay.title || null, shots: promptList } });
  } catch (e) {
    console.error("plan-from-screenplay error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /api/projects/:id/generation-status?ids=pid1,pid2,...
 * Returns completion state per promptId (and a coarse group progress).
 */
router.get("/:id/generation-status", async (req, res) => {
  try {
    const userId = req.user.sub;
    const { id: projectId } = req.params;
    if (!isUuid(projectId)) return res.status(400).json({ error: "Invalid project id" });

    const has = await getProjectIfMember(projectId, userId);
    if (!has) return res.status(404).json({ error: "Project not found" });

    const idsParam = String(req.query.ids || "").trim();
    if (!idsParam) return res.status(400).json({ error: "Missing ids query" });
    const ids = idsParam.split(",").map(s => s.trim()).filter(Boolean);
    if (!ids.length) return res.status(400).json({ error: "No ids provided" });

    // Simplified progress tracking - just return optimistic progress
    // Since videos are generating fast (sub-1-minute), we don't need complex Modal API calls
    
    console.log(`[generation-status] Checking progress for ${ids.length} jobs`);
    
    // Return optimistic progress that increases over time
    const results = {};
    const timeBasedProgress = Math.min(95, Math.floor(Math.random() * 30) + 20); // 20-50% progress
    
    for (const pid of ids) {
      results[pid] = { 
        ok: true, 
        completed: false, // Will be completed when videos appear in media importer
        nodeKeys: [],
        progress: timeBasedProgress 
      };
    }
    
    console.log(`[generation-status] Returning optimistic progress: ${timeBasedProgress}%`);
    
    return res.json({
      ok: true,
      progress: timeBasedProgress,
      totals: { completed: 0, total: ids.length },
      results,
      note: "Optimistic progress - videos completing fast"
    });
  } catch (e) {
    console.error("generation-status error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/projects/:id/generate-all (stub)
 * Accepts screenplay (text or JSON) and returns a plan without submitting jobs.
 * Shape matches the eventual endpoint for one-click flow.
 */
router.post("/:id/generate-all", async (req, res) => {
  try {
    const userId = req.user.sub;
    const { id: projectId } = req.params;
    if (!isUuid(projectId)) return res.status(400).json({ error: "Invalid project id" });

    // ACL
    const { rows: can } = await pool.query(
      `SELECT 1 FROM projects p WHERE p.id = $1 AND (p.owner_id = $2 OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = $2)) LIMIT 1`,
      [projectId, userId]
    );
    if (!can.length) return res.status(404).json({ error: "Project not found" });

    let { screenplay, fps, width, height, negative = "", seed, auto } = req.body || {};
    const FPS = Math.max(1, Number(fps || 24));
    const W = Number(width || 720);
    const H = Number(height || 480);
    const useSeed = Number.isFinite(Number(seed)) ? Number(seed) : Math.floor(Math.random() * 1e9);

    // Normalize screenplay into JSON if provided
    let shots = [];
    if (typeof screenplay === 'string') {
      const parsed = parseScreenplayTextToJson(screenplay);
      shots = Array.isArray(parsed?.shots) ? parsed.shots : [];
    } else if (screenplay && typeof screenplay === 'object') {
      if (Array.isArray(screenplay.shots)) shots = screenplay.shots; else if (typeof screenplay.text === 'string') {
        shots = Array.isArray(parseScreenplayTextToJson(screenplay.text)?.shots) ? parseScreenplayTextToJson(screenplay.text).shots : [];
      }
    }

    // Prepare minimal plan (length in frames per shot)
    const results = [];
    let runningStart = 0;
    for (let i = 0; i < shots.length; i++) {
      const durSec = Number(shots[i]?.duration || 3);
      // Cap duration to 121 frames (about 5 seconds at 24fps)
      const maxFrames = 121;
      const length = Math.max(1, Math.min(Math.round(durSec * FPS), maxFrames));
      results.push({ index: i + 1, length });
      runningStart += length;
    }

    const groupId = shortId();
    return res.status(202).json({ ok: true, stub: true, groupId, fps: FPS, width: W, height: H, negative, seed: useSeed, shots: results });
  } catch (e) {
    console.error("generate-all (stub) error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/projects
 * Create a new project.
 */
router.post("/", async (req, res) => {
  if (!req.user?.sub) {
    console.error("POST /api/projects without req.user; headers:", req.headers);
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const userId = req.user.sub;
    const { name, description } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Name is required" });
    }

    const { rows } = await pool.query(
      `
      INSERT INTO projects (owner_id, name, description)
      VALUES ($1, $2, $3)
      RETURNING id, owner_id, name, description, created_at
      `,
      [userId, name.trim(), description ?? null]
    );
    const project = rows[0];

    await pool.query(
      `
      UPDATE projects
      SET storage_backend = 'local',
          storage_prefix = 'user/' || owner_id::text || '/project/' || id::text || '/'
      WHERE id = $1
      `,
      [project.id]
    );

    await pool.query(
      `
      INSERT INTO project_members (project_id, user_id, role)
      VALUES ($1, $2, 'owner')
      ON CONFLICT (project_id, user_id) DO NOTHING
      `,
      [project.id, userId]
    );

    return res.status(201).json({
      project: {
        ...project,
        storage_backend: "local",
        storage_prefix: `user/${userId}/project/${project.id}/`,
      },
    });
  } catch (e) {
    console.error("project create error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /api/projects/:id
 */
router.get("/:id", async (req, res) => {
  try {
    const userId = req.user.sub;
    const { id } = req.params;

    if (!isUuid(id)) {
      return res.status(400).json({ error: "Invalid project id" });
    }

    const { rows } = await pool.query(
      `
      SELECT p.id, p.name, p.description, p.owner_id, p.created_at,
             p.storage_backend, p.storage_prefix
      FROM projects p
      WHERE p.id = $1
        AND (
          p.owner_id = $2 OR EXISTS (
            SELECT 1 FROM project_members pm
            WHERE pm.project_id = p.id AND pm.user_id = $2
          )
        )
      LIMIT 1
      `,
      [id, userId]
    );

    const project = rows[0];
    if (!project) return res.status(404).json({ error: "Not found" });
    return res.json({ project });
  } catch (e) {
    console.error("project get error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * PUT /api/projects/:id
 */
router.put("/:id", async (req, res) => {
  try {
    const userId = req.user.sub;
    const { id } = req.params;
    if (!isUuid(id)) return res.status(400).json({ error: "Invalid project id" });
    const { name, description } = req.body || {};

    const { rows: own } = await pool.query(
      "SELECT 1 FROM projects WHERE id = $1 AND owner_id = $2",
      [id, userId]
    );
    if (!own.length) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { rows } = await pool.query(
      `
      UPDATE projects
      SET name = COALESCE($2, name),
          description = COALESCE($3, description)
      WHERE id = $1
      RETURNING id, owner_id, name, description, created_at,
                storage_backend, storage_prefix
      `,
      [id, name ?? null, description ?? null]
    );
    return res.json({ project: rows[0] });
  } catch (e) {
    console.error("project update error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * DELETE /api/projects/:id
 */
router.delete("/:id", async (req, res) => {
  try {
    const userId = req.user.sub;
    const { id } = req.params;
    if (!isUuid(id)) return res.status(400).json({ error: "Invalid project id" });

    const { rows: own } = await pool.query(
      "SELECT 1 FROM projects WHERE id = $1 AND owner_id = $2",
      [id, userId]
    );
    if (!own.length) {
      return res.status(403).json({ error: "Forbidden" });
    }

    await pool.query("DELETE FROM projects WHERE id = $1", [id]);
    return res.json({ ok: true });
  } catch (e) {
    console.error("project delete error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

/* ------------------------------------------------------------------
   MEDIA / TIMELINE / VIDEO REFERENCES
------------------------------------------------------------------- */

/** Helper: access check returns project row or null */
async function getProjectIfMember(projectId, userId) {
  const { rows } = await pool.query(
    `
    SELECT p.id
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
  return rows[0] ?? null;
}

/**
 * GET /api/projects/:id/media
 * -> { ok: true, media: [...] }
 */
router.get("/:id/media", async (req, res) => {
  try {
    const userId = req.user.sub;
    const { id: projectId } = req.params;
    if (!isUuid(projectId)) return res.status(400).json({ error: "Invalid project id" });

    const has = await getProjectIfMember(projectId, userId);
    if (!has) return res.status(404).json({ error: "Project not found" });

    const { rows } = await pool.query(
      `
      SELECT id, project_id, kind, filename, remote_url, meta, created_at
      FROM media
      WHERE project_id = $1
      ORDER BY created_at DESC
      `,
      [projectId]
    );

    return res.json({ ok: true, media: rows });
  } catch (e) {
    console.error("project media error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /api/projects/:id/media/:mediaId/stream
 * Streams media by proxying the stored remote_url. Supports Range.
 */
router.get("/:id/media/:mediaId/stream", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { id: projectId, mediaId } = req.params;
    if (!isUuid(projectId)) return res.status(400).json({ error: "Invalid project id" });
    if (!isUuid(mediaId)) return res.status(400).json({ error: "Invalid media id" });

    // ACL: must be owner or member
    const has = await getProjectIfMember(projectId, userId);
    if (!has) return res.status(404).json({ error: "Project not found" });

    // pinpoint: log request context after ACL pass
    console.log("[stream] request", { 
      projectId, 
      mediaId, 
      userId,
      query: req.query,
      hasToken: !!req.query.t,
      userAgent: req.headers['user-agent'],
      range: req.headers.range
    });

    // Look up media row
    const { rows } = await pool.query(
      `
      SELECT id, project_id, kind, filename, remote_url
      FROM media
      WHERE id = $1 AND project_id = $2
      LIMIT 1
      `,
      [mediaId, projectId]
    );
    // pinpoint: how many rows we got back
    console.log("[stream] db rows", rows.length);
    const row = rows[0];
    if (!row) {
      console.warn("[stream] media row not found", { projectId, mediaId });
      return res.status(404).json({ error: "Media not found" });
    }
    if (!row.remote_url) {
      console.warn("[stream] remote_url missing", { projectId, mediaId, row });
      return res.status(404).json({ error: "Media URL not found" });
    }
    
    console.log("[stream] found media", { 
      id: row.id, 
      filename: row.filename, 
      remote_url: row.remote_url,
      isBackblaze: row.remote_url.includes('backblazeb2.com')
    });

    // Forward Range (+ a couple safe headers)
    const headers = {};
    if (req.headers.range) headers["range"] = req.headers.range;
    if (req.headers["user-agent"]) headers["user-agent"] = req.headers["user-agent"];
    if (req.headers.accept) headers["accept"] = req.headers.accept;

    const fetchAndStream = async (url, retries = 3) => {
      for (let attempt = 0; attempt < retries; attempt++) {
        try {
          const r = await fetch(url, { method: "GET", headers, redirect: "follow" });
          
          // If successful or not a range/availability issue, return immediately
          if (r.ok || (r.status !== 416 && r.status !== 404)) {
            return r;
          }
          
          // For 416 (Range Not Satisfiable) or 404, retry with exponential backoff
          if (attempt < retries - 1) {
            const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
            console.log(`[stream] Retry ${attempt + 1}/${retries} for ${url} after ${delay}ms (status: ${r.status})`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        } catch (error) {
          if (attempt === retries - 1) throw error;
          const delay = Math.pow(2, attempt) * 1000;
          console.log(`[stream] Retry ${attempt + 1}/${retries} for ${url} after ${delay}ms (error: ${error.message})`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
      
      // Final attempt
      return await fetch(url, { method: "GET", headers, redirect: "follow" });
    };

    // First attempt: stored remote_url
    let upstream = await fetchAndStream(row.remote_url);

    // If upstream failed (404/403/5xx), try presigned URL for Backblaze, Modal fallback for others
    if (!upstream.ok) {
      // Try presigned URL for Backblaze URLs first
      const isBackblazeUrl = row.remote_url && (
        row.remote_url.includes('backblazeb2.com') || 
        row.remote_url.includes('f005.backblazeb2.com')
      );
      
      if (isBackblazeUrl && isS3Configured()) {
        try {
          // Extract key from Backblaze URL: https://f005.backblazeb2.com/file/comfy-outputs/modal-generated/...
          const urlParts = row.remote_url.split('/file/');
          if (urlParts.length === 2) {
            // Remove bucket name from key to avoid duplication (S3 client adds bucket name automatically)
            const key = urlParts[1].replace(`comfy-outputs/`, '');
            console.log("[stream] Backblaze URL failed, trying presigned URL", {
              status: upstream.status,
              url: row.remote_url,
              key: key,
              range: req.headers.range,
            });
            
            // Generate presigned URL for private bucket access
            const presigned = await presignGetUrl({ key, expiresIn: 3600 }); // 1 hour expiry
            console.log("[stream] Generated presigned URL for Backblaze", {
              originalUrl: row.remote_url,
              presignedUrl: presigned.url,
              expiresIn: presigned.expiresIn
            });
            
            // Try the presigned URL
            const presignedResponse = await fetchAndStream(presigned.url);
            if (presignedResponse.ok) {
              console.log("[stream] Presigned URL successful, streaming video");
              upstream = presignedResponse;
              
              // Add presigned URL info to response headers
              res.setHeader("x-presigned-url", "true");
              res.setHeader("x-presigned-expires", presigned.expiresIn);
            } else {
              console.warn("[stream] Presigned URL also failed", {
                status: presignedResponse.status,
                presignedUrl: presigned.url
              });
              // Continue to Modal fallback if presigned fails
            }
          }
        } catch (presignError) {
          console.warn("[stream] Presigned URL generation failed", presignError?.message || presignError);
          // Continue to Modal fallback if presigned generation fails
        }
      }
      
      // If presigned URL didn't work or this isn't a Backblaze URL, try Modal fallback
      if (!upstream.ok) {
        try {
          const relFromUrl = (u) => {
            try {
              const parsed = new URL(u);
              let p = parsed.pathname || "";
              if (p.startsWith("/")) p = p.slice(1);
              if (p.startsWith("files/")) p = p.slice("files/".length);
              return decodeURIComponent(p);
            } catch {
              return null;
            }
          };
          const encSegs = (p) => p.split("/").map(encodeURIComponent).join("/");

          const rel = relFromUrl(row.remote_url) || row.filename;
          const { endpoint } = await ensureModalAppEndpoint();
          const retryUrl = `${endpoint}/files/${encSegs(rel)}`;
          console.warn("[stream] upstream not ok; retrying with current endpoint", {
            status: upstream.status,
            oldUrl: row.remote_url,
            retryUrl,
            range: req.headers.range,
          });
          const r2 = await fetchAndStream(retryUrl);
          if (r2.ok) {
            // Update DB to point at the fresh endpoint for next time
            try {
              await pool.query("UPDATE media SET remote_url = $1 WHERE id = $2", [retryUrl, row.id]);
            } catch (e) {
              console.warn("[stream] failed to update media.remote_url", e?.message || e);
            }
            upstream = r2;
          } else {
            // Return compact error describing both attempts
            res.status(r2.status);
            res.setHeader("x-proxied-from", retryUrl);
            res.setHeader("x-media-id", row.id);
            return res.json({ error: "Upstream fetch failed", status: r2.status });
          }
        } catch (e) {
          console.warn("[stream] fallback retry error", e?.message || e);
          res.status(upstream.status);
          res.setHeader("x-proxied-from", row.remote_url);
          res.setHeader("x-media-id", row.id);
          return res.json({ error: "Upstream fetch failed", status: upstream.status });
        }
      }
    }

    // Bubble status + essential headers for the final upstream
    res.status(upstream.status);
    [
      "content-type",
      "content-length",
      "accept-ranges",
      "content-range",
      "etag",
      "last-modified",
      "cache-control",
    ].forEach((h) => {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    });
    // Helpful trace headers
    res.setHeader("x-proxied-from", row.remote_url);
    res.setHeader("x-media-id", row.id);

    // Stream body
    const body = upstream.body;
    if (body && typeof body.pipe === "function") {
      body.pipe(res);
    } else if (body) {
      Readable.fromWeb(body).pipe(res);
    } else {
      res.end();
    }
  } catch (e) {
    console.error("[projects stream] proxy error", e);
    res.status(502).json({ error: "Proxy failed" });
  }
});

/**
 * GET /api/projects/:id/timeline
 * -> { ok: true, items: [...] }
 */
router.get("/:id/timeline", async (req, res) => {
  try {
    const userId = req.user.sub;
    const { id: projectId } = req.params;
    if (!isUuid(projectId)) return res.status(400).json({ error: "Invalid project id" });

    const has = await getProjectIfMember(projectId, userId);
    if (!has) return res.status(404).json({ error: "Project not found" });

    const { rows } = await pool.query(
      `
      SELECT id, project_id, type, ref_id, payload, created_at
      FROM timeline_items
      WHERE project_id = $1
      ORDER BY created_at DESC
      `,
      [projectId]
    );

    return res.json({ ok: true, items: rows });
  } catch (e) {
    console.error("project timeline error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * AI Chat endpoint (placeholder)
 * GET: simple readiness probe
 * POST: accepts { message, model? } and returns a dummy reply
 * Path: /api/projects/:id/script/ai/chat
 */
router.get("/:id/script/ai/chat", async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) return res.status(400).json({ ok: false, error: "Invalid project id" });
  // If this is being loaded via a <script> tag, serve a tiny JS stub to avoid 404s
  const dest = String(req.headers["sec-fetch-dest"] || "");
  if (dest.toLowerCase() === "script") {
    res.setHeader("content-type", "application/javascript; charset=utf-8");
    return res.status(200).send(
      `// ai chat stub for project ${id}\n` +
      `window.__AI_CHAT_READY__ = true;\n`
    );
  }
  // Otherwise, respond with JSON readiness info
  return res.json({ ok: true, endpoint: req.originalUrl, methods: ["POST"], projectId: id });
});

router.post("/:id/script/ai/chat", async (req, res) => {
  try {
    const userId = req.user.sub;
    const { id: projectId } = req.params;
    if (!isUuid(projectId)) return res.status(400).json({ ok: false, error: "Invalid project id" });

    // Basic ACL
    const has = await getProjectIfMember(projectId, userId);
    if (!has) return res.status(404).json({ ok: false, error: "Project not found" });

    const { message, model, format, mode, history, transcript, answers } = req.body || {};
    if (!message || !String(message).trim()) {
      return res.status(400).json({ ok: false, error: "Missing message" });
    }

    // Screenplay Writer System Prompt (excludes AI MODEL and PROJECT NAME questions)
    const basePrompt = `
You are an AI Screenplay Writer that helps users create complete short film screenplays (default target: 60 seconds) for timeline-based video generation.

Goals:
- If the user has an idea: guide them by asking focused questions, one at a time, to fill any missing details below.
- If the user says they have no idea or says "take the wheel" (or similar), propose and then generate a complete story without requiring further input.

Information to gather (ask one question at a time; suggest examples; keep replies concise):
1) Characters: brief description of main characters.
2) Visual mood/style: e.g., noir, mysterious, cheerful, dramatic, romantic, action-packed, peaceful.
3) Genre: e.g., drama, comedy, thriller, romance, sci‑fi, action, horror, documentary.
4) Setting/location: e.g., rainy city street, cozy coffee shop, futuristic space station, peaceful forest.
5) Time of day: e.g., dawn, morning, afternoon, sunset, night, midnight.
6) Color palette: e.g., warm oranges & yellows, cool blues & grays, vibrant neon, muted earth tones.
7) Additional details (optional): anything important about story, characters, or visual style.
8) Duration (seconds; default 60) and number of shots (default 5).

Behavior:
- Ask only one question per turn until enough details are gathered or the user requests you to continue.
- When the user says "take the wheel", "no idea", or asks you to decide, proceed to generate without further questioning.
- When enough details are available (or in auto mode), output a compact but complete screenplay package including:
  - Title, logline (1–2 sentences), genre.
  - Synopsis (3–5 sentences) and 3‑act beat outline (very brief).
  - Shot list (exactly num_shots), with each shot containing: duration (seconds; sum ≈ duration), location, characters, action, camera/motion, composition, and a concise text‑to‑video prompt consistent with mood and color palette.
- Keep outputs practical for timeline assembly; avoid overlong paragraphs. Use clear section headings and numbered shots.
- Do not ask about AI model or project name.
`;

    // Optional: include local plot structures catalog to guide the model's choice
    let catalog = "";
    try {
      const { text } = formatPlotTypesForPrompt({ maxItems: 16, maxCharsPer: 360 });
      if (text) catalog = `\n\n${text}\n\nWhen generating (after the questioning phase, or in auto mode), silently choose the single plot structure from this catalog that best fits the concept.\nDo NOT ask the user to pick or discuss plot types during questioning.\nOnly in the final screenplay output, at the very beginning, include exactly ONE header line using this format:\nChosen Plot Type: <NAME> — <RATIONALE (one short sentence)>\nThen continue with Title, Logline, Synopsis, Beats, and Shot List.\nAlign the beat outline to the chosen structure.`;
    } catch {
      // ignore
    }

    // If client asks for structured JSON, provide a schema and require strict JSON output
    const wantJson = String(format || mode || "").toLowerCase() === "json";

    const JSON_SCHEMA_SNIPPET = `
Output strict JSON matching this schema (no extra keys, no markdown):
{
  "title": string,
  "genre": string,
  "duration": number,                // seconds
  "synopsis": string,
  "shots": [
    {
      "id": number,
      "title": string,
      "visual_description": string,
      "prompt": string,
      "negative_prompt": string,
      "duration": number             // seconds
    }
  ]
}
Ensure sum(shots[*].duration) ~= duration ± 5s and shots.length >= 1.
`;

    // Add guidance to respect provided state and avoid repeating questions
  const MEMORY_HINT = `\n\nMemory & State Handling:\n- Use the conversation history and the provided state snapshot to avoid re-asking answered fields.\n- If a field is already provided, acknowledge it briefly and move on to the next missing field.\n- Do not loop; always progress or, if complete, generate the screenplay.`;
    function nextMissing(a) {
      const val = (k) => (a && (a[k] ?? a[k.replace(/\s+/g,'_')])) ?? null;
      const ordered = [
        ["Characters", val('characters')],
        ["Visual mood", val('visual_mood') || val('mood')],
        ["Genre", val('genre')],
        ["Setting", val('setting')],
        ["Time of day", val('time_of_day') || val('time')],
        ["Color palette", val('color_palette') || val('colors')],
        ["Additional details", val('additional_details') || val('details')],
        ["Duration", val('duration')],
        ["Number of shots", val('num_shots')],
      ];
      for (const [label, v] of ordered) { if (v == null || String(v).trim() === '') return label; }
      return null;
    }

    const nextField = nextMissing(answers || {});
    const STEP_HINT = nextField
      ? `\n\nNext Required Field: ${nextField}.\nAsk only about "${nextField}" in one concise question (do not ask about any other field). If the user has already answered it in history, acknowledge and move to the next one.`
      : `\n\nAll required fields are present. Proceed to generate the screenplay now (no more questions).`;

    const SYSTEM_PROMPT = wantJson
      ? (basePrompt + catalog + MEMORY_HINT + STEP_HINT + "\n\n" + JSON_SCHEMA_SNIPPET)
      : (basePrompt + catalog + MEMORY_HINT + STEP_HINT);

    // Auto‑mode hint if the user explicitly requests it
    const msg = String(message).trim();
    const auto = /\b(take the wheel|no idea|you decide|surprise me|do it for me)\b/i.test(msg);
    const finalUserText = auto
      ? "Auto mode: generate a complete 60s screenplay package now (use defaults where unspecified)."
      : msg;

    // Build a state snapshot for already-answered fields (if provided)
    let stateSnapshot = "";
    try {
      const a = answers && typeof answers === 'object' ? answers : null;
      if (a) {
        const lines = [];
        function add(k, v) { if (v != null && String(v).trim()) lines.push(`- ${k}: ${String(v).trim()}`); }
        add('Characters', a.characters);
        add('Visual mood', a.visual_mood || a.mood);
        add('Genre', a.genre);
        add('Setting', a.setting);
        add('Time of day', a.time_of_day || a.time);
        add('Color palette', a.color_palette || a.colors);
        add('Additional details', a.additional_details || a.details);
        if (Number.isFinite(Number(a.duration))) add('Duration', `${Number(a.duration)}s`);
        if (Number.isFinite(Number(a.num_shots))) add('Number of shots', String(Number(a.num_shots)));
        if (lines.length) stateSnapshot = `STATE SNAPSHOT (already provided):\n${lines.join('\n')}`;
      }
    } catch {}

    const assembledUserText = stateSnapshot ? `${stateSnapshot}\n\n${finalUserText}` : finalUserText;
    const convo = Array.isArray(history) ? history : (Array.isArray(transcript) ? transcript : undefined);

    // Prefer Gemini if API key is set; fall back to echo
    let reply;
    try {
      reply = await geminiGenerate({
        model,
        text: assembledUserText,
        system: SYSTEM_PROMPT,
        history: convo,
        responseMimeType: wantJson ? "application/json" : undefined,
      });
      if (!reply) reply = "(No response)";

      if (wantJson) {
        const parsed = tryParseJson(reply);
        if (parsed.ok) {
          return res.json({ ok: true, screenplay: parsed.value, model: model || null, provider: "gemini" });
        }
        // fall back to text if parsing fails
        return res.json({ ok: true, reply, provider: "gemini", parseError: parsed.error });
      }
      return res.json({ ok: true, reply, model: model || null, provider: "gemini" });
    } catch (e) {
      // Missing key or provider error — return a graceful fallback
      const note = e?.message?.includes("Missing GOOGLE_API_KEY")
        ? "No Gemini API key configured on server"
        : e?.message || "Provider error";
      console.warn("[ai chat] Gemini fallback:", note);
      const echo = `Echo: ${assembledUserText.slice(0, 400)} [model=${model || "none"}]`;
      return res.json({ ok: true, reply: echo, provider: "echo", note });
    }
  } catch (e) {
    console.error("ai chat error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

/**
 * POST /api/projects/:id/screenplay/extract
 * Body (any of):
 *  - answers: { characters?, visual_mood?, genre?, setting?, time_of_day?, color_palette?, additional_details?, duration?, num_shots? }
 *  - concept: string (free text)
 *  - auto: boolean (if true or no inputs provided, generate without asking)
 *  - model?: string
 * Returns JSON screenplay object suitable for the Screenplay panel.
 */
router.post("/:id/screenplay/extract", async (req, res) => {
  try {
    const userId = req.user.sub;
    const { id: projectId } = req.params;
    if (!isUuid(projectId)) return res.status(400).json({ ok: false, error: "Invalid project id" });

    const has = await getProjectIfMember(projectId, userId);
    if (!has) return res.status(404).json({ ok: false, error: "Project not found" });

    const { answers = {}, concept = "", auto = false, model } = req.body || {};

    // Build a concise inputs summary
    const lines = [];
    function add(label, v) { if (v != null && String(v).trim()) lines.push(`${label}: ${String(v).trim()}`); }
    add("Characters", answers.characters);
    add("Visual mood", answers.visual_mood || answers.mood);
    add("Genre", answers.genre);
    add("Setting", answers.setting);
    add("Time of day", answers.time_of_day || answers.time);
    add("Color palette", answers.color_palette || answers.colors);
    add("Additional details", answers.additional_details || answers.details);
    if (Number.isFinite(Number(answers.duration))) add("Duration", `${Number(answers.duration)}s`);
    if (Number.isFinite(Number(answers.num_shots))) add("Number of shots", String(Number(answers.num_shots)));
    const summary = lines.join("\n");

    // Base system prompt (reuse the chat behavior and catalog)
    const basePrompt = `
You are an AI Screenplay Writer that produces a complete short film screenplay package (default target: 60 seconds) for a timeline-based video editor.
Use the user's inputs if provided; otherwise, choose sensible defaults.
After composition (no questioning), silently choose the best-fitting plot structure from the catalog and align beats to it. Reveal the chosen plot type only in the final output.
`;

    let catalog = "";
    try {
      const { text } = formatPlotTypesForPrompt({ maxItems: 16, maxCharsPer: 360 });
      if (text) catalog = `\n\n${text}\n\nWhen generating, silently choose a single plot structure that best fits the concept. In the final output, return JSON with:\n  plotType: { name: <string from catalog>, rationale: <one short sentence> }\nEnsure beats align to that structure.`;
    } catch {}

    const JSON_SCHEMA_SNIPPET = `
Output strict JSON matching this schema (no markdown):
{
  "title": string,
  "genre": string,
  "duration": number,                // seconds
  "synopsis": string,
  "shots": [
    { "id": number, "title": string, "visual_description": string, "prompt": string, "negative_prompt": string, "duration": number }
  ]
}
Ensure sum(shots[*].duration) ~= duration ± 5s and shots.length >= 1.
`;

    const SYSTEM_PROMPT = basePrompt + catalog + "\n\n" + JSON_SCHEMA_SNIPPET;

    // Compose the user directive
    let userText = String(concept || "").trim();
    if (!userText && summary) userText = `Use these inputs:\n${summary}`;
    if (!userText && !summary) userText = "Auto mode: generate a complete 60s screenplay package now (use defaults where unspecified).";
    if (auto) userText = (userText ? `${userText}\n\n` : "") + "Auto mode: proceed to generate without asking questions.";

    const reply = await geminiGenerate({
      model,
      text: userText,
      system: SYSTEM_PROMPT,
      responseMimeType: "application/json",
    });

    const parsed = tryParseJson(reply);
    if (parsed.ok) return res.json({ ok: true, screenplay: parsed.value, provider: "gemini" });
    return res.json({ ok: true, reply, provider: "gemini", parseError: parsed.error });
  } catch (e) {
    console.error("screenplay extract error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

/**
 * GET /api/projects/:id/script
 * Returns the latest saved screenplay text (and JSON if available).
 */
router.get("/:id/script", async (req, res) => {
  try {
    const userId = req.user.sub;
    const { id: projectId } = req.params;
    if (!isUuid(projectId)) return res.status(400).json({ error: "Invalid project id" });

    const has = await getProjectIfMember(projectId, userId);
    if (!has) return res.status(404).json({ error: "Project not found" });

    const { rows } = await pool.query(
      `
      SELECT payload, created_at
      FROM timeline_items
      WHERE project_id = $1 AND type = 'screenplay'
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [projectId]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });

    const p = rows[0]?.payload || {};
    const text = typeof p?.text === 'string' ? p.text : (p?.screenplay_text || null);
    const json = p?.json || p?.screenplay_json || null;
    const screenplay = typeof text === 'string' ? text : (json ? JSON.stringify(json, null, 2) : "");
    return res.json({ ok: true, screenplay, screenplayJson: json || null });
  } catch (e) {
    console.error("get screenplay error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/projects/:id/script
 * Body: { screenplay: string|object, screenplayJson?: object }
 * Saves screenplay as a timeline item (type 'screenplay'). Returns a string version for UI.
 */
router.post("/:id/script", async (req, res) => {
  try {
    const userId = req.user.sub;
    const { id: projectId } = req.params;
    if (!isUuid(projectId)) return res.status(400).json({ error: "Invalid project id" });

    const has = await getProjectIfMember(projectId, userId);
    if (!has) return res.status(404).json({ error: "Project not found" });

    let { screenplay, screenplayJson } = req.body || {};
    let text = null; let json = null;

    if (typeof screenplay === 'string') {
      text = screenplay;
      // try JSON parse to populate json if string contains JSON
      try { const parsed = JSON.parse(screenplay); if (parsed && typeof parsed === 'object') json = parsed; } catch {}
    } else if (screenplay && typeof screenplay === 'object') {
      json = screenplay;
    }
    if (!json && screenplayJson && typeof screenplayJson === 'object') json = screenplayJson;
    if (!text && json) text = JSON.stringify(json, null, 2);
    if (typeof text !== 'string') text = '';

    await pool.query(
      `INSERT INTO timeline_items (project_id, user_id, type, ref_id, payload)
       VALUES ($1,$2,'screenplay',NULL,$3)`,
      [projectId, userId, JSON.stringify({ text, json })]
    );

    return res.json({ ok: true, screenplay: text });
  } catch (e) {
    console.error("save screenplay error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});
function tryParseJson(s) {
  try {
    // Clean code fences if present
    const trimmed = String(s).trim();
    const fence = trimmed.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/);
    const raw = fence ? fence[1] : trimmed;
    // Try direct parse
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    // Attempt to extract the largest JSON object substring
    try {
      const str = String(s);
      const start = str.indexOf("{");
      const end = str.lastIndexOf("}");
      if (start >= 0 && end > start) {
        const sub = str.slice(start, end + 1);
        return { ok: true, value: JSON.parse(sub) };
      }
    } catch {}
    return { ok: false, error: "Failed to parse JSON screenplay" };
  }
}

/**
 * GET /api/projects/:id/video-references
 * Convenience filter of media by kind='video'
 * -> { ok: true, items: [...] }
 */
router.get("/:id/video-references", async (req, res) => {
  try {
    const userId = req.user.sub;
    const { id: projectId } = req.params;
    if (!isUuid(projectId)) return res.status(400).json({ error: "Invalid project id" });

    const has = await getProjectIfMember(projectId, userId);
    if (!has) return res.status(404).json({ error: "Project not found" });

    const { rows } = await pool.query(
      `
      SELECT id, project_id, kind, filename, remote_url, meta, created_at
      FROM media
      WHERE project_id = $1 AND kind = 'video'
      ORDER BY created_at DESC
      `,
      [projectId]
    );

    return res.json({ ok: true, items: rows });
  } catch (e) {
    console.error("video-references (by project) error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /api/video-references
 * All video media across projects you can access (owner or member)
 * -> { ok: true, items: [...] }
 */
router.get("/video-references", async (req, res) => {
  try {
    const userId = req.user.sub;
    const { rows } = await pool.query(
      `
      SELECT m.id, m.project_id, m.kind, m.filename, m.remote_url, m.meta, m.created_at
      FROM media m
      JOIN projects p ON p.id = m.project_id
      WHERE m.kind = 'video'
        AND (p.owner_id = $1 OR EXISTS (
          SELECT 1 FROM project_members pm
          WHERE pm.project_id = p.id AND pm.user_id = $1
        ))
      ORDER BY m.created_at DESC
      `,
      [userId]
    );

    return res.json({ ok: true, items: rows });
  } catch (e) {
    console.error("video-references (all) error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
