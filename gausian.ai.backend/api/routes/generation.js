// api/routes/generation.js
import express from "express";
import fetch from "node-fetch";
import { requireAuth } from "../middleware/auth.js";
import pool from "../db.js";
import { ensureModalAppEndpoint, markJobStart, markJobDone } from "../lib/modalManager.js";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { addRegenMapping } from "../lib/regenMap.js";

const DEBUG = process.env.DEBUG_PROMPT === "1" || true; // Temporarily enable debug
const router = express.Router();
router.use(requireAuth);

// ---------- Load WAN 2.2 workflow (API format) ----------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW_PATH = path.resolve(__dirname, "..", "workflows", "wan22_t2v_flexible.json");
const WORKFLOW_60FPS_PATH = path.resolve(__dirname, "..", "workflows", "Wrapper-SelfForcing-TextToVideo-60FPS.json");

let WAN22_TEMPLATE = null;
let WAN60FPS_TEMPLATE = null;

try {
  let tpl = JSON.parse(fs.readFileSync(WORKFLOW_PATH, "utf8"));
  // If wrapped as { prompt: {...} }, unwrap it
  if (tpl && typeof tpl === "object" && tpl.prompt && typeof tpl.prompt === "object") {
    tpl = tpl.prompt;
  }
  // Reject editor/canvas format
  if (tpl && typeof tpl === "object" && Array.isArray(tpl.nodes)) {
    throw new Error("Workflow file is ComfyUI editor format (has nodes[]). Export API format before using.");
  }
  WAN22_TEMPLATE = tpl;
  console.log(`[gen] Loaded workflow template: ${WORKFLOW_PATH}`);
} catch (e) {
  console.error(`[gen] Failed to read workflow template at ${WORKFLOW_PATH}:`, e);
  WAN22_TEMPLATE = null;
}

// Load 60FPS workflow (ComfyUI editor format)
try {
  let tpl = JSON.parse(fs.readFileSync(WORKFLOW_60FPS_PATH, "utf8"));
  // Convert from editor format to API format
  if (tpl && typeof tpl === "object" && Array.isArray(tpl.nodes)) {
    tpl = convertEditorToApi(tpl);
  }
  WAN60FPS_TEMPLATE = tpl;
  console.log(`[gen] Loaded 60FPS workflow template: ${WORKFLOW_60FPS_PATH}`);
} catch (e) {
  console.error(`[gen] Failed to read 60FPS workflow template at ${WORKFLOW_60FPS_PATH}:`, e);
  WAN60FPS_TEMPLATE = null;
}

// ---------- helpers ----------

/** Convert ComfyUI editor format to API format */
function convertEditorToApi(editorWorkflow) {
  if (!editorWorkflow || !Array.isArray(editorWorkflow.nodes)) {
    throw new Error("Invalid editor workflow format");
  }
  
  const apiFormat = {};
  
  for (const node of editorWorkflow.nodes) {
    if (!node.id || !node.type) continue;
    
    // Convert node to API format
    const apiNode = {
      class_type: node.type,
      inputs: {}
    };
    
    // Convert widgets_values to inputs (primary method)
    if (node.widgets_values) {
      if (Array.isArray(node.widgets_values)) {
        // Handle array format (most common)
        const widgetNames = getWidgetNames(node.type);
        for (let i = 0; i < Math.min(node.widgets_values.length, widgetNames.length); i++) {
          apiNode.inputs[widgetNames[i]] = node.widgets_values[i];
        }
      } else if (typeof node.widgets_values === 'object') {
        // Handle object format (VHS_VideoCombine nodes)
        Object.assign(apiNode.inputs, node.widgets_values);
      }
    }
    
    // Convert inputs from editor format (secondary method)
    if (node.inputs) {
      for (const input of node.inputs) {
        if (input.link !== null && input.link !== undefined) {
          // This is a connection, we'll handle it later
          continue;
        }
        // This is a widget value
        if (input.widget && input.widget.name) {
          apiNode.inputs[input.widget.name] = input.widget.value;
        }
      }
    }
    
    // Always include the node, even if it has no inputs (like Reroute nodes)
    // Use hash prefix for node IDs in API format
    apiFormat[`#${node.id}`] = apiNode;
  }
  
  // Process links to create connections
  if (editorWorkflow.links) {
    for (const link of editorWorkflow.links) {
      const [linkId, fromNodeId, fromSlot, toNodeId, toSlot, dataType] = link;
      const fromNodeKey = `#${fromNodeId}`;
      const toNodeKey = `#${toNodeId}`;
      if (apiFormat[toNodeKey] && apiFormat[fromNodeKey]) {
        // Create connection in API format
        const inputName = getInputName(toNodeId, toSlot);
        apiFormat[toNodeKey].inputs[inputName] = [fromNodeKey, fromSlot];
      }
    }
  }
  
  // Debug: log the converted nodes
  if (DEBUG) {
    console.log("[gen] Converted nodes:", Object.keys(apiFormat).length);
    console.log("[gen] Node #141 exists:", !!apiFormat['#141']);
    console.log("[gen] Node #141 type:", apiFormat['#141']?.class_type);
  }
  
  return apiFormat;
}

