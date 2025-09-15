-- 002_media_timeline.sql
-- Media library and timeline items used by generation/import/export flows.
-- Executed by Postgres entrypoint on fresh volumes (alphabetical ordering).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Media generated or attached to a project.
-- remote_url typically points to Modal's /files/<path>; storage_* reserved for future local/S3 backends.
CREATE TABLE IF NOT EXISTS media (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL,                                     -- 'video' | 'image' | 'audio' | ...
  filename         TEXT NOT NULL,
  remote_url       TEXT,                                              -- when storage_backend='remote'
  storage_backend  TEXT NOT NULL DEFAULT 'remote',                    -- 'remote' | 'local' | 's3' | ...
  storage_path     TEXT,                                              -- path or key when not remote
  meta             JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One media per (project, remote_url)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'media_project_remote_url_key'
  ) THEN
    ALTER TABLE media ADD CONSTRAINT media_project_remote_url_key UNIQUE (project_id, remote_url);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_media_project        ON media(project_id);
CREATE INDEX IF NOT EXISTS idx_media_project_kind   ON media(project_id, kind);
CREATE INDEX IF NOT EXISTS idx_media_created_at     ON media(created_at);


-- Timeline items for screenplay, generated assets, and placements.
-- type examples: 'screenplay', 'generated_video', 'generated_image', 'placed_video', 'placed_image'
CREATE TABLE IF NOT EXISTS timeline_items (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  ref_id     UUID REFERENCES media(id) ON DELETE CASCADE,             -- nullable (e.g., screenplay)
  payload    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Prevent duplicate generated entries per (project,type,ref)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'timeline_unique_generated'
  ) THEN
    ALTER TABLE timeline_items
      ADD CONSTRAINT timeline_unique_generated UNIQUE (project_id, type, ref_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_timeline_project      ON timeline_items(project_id);
CREATE INDEX IF NOT EXISTS idx_timeline_project_time ON timeline_items(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_timeline_ref          ON timeline_items(ref_id);
CREATE INDEX IF NOT EXISTS idx_timeline_type         ON timeline_items(type);

