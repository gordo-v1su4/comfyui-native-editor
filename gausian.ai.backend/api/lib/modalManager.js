// api/lib/modalManager.js
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fetch from "node-fetch";

const pexecFile = promisify(execFile);

/**
 * This manager keeps one "current" Modal endpoint in memory,
 * deploys it on-demand with `modal deploy`, and will stop the app
 * after an idle period following the last job completion.
 *
 * ENV you should set:
 * - MODAL_TOKEN        (already set)
 * - MODAL_APP_PATH     (default: /app/comfy-modal/headless_comfyui.py)
 * - MODAL_DEPLOY_CMD   (optional override; default uses APP_PATH)
 * - MODAL_IDLE_SECS    (optional; default 600)
 *
 * Optional bootstrap:
 * - MODAL_ENDPOINT     (if you want to seed a known live endpoint)
 * - MODAL_HEALTH_URL   (if you want to seed a custom /health url)
 */

const APP_PATH = process.env.MODAL_APP_PATH || "/app/comfy-modal/headless_comfyui.py";
const DEPLOY_CMD =
  process.env.MODAL_DEPLOY_CMD || `modal deploy ${APP_PATH}`;
const IDLE_SECS = Number(process.env.MODAL_IDLE_SECS || 600);
const POLL_TIMEOUT_MS = 4000;

let state = {
  endpoint: process.env.MODAL_ENDPOINT || null,   // e.g. https://<id>--<region>.modal.run
  health: process.env.MODAL_HEALTH_URL || null,   // usually endpoint + "/health"
  busyCount: 0,                                   // outstanding job counter
  lastActivityAt: 0,                              
  stopTimer: null,                                
};

function _now() { return Math.floor(Date.now() / 1000); }

async function _isHealthy(url) {
  try {
    const r = await fetch(url, { method: "GET", timeout: POLL_TIMEOUT_MS });
    if (!r.ok) return false;
    // health endpoint proxies ComfyUI /system_stats; any 200 OK is enough
    return true;
  } catch {
    return false;
  }
}

async function _deployViaCli() {
  // We expect Modal CLI is available in the container PATH.
  // The output typically includes the served URL line like:
  //   "Serving at https://xxxxx--yyyy.modal.run"
  const { stdout, stderr } = await pexecFile("/bin/sh", ["-lc", DEPLOY_CMD], {
    env: process.env,
    maxBuffer: 1024 * 1024 * 4,
  });

  const out = `${stdout ?? ""}\n${stderr ?? ""}`;
  const m = out.match(/https?:\/\/[a-z0-9\-]+--[a-z0-9\-]+\.modal\.run/gi);
  if (!m || !m[0]) {
    throw new Error(`Could not parse Modal endpoint from deploy output.\nOutput:\n${out}`);
  }
  const endpoint = m[m.length - 1]; // pick the last URL printed
  return {
    endpoint,
    health: `${endpoint}/health`,
  };
}

function _scheduleStopCheck() {
  if (state.stopTimer) clearTimeout(state.stopTimer);
  state.stopTimer = setTimeout(async () => {
    try {
      if (state.busyCount > 0) return _scheduleStopCheck(); // still busy; try later
      const idleFor = _now() - state.lastActivityAt;
      if (state.endpoint && idleFor >= IDLE_SECS) {
        // Optional: use CLI to stop the app to save money.
        // If you named the app in the Modal file (it is: headless-comfyui-server)
        // you can run: `modal app stop headless-comfyui-server`
        try {
          await pexecFile("/bin/sh", ["-lc", "modal app stop headless-comfyui-server"], {
            env: process.env,
            maxBuffer: 1024 * 1024,
          });
        } catch (e) {
          // non-fatal; maybe the app already scaled down
        }
        state.endpoint = null;
        state.health = null;
      }
    } finally {
      _scheduleStopCheck(); // keep the loop running
    }
  }, 15_000); // check every 15s
}

_scheduleStopCheck();

/**
 * Ensure we have a healthy endpoint; if not, deploy one.
 * Returns { endpoint, health }
 */
export async function ensureModalAppEndpoint() {
  // 1) If we already have one, health-check it
  if (state.endpoint && state.health) {
    // Trust the cached endpoint to reduce health pings; failures will surface on use
    return { endpoint: state.endpoint, health: state.health };
  }

  // 2) Deploy fresh
  const { endpoint, health } = await _deployViaCli();

  // 3) Wait until healthy
  const started = Date.now();
  while (Date.now() - started < 1000 * 60 * 14) { // allow up to ~14min on first cold start
    if (await _isHealthy(health)) {
      state.endpoint = endpoint;
      state.health = health;
      state.lastActivityAt = _now();
      return { endpoint, health };
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error("Modal endpoint failed to become healthy in time");
}

/**
 * Mark that work is starting; keeps the app alive.
 */
export function markJobStart() {
  state.busyCount = Math.max(0, state.busyCount) + 1;
  state.lastActivityAt = _now();
}

/**
 * Mark that work ended; if count drops to zero, the stop checker will eventually stop the app.
 */
export function markJobDone() {
  state.busyCount = Math.max(0, state.busyCount - 1);
  state.lastActivityAt = _now();
}

/**
 * Expose current endpoint (may be null).
 */
export function currentEndpoint() {
  return state.endpoint;
}
