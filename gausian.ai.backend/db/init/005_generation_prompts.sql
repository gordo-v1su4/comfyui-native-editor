-- 005_generation_prompts.sql
-- Table to store generation prompts for video generation
-- This table links prompts to generated videos via filename_prefix

CREATE TABLE IF NOT EXISTS generation_prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prompt_id TEXT,                                    -- Modal prompt ID
  client_id TEXT,                                    -- Client identifier for the generation request
  filename_prefix TEXT NOT NULL,                     -- Prefix used to match with generated video filenames
  positive_prompt TEXT NOT NULL,                     -- The main prompt used for generation
  negative_prompt TEXT,                              -- Negative prompt (optional)
  seed INTEGER,                                      -- Random seed used
  width INTEGER NOT NULL,                            -- Video width
  height INTEGER NOT NULL,                           -- Video height
  length INTEGER NOT NULL,                           -- Video length in frames
  fps INTEGER NOT NULL,                              -- Frames per second
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_generation_prompts_project ON generation_prompts(project_id);
CREATE INDEX IF NOT EXISTS idx_generation_prompts_filename_prefix ON generation_prompts(filename_prefix);
CREATE INDEX IF NOT EXISTS idx_generation_prompts_created_at ON generation_prompts(created_at);

-- Unique constraint to prevent duplicate prompts for the same filename prefix
CREATE UNIQUE INDEX IF NOT EXISTS idx_generation_prompts_unique_prefix 
ON generation_prompts(project_id, filename_prefix);


-- Persist replacement target (in-place clip regeneration)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name='generation_prompts' AND column_name='replace_item_id'
  ) THEN
    ALTER TABLE generation_prompts
      ADD COLUMN replace_item_id UUID REFERENCES timeline_items(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_generation_prompts_replace_item
  ON generation_prompts(replace_item_id);


