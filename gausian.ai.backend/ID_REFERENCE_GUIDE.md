# ID Reference Guide - Gausian Video Editor

## Overview

This document provides a comprehensive guide to how IDs are used throughout the Gausian video editor web application. Understanding ID usage is crucial for maintaining data integrity and preventing the ID mismatch issues that were causing video playback failures.

## ID Architecture

The application uses a **dual-ID system** to separate concerns:

1. **Timeline Item ID** (`timeline_item.id`) - For editing, state management, and React component keys
2. **Media Asset ID** (`timeline_item.ref_id` → `media.id`) - For streaming, decoding, and actual video content

## Database Schema

### Media Table (`media`)
```sql
CREATE TABLE media (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),  -- Media Asset ID
  project_id       UUID NOT NULL REFERENCES projects(id),
  user_id          UUID NOT NULL REFERENCES users(id),
  kind             TEXT NOT NULL,                               -- 'video' | 'image' | 'audio'
  filename         TEXT NOT NULL,                               -- Unique filename per project
  remote_url       TEXT,                                        -- Backblaze URL
  storage_backend  TEXT NOT NULL DEFAULT 's3',                 -- 's3' | 'local' | 'remote'
  storage_path     TEXT,                                        -- S3 key or local path
  meta             JSONB NOT NULL DEFAULT '{}',                -- Metadata
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Constraints
ALTER TABLE media ADD CONSTRAINT media_project_filename_unique UNIQUE (project_id, filename);
```

### Timeline Items Table (`timeline_items`)
```sql
CREATE TABLE timeline_items (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),       -- Timeline Item ID
  project_id UUID NOT NULL REFERENCES projects(id),
  user_id    UUID NOT NULL REFERENCES users(id),
  type       TEXT NOT NULL,                                    -- 'placed_video' | 'screenplay' | etc.
  ref_id     UUID REFERENCES media(id) ON DELETE CASCADE,     -- Media Asset ID (nullable)
  payload    JSONB NOT NULL DEFAULT '{}',                     -- Timeline-specific data
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Constraints
ALTER TABLE timeline_items ADD CONSTRAINT timeline_unique_generated UNIQUE (project_id, type, ref_id);
ALTER TABLE timeline_items ADD CONSTRAINT timeline_placed_video_ref_id_not_null 
  CHECK ((type = 'placed_video' AND ref_id IS NOT NULL) OR (type != 'placed_video'));
```

## ID Usage Throughout the Application

### 1. Frontend Components

#### MediaImporter.tsx
**Purpose**: Loads and manages media files from the backend

**ID Usage**:
- **MediaFile.id**: Uses `media.id` from database
- **Deduplication**: Prevents duplicate media entries by filename
- **Stream URLs**: Constructs URLs using `media.id`

```typescript
// Media file structure
interface MediaFile {
  id: string;        // media.id from database
  name: string;      // media.filename
  type: string;      // media.kind
  url: string;       // Stream URL using media.id
  // ... other properties
}

// Deduplication logic
const deduplicatedVideos = projectVideos.reduce((acc: MediaFile[], video) => {
  const existingIndex = acc.findIndex(v => v.name === video.name);
  if (existingIndex >= 0) {
    // Keep existing ID, discard duplicate
    acc[existingIndex] = { ...acc[existingIndex], ...video, id: acc[existingIndex].id };
  } else {
    acc.push(video);
  }
  return acc;
}, []);
```

#### AdvancedVideoEditor.tsx
**Purpose**: Main video editing interface, manages timeline and media

**ID Usage**:
- **Timeline Item Creation**: Uses `timeline_item.id` for React keys and state
- **Media Streaming**: Uses `timeline_item.ref_id` for video URLs
- **Database Operations**: Maintains both IDs separately

```typescript
// Timeline item structure
const timelineItem = {
  id: item.id,                    // Timeline item ID for editing/state
  ref_id: item.ref_id,           // Media asset ID for streaming/decoding
  type: "video",
  src: `/api/projects/${currentProject.id}/media/${item.ref_id}/stream`, // Use asset_id for streaming
  from: item.payload?.start_frame || 0,
  durationInFrames: item.payload?.duration_frames || 60,
  frameRate: item.payload?.fps || 24,
  track: item.payload?.track || 'Generated',
};
```

#### VideoPreview.tsx
**Purpose**: Displays the active video in the timeline

**ID Usage**:
- **React Key**: Uses `timeline_item.id` for React component keys
- **Video Element Ref**: Uses `timeline_item.id` for DOM element management
- **Video Source**: Uses `timeline_item.ref_id` in the streaming URL

```typescript
// Video element rendering
<video
  key={activeVideo.id}                    // Timeline item ID for React key
  ref={(el) => {
    videoRefs.current[activeVideo.id] = el; // Timeline item ID for ref management
  }}
  src={activeVideo.src}                   // Media asset ID in the URL
  // ... other props
/>
```

#### VideoPromptPanel.tsx
**Purpose**: Displays generation prompts for selected timeline clips

**ID Usage**:
- **Media Lookup**: Uses `timeline_item.ref_id` to find corresponding media
- **Prompt Matching**: Matches prompts by filename patterns

```typescript
// Media lookup for prompts
const selectedMedia = mediaFiles?.find(media => media.id === selectedItem.ref_id);
```

### 2. Backend API Endpoints

#### Media Routes (`/api/routes/media.js`)

**Streaming Endpoint**: `GET /api/projects/:projectId/media/:mediaId/stream`
- **URL Parameter**: `mediaId` = `media.id` (Media Asset ID)
- **Purpose**: Streams video content from Backblaze
- **Authentication**: Requires JWT token

**Modal Upload Endpoint**: `POST /api/modal-upload`
- **Creates**: New `media` entry with unique `media.id`
- **Creates**: New `timeline_items` entry with `ref_id` pointing to `media.id`
- **Deduplication**: Prevents duplicate media by filename

#### Timeline Routes (`/api/routes/timeline.js`)

**Timeline Loading**: `GET /api/projects/:projectId/timeline`
- **Returns**: Timeline items with both `id` and `ref_id`
- **Validation**: Ensures `ref_id` points to existing media

**Cleanup Endpoints**:
- `DELETE /api/projects/:projectId/timeline/cleanup` - Remove specific timeline items
- `POST /api/projects/:projectId/timeline/cleanup-orphaned` - Remove orphaned timeline items
- `GET /api/projects/:projectId/timeline/validate` - Validate media-timeline consistency

### 3. Database Functions

#### Cleanup Functions
```sql
-- Clean up orphaned timeline items
CREATE OR REPLACE FUNCTION cleanup_orphaned_timeline_items()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM timeline_items 
  WHERE ref_id IS NOT NULL 
    AND ref_id NOT IN (SELECT id FROM media);
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Validate media-timeline consistency
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
END;
$$ LANGUAGE plpgsql;
```

## ID Flow Diagrams

### Media Upload Flow
```
Modal Upload → Backblaze → /api/modal-upload → media.id → timeline_items.ref_id
```

### Timeline Loading Flow
```
Database → timeline_items → AdvancedVideoEditor → VideoPreview → /api/media/:ref_id/stream
```

### Video Streaming Flow
```
VideoPreview → /api/projects/:projectId/media/:mediaId/stream → Backblaze → Browser
```

## Key Principles

### 1. Separation of Concerns
- **Timeline Item ID**: Used for React state, component keys, and editing operations
- **Media Asset ID**: Used for streaming, file access, and content delivery

### 2. Data Integrity
- **Foreign Key Constraints**: `timeline_items.ref_id` references `media.id`
- **Cascade Deletes**: Deleting media automatically removes timeline items
- **Unique Constraints**: Prevent duplicate media by filename per project

### 3. Deduplication
- **MediaImporter**: Deduplicates by filename to prevent ID mismatches
- **Modal Uploads**: Creates single media entry per unique filename
- **Timeline Items**: Reference the same media ID consistently

### 4. Error Handling
- **Missing Media**: Timeline items with non-existent `ref_id` are filtered out
- **Orphaned Items**: Automatic cleanup of timeline items without media
- **Validation**: Regular consistency checks between media and timeline tables

## Common ID Patterns

### Creating Timeline Items
```typescript
// ✅ Correct: Use separate IDs
const timelineItem = {
  id: `timeline-${Date.now()}-${Math.random()}`, // Timeline item ID
  ref_id: mediaFile.id,                          // Media asset ID
  src: `/api/projects/${projectId}/media/${mediaFile.id}/stream`
};

// ❌ Incorrect: Using same ID for both purposes
const timelineItem = {
  id: mediaFile.id,  // This causes ID conflicts
  src: `/api/projects/${projectId}/media/${mediaFile.id}/stream`
};
```

### React Component Keys
```typescript
// ✅ Correct: Use timeline item ID for React keys
{tracks.map(track => 
  track.items.map(item => (
    <VideoItem key={item.id} item={item} />  // Timeline item ID
  ))
)}

// ❌ Incorrect: Using media ID for React keys
{tracks.map(track => 
  track.items.map(item => (
    <VideoItem key={item.ref_id} item={item} />  // Media asset ID
  ))
)}
```

### Video Streaming URLs
```typescript
// ✅ Correct: Use media asset ID for streaming
const streamUrl = `/api/projects/${projectId}/media/${item.ref_id}/stream`;

// ❌ Incorrect: Using timeline item ID for streaming
const streamUrl = `/api/projects/${projectId}/media/${item.id}/stream`;
```

## Troubleshooting

### ID Mismatch Issues
**Symptoms**: 404 errors when streaming videos, "Video element not found" errors

**Causes**:
1. Timeline items referencing non-existent media IDs
2. Duplicate media entries with different IDs
3. Race conditions between media import and timeline loading

**Solutions**:
1. Use deduplication in MediaImporter
2. Validate timeline items against existing media
3. Clean up orphaned timeline items
4. Ensure proper ID separation

### Debugging Commands
```sql
-- Check for orphaned timeline items
SELECT * FROM validate_media_timeline_consistency('project-uuid');

-- Clean up orphaned items
SELECT cleanup_orphaned_timeline_items();

-- Find duplicate media by filename
SELECT filename, COUNT(*) as count 
FROM media 
WHERE project_id = 'project-uuid' 
GROUP BY filename 
HAVING COUNT(*) > 1;
```

## Best Practices

1. **Always use the correct ID for the correct purpose**
2. **Implement deduplication at the data layer**
3. **Validate data integrity regularly**
4. **Use database constraints to prevent inconsistencies**
5. **Log ID usage for debugging**
6. **Test ID flows thoroughly**
7. **Monitor for orphaned records**

This ID reference guide ensures that all developers understand how IDs are used throughout the application and can maintain data integrity while preventing the ID mismatch issues that were causing video playback failures.
