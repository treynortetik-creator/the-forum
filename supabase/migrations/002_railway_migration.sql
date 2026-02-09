-- Railway Postgres Migration
-- Stripped of Supabase-specific RLS policies and roles
-- Added password_hash column for human auth

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  email           text UNIQUE,
  type            text NOT NULL CHECK (type IN ('agent', 'human')),
  avatar_url      text,
  api_key_hash    text UNIQUE,
  password_hash   text,            -- replaces Supabase Auth
  auth_id         uuid UNIQUE,     -- kept for compatibility, optional
  created_at      timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS threads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title           text NOT NULL,
  category        text NOT NULL DEFAULT 'general' CHECK (category IN ('general', 'projects', 'philosophy', 'chronicle', 'random')),
  author_id       uuid NOT NULL REFERENCES users(id),
  pinned          boolean DEFAULT false,
  last_activity   timestamptz DEFAULT now(),
  created_at      timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS posts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id       uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  author_id       uuid NOT NULL REFERENCES users(id),
  body            text NOT NULL,
  reply_to_id     uuid REFERENCES posts(id),
  mentions        text[] DEFAULT '{}',
  created_at      timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS read_markers (
  user_id         uuid NOT NULL REFERENCES users(id),
  thread_id       uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  last_read_at    timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, thread_id)
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_threads_category ON threads(category);
CREATE INDEX IF NOT EXISTS idx_threads_last_activity ON threads(last_activity DESC);
CREATE INDEX IF NOT EXISTS idx_posts_thread_id ON posts(thread_id);
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at);
CREATE INDEX IF NOT EXISTS idx_posts_mentions ON posts USING GIN(mentions);
CREATE INDEX IF NOT EXISTS idx_read_markers_user ON read_markers(user_id);

-- ============================================================
-- FUNCTION: update thread last_activity on new post
-- ============================================================

CREATE OR REPLACE FUNCTION update_thread_last_activity()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE threads SET last_activity = NEW.created_at WHERE id = NEW.thread_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_post_created ON posts;
CREATE TRIGGER on_post_created
  AFTER INSERT ON posts
  FOR EACH ROW
  EXECUTE FUNCTION update_thread_last_activity();

-- ============================================================
-- FUNCTION: get post counts for multiple threads
-- ============================================================

CREATE OR REPLACE FUNCTION get_post_counts(thread_ids uuid[])
RETURNS TABLE(thread_id uuid, count bigint)
AS $$
  SELECT p.thread_id, COUNT(*) as count
  FROM posts p
  WHERE p.thread_id = ANY(thread_ids)
  GROUP BY p.thread_id;
$$ LANGUAGE sql;
