-- 006_media_integrity_constraints.sql
-- Additional constraints to prevent ID mismatches and ensure data integrity
-- Executed by Postgres entrypoint on fresh volumes (alphabetical ordering)

-- Add a unique constraint on media filename per project to prevent duplicates
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'media_project_filename_unique'
  ) THEN
    ALTER TABLE media 
    ADD CONSTRAINT media_project_filename_unique UNIQUE (project_id, filename);
  END IF;
END $$;

-- Add a check constraint to ensure ref_id is not null for placed_video timeline items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'timeline_placed_video_ref_id_not_null'
  ) THEN
    ALTER TABLE timeline_items 
    ADD CONSTRAINT timeline_placed_video_ref_id_not_null 
    CHECK (
      (type = 'placed_video' AND ref_id IS NOT NULL) OR 
      (type != 'placed_video')
    );
  END IF;
END $$;

-- Create a function to clean up orphaned timeline items
CREATE OR REPLACE FUNCTION cleanup_orphaned_timeline_items()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  -- Delete timeline items that reference non-existent media
  DELETE FROM timeline_items 
  WHERE ref_id IS NOT NULL 
    AND ref_id NOT IN (SELECT id FROM media);
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  IF deleted_count > 0 THEN
    RAISE NOTICE 'Cleaned up % orphaned timeline items', deleted_count;
  END IF;
  
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Create a function to validate media-timeline consistency
CREATE OR REPLACE FUNCTION validate_media_timeline_consistency(project_uuid UUID)
RETURNS TABLE(
  issue_type TEXT,
  timeline_item_id UUID,
  media_id UUID,
  details TEXT
) AS $$
BEGIN
  -- Check for timeline items referencing non-existent media
  RETURN QUERY
  SELECT 
    'orphaned_timeline_item'::TEXT as issue_type,
    ti.id as timeline_item_id,
    ti.ref_id as media_id,
    'Timeline item references non-existent media'::TEXT as details
  FROM timeline_items ti
  WHERE ti.project_id = project_uuid
    AND ti.ref_id IS NOT NULL
    AND ti.ref_id NOT IN (SELECT id FROM media);
    
  -- Check for media without corresponding timeline items (optional - not always an issue)
  RETURN QUERY
  SELECT 
    'orphaned_media'::TEXT as issue_type,
    NULL::UUID as timeline_item_id,
    m.id as media_id,
    'Media exists but has no timeline items'::TEXT as details
  FROM media m
  WHERE m.project_id = project_uuid
    AND m.id NOT IN (SELECT ref_id FROM timeline_items WHERE ref_id IS NOT NULL);
END;
$$ LANGUAGE plpgsql;

-- Add indexes for better performance on consistency checks
CREATE INDEX IF NOT EXISTS idx_media_project_filename ON media(project_id, filename);
CREATE INDEX IF NOT EXISTS idx_timeline_items_ref_id_project ON timeline_items(ref_id, project_id) WHERE ref_id IS NOT NULL;
