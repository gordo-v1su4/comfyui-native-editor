// api/middleware/auth.js
import jwt from "jsonwebtoken";

const COOKIE = "token";
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

/** Strip surrounding quotes if they accidentally appear in a token. */
function stripQuotes(s) {
  return typeof s === "string" ? s.replace(/^['"]+|['"]+$/g, "") : s;
}

/**
 * Extract a JWT from the request in this priority:
 *  1) Authorization: Bearer <token>
 *  2) Query string: ?t= / ?access_token= / ?token=
 *  3) Cookie: token
 *  4) Body: { token: "" }
 *
 * We prioritize header and query so <video> tag URLs with ?t=... work
 * even if a stale cookie exists.
 */
function getTokenFromReq(req) {
  // 1) Authorization header (case-insensitive, Bearer <token>)
  const auth = req.headers.authorization || req.headers.Authorization;
  if (typeof auth === "string") {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m) return stripQuotes(m[1].trim());
  }

  // 2) Query string
  const q = req.query || {};
  const qToken =
    (typeof q.t === "string" && q.t) ||
    (typeof q.access_token === "string" && q.access_token) ||
    (typeof q.token === "string" && q.token);
  if (qToken) return stripQuotes(qToken);

  // 3) Cookie
  if (req.cookies && typeof req.cookies[COOKIE] === "string") {
    return stripQuotes(req.cookies[COOKIE]);
  }

  // 4) Body (debug / non-GET)
  if (req.body && typeof req.body.token === "string") {
    return stripQuotes(req.body.token);
  }

  return null;
}

function decodeToken(token) {
  const payload = jwt.verify(token, JWT_SECRET);
  return {
    sub: payload.sub,
    id: payload.sub,
    email: payload.email ?? null,
    username: payload.username ?? null,
    raw: payload,
  };
}

/**
 * Require a valid JWT. On success, attaches req.user and calls next().
 * On failure, responds 401. CORS preflight (OPTIONS) is always allowed.
 */
export function requireAuth(req, res, next) {
  // Allow CORS preflight to pass through without auth
  if (req.method === "OPTIONS") return next();

  try {
    const token = getTokenFromReq(req);
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    req.user = decodeToken(token);
    return next();
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }
}

/**
 * Optional auth: attaches req.user if a valid token is present; never 401s.
 */
export function optionalAuth(req, _res, next) {
  try {
    const token = getTokenFromReq(req);
    if (token) req.user = decodeToken(token);
  } catch {
    // ignore invalid/expired token
  }
  return next();
}