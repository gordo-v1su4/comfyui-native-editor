// api/routes/export.js
import express from "express";
import { requireAuth } from "../middleware/auth.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";

const router = express.Router();
router.use(requireAuth);

// In-memory job store for demo/placeholder behavior
// NOTE: This resets on container restarts; replace with DB if persisting is needed
const JOBS = new Map(); // exportId -> { status, createdAt, progress (0-1), payload, resultUrl, error, firstFile, outPath }

let _isWorkerRunning = false;
const _queue = [];

function absApiUrl(req, rel) {
  if (/^https?:\/\//i.test(rel)) return rel;
  const proto = (req.headers["x-forwarded-proto"] || req.protocol || "https").toString();
  const host = (req.headers["x-forwarded-host"] || req.headers.host || "").toString();
  return `${proto}://${host}${rel.startsWith("/") ? rel : "/" + rel}`;
}

function pickFirstDataUrl(payload) {
  try {
    const files = payload?.videoFiles || payload?.files || null;
    if (!files || typeof files !== "object") return null;
    const firstKey = Object.keys(files)[0];
    const dataUrl = files[firstKey];
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) return null;
    const m = dataUrl.match(/^data:([^;,]+)?;base64,(.+)$/);
    if (!m) return null;
    const contentType = m[1] || "application/octet-stream";
    const base64 = m[2];
    return { contentType, base64 };
  } catch {
    return null;
  }
}

function createJob(payload) {
  const exportId = `exp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const job = {
    id: exportId,
    status: "queued",
    createdAt: Date.now(),
    progress: 0,
    payload,
    resultUrl: null,
    error: null,
    firstFile: pickFirstDataUrl(payload),
    outPath: null,
  };
  JOBS.set(exportId, job);

  // Simulate work: advance progress over ~4s then mark done
  _queue.push(exportId);
  runWorker().catch(() => {});

  return exportId;
}

async function runWorker() {
  if (_isWorkerRunning) return;
  _isWorkerRunning = true;
  try {
    while (_queue.length) {
      const id = _queue.shift();
      const job = JOBS.get(id);
      if (!job) continue;
      try {
        await processJob(job);
      } catch (e) {
        job.status = "error";
        job.error = e?.message || String(e);
        job.progress = 1;
      }
    }
  } finally {
    _isWorkerRunning = false;
  }
}

async function processJob(job) {
  job.status = "processing";
  job.progress = 0.05;

  const tmpDir = path.join(os.tmpdir(), `export_${job.id}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const payload = job.payload || {};

  // 1) Gather clip sources (prefer tracks->items->src|url). Fallback to first data URL.
  const clips = [];
  const tracks = Array.isArray(payload.tracks) ? payload.tracks : [];
  for (const t of tracks) {
    const items = Array.isArray(t?.items) ? t.items : [];
    for (const it of items) {
      const src = it?.src || it?.url;
      if (typeof src === "string" && src) clips.push({ url: src });
    }
  }

  if (!clips.length && job.firstFile) {
    // Save the base64 as a temp mp4 and return it as the single clip
    const b = Buffer.from(job.firstFile.base64, "base64");
    const p = path.join(tmpDir, `clip_0.mp4`);
    fs.writeFileSync(p, b);
    clips.push({ file: p });
  }

  if (!clips.length) {
    throw new Error("No clips to render (no tracks items or files)");
  }

  // 2) Download each src URL to a temp file (only allow our own media stream endpoints)
  let idx = 0;
  const listPaths = [];
  for (const c of clips) {
    if (c.file) {
      listPaths.push(c.file);
      continue;
    }
    const rel = c.url;
    const isStreamPath = typeof rel === "string" && /\/api\/projects\/.+\/media\/.+\/stream/.test(rel);
    if (!isStreamPath) continue; // ignore unknown sources for safety
    const abs = rel; // already normalized to absolute in POST handler
    const out = path.join(tmpDir, `clip_${idx++}.mp4`);
    await downloadToFile(abs, out, payload.__auth || {});
    listPaths.push(out);
    job.progress = Math.min(0.6, job.progress + 0.1);
  }

  if (!listPaths.length) throw new Error("No usable clips to render");

  // 3) Concat via ffmpeg
  const listFile = path.join(tmpDir, "list.txt");
  const listContent = listPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
  fs.writeFileSync(listFile, listContent);

  const outPath = path.join(tmpDir, `${(payload.filename || `export-${job.id}`).replace(/[^A-Za-z0-9._-]/g, "_")}.mp4`);
  await runFfmpegConcat(listFile, outPath, {
    fps: Number(payload.fps) || 24,
    width: Number(payload.width) || null,
    height: Number(payload.height) || null,
  }, (p) => { job.progress = Math.max(job.progress, 0.7 + 0.25 * p); });

  job.outPath = outPath;
  job.status = "completed";
  job.progress = 1;
  job.resultUrl = `/api/render-download/${job.id}`;
}

