// api/services/jobWatcher.js
import fetch from "node-fetch";
import pool from "../db.js";
import { ensureModalAppEndpoint } from "../lib/modalManager.js";
import { uploadBufferToS3, isS3Configured } from "../services/s3.js";
import { Readable } from "node:stream";

const LOCK_A = 730001;
const LOCK_B = 730009;
let _intervalHandle = null;
let _isRunning = false;

function encodePathSegments(p) {
  return p.split("/").map(encodeURIComponent).join("/");
}

function detectKind(obj, filename) {
  const fmt = String(obj?.format || "").toLowerCase();
  const fn = String(filename || "").toLowerCase();
  if (fmt.startsWith("video/") || fn.endsWith(".mp4") || fn.endsWith(".webm")) return "video";
  if (
    fmt.startsWith("image/") ||
    fn.endsWith(".png") ||
    fn.endsWith(".jpg") ||
    fn.endsWith(".jpeg") ||
    fn.endsWith(".gif")
  ) return "image";
  return null;
}

function extractOutputsFromHistory(outputs, endpointBase) {
  const out = [];
  if (!outputs || typeof outputs !== "object") return out;

  // shape: { "<nodeId>": { <bucketName>: [ { filename, subfolder, format, ...}, ... ] , ...}, ... }
  for (const [nodeId, bucketObj] of Object.entries(outputs)) {
    if (!bucketObj || typeof bucketObj !== "object") continue;

    for (const [bucketName, arr] of Object.entries(bucketObj)) {
      if (!Array.isArray(arr)) continue;

      for (const o of arr) {
        const fn = o?.filename || o?.name;
        if (!fn) continue;

        const sub = (o?.subfolder || "").replace(/^\/+|\/+$/g, "");
        const kind = detectKind(o, fn);
        if (!kind) continue;

        const rel = sub ? `${sub}/${fn}` : fn;
        const remote_url = `${endpointBase}/files/${encodePathSegments(rel)}`;

        out.push({
          filename: fn,
          subfolder: sub,
          remote_url,
          kind,
          nodeId,
          bucket: bucketName,
        });
      }
    }
  }
  return out;
}

// Fallback: scan /outputs on Modal for files that match our project filename prefix
async function scanOutputsForJob(job, endpoint) {
  // Prefix you use in the workflow: "u<userId>_p<projectId>_<shortId>"
  const prefix = `u${job.user_id}_p${job.project_id}_`;
  const url = `${endpoint}/debug/find_outputs?q=${encodeURIComponent(prefix)}`;

  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    console.warn(`[jobWatcher] scan fetch error for ${prefix}:`, e.message);
    return [];
  }
  if (!res.ok) {
    console.warn(`[jobWatcher] scan ${url} -> ${res.status}`);
    return [];
  }

  const data = await res.json();
  const results = Array.isArray(data?.results) ? data.results : [];

  // Filter files only, match common video/image extensions
  const files = results.filter(r => !r.is_dir && typeof r.path === "string");

  // Time window: accept files near job.created_at (±2h) to avoid importing old files.
  const createdAt = new Date(job.created_at).getTime();
  const windowStart = createdAt - 2 * 60 * 60 * 1000;
  const windowEnd   = createdAt + 6 * 60 * 60 * 1000; // a bit generous on the upper bound

  const candidates = files
    .filter(f => {
      const mtime = (Number(f.mtime) || 0) * 1000; // debug endpoint returns seconds
      return mtime === 0 || (mtime >= windowStart && mtime <= windowEnd);
    })
    .map(f => ({
      filename: f.path.split("/").pop(),
      subfolder: f.path.split("/").slice(0, -1).join("/"),
      remote_url: `${endpoint}/files/${encodePathSegments(f.path)}`,
      kind: detectKind(null, f.path),
      nodeId: "scan",
      bucket: "scan",
    }))
    .filter(f => f.kind);

  return candidates;
}