/** Get widget names for a given node type */
function getWidgetNames(nodeType) {
  // Common widget patterns for different node types
  const widgetMaps = {
    'WanVideoEmptyEmbeds': ['width', 'height', 'length'],
    'WanVideoSampler': ['steps', 'cfg', 'motion_scale', 'seed', 'seed_mode', 'scheduler', 'scheduler_type', 'scheduler_shift', 'scheduler_shift_mode', 'custom_scheduler', 'scheduler_mode', 'custom_scheduler_args'],
    'Text Prompt (JPS)': ['text'],
    'VHS_VideoCombine': ['frame_rate', 'loop_count', 'filename_prefix', 'format', 'pix_fmt', 'crf', 'save_metadata', 'trim_to_audio', 'pingpong', 'save_output'],
    'RIFE VFI': ['model', 'interpolation_factor', 'multiplier', 'skip_first_last', 'skip_middle', 'skip_threshold'],
    'WanVideoLoraSelect': ['lora_name', 'strength', 'enabled'],
    'WanVideoEnhanceAVideo': ['factor', 'mode', 'enabled'],
    'Int': ['value'],
    'Reroute': [], // Reroute nodes have no widgets
    'Note': [], // Note nodes have no widgets
    'SetNode': ['value'], // SetNode has a single value widget
    'Anything Everywhere': [], // No widgets
    'UpscaleModelLoader': ['model_name'],
    'WanVideoModelLoader': ['model_name', 'weight_dtype', 'compile_mode', 'offload_device', 'attention_mode'],
    'WanVideoVAELoader': ['vae_name', 'weight_dtype'],
    'LoadWanVideoT5TextEncoder': ['model_name', 'weight_dtype', 'offload_device', 'compile_mode'],
    'WanVideoDecode': ['tile_size', 'tile_stride', 'tile_overlap', 'tile_border'],
    'easy cleanGpuUsed': [], // No widgets
    'WanVideoTextEncode': ['positive_prompt', 'negative_prompt', 'normalize_embeddings']
  };
  
  return widgetMaps[nodeType] || [];
}

/** Get input name for a given node and slot */
function getInputName(nodeId, slot) {
  // This is a simplified mapping - in practice, you'd need the actual input names
  const inputMaps = {
    '205': ['model', 'image_embeds', 'text_embeds', 'samples', 'feta_args', 'context_options', 'cache_args', 'flowedit_args', 'slg_args', 'loop_args', 'experimental_args', 'sigmas', 'unianimate_poses', 'fantasytalking_embeds', 'uni3c_embeds', 'teacache_args'],
    '254': ['t5', 'model_to_offload', 'positive_prompt', 'negative_prompt'],
    '80': ['images', 'audio', 'meta_batch', 'vae'],
    '94': ['images', 'audio', 'meta_batch', 'vae'],
    '252': ['frames', 'optional_interpolation_states'],
    '204': ['vae', 'samples'],
    '192': ['IMAGE'],
    '227': ['anything'],
    '209': ['control_embeds'],
    '198': ['compile_args', 'block_swap_args', 'lora', 'vram_management_args', 'vace_model', 'fantasytalking_model'],
    '202': [],
    '253': [],
    '154': [],
    '256': [],
    '257': [],
    '246': ['prev_lora', 'blocks'],
    '250': ['prev_lora', 'blocks'],
    '229': ['prev_lora', 'blocks'],
    '247': ['prev_lora', 'blocks'],
    '244': [],
    '218': [],
    '141': [''],
    '142': [''],
    '232': [''],
    '255': [''],
    '241': [''],
    '242': [''],
    '238': [''],
    '239': [''],
    '240': ['']
  };
  
  const inputs = inputMaps[nodeId] || [];
  return inputs[slot] || `input_${slot}`;
}

function assertApiMap(graph) {
  if (!graph || typeof graph !== "object" || Array.isArray(graph)) {
    throw new Error("Prompt must be an object map (API format), not array/string");
  }
  const keys = Object.keys(graph);
  if (!keys.length) throw new Error("Prompt map is empty");
  for (const k of keys) {
    const v = graph[k];
    if (!v || typeof v !== "object" || Array.isArray(v)) {
      throw new Error(`Node ${k} must be an object, got ${typeof v}`);
    }
    if (!("class_type" in v)) throw new Error(`Node ${k} missing class_type`);
    if (!("inputs" in v) || typeof v.inputs !== "object" || Array.isArray(v.inputs)) {
      throw new Error(`Node ${k} missing inputs object`);
    }
  }
}

