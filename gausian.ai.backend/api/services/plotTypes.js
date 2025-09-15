// api/services/plotTypes.js
import fs from "node:fs";
import path from "node:path";

let _cache = null;

function defaultPath() {
  // Prefer env override, else look for ./plot_types.json within the backend image
  const p = process.env.PLOT_TYPES_PATH || path.resolve(process.cwd(), "plot_types.json");
  return p;
}

export function loadPlotTypesSafe() {
  if (_cache) return _cache;
  const p = defaultPath();
  try {
    if (!fs.existsSync(p)) return (_cache = { list: [], source: null });
    const raw = fs.readFileSync(p, "utf8");
    const json = JSON.parse(raw);
    const list = Array.isArray(json) ? json : (Array.isArray(json?.plots) ? json.plots : []);
    return (_cache = { list, source: p });
  } catch {
    return (_cache = { list: [], source: null });
  }
}

export function formatPlotTypesForPrompt({ maxItems = 12, maxCharsPer = 260 } = {}) {
  const { list, source } = loadPlotTypesSafe();
  if (!list?.length) return { text: "", count: 0, source: source || null };

  // Attempt to compress entries into a compact catalog
  const lines = [];
  const pick = list.slice(0, maxItems);
  for (let i = 0; i < pick.length; i++) {
    const it = pick[i] || {};
    const name = String(it.name || it.title || it.type || `Plot ${i + 1}`).trim();
    const beats = Array.isArray(it.beats) ? it.beats : (Array.isArray(it.structure) ? it.structure : null);
    let desc = String(it.description || it.note || "").trim();
    let beatStr = beats ? `Beats: ${beats.join(" > ")}` : "";
    const parts = [name, desc, beatStr].filter(Boolean).join(" — ");
    const clipped = parts.length > maxCharsPer ? parts.slice(0, maxCharsPer - 1) + "…" : parts;
    lines.push(`- ${clipped}`);
  }
  const header = `Plot Structures Catalog (choose one and follow its beats):`;
  const text = [header, ...lines].join("\n");
  return { text, count: pick.length, source: source || null };
}

