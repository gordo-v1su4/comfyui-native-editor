// routes/media.js
import { Router } from "express";
import multer from "multer";
const upload = multer({ limits: { fileSize: 1024 * 1024 * 200 } }); // 200MB
const r = Router();

r.post("/upload-video", upload.single("file"), (req, res) => res.json({ ok: true, file: req.file?.originalname }));
r.post("/projects/:projectId/bulk-upload", upload.array("files"), (req, res) => res.json({ count: req.files?.length || 0 }));
r.get("/projects/:projectId/media", (req, res) => res.json([]));
r.get("/projects/:projectId/video-references", (req, res) => res.json([]));
r.get("/video-references", (req, res) => res.json([]));
r.post("/video-references", (req, res) => res.status(201).json(req.body));
r.delete("/video-references/:id", (req, res) => res.status(204).end());
r.post("/extract-video-metadata", (req, res) => res.json({ duration: 0 }));

export default r;