/** Revive any node-level JSON strings, but only if they parse to an object. */
function reviveNodesMap(graph) {
  if (!graph || typeof graph !== "object" || Array.isArray(graph)) return graph;
  for (const [k, v] of Object.entries(graph)) {
    if (typeof v === "string") {
      try {
        const parsed = JSON.parse(v);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          graph[k] = parsed;
        } else {
          throw new Error(`parsed to ${typeof parsed}`);
        }
      } catch (e) {
        throw new Error(`Node ${k} is a string and did not JSON.parse to an object (${e.message})`);
      }
    }
  }
  return graph;
}

// replace both {{KEY}} and {KEY}
function replacePlaceholders(str, map) {
  let s = str;
  for (const [k, v] of Object.entries(map)) {
    s = s.split(`{{${k}}}`).join(String(v));
    s = s.split(`{${k}}`).join(String(v));
  }
  return s;
}

/** Deep placeholder replacement + numeric coercions (generic across all nodes). */
function hydrateWan22Template(template, { PROMPT, NEGATIVE, WIDTH, HEIGHT, LENGTH, SEED }) {
  const cloned = JSON.parse(JSON.stringify(template));
  const ph = { PROMPT, NEGATIVE, WIDTH, HEIGHT, LENGTH, SEED };

  const replaceIn = (obj) => {
    if (Array.isArray(obj)) return obj.map(replaceIn);
    if (obj && typeof obj === "object") {
      for (const k of Object.keys(obj)) obj[k] = replaceIn(obj[k]);
      return obj;
    }
    if (typeof obj === "string") {
      return replacePlaceholders(obj, ph);
    }
    return obj;
  };

  const t = replaceIn(cloned);

  // Generic numeric coercion for common fields across ANY node class
  for (const [, node] of Object.entries(t)) {
    if (!node?.inputs || typeof node.inputs !== "object") continue;
    const inp = node.inputs;

    // width/height/frames/length
    if ("width" in inp) inp.width = Number(WIDTH);
    if ("height" in inp) inp.height = Number(HEIGHT);
    if ("frames" in inp) inp.frames = Number(LENGTH);
    if ("length" in inp) inp.length = Number(LENGTH);

    // seeds
    if ("seed" in inp) inp.seed = Number(SEED);
    if ("noise_seed" in inp) inp.noise_seed = Number(SEED);
  }

  // Extra debug: warn if any placeholders survived
  if (DEBUG) {
    const leftovers = [];
    const scan = (x, kpath = "") => {
      if (typeof x === "string") {
        if (x.includes("{WIDTH}") || x.includes("{HEIGHT}") || x.includes("{LENGTH}") || x.includes("{SEED}") ||
            x.includes("{{WIDTH}}") || x.includes("{{HEIGHT}}") || x.includes("{{LENGTH}}") || x.includes("{{SEED}}")) {
          leftovers.push(kpath);
        }
      } else if (Array.isArray(x)) {
        x.forEach((y, i) => scan(y, `${kpath}[${i}]`));
      } else if (x && typeof x === "object") {
        Object.entries(x).forEach(([k, v]) => scan(v, kpath ? `${kpath}.${k}` : k));
      }
    };
    scan(t);
    if (leftovers.length) console.debug("[gen] WARNING: leftover placeholders at:", leftovers.slice(0, 12));
  }

  // IMPORTANT: revive node-level JSON strings (if any)
  reviveNodesMap(t);
  // Validate final shape
  assertApiMap(t);

  if (DEBUG) {
    const keys = Object.keys(t);
    const fk = keys[0];
    const first = t[fk];
    console.debug("[gen] first node key:", fk, "class_type:", first.class_type, "inputs:", Object.keys(first.inputs || {}));
  }

  return t;
}

