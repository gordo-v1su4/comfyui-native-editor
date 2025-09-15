// api/services/modalClient.js
import fetch from "node-fetch";

export async function httpJson(url, opts = {}) {
  const r = await fetch(url, {
    ...opts,
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      ...(opts.headers || {}),
    },
  });
  const text = await r.text();
  if (!r.ok) {
    throw new Error(`HTTP ${r.status} ${r.statusText} – ${text}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export async function postPrompt(endpoint, promptObj, clientId) {
  // DEFENSIVE: if some caller passed a string, parse once to an object
  if (typeof promptObj === "string") {
    try {
      const parsed = JSON.parse(promptObj);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        promptObj = parsed;
      } else {
        throw new Error("prompt string parsed to non-object");
      }
    } catch (e) {
      throw new Error(`Refusing to send string prompt (not a JSON object): ${e.message}`);
    }
  }

  // IMPORTANT: keep prompt as an OBJECT in the JSON body
  return httpJson(`${endpoint}/prompt`, {
    method: "POST",
    body: JSON.stringify({ prompt: promptObj, client_id: clientId }),
  });
}