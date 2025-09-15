// api/routes/timeline.js
import express from "express";
import pool from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();
router.use(requireAuth);

async function hasAccess(projectId, userId) {
  const { rows } = await pool.query(
    `
    SELECT 1
    FROM projects p
    WHERE p.id = $1 AND (
      p.owner_id = $2 OR EXISTS (
        SELECT 1 FROM project_members pm
        WHERE pm.project_id = p.id AND pm.user_id = $2
      )
    )
    LIMIT 1
    `,
    [projectId, userId]
  );
  return !!rows.length;
}

/** GET /api/projects/:id/timeline */
router.get("/projects/:id/timeline", async (req, res) => {
  const userId = req.user.sub;
  const projectId = req.params.id;
  
  // Validate project ID format
  if (!projectId || projectId === 'undefined' || projectId === 'null') {
    console.error("Invalid project ID:", projectId);
    return res.status(400).json({ error: "Invalid project ID" });
  }
  
  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(projectId)) {
    console.error("Invalid UUID format for project ID:", projectId);
    return res.status(400).json({ error: "Invalid project ID format" });
  }
  
  if (!(await hasAccess(projectId, userId))) {
    return res.status(404).json({ error: "Project not found" });
  }
  const { rows } = await pool.query(
    `
    SELECT id, project_id, user_id, type, ref_id, payload, created_at
    FROM timeline_items
    WHERE project_id = $1
    ORDER BY created_at DESC
    `,
    [projectId]
  );
  return res.json({ ok: true, items: rows });
});

/**
 * POST /api/projects/:id/timeline
 * Body: { type, refId?, payload? }
 * Creates a new timeline item.
 */