/** Hydrate 60FPS workflow template with user parameters */
function hydrateWan60FpsTemplate(template, { PROMPT, NEGATIVE, WIDTH, HEIGHT, LENGTH, SEED, filenamePrefix }) {
  const cloned = JSON.parse(JSON.stringify(template));
  const ph = { PROMPT, NEGATIVE, WIDTH, HEIGHT, LENGTH, SEED };

  const replaceIn = (obj) => {
    if (Array.isArray(obj)) return obj.map(replaceIn);
    if (obj && typeof obj === "object") {
      for (const k of Object.keys(obj)) obj[k] = replaceIn(obj[k]);
      return obj;
    }
    if (typeof obj === "string") {
      return replacePlaceholders(obj, ph);
    }
    return obj;
  };

  const t = replaceIn(cloned);

  // Specific node updates for 60FPS workflow
  for (const [nodeId, node] of Object.entries(t)) {
    if (!node?.inputs || typeof node.inputs !== "object") continue;
    const inp = node.inputs;

    // Update WanVideoEmptyEmbeds (Node 209) - Video dimensions and frame count
    if (node.class_type === "WanVideoEmptyEmbeds") {
      if ("width" in inp) inp.width = Number(WIDTH);
      if ("height" in inp) inp.height = Number(HEIGHT);
      if ("length" in inp) inp.length = Number(LENGTH);
    }

    // Update WanVideoSampler (Node 205) - Sampling parameters
    if (node.class_type === "WanVideoSampler") {
      if ("seed" in inp) inp.seed = Number(SEED);
      if ("steps" in inp) inp.steps = Number(inp.steps || 6);
      if ("cfg" in inp) inp.cfg = Number(inp.cfg || 1.0);
      if ("motion_scale" in inp) inp.motion_scale = Number(inp.motion_scale || 8.0);
    }

    // Update Text Prompt nodes (Nodes #256, #257) - Prompts
    if (node.class_type === "Text Prompt (JPS)") {
      if (nodeId === "#256") { // Positive prompt
        if ("text" in inp) inp.text = String(PROMPT);
      } else if (nodeId === "#257") { // Negative prompt
        if ("text" in inp) inp.text = String(NEGATIVE);
      }
    }

    // Update VHS_VideoCombine nodes (Nodes 80, 94) - Filename prefixes
    if (node.class_type === "VHS_VideoCombine") {
      if ("filename_prefix" in inp) {
        inp.filename_prefix = filenamePrefix;
      }
    }

    // Generic numeric coercion for common fields
    if ("width" in inp) inp.width = Number(WIDTH);
    if ("height" in inp) inp.height = Number(HEIGHT);
    if ("frames" in inp) inp.frames = Number(LENGTH);
    if ("length" in inp) inp.length = Number(LENGTH);
    if ("seed" in inp) inp.seed = Number(SEED);
    if ("noise_seed" in inp) inp.noise_seed = Number(SEED);
  }

  // Extra debug: warn if any placeholders survived
  if (DEBUG) {
    const leftovers = [];
    const scan = (x, kpath = "") => {
      if (typeof x === "string") {
        if (x.includes("{WIDTH}") || x.includes("{HEIGHT}") || x.includes("{LENGTH}") || x.includes("{SEED}") ||
            x.includes("{{WIDTH}}") || x.includes("{{HEIGHT}}") || x.includes("{{LENGTH}}") || x.includes("{{SEED}}")) {
          leftovers.push(kpath);
        }
      } else if (Array.isArray(x)) {
        x.forEach((y, i) => scan(y, `${kpath}[${i}]`));
      } else if (x && typeof x === "object") {
        Object.entries(x).forEach(([k, v]) => scan(v, kpath ? `${kpath}.${k}` : k));
      }
    };
    scan(t);
    if (leftovers.length) console.debug("[gen] WARNING: leftover placeholders at:", leftovers.slice(0, 12));
  }

  // Validate final shape
  assertApiMap(t);

  if (DEBUG) {
    const keys = Object.keys(t);
    const fk = keys[0];
    const first = t[fk];
    console.debug("[gen] 60FPS workflow hydrated. first node key:", fk, "class_type:", first.class_type, "inputs:", Object.keys(first.inputs || {}));
  }

  return t;
}

// ---------- Routes ----------

/**
 * POST /api/projects/:id/generate-videos
 * body: { params: { prompt, negative?, length, width, height, seed? } }
 * Returns: { ok: true, promptId, endpoint, clientId } | { ok:true, submitted:true, ... }
 */
