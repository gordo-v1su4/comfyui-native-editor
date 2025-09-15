// api/routes/videoReferences.js
import express from "express";
import pool from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();
router.use(requireAuth);

// Global video references across all projects the user can access
// Mirrors the logic in projects.js but exposes /api/video-references
router.get("/video-references", async (req, res) => {
  try {
    const userId = req.user.sub;
    const { rows } = await pool.query(
      `
      SELECT m.id, m.project_id, m.kind, m.filename, m.remote_url, m.meta, m.created_at
      FROM media m
      JOIN projects p ON p.id = m.project_id
      WHERE m.kind = 'video'
        AND (p.owner_id = $1 OR EXISTS (
          SELECT 1 FROM project_members pm
          WHERE pm.project_id = p.id AND pm.user_id = $1
        ))
      ORDER BY m.created_at DESC
      `,
      [userId]
    );
    return res.json({ ok: true, items: rows });
  } catch (e) {
    console.error("/api/video-references error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

// Create a video reference (manual-add), expects body with { projectId, filename?, remote_url, meta? }
router.post("/video-references", async (req, res) => {
  try {
    const userId = req.user.sub;
    const { projectId, filename, remote_url, meta } = req.body || {};
    if (!projectId) return res.status(400).json({ error: "Missing projectId" });
    if (!remote_url) return res.status(400).json({ error: "Missing remote_url" });

    // ACL: owner or member
    const { rows: can } = await pool.query(
      `SELECT 1 FROM projects p WHERE p.id=$1 AND (p.owner_id=$2 OR EXISTS (
         SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.user_id=$2)) LIMIT 1`,
      [projectId, userId]
    );
    if (!can.length) return res.status(404).json({ error: "Project not found" });

    const { rows } = await pool.query(
      `INSERT INTO media (project_id, user_id, kind, filename, remote_url, storage_backend, storage_path, meta)
       VALUES ($1,$2,'video',$3,$4,'remote',NULL,$5)
       ON CONFLICT (project_id, remote_url) DO UPDATE SET meta = media.meta || EXCLUDED.meta
       RETURNING id, project_id, user_id, kind, filename, remote_url, meta, created_at`,
      [projectId, userId, filename || (remote_url.split('/').pop() || 'video'), remote_url, JSON.stringify(meta || {})]
    );
    return res.status(201).json({ ok: true, media: rows[0] });
  } catch (e) {
    console.error("/api/video-references create error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

// Delete a video reference by id
router.delete("/video-references/:id", async (req, res) => {
  try {
    const userId = req.user.sub;
    const id = req.params.id;
    // Ensure the media belongs to a project the user can access
    const { rows } = await pool.query(
      `SELECT m.id, m.project_id FROM media m JOIN projects p ON p.id=m.project_id
       WHERE m.id=$1 AND (p.owner_id=$2 OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.user_id=$2))
       LIMIT 1`,
      [id, userId]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    await pool.query(`DELETE FROM media WHERE id=$1`, [id]);
    // Also cleanup timeline placements referencing it
    await pool.query(`DELETE FROM timeline_items WHERE ref_id=$1`, [id]);
    return res.json({ ok: true });
  } catch (e) {
    console.error("/api/video-references delete error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
