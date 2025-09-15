// Simple in-memory mapping of filename_prefix -> replacement info
// Used to perform true in-place replacement of timeline items when a regenerated
// clip finishes uploading and modal-upload is called.

const map = new Map();

export function addRegenMapping(filenamePrefix, info) {
  if (!filenamePrefix) return;
  map.set(String(filenamePrefix), { ...info, ts: Date.now() });
}

export function getRegenMapping(filenamePrefix) {
  if (!filenamePrefix) return null;
  return map.get(String(filenamePrefix)) || null;
}

export function deleteRegenMapping(filenamePrefix) {
  if (!filenamePrefix) return;
  map.delete(String(filenamePrefix));
}

// Optional: periodic cleanup of very old entries (best-effort)
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of map.entries()) {
    if (now - (v.ts || now) > 1000 * 60 * 60) { // 1 hour TTL
      map.delete(k);
    }
  }
}, 60_000).unref?.();