function runFfmpegConcat(listFile, outPath, opts, onProgress) {
  const args = [
    "-y",
    "-f", "concat", "-safe", "0",
    "-i", listFile,
    // Normalize output for wide compatibility
    "-r", String(opts.fps || 24),
    "-pix_fmt", "yuv420p",
    "-c:v", "libx264",
    "-movflags", "+faststart",
    outPath,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    child.stderr.on("data", (buf) => {
      const s = buf.toString();
      const m = s.match(/time=([0-9:.]+)/);
      if (m && typeof onProgress === "function") {
        onProgress(0.5); // coarse progress bump
      }
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(); else reject(new Error(`ffmpeg exited ${code}`));
    });
  });
}

function downloadToFile(url, dest, auth) {
  return new Promise(async (resolve, reject) => {
    try {
      const headers = {};
      if (auth && typeof auth.bearer === "string") headers["authorization"] = `Bearer ${auth.bearer}`;
      const r = await fetch(url, { headers });
      if (!r.ok) return reject(new Error(`download ${url} -> ${r.status}`));
      const file = fs.createWriteStream(dest);
      if (r.body && typeof r.body.pipe === "function") {
        r.body.pipe(file);
      } else {
        (await import("node:stream")).Readable.fromWeb(r.body).pipe(file);
      }
      file.on("finish", () => file.close(resolve));
      file.on("error", reject);
    } catch (e) { reject(e); }
  });
}

/**
 * POST /api/render-video
 * Accepts a timeline/export payload and returns a stub export id.
 * This endpoint is CORS-enabled by global middleware and supports large JSON bodies.
 */
// Use a higher per-route limit to be safe
router.post("/render-video", express.json({ limit: "100mb" }), async (req, res) => {
  try {
    const userId = req.user?.sub;
    const payload = req.body || {};

    // Accept multiple client payload shapes
    const projectId = payload.projectId ?? null;
    const timeline = payload.timeline ?? null;
    const hasTimeline = timeline && typeof timeline === "object";
    const hasTracks = Array.isArray(payload.tracks);
    const hasCompositionHints = Number.isFinite(payload.durationInFrames) && Number.isFinite(payload.fps);
    if (!hasTimeline && !hasTracks && !hasCompositionHints) {
      return res.status(400).json({ ok: false, error: "Missing timeline/tracks" });
    }

    // Normalize clip URLs to absolute (so worker can fetch them)
    try {
      if (Array.isArray(payload.tracks)) {
        for (const t of payload.tracks) {
          if (!Array.isArray(t?.items)) continue;
          for (const it of t.items) {
            if (typeof it?.src === "string") it.src = absApiUrl(req, it.src);
            if (typeof it?.url === "string") it.url = absApiUrl(req, it.url);
          }
        }
      }
    } catch {}

    // Create a job entry so progress polling works
    // Pass through auth token so the worker can download protected media
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, "") || req.query.t || null;
    if (token) payload.__auth = { bearer: token };
    const exportId = createJob(payload);
    console.log("[export] request", {
      userId,
      projectId,
      format: payload.format || "mp4",
      name: payload.name || payload.filename || null,
      hasTimeline,
      tracks: hasTracks ? payload.tracks.length : 0,
      durationInFrames: payload.durationInFrames ?? null,
      fps: payload.fps ?? null,
    });

    return res.status(202).json({ ok: true, exportId, status: "queued" });
  } catch (e) {
    console.error("[export] error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// Optional compatibility alias matching older client expectations
router.post("/export-video", (req, res) => {
  const exportId = createJob(req.body || {});
  return res.status(202).json({ ok: true, exportId, status: "queued" });
});

/**
 * GET /api/render-progress/:exportId
 * Returns progress for a previously queued export job.
 * -> { ok: true, exportId, status, progress, resultUrl? }
 */
router.get("/render-progress/:exportId", (req, res) => {
  const id = req.params.exportId;
  const job = JOBS.get(id);
  if (!job) return res.status(404).json({ ok: false, error: "Not found" });
  // Build absolute URL if we have a relative resultUrl
  let resultUrl = job.resultUrl || null;
  if (resultUrl && !/^https?:\/\//i.test(resultUrl)) {
    const proto = (req.headers["x-forwarded-proto"] || req.protocol || "https").toString();
    const host = (req.headers["x-forwarded-host"] || req.headers.host || "").toString();
    if (host) resultUrl = `${proto}://${host}${resultUrl}`;
  }
  // Return fields compatible with different clients
  return res.json({
    // generic shape used by our newer client
    ok: true,
    exportId: id,
    status: job.status, // "queued" | "processing" | "completed"
    progress: job.progress,
    resultUrl,
    downloadUrl: resultUrl,
    // compatibility fields some clients expect
    renderId: id,
    error: job.error,
  });
});

// Compatibility alias used by some frontends
router.get("/render-download/:exportId", (req, res) => {
  const id = req.params.exportId;
  const job = JOBS.get(id);
  if (!job) return res.status(404).json({ error: "Not found" });
  if (job.status !== "completed") return res.status(425).json({ error: "Not ready" });
  const filename = (job.payload?.filename || `export-${id}.mp4`).replace(/[^A-Za-z0-9._-]/g, "_");
  if (job.outPath && fs.existsSync(job.outPath)) {
    res.setHeader("content-type", "video/mp4");
    res.setHeader("content-disposition", `attachment; filename="${filename}"`);
    return fs.createReadStream(job.outPath).pipe(res);
  }
  const file = job.firstFile;
  if (file) {
    const buf = Buffer.from(file.base64, "base64");
    res.setHeader("content-type", file.contentType || "video/mp4");
    res.setHeader("content-length", buf.length);
    res.setHeader("content-disposition", `attachment; filename="${filename}"`);
    return res.send(buf);
  }
  return res.status(404).json({ error: "No file" });
});

/**
 * GET /api/render-result/:exportId
 * Streams the resulting file for a completed export (demo: first provided video data URL).
 */
router.get("/render-result/:exportId", (req, res) => {
  const id = req.params.exportId;
  const job = JOBS.get(id);
  if (!job) return res.status(404).json({ error: "Not found" });
  if (job.status !== "completed") return res.status(425).json({ error: "Not ready" });
  const filename = (job.payload?.filename || `export-${id}.mp4`).replace(/[^A-Za-z0-9._-]/g, "_");
  if (job.outPath && fs.existsSync(job.outPath)) {
    res.setHeader("content-type", "video/mp4");
    res.setHeader("content-disposition", `attachment; filename="${filename}"`);
    return fs.createReadStream(job.outPath).pipe(res);
  }
  const file = job.firstFile;
  if (file) {
    const buf = Buffer.from(file.base64, "base64");
    res.setHeader("content-type", file.contentType || "video/mp4");
    res.setHeader("content-length", buf.length);
    res.setHeader("content-disposition", `attachment; filename="${filename}"`);
    return res.send(buf);
  }
  return res.status(404).json({ error: "No file" });
});

export default router;
