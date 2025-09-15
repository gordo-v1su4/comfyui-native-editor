-- Initial schema (V0001)
BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_path TEXT,
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sequences (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  fps_num INTEGER NOT NULL,
  fps_den INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  duration_frames INTEGER NOT NULL,
  timeline_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sequences_project_id ON sequences(project_id);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('video','image','audio','sequence')),
  src_abs TEXT NOT NULL,
  src_rel TEXT,
  referenced INTEGER NOT NULL DEFAULT 1,
  file_size INTEGER,
  mtime_ns INTEGER,
  hash_sha256 TEXT,
  width INTEGER,
  height INTEGER,
  duration_frames INTEGER,
  fps_num INTEGER,
  fps_den INTEGER,
  audio_channels INTEGER,
  sample_rate INTEGER,
  color_primaries TEXT,
  transfer TEXT,
  matrix TEXT,
  timecode TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assets_project_id ON assets(project_id);
CREATE INDEX IF NOT EXISTS idx_assets_src_abs ON assets(src_abs);
CREATE INDEX IF NOT EXISTS idx_assets_hash ON assets(hash_sha256);

CREATE TABLE IF NOT EXISTS asset_files (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  "index" INTEGER NOT NULL,
  file_abs TEXT NOT NULL,
  file_rel TEXT,
  file_size INTEGER,
  mtime_ns INTEGER,
  hash_sha256 TEXT
);
CREATE INDEX IF NOT EXISTS idx_asset_files_asset_id ON asset_files(asset_id);

CREATE TABLE IF NOT EXISTS proxies (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('proxy','transcode')),
  width INTEGER,
  height INTEGER,
  codec TEXT,
  pixel_fmt TEXT,
  bitrate_kbps INTEGER,
  path_abs TEXT NOT NULL,
  settings_hash TEXT NOT NULL,
  valid INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_proxies_asset_id ON proxies(asset_id);
CREATE INDEX IF NOT EXISTS idx_proxies_settings_hash ON proxies(settings_hash);

CREATE TABLE IF NOT EXISTS usages (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  sequence_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  start_frame INTEGER NOT NULL,
  end_frame INTEGER NOT NULL,
  speed_num INTEGER NOT NULL DEFAULT 1,
  speed_den INTEGER NOT NULL DEFAULT 1,
  reversed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_usages_sequence_id ON usages(sequence_id);
CREATE INDEX IF NOT EXISTS idx_usages_asset_id ON usages(asset_id);

CREATE TABLE IF NOT EXISTS cache (
  id TEXT PRIMARY KEY,
  asset_id TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('thumbnail','waveform','analysis')),
  path_abs TEXT NOT NULL,
  meta_json TEXT NOT NULL DEFAULT '{}',
  valid INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cache_asset_id ON cache(asset_id);

COMMIT;

