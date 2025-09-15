// routes/video.js
import { Router } from "express";
const r = Router();

r.post("/:projectId/generate-videos", (req, res) => res.json({ jobId: "job_123" }));
r.post("/:projectId/video-generation-pause/:jobId", (req, res) => res.json({ ok: true }));
r.get("/:projectId/video-generation-status", (req, res) => res.json({ status: "idle" }));

export default r;
