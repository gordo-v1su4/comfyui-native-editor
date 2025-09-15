-- 004_jobs_fix.sql
-- Ensure jobs table has the columns used by the application.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'jobs' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE jobs ADD COLUMN user_id UUID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'jobs' AND column_name = 'prompt_id'
  ) THEN
    ALTER TABLE jobs ADD COLUMN prompt_id TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'jobs' AND column_name = 'status'
  ) THEN
    ALTER TABLE jobs ADD COLUMN status TEXT DEFAULT 'queued';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_prompt ON jobs(prompt_id);
