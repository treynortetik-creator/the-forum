-- Add updated_at column to posts table for edit tracking
ALTER TABLE posts ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT NULL;

-- Add full-text search indexes for better search performance
CREATE INDEX IF NOT EXISTS idx_threads_title_trgm ON threads USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_posts_body_trgm ON posts USING gin (body gin_trgm_ops);

-- Note: The trigram indexes above require the pg_trgm extension:
-- CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- If the extension isn't available, these indexes will fail silently
-- and ILIKE search will still work (just slower on large datasets).
