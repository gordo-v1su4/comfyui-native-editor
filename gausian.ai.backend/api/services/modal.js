// api/services/modal.js
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);

const SHARED = process.env.MODAL_SHARED_SECRET;
const APP_NAME = process.env.MODAL_APP_NAME || "gausian-render-mvp";
const ENTRY = process.env.MODAL_ENTRY_FILE || "/app/modal_app.py";

let MODAL_BASE = process.env.MODAL_BASE_URL || "";     // e.g., https://xxx.modal.run
let MODAL_HEALTH = process.env.MODAL_HEALTH_URL || ""; // e.g., https://xxx.modal.run/health

async function fetchJSON(url, opts = {}) {
  const resp = await fetch(url, opts);
  const text = await resp.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${text || resp.statusText}`);
  return data;
}

/**
 * Try health; if missing/unhealthy -> deploy.
 * After deploy, set in-memory base + health URLs.
 */
export async function ensureModalAppEndpoint() {
  // try health first
  if (MODAL_HEALTH) {
    try {
      await fetchJSON(MODAL_HEALTH);
      return { base: MODAL_BASE, health: MODAL_HEALTH };
    } catch {/* fall through */}
  }

  // deploy via CLI
  // NOTE: modal must be logged in; on your host/container run: `modal token new`
  const { stdout, stderr } = await execFileAsync("modal", ["deploy", ENTRY], { env: process.env });
  const out = `${stdout}\n${stderr}`;
  // Try to parse URL from deploy output; Modal prints a “Base URL” line.
  // Fallback: user sets MODAL_BASE_URL in env.
  const m = out.match(/https?:\/\/[a-zA-Z0-9\.\-]+\.modal\.run/);
  if (!m && !process.env.MODAL_BASE_URL) {
    throw new Error(`Could not discover Modal URL from deploy output. Set MODAL_BASE_URL. Output:\n${out}`);
  }
  MODAL_BASE = m ? m[0] : process.env.MODAL_BASE_URL;
  MODAL_HEALTH = `${MODAL_BASE}/health`;
  return { base: MODAL_BASE, health: MODAL_HEALTH };
}

export async function stopModalApp() {
  // stop (suspend) is usually enough; delete if you want to fully remove
  try { await execFileAsync("modal", ["app", "stop", APP_NAME], { env: process.env }); } catch {}
  try { await execFileAsync("modal", ["app", "delete", APP_NAME, "--yes"], { env: process.env }); } catch {}
}

export async function submitPrompt(workflow, metadata = {}) {
  const { base } = await ensureModalAppEndpoint();
  const url = `${base}/prompt`;
  return await fetchJSON(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-shared-secret": SHARED || "",
    },
    body: JSON.stringify({ workflow, metadata }),
  });
}

export async function getHistory(promptId) {
  const { base } = await ensureModalAppEndpoint();
  const url = `${base}/history/${encodeURIComponent(promptId)}`;
  return await fetchJSON(url, { method: "GET" });
}

export async function getView(params = "") {
  const { base } = await ensureModalAppEndpoint();
  const url = `${base}/view${params ? `?${params}` : ""}`;
  return await fetchJSON(url, { method: "GET" });
}

/**
 * Helper that blocks until a prompt is done (poll every N ms).
 * Returns { status, outputs }
 */
export async function waitForCompletion(promptId, { intervalMs = 15000, timeoutMs = 30 * 60_000 } = {}) {
  const start = Date.now();
  while (true) {
    const h = await getHistory(promptId);
    if (h.status === "done" || h.status === "error") return h;
    if (Date.now() - start > timeoutMs) throw new Error("Modal wait timeout");
    await new Promise(r => setTimeout(r, intervalMs));
  }
}