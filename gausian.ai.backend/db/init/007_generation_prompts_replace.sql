-- 007_generation_prompts_replace.sql
-- Add persistent reference to the timeline item we intend to replace on regen.

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

