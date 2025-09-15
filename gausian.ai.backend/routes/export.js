// routes/export.js
import { Router } from "express";
const r = Router();

r.post("/export-video", (req, res) => res.json({ exportId: "exp_123", status: "queued" }));

export default r;