async function importOutputs(job, outputs, endpoint, io) {
  if (!outputs || !outputs.length) return 0;

  let imported = 0;
  for (const output of outputs) {
    try {
      // Restrict imports to only Backblaze URLs - reject Modal URLs
      if (!output.remote_url.includes('backblazeb2.com')) {
        console.log(`[jobWatcher] Rejected non-Backblaze URL: ${output.remote_url}`);
        continue;
      }
      
      // Download the file
      const fileRes = await fetch(output.remote_url);
      if (!fileRes.ok) {
        console.warn(`[jobWatcher] failed to download ${output.remote_url}: ${fileRes.status}`);
        continue;
      }

      const buffer = await fileRes.arrayBuffer();
      const filename = output.filename;
      const subfolder = output.subfolder;

      // Upload to S3 if configured
      let s3Url = null;
      if (isS3Configured()) {
        try {
          const s3Key = `projects/${job.project_id}/media/${filename}`;
          s3Url = await uploadBufferToS3(Buffer.from(buffer), s3Key, fileRes.headers.get("content-type"));
          console.log(`[jobWatcher] uploaded ${filename} to S3: ${s3Url}`);
        } catch (e) {
          console.warn(`[jobWatcher] S3 upload failed for ${filename}:`, e.message);
        }
      }

      // Save to database
      const meta = {
        prompt_id: job.prompt_id,
        node_id: output.nodeId,
        bucket: output.bucket,
        kind: output.kind,
        modal_url: output.remote_url,
        s3_url: s3Url,
        subfolder,
      };

      const mediaRes = await pool.query(
        `INSERT INTO media (project_id, filename, meta, user_id) VALUES ($1, $2, $3, $4) RETURNING id`,
        [job.project_id, filename, meta, job.user_id]
      );

      if (mediaRes.rows[0]) {
        imported++;
        console.log(`[jobWatcher] imported ${filename} for job ${job.id}`);

        // Notify frontend via WebSocket
        if (io) {
          io.to(`project_${job.project_id}`).emit("media_imported", {
            mediaId: mediaRes.rows[0].id,
            filename,
            projectId: job.project_id,
          });
        }
      }
    } catch (e) {
      console.warn(`[jobWatcher] import failed for ${output.filename}:`, e.message);
    }
  }

  return imported;
}

// EFFICIENT BATCH MONITORING - Single API call instead of N individual calls
async function tick(io) {
  if (_isRunning) return;
  _isRunning = true;

  let gotLock = false;
  try {
    // Try to acquire advisory lock to prevent multiple instances
    const lockRes = await pool.query("SELECT pg_try_advisory_lock($1, $2)", [LOCK_A, LOCK_B]);
    gotLock = lockRes.rows[0]?.pg_try_advisory_lock || false;
    if (!gotLock) {
      console.log("[jobWatcher] another instance is running, skipping");
      return;
    }

    // Get all jobs that need monitoring
    const { rows: jobs } = await pool.query(`
      SELECT j.* FROM jobs j
      WHERE j.status IN ('pending', 'running')
        AND j.created_at > NOW() - INTERVAL '24 hours'
        AND (
          j.status = 'pending'
          OR (
            j.status = 'running'
            AND NOT EXISTS (
              SELECT 1
              FROM media m
              WHERE m.project_id = j.project_id
                AND (m.meta->>'prompt_id') = j.prompt_id
            )
          )
        )
      ORDER BY j.created_at ASC
      LIMIT 20
    `);

    console.log(`[jobWatcher] tick: ${jobs.length} job(s) to process`);
    if (!jobs.length) return;

    const { endpoint } = await ensureModalAppEndpoint();

    // SMART POLLING: Only check jobs that are likely to have updates
    const jobsToCheck = jobs.filter(job => {
      const jobAge = Date.now() - new Date(job.created_at).getTime();
      
      // Skip very recent jobs (<1min) - they're likely still starting
      if (jobAge < 60000) return false;
      
      // Check running jobs less frequently based on age
      if (job.status === 'running') {
        if (jobAge < 300000) return true;        // 1-5min: check every tick
        if (jobAge < 900000) return jobAge % 60000 < 30000;  // 5-15min: check every 2 ticks
        return jobAge % 120000 < 30000;          // >15min: check every 4 ticks
      }
      
      return true; // Always check pending jobs
    });

    if (jobsToCheck.length === 0) {
      console.log(`[jobWatcher] no jobs need checking this tick`);
      return;
    }

    console.log(`[jobWatcher] checking ${jobsToCheck.length} jobs (filtered from ${jobs.length} total)`);

    // EFFICIENT BATCH MONITORING: Single GET /history call instead of N individual calls
    try {
      console.log(`[jobWatcher] making single GET /history call to monitor ${jobsToCheck.length} jobs`);
      const historyRes = await fetch(`${endpoint}/history`);
      
      if (historyRes.ok) {
        const historyData = await historyRes.json();
        console.log(`[jobWatcher] received history data, processing ${jobsToCheck.length} jobs`);
        
        // Process each job using the batch history data
        for (const job of jobsToCheck) {
          try {
            const promptId = job.prompt_id;
            const item = historyData?.history?.[promptId] ?? historyData?.[promptId];
            
            if (item) {
              const nodeKeys = Object.keys(item.outputs || {});
              const firstNodeBuckets = nodeKeys.length
                ? Object.keys((item.outputs || {})[nodeKeys[0]] || {})
                : [];
              
              console.log(
                `[jobWatcher] pid=${promptId} completed=${!!item.status?.completed} ` +
                `outputNodes=${nodeKeys.join(",") || "<none>"} ` +
                `firstNodeBuckets=${firstNodeBuckets.join(",") || "<none>"}`
              );

              const outs = extractOutputsFromHistory(item.outputs, endpoint);
              console.log(`[jobWatcher] pid=${promptId} extracted ${outs.length} file(s) from history`);

              const completed = !!item.status?.completed;
              if (completed && outs.length === 0) {
                await pool.query(`UPDATE jobs SET status='no_outputs' WHERE id=$1`, [job.id]);
                console.warn(`[jobWatcher] pid=${promptId} completed with NO outputs; marked no_outputs`);
                continue;
              }

              if (outs.length > 0) {
                const imported = await importOutputs(job, outs, endpoint, io);
                await pool.query(`UPDATE jobs SET status='done' WHERE id=$1`, [job.id]);
                console.log(`[jobWatcher] pid=${promptId} imported ${imported} file(s) via batch history → status=done`);
                continue;
              }

              // not completed yet / nothing to import yet: set running and keep polling
              if (job.status !== "running") {
                await pool.query(`UPDATE jobs SET status='running' WHERE id=$1`, [job.id]);
              }
            } else {
              // Job not in history yet - this is normal for recent jobs
              console.log(`[jobWatcher] pid=${promptId} not in history yet (normal for recent jobs)`);
              if (job.status !== "running") {
                await pool.query(`UPDATE jobs SET status='running' WHERE id=$1`, [job.id]);
              }
            }
          } catch (e) {
            console.warn(`[jobWatcher] error processing job ${job.id}:`, e.message);
          }
        }
      } else {
        console.warn(`[jobWatcher] batch history call failed: ${historyRes.status}`);
        // Fallback to individual calls only if batch fails
        await fallbackIndividualChecks(jobsToCheck, endpoint, io);
      }
    } catch (e) {
      console.warn(`[jobWatcher] batch history error:`, e.message);
      // Fallback to individual calls only if batch fails
      await fallbackIndividualChecks(jobsToCheck, endpoint, io);
    }

  } catch (e) {
    console.warn("[jobWatcher] tick error:", e.stack || e.message);
  } finally {
    if (gotLock) {
      try { await pool.query("SELECT pg_advisory_unlock($1, $2)", [LOCK_A, LOCK_B]); } catch {}
    }
    _isRunning = false;
  }
}

// Fallback: individual job checks (only used if batch monitoring fails)
async function fallbackIndividualChecks(jobs, endpoint, io) {
  console.log(`[jobWatcher] falling back to individual job checks for ${jobs.length} jobs`);
  
  for (const job of jobs) {
    try {
      console.log(`[jobWatcher] individual check for job id=${job.id} pid=${job.prompt_id}`);
      
      // Individual history check
      const r = await fetch(`${endpoint}/history/${encodeURIComponent(job.prompt_id)}`);
      if (r.ok) {
        const hist = await r.json();
        const item = hist?.history?.[job.prompt_id] ?? hist?.[job.prompt_id];
        
        if (item) {
          const outs = extractOutputsFromHistory(item.outputs, endpoint);
          const completed = !!item.status?.completed;
          
          if (completed && outs.length === 0) {
            await pool.query(`UPDATE jobs SET status='no_outputs' WHERE id=$1`, [job.id]);
            continue;
          }

          if (outs.length > 0) {
            const imported = await importOutputs(job, outs, endpoint, io);
            await pool.query(`UPDATE jobs SET status='done' WHERE id=$1`, [job.id]);
            continue;
          }

          if (job.status !== "running") {
            await pool.query(`UPDATE jobs SET status='running' WHERE id=$1`, [job.id]);
          }
        }
      } else {
        // History missing → fallback scan
        console.log(`[jobWatcher] history missing for ${job.prompt_id} — trying fallback scan`);
        const scanned = await scanOutputsForJob(job, endpoint);

        if (scanned.length > 0) {
          const imported = await importOutputs(job, scanned, endpoint, io);
          await pool.query(`UPDATE jobs SET status='done_from_scan' WHERE id=$1`, [job.id]);
          console.log(`[jobWatcher] pid=${job.prompt_id} imported ${imported} file(s) via scan → status=done_from_scan`);
          continue;
        }

        if (job.status !== "running") {
          await pool.query(`UPDATE jobs SET status='running' WHERE id=$1`, [job.id]);
        }
      }
    } catch (e) {
      await pool.query(`UPDATE jobs SET status='error' WHERE id=$1`, [job.id]);
      console.warn("[jobWatcher] individual job check failed:", job.id, job.prompt_id, e.stack || e.message);
    }
  }
}

export function startJobWatcher({ io, intervalMs = 60000 } = {}) { // TEMPORARILY DISABLED to stop Modal API spam
  if (_intervalHandle) {
    clearInterval(_intervalHandle);
  }

  // TEMPORARILY DISABLED: Comment out the polling to stop Modal API calls
  // const tickWrapper = () => tick(io).catch(console.error);
  // _intervalHandle = setInterval(tickWrapper, intervalMs);
  // tickWrapper();
  
  console.log(`[jobWatcher] TEMPORARILY DISABLED - no Modal API calls until re-enabled`);
  return () => {
    if (_intervalHandle) clearInterval(_intervalHandle);
    _intervalHandle = null;
  };
}
