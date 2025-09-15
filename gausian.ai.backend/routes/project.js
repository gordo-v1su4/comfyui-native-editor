// routes/projects.js
import { Router } from "express";
const r = Router();

r.get("/", (req, res) => res.json([]));
r.post("/", (req, res) => res.status(201).json({ id: "p1", ...req.body }));
r.get("/:id", (req, res) => res.json({ id: req.params.id }));
r.put("/:id", (req, res) => res.json({ id: req.params.id, ...req.body }));
r.delete("/:id", (req, res) => res.status(204).end());

// timeline
r.get("/:id/timeline", (req, res) => res.json([]));
r.post("/:id/timeline", (req, res) => res.status(201).json(req.body));
r.put("/:id/timeline/:itemId", (req, res) => res.json({ id: req.params.itemId, ...req.body }));
r.delete("/:id/timeline/:itemId", (req, res) => res.status(204).end());

export default r;