router.post("/:id/generate-videos", async (req, res) => {
  if (!WAN22_TEMPLATE) {
    return res.status(500).json({ error: "Workflow template missing on server" });
  }

  const userId = req.user.sub;
  const { id: projectId } = req.params;
  const { params } = req.body || {};

  const missing = [];
  if (!params?.prompt) missing.push("prompt");
  if (!params?.length) missing.push("length");
  if (!params?.width)  missing.push("width");
  if (!params?.height) missing.push("height");
  if (missing.length) return res.status(400).json({ error: `Missing params: ${missing.join(", ")}` });

  const width  = Number(params.width);
  const height = Number(params.height);
  const length = Number(params.length);
  const seed   = Number(params.seed ?? Math.floor(Math.random() * 1e9));
  if (![width, height, length].every(n => Number.isFinite(n) && n > 0)) {
    return res.status(400).json({ error: "width, height, length must be positive numbers" });
  }

  // ACL: must own or be member
  const { rows: can } = await pool.query(
    `
      SELECT 1
      FROM projects p
      WHERE p.id = $1
        AND (p.owner_id = $2 OR EXISTS (
          SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = $2
        ))
      LIMIT 1
    `,
    [projectId, userId]
  );
  if (!can.length) return res.status(404).json({ error: "Project not found" });

  try {
    const { endpoint } = await ensureModalAppEndpoint();

    // Build prompt graph (fully hydrated & validated object map)
    const promptGraph = hydrateWan22Template(WAN22_TEMPLATE, {
      PROMPT:   String(params.prompt),
      NEGATIVE: String(params.negative ?? ""),
      WIDTH:    width,
      HEIGHT:   height,
      LENGTH:   length,
      SEED:     seed,
    });

    // Final sanity: NO string nodes allowed
    const stringNodes = Object.entries(promptGraph)
      .filter(([, v]) => typeof v === "string")
      .map(([k]) => k);
    if (stringNodes.length) {
      throw new Error(`Leftover string nodes after hydration: ${stringNodes.slice(0, 8).join(", ")}`);
    }

    if (DEBUG) {
      const keys = Object.keys(promptGraph);
      const fk = keys[0];
      const first = promptGraph[fk];
      console.log("[gen] promptGraph ok. first:", fk, first.class_type, "inputs:", Object.keys(first.inputs || {}));
    }

    const clientId = `u:${userId}:p:${projectId}:${crypto.randomUUID()}`;
    markJobStart();


    // Create a unique, human-readable prefix per job
    const short = crypto.randomUUID().split("-")[0];
    const filePrefix = `u${userId}_p${projectId}_${short}`;


    // Force unique filename prefix on the saver node
    for (const [, node] of Object.entries(promptGraph)) {
      if (node?.class_type === "VHS_VideoCombine" && node.inputs) {
        node.inputs.filename_prefix = filePrefix;
      }
    }

    const r = await fetch(`${endpoint}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json", "accept": "application/json" },
      // IMPORTANT: promptGraph remains an OBJECT
      body: JSON.stringify({ prompt: promptGraph, client_id: clientId }),
    });

    const text = await r.text();
    if (!r.ok) {
      // Surface Comfy/Modal error for faster debugging
      throw new Error(`Modal /prompt failed: ${r.status} ${text}`);
    }

    let out;
    try { out = JSON.parse(text); } catch { out = { raw: text }; }
    const promptId = out?.prompt_id ?? out?.promptId ?? out?.id ?? null;

    try {
      await pool.query(
        `INSERT INTO jobs (project_id, user_id, prompt_id, status, created_at)
         VALUES ($1, $2, $3, 'queued', NOW())`,
        [projectId, userId, promptId ? String(promptId) : null]
      );
      
      // Store generation prompts for later retrieval
      await pool.query(
        `INSERT INTO generation_prompts (project_id, user_id, prompt_id, client_id, filename_prefix, positive_prompt, negative_prompt, seed, width, height, length, fps)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          projectId, 
          userId, 
          promptId ? String(promptId) : null,
          clientId,
          filePrefix,
          String(params.prompt),
          String(params.negative || ""),
          seed,
          width,
          height,
          length,
          Math.max(1, Number(params.fps || 24))
        ]
      );
    } catch (e) {
      console.warn("[gen] insert jobs/prompts warning:", e.message);
    }

    if (!promptId) {
      return res.status(202).json({ ok: true, submitted: true, endpoint, out, clientId });
    }
    return res.status(202).json({ ok: true, promptId, endpoint, clientId });
  } catch (e) {
    console.error("generate-videos error:", e);
    return res.status(500).json({ error: e.message || "Server error" });
  } finally {
    markJobDone();
  }
});

/**
 * POST /api/projects/:id/regenerate-clip (WAN 2.2 workflow)
 * Body: {
 *   timelineItemId?: string,   // preferred (placed_video item)
 *   refId?: string,            // media id (fallback if no timeline item)
 *   params: {
 *     prompt: string,
 *     negative?: string,
 *     width: number,
 *     height: number,
 *     length?: number,         // frames (used if no payload duration)
 *     fps?: number,
 *     seed?: number
 *   },
 *   replace?: boolean          // reserved for future use
 * }
 *
 * Returns: { ok, promptId?, endpoint, clientId }
 */
router.post("/:id/regenerate-clip", async (req, res) => {
  if (!WAN22_TEMPLATE) {
    return res.status(500).json({ error: "Workflow template missing on server" });
  }

  const userId = req.user.sub;
  const { id: projectId } = req.params;
  const { timelineItemId, refId, params } = req.body || {};

  // Basic params validation
  const missing = [];
  if (!params?.prompt) missing.push("prompt");
  if (!params?.width)  missing.push("width");
  if (!params?.height) missing.push("height");
  if (missing.length) return res.status(400).json({ error: `Missing params: ${missing.join(", ")}` });

  // ACL: must own or be member
  const { rows: can } = await pool.query(
    `
      SELECT 1
      FROM projects p
      WHERE p.id = $1
        AND (p.owner_id = $2 OR EXISTS (
          SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = $2
        ))
      LIMIT 1
    `,
    [projectId, userId]
  );
  if (!can.length) return res.status(404).json({ error: "Project not found" });

  // Load timeline payload if provided to derive frames/fps/shot info
  let payload = null;
  let mediaIdFromTimeline = null;
  let timelineItemFound = false;
  let fallbackTimelineItemId = null;
  // Validate UUID format before querying by timelineItemId to avoid 22P02 errors
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (timelineItemId && typeof timelineItemId === 'string' && uuidRegex.test(timelineItemId)) {
    const { rows } = await pool.query(
      `SELECT id, type, ref_id, payload
       FROM timeline_items
       WHERE id = $1 AND project_id = $2
       LIMIT 1`,
      [timelineItemId, projectId]
    );
    if (!rows.length) {
      // Fallback: stale timeline id. If refId is provided, continue; also try to
      // recover the latest placement for this media to pull placement payload.
      if (refId) {
        console.warn(`[regen] timeline item ${timelineItemId} not found; falling back to refId-only regen for project ${projectId}`);
      } else {
        return res.status(404).json({ error: "Timeline item not found" });
      }
    } else {
      const row = rows[0];
      timelineItemFound = true;
      mediaIdFromTimeline = row.ref_id || null;
      try { payload = row.payload || null; } catch { payload = null; }
    }
  } else if (timelineItemId) {
    console.warn(`[regen] Non-UUID timelineItemId provided (${timelineItemId}); skipping direct lookup and using refId placement fallback`);
  }

  // If timeline item was not found but we have a refId, try to fetch the latest placement
  // so we can recover start_frame/duration_frames/fps for filename prefix and placement heuristics.
  if (!timelineItemFound && refId) {
    const { rows: placeRows } = await pool.query(
      `SELECT id, payload
       FROM timeline_items
       WHERE project_id = $1 AND type LIKE 'placed_%' AND ref_id = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [projectId, refId]
    );
    if (placeRows.length) {
      fallbackTimelineItemId = placeRows[0].id;
      try { payload = placeRows[0].payload || payload; } catch {}
    }
  }

  // Validate ref media belongs to project (if provided directly or from timeline)
  const targetMediaId = mediaIdFromTimeline || refId || null;
  if (targetMediaId) {
    const { rows } = await pool.query(
      `SELECT id FROM media WHERE id = $1 AND project_id = $2 LIMIT 1`,
      [targetMediaId, projectId]
    );
    if (!rows.length) return res.status(404).json({ error: "Media not found in project" });
  }

  // Derive clip placement and defaults
  const shotNumber      = Number(payload?.shot_number ?? 1) || 1;
  const startFrame      = Number(payload?.start_frame ?? 0) || 0;
  const durationFrames  = Number(payload?.duration_frames ?? params.length ?? 60) || 60;
  const fps             = Math.max(1, Number(payload?.fps ?? params.fps ?? 24));

  const width  = Number(params.width);
  const height = Number(params.height);
  const length = Number(params.length ?? durationFrames);
  const seed   = Number(params.seed ?? Math.floor(Math.random() * 1e9));

  if (![width, height, length].every(n => Number.isFinite(n) && n > 0)) {
    return res.status(400).json({ error: "width, height, length must be positive numbers" });
  }

  try {
    const { endpoint } = await ensureModalAppEndpoint();

    // Build prompt graph (WAN 2.2) with prompt/negative/geometry and seed
    const promptGraph = hydrateWan22Template(WAN22_TEMPLATE, {
      PROMPT:   String(params.prompt),
      NEGATIVE: String(params.negative ?? ""),
      WIDTH:    width,
      HEIGHT:   height,
      LENGTH:   length,
      SEED:     seed,
    });

    // Unique + structured filename prefix so modal-upload can auto-place
    const short = crypto.randomUUID().split("-")[0];
    const filePrefix = `u${userId}_p${projectId}_g${short}_s${shotNumber}_sf${startFrame}_df${durationFrames}_fps${fps}`;

    // Force filename_prefix on any video saver nodes (e.g., VHS_VideoCombine)
    for (const [, node] of Object.entries(promptGraph)) {
      if (node?.class_type === "VHS_VideoCombine" && node.inputs) {
        node.inputs.filename_prefix = filePrefix;
      }
    }

    // Final sanity: no stray strings
    const stringNodes = Object.entries(promptGraph)
      .filter(([, v]) => typeof v === "string")
      .map(([k]) => k);
    if (stringNodes.length) {
      throw new Error(`Leftover string nodes after hydration: ${stringNodes.slice(0, 8).join(", ")}`);
    }

    const clientId = `u:${userId}:p:${projectId}:${crypto.randomUUID()}`;
    markJobStart();

    const r = await fetch(`${endpoint}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json", "accept": "application/json" },
      body: JSON.stringify({ prompt: promptGraph, client_id: clientId }),
    });

    const text = await r.text();
    if (!r.ok) {
      throw new Error(`Modal /prompt failed: ${r.status} ${text}`);
    }

    const out = (() => { try { return JSON.parse(text); } catch { return { raw: text }; } })();
    const promptId = out?.prompt_id ?? out?.promptId ?? out?.id ?? null;

    // Track in jobs + generation_prompts (filename_prefix enables auto-placement later)
    try {
      await pool.query(
        `INSERT INTO jobs (project_id, user_id, prompt_id, status, created_at)
         VALUES ($1, $2, $3, 'queued', NOW())`,
        [projectId, userId, promptId ? String(promptId) : null]
      );

      // Try insert with replace_item_id persistence, fallback without if column missing
      const replaceTargetId = timelineItemFound ? (timelineItemId || null) : (fallbackTimelineItemId || null);
      try {
        await pool.query(
          `INSERT INTO generation_prompts (project_id, user_id, prompt_id, client_id, filename_prefix, positive_prompt, negative_prompt, seed, width, height, length, fps, replace_item_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            projectId,
            userId,
            promptId ? String(promptId) : null,
            clientId,
            filePrefix,
            String(params.prompt),
            String(params.negative || ""),
            seed,
            width,
            height,
            length,
            fps,
            replaceTargetId,
          ]
        );
      } catch (e) {
        // Column may not exist on older DBs; insert without it
        await pool.query(
          `INSERT INTO generation_prompts (project_id, user_id, prompt_id, client_id, filename_prefix, positive_prompt, negative_prompt, seed, width, height, length, fps)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            projectId,
            userId,
            promptId ? String(promptId) : null,
            clientId,
            filePrefix,
            String(params.prompt),
            String(params.negative || ""),
            seed,
            width,
            height,
            length,
            fps,
          ]
        );
      }
    } catch (e) {
      console.warn("[regen] insert jobs/prompts warning:", e.message);
    }

    // Register mapping for true in-place replacement if a timeline item was provided
    if (timelineItemId && timelineItemFound) {
      try {
        addRegenMapping(filePrefix, { 
          projectId, 
          timelineItemId,
          settings: {
            prompt: String(params.prompt),
            negative: String(params.negative || ""),
            seed,
            width,
            height,
            length,
            fps,
          }
        });
      } catch (e) {
        console.warn("[regen] mapping add failed:", e?.message || e);
      }
    }
    // If we fell back to the latest placement, still register mapping so uploaded clip replaces it
    else if (!timelineItemFound && fallbackTimelineItemId) {
      try {
        addRegenMapping(filePrefix, { 
          projectId, 
          timelineItemId: fallbackTimelineItemId,
          settings: {
            prompt: String(params.prompt),
            negative: String(params.negative || ""),
            seed,
            width,
            height,
            length,
            fps,
          }
        });
      } catch (e) {
        console.warn("[regen] fallback mapping add failed:", e?.message || e);
      }
    }

    if (!promptId) {
      return res.status(202).json({ ok: true, submitted: true, endpoint, clientId });
    }
    return res.status(202).json({ ok: true, promptId, endpoint, clientId });
  } catch (e) {
    console.error("regenerate-clip error:", e);
    return res.status(500).json({ error: e.message || "Server error" });
  } finally {
    markJobDone();
  }
});

/**
 * POST /api/projects/:id/generate-videos-60fps
 * body: { params: { prompt, negative?, length, width, height, seed? } }
 * Returns: { ok: true, promptId, endpoint, clientId } | { ok:true, submitted:true, ... }
 */
router.post("/:id/generate-videos-60fps", async (req, res) => {
  if (!WAN60FPS_TEMPLATE) {
    return res.status(500).json({ error: "60FPS workflow template missing on server" });
  }

  const userId = req.user.sub;
  const { id: projectId } = req.params;
  const { params } = req.body || {};

  const missing = [];
  if (!params?.prompt) missing.push("prompt");
  if (!params?.length) missing.push("length");
  if (!params?.width)  missing.push("width");
  if (!params?.height) missing.push("height");
  if (missing.length) return res.status(400).json({ error: `Missing params: ${missing.join(", ")}` });

  const width  = Number(params.width);
  const height = Number(params.height);
  const length = Number(params.length);
  const seed   = Number(params.seed ?? Math.floor(Math.random() * 1e9));
  if (![width, height, length].every(n => Number.isFinite(n) && n > 0)) {
    return res.status(400).json({ error: "width, height, length must be positive numbers" });
  }

  // ACL: must own or be member
  const { rows: can } = await pool.query(
    `
      SELECT 1
      FROM projects p
      WHERE p.id = $1
        AND (p.owner_id = $2 OR EXISTS (
          SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = $2
        ))
      LIMIT 1
    `,
    [projectId, userId]
  );
  if (!can.length) return res.status(404).json({ error: "Project not found" });

  try {
    const { endpoint } = await ensureModalAppEndpoint();

    // Create a unique, human-readable prefix per job
    const short = crypto.randomUUID().split("-")[0];
    const filePrefix = `u${userId}_p${projectId}_${short}`;

    // Build prompt graph (fully hydrated & validated object map)
    const promptGraph = hydrateWan60FpsTemplate(WAN60FPS_TEMPLATE, {
      PROMPT:   String(params.prompt),
      NEGATIVE: String(params.negative ?? ""),
      WIDTH:    width,
      HEIGHT:   height,
      LENGTH:   length,
      SEED:     seed,
      filenamePrefix: filePrefix,
    });

    // Final sanity: NO string nodes allowed
    const stringNodes = Object.entries(promptGraph)
      .filter(([, v]) => typeof v === "string")
      .map(([k]) => k);
    if (stringNodes.length) {
      throw new Error(`Leftover string nodes after hydration: ${stringNodes.slice(0, 8).join(", ")}`);
    }

    if (DEBUG) {
      const keys = Object.keys(promptGraph);
      const fk = keys[0];
      const first = promptGraph[fk];
      console.log("[gen] 60FPS promptGraph ok. first:", fk, first.class_type, "inputs:", Object.keys(first.inputs || {}));
    }

    const clientId = `u:${userId}:p:${projectId}:${crypto.randomUUID()}`;
    markJobStart();

    const r = await fetch(`${endpoint}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json", "accept": "application/json" },
      // IMPORTANT: promptGraph remains an OBJECT
      body: JSON.stringify({ prompt: promptGraph, client_id: clientId }),
    });

    const text = await r.text();
    if (!r.ok) {
      // Surface Comfy/Modal error for faster debugging
      throw new Error(`Modal /prompt failed: ${r.status} ${text}`);
    }

    let out;
    try { out = JSON.parse(text); } catch { out = { raw: text }; }
    const promptId = out?.prompt_id ?? out?.promptId ?? out?.id ?? null;

    try {
      await pool.query(
        `INSERT INTO jobs (project_id, user_id, prompt_id, status, created_at)
         VALUES ($1, $2, $3, 'queued', NOW())`,
        [projectId, userId, promptId ? String(promptId) : null]
      );
      
      // Store generation prompts for later retrieval
      await pool.query(
        `INSERT INTO generation_prompts (project_id, user_id, prompt_id, client_id, filename_prefix, positive_prompt, negative_prompt, seed, width, height, length, fps)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          projectId, 
          userId, 
          promptId ? String(promptId) : null,
          clientId,
          filePrefix,
          String(params.prompt),
          String(params.negative || ""),
          seed,
          width,
          height,
          length,
          Math.max(1, Number(params.fps || 24))
        ]
      );
    } catch (e) {
      console.warn("[gen] insert jobs/prompts warning:", e.message);
    }

    if (!promptId) {
      return res.status(202).json({ ok: true, submitted: true, endpoint, out, clientId });
    }
    return res.status(202).json({ ok: true, promptId, endpoint, clientId });
  } catch (e) {
    console.error("generate-videos-60fps error:", e);
    return res.status(500).json({ error: e.message || "Server error" });
  } finally {
    markJobDone();
  }
});

// Pass-through to ComfyUI history
router.get("/:id/generate-videos/:promptId/status", async (req, res) => {
  try {
    const { endpoint } = await ensureModalAppEndpoint();
    const r = await fetch(`${endpoint}/history/${encodeURIComponent(req.params.promptId)}`, {
      headers: { "accept": "application/json" },
    });
    const txt = await r.text();
    res.status(r.status).type(r.headers.get("content-type") || "application/json").send(txt);
  } catch (e) {
    console.error("status proxy error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
