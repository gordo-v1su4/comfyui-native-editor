// routes/auth.js
import { Router } from "express";
const r = Router();

r.post("/login", (req, res) => res.json({ ok: true, user: { email: req.body?.email || "unknown" } }));
r.post("/register", (req, res) => res.status(201).json({ ok: true }));
r.post("/logout", (req, res) => res.json({ ok: true }));

export default r;
