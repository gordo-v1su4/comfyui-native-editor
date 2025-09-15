// api/services/gemini.js
import fetch from "node-fetch";

function pickApiKey() {
  return process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || null;
}

function normalizeModel(model) {
  const m = String(model || "").trim();
  if (!m) return "gemini-1.5-flash";
  // Allow any provided model; only map some common aliases
  const map = new Map([
    ["gemini-2.5-flash-lite", "gemini-2.0-flash-lite"], // alias to closest available
    ["gemini-2.5-flash", "gemini-2.0-flash"],
    ["gemini-1.5-flash-latest", "gemini-1.5-flash-latest"],
    ["gemini-1.5-flash", "gemini-1.5-flash"],
    ["gemini-1.5-pro", "gemini-1.5-pro"],
    ["gemini-2.0-flash", "gemini-2.0-flash"],
    ["gemini-2.0-flash-lite", "gemini-2.0-flash-lite"],
    ["gemini-2.0-pro", "gemini-2.0-pro"],
  ]);
  return map.get(m) || m; // pass-through unknowns (API may accept newer models)
}

export async function geminiGenerate({ model, text, system, history, responseMimeType }) {
  const apiKey = pickApiKey();
  if (!apiKey) throw new Error("Missing GOOGLE_API_KEY/GEMINI_API_KEY");

  const mdl = normalizeModel(model);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(mdl)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  // Build conversation contents. Gemini uses roles: "user" and "model".
  const contents = [];
  if (Array.isArray(history)) {
    for (const m of history) {
      const role = String(m?.role || "").toLowerCase();
      const content = typeof m?.content === "string" ? m.content : "";
      if (!content) continue;
      if (role === "assistant" || role === "model") {
        contents.push({ role: "model", parts: [{ text: content }] });
      } else {
        contents.push({ role: "user", parts: [{ text: content }] });
      }
    }
  }
  contents.push({ role: "user", parts: [{ text: String(text || "") }] });

  const body = {
    contents,
    ...(system
      ? { systemInstruction: { role: "system", parts: [{ text: String(system) }] } }
      : {}),
  };

  const bodyObj = {
    ...body,
    ...(responseMimeType
      ? { generationConfig: { response_mime_type: responseMimeType } }
      : {}),
  };

  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(bodyObj),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = json?.error?.message || `Gemini error ${r.status}`;
    const code = json?.error?.code || r.status;
    const details = json?.error?.details || null;
    const err = new Error(msg);
    err.code = code;
    err.details = details;
    throw err;
  }

  // Extract first candidate text
  const candidates = json?.candidates || [];
  for (const c of candidates) {
    const parts = c?.content?.parts || [];
    const firstText = parts.find((p) => typeof p?.text === "string")?.text;
    if (firstText) return firstText;
  }
  return "";
}