router.post("/projects/:id/timeline", async (req, res) => {
  const userId = req.user.sub;
  const projectId = req.params.id;
  if (!(await hasAccess(projectId, userId))) {
    return res.status(404).json({ error: "Project not found" });
  }
  const { type, refId = null, payload = {} } = req.body || {};
  if (!type || typeof type !== "string") {
    return res.status(400).json({ error: "Missing type" });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO timeline_items (project_id, user_id, type, ref_id, payload)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, project_id, user_id, type, ref_id, payload, created_at`,
      [projectId, userId, type, refId, JSON.stringify(payload || {})]
    );
    return res.status(201).json({ ok: true, item: rows[0] });
  } catch (e) {
    console.error("timeline create error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * PUT /api/projects/:id/timeline/placements
 * Body: { items: [ { refId, startFrame, durationFrames, track?, fps? } ] }
 * Upserts "placed_video" timeline items for the given media refs.
 */
router.put("/projects/:id/timeline/placements", async (req, res) => {
  const userId = req.user.sub;
  const projectId = req.params.id;
  
  // Validate project ID format
  if (!projectId || projectId === 'undefined' || projectId === 'null') {
    console.error("Invalid project ID:", projectId);
    return res.status(400).json({ error: "Invalid project ID" });
  }
  
  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(projectId)) {
    console.error("Invalid UUID format for project ID:", projectId);
    return res.status(400).json({ error: "Invalid project ID format" });
  }
  
  if (!(await hasAccess(projectId, userId))) {
    return res.status(404).json({ error: "Project not found" });
  }
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ error: "No items provided" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const it of items) {
      const refId = it?.refId || it?.mediaId;
      const start = Number(it?.startFrame);
      const dur = Number(it?.durationFrames);
      const fps = Number(it?.fps || 24);
      const track = String(it?.track || "Generated");
      if (!refId || !Number.isFinite(start) || !Number.isFinite(dur)) continue;

      // Remove existing placement for this media (idempotent update)
      await client.query(
        `DELETE FROM timeline_items WHERE project_id=$1 AND type LIKE 'placed_%' AND ref_id=$2`,
        [projectId, refId]
      );

      // Insert new placement
      await client.query(
        `INSERT INTO timeline_items (project_id, user_id, type, ref_id, payload)
         VALUES ($1,$2,'placed_video',$3,$4)`,
        [
          projectId,
          userId,
          refId,
          JSON.stringify({ track, start_frame: start, duration_frames: dur, fps }),
        ]
      );
    }
    await client.query("COMMIT");
    return res.json({ ok: true, count: items.length });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("timeline placements save error:", e);
    return res.status(500).json({ error: "Server error" });
  } finally {
    client.release();
  }
});

/**
 * PUT /api/projects/:id/timeline/:itemId
 * Updates type and/or payload for an existing item (not placements).
 */
router.put("/projects/:id/timeline/:itemId", async (req, res) => {
  const userId = req.user.sub;
  const { id: projectId, itemId } = req.params;
  if (!(await hasAccess(projectId, userId))) {
    return res.status(404).json({ error: "Project not found" });
  }
  const { type, payload } = req.body || {};
  if (!type && payload == null) return res.status(400).json({ error: "Nothing to update" });
  try {
    const fields = [];
    const args = [projectId, itemId];
    if (typeof type === "string") { fields.push(`type = $${args.length + 1}`); args.push(type); }
    if (payload != null) { fields.push(`payload = $${args.length + 1}::jsonb`); args.push(JSON.stringify(payload)); }
    if (!fields.length) return res.status(400).json({ error: "Nothing to update" });
    const { rows } = await pool.query(
      `UPDATE timeline_items SET ${fields.join(", ")} 
       WHERE project_id = $1 AND id = $2
       RETURNING id, project_id, user_id, type, ref_id, payload, created_at`,
      args
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    return res.json({ ok: true, item: rows[0] });
  } catch (e) {
    console.error("timeline update error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * DELETE /api/projects/:id/timeline/placements/:refId
 * Removes placement (placed_*) for a specific media id.
 */
router.delete("/projects/:id/timeline/placements/:refId", async (req, res) => {
  const userId = req.user.sub;
  const { id: projectId, refId } = req.params;
  if (!(await hasAccess(projectId, userId))) {
    return res.status(404).json({ error: "Project not found" });
  }
  await pool.query(
    `DELETE FROM timeline_items WHERE project_id=$1 AND type LIKE 'placed_%' AND ref_id=$2`,
    [projectId, refId]
  );
  return res.json({ ok: true });
});

/**
 * DELETE /api/projects/:id/timeline/:itemId
 * Deletes a timeline item by id (non-placement).
 */
router.delete("/projects/:id/timeline/:itemId", async (req, res) => {
  const userId = req.user.sub;
  const { id: projectId, itemId } = req.params;
  if (!(await hasAccess(projectId, userId))) {
    return res.status(404).json({ error: "Project not found" });
  }
  await pool.query(`DELETE FROM timeline_items WHERE project_id=$1 AND id=$2`, [projectId, itemId]);
  return res.json({ ok: true });
});

/** DELETE /api/projects/:id/timeline/cleanup - Remove stale timeline items */
router.delete("/projects/:id/timeline/cleanup", requireAuth, async (req, res) => {
  const userId = req.user.sub;
  const projectId = req.params.id;
  const { itemIds } = req.body;

  if (!Array.isArray(itemIds) || itemIds.length === 0) {
    return res.status(400).json({ error: "itemIds must be a non-empty array" });
  }

  if (!(await hasAccess(projectId, userId))) {
    return res.status(404).json({ error: "Project not found" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    
    // Delete timeline items by IDs
    const placeholders = itemIds.map((_, i) => `$${i + 1}`).join(',');
    const { rowCount } = await client.query(
      `DELETE FROM timeline_items WHERE id IN (${placeholders}) AND project_id = $${itemIds.length + 1}`,
      [...itemIds, projectId]
    );
    
    await client.query("COMMIT");
    console.log(`[timeline cleanup] Removed ${rowCount} stale timeline items for project ${projectId}`);
    
    return res.json({ 
      ok: true, 
      removed: rowCount,
      message: `Removed ${rowCount} stale timeline items`
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[timeline cleanup] Error:", error);
    return res.status(500).json({ error: "Failed to cleanup timeline items" });
  } finally {
    client.release();
  }
});

/** POST /api/projects/:id/timeline/cleanup-orphaned - Clean up orphaned timeline items */
router.post("/projects/:id/timeline/cleanup-orphaned", requireAuth, async (req, res) => {
  const userId = req.user.sub;
  const projectId = req.params.id;

  if (!(await hasAccess(projectId, userId))) {
    return res.status(404).json({ error: "Project not found" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    
    // Use the cleanup function to remove orphaned timeline items
    const result = await client.query(
      `SELECT cleanup_orphaned_timeline_items() as deleted_count`
    );
    
    const deletedCount = result.rows[0]?.deleted_count || 0;
    
    await client.query("COMMIT");
    console.log(`[timeline cleanup-orphaned] Removed ${deletedCount} orphaned timeline items for project ${projectId}`);
    
    return res.json({ 
      ok: true, 
      removed: deletedCount,
      message: `Removed ${deletedCount} orphaned timeline items`
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[timeline cleanup-orphaned] Error:", error);
    return res.status(500).json({ error: "Failed to cleanup orphaned timeline items" });
  } finally {
    client.release();
  }
});

/** GET /api/projects/:id/timeline/validate - Validate media-timeline consistency */
router.get("/projects/:id/timeline/validate", requireAuth, async (req, res) => {
  const userId = req.user.sub;
  const projectId = req.params.id;

  if (!(await hasAccess(projectId, userId))) {
    return res.status(404).json({ error: "Project not found" });
  }

  try {
    // Use the validation function to check consistency
    const result = await pool.query(
      `SELECT * FROM validate_media_timeline_consistency($1)`,
      [projectId]
    );
    
    const issues = result.rows;
    console.log(`[timeline validate] Found ${issues.length} consistency issues for project ${projectId}`);
    
    return res.json({ 
      ok: true, 
      issues: issues,
      count: issues.length,
      message: `Found ${issues.length} consistency issues`
    });
  } catch (error) {
    console.error("[timeline validate] Error:", error);
    return res.status(500).json({ error: "Failed to validate timeline consistency" });
  }
});

export default router;
