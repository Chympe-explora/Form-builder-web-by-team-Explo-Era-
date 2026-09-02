-- Form & Website Builder — Cloudflare D1 schema
-- Apply with: wrangler d1 execute YOUR_DB_NAME --file=schema.sql

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- One row per creator's form/website. `config` holds the entire page
-- structure (pages, elements, buttons, theme, whatsapp settings) as JSON,
-- so the same renderer can load any project just by fetching this row.
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,       -- public URL segment, e.g. /f/abc123
  name TEXT NOT NULL,
  config TEXT NOT NULL,            -- JSON blob, see CONFIG_SHAPE.md
  published INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_slug ON projects(slug);

-- One row per visitor submission.
CREATE TABLE IF NOT EXISTS responses (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  data TEXT NOT NULL,              -- JSON: { fieldId: value, ... }
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);
CREATE INDEX IF NOT EXISTS idx_responses_project ON responses(project_id);

-- Every uploaded file (logos, banners, gallery images, visitor uploads)
-- is stored in Telegram; this row keeps the reference D1-side.
CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  telegram_file_id TEXT NOT NULL,
  telegram_file_path TEXT,
  original_name TEXT,
  mime_type TEXT,
  kind TEXT NOT NULL DEFAULT 'asset',   -- 'asset' (builder-uploaded) or 'submission' (visitor-uploaded)
  response_id TEXT,                     -- set when kind = 'submission'
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);
CREATE INDEX IF NOT EXISTS idx_media_project ON media(project_id);
