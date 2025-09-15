// api/routes/auth.js
import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import pool from "../db.js";

const router = express.Router();
const COOKIE = "token";
const WEEK = 7 * 24 * 3600 * 1000;

/** Build cookie options per request so cross-site works via HTTPS (Cloudflare). */
function cookieOptionsFor(req) {
  // trust proxy is enabled in server.js, so req.secure reflects client->proxy HTTPS
  const secure = !!req.secure || String(req.headers["x-forwarded-proto"] || "").includes("https");
  return {
    httpOnly: true,
    secure,                  // required for SameSite=None
    sameSite: secure ? "none" : "lax",
    path: "/",
    maxAge: WEEK,
  };
}

// ========== REGISTER ==========
router.post("/register", async (req, res) => {
  try {
    let { email, password, username } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: "Missing email or password" });
    }

    email = String(email).toLowerCase().trim();
    if (username != null) {
      username = String(username).trim().toLowerCase();
      if (!username) username = null;
    }

    // check existing email
    const { rows: existingEmail } = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [email]
    );
    if (existingEmail.length) {
      return res.status(409).json({ ok: false, error: "Email already registered" });
    }

    // check existing username if provided
    if (username) {
      const { rows: existingUser } = await pool.query(
        "SELECT id FROM users WHERE LOWER(username) = LOWER($1)",
        [username]
      );
      if (existingUser.length) {
        return res.status(409).json({ ok: false, error: "Username already taken" });
      }
    }

    const id = uuidv4();
    const hash = await bcrypt.hash(password, 12);

    if (username) {
      await pool.query(
        "INSERT INTO users (id, email, username, password_hash) VALUES ($1, $2, $3, $4)",
        [id, email, username, hash]
      );
    } else {
      await pool.query(
        "INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)",
        [id, email, hash]
      );
    }

    // auto-login
    const token = jwt.sign(
      { sub: id, email, username: username || null },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );
    res.cookie(COOKIE, token, cookieOptionsFor(req));
    return res.json({ ok: true, token, user: { id, email, username } });
  } catch (e) {
    console.error("register error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// ========== LOGIN ==========
router.post("/login", async (req, res) => {
  try {
    let { email, username, password } = req.body || {};

    if (!password) return res.status(400).json({ ok: false, error: "Missing password" });
    if (!email && !username) return res.status(400).json({ ok: false, error: "Missing email or username" });

    let userRow = null;

    if (email) {
      const em = String(email).toLowerCase().trim();
      const { rows } = await pool.query(
        "SELECT id, email, username, password_hash FROM users WHERE email = $1",
        [em]
      );
      if (rows.length) userRow = rows[0];
    }

    if (!userRow && username) {
      const un = String(username).trim().toLowerCase();
      const { rows } = await pool.query(
        "SELECT id, email, username, password_hash FROM users WHERE LOWER(username) = LOWER($1)",
        [un]
      );
      if (rows.length) userRow = rows[0];
    }

    if (!userRow) return res.status(401).json({ ok: false, error: "Invalid credentials" });

    const ok = await bcrypt.compare(password, userRow.password_hash);
    if (!ok) return res.status(401).json({ ok: false, error: "Invalid credentials" });

    const token = jwt.sign(
      { sub: userRow.id, email: userRow.email, username: userRow.username || null },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.cookie(COOKIE, token, cookieOptionsFor(req));
    return res.json({
      ok: true,
      token, // include token so frontend can use Authorization header if cookies are blocked
      user: { id: userRow.id, email: userRow.email, username: userRow.username || null },
    });
  } catch (e) {
    console.error("login error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// ========== LOGOUT ==========
router.post("/logout", (req, res) => {
  // clear with matching attributes so browsers actually remove it
  res.clearCookie(COOKIE, { ...cookieOptionsFor(req), maxAge: 0 });
  return res.json({ ok: true });
});

// ========== ME ==========
router.get("/me", async (req, res) => {
  try {
    // Accept Authorization: Bearer <token> OR cookie
    const hdr = req.headers.authorization || req.headers.Authorization;
    let token = null;
    if (typeof hdr === "string") {
      const m = hdr.match(/^Bearer\s+(.+)$/i);
      if (m) token = m[1];
    }
    if (!token && req.cookies?.[COOKIE]) token = req.cookies[COOKIE];

    if (!token) return res.status(200).json({ ok: true, user: null });

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    return res.json({
      ok: true,
      user: {
        id: payload.sub,
        email: payload.email,
        username: payload.username ?? null,
      },
    });
  } catch {
    return res.json({ ok: true, user: null });
  }
});

export default router;