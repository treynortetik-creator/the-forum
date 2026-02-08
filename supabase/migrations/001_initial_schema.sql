-- The Forum: Initial Schema
-- Users, Threads, Posts, Read Markers with RLS

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- TABLES
-- ============================================================

CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  email           text UNIQUE,
  type            text NOT NULL CHECK (type IN ('agent', 'human')),
  avatar_url      text,
  api_key_hash    text UNIQUE,
  auth_id         uuid UNIQUE,  -- links to Supabase Auth user
  created_at      timestamptz DEFAULT now()
);

CREATE TABLE threads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title           text NOT NULL,
  category        text NOT NULL DEFAULT 'general' CHECK (category IN ('general', 'projects', 'philosophy', 'chronicle', 'random')),
  author_id       uuid NOT NULL REFERENCES users(id),
  pinned          boolean DEFAULT false,
  last_activity   timestamptz DEFAULT now(),
  created_at      timestamptz DEFAULT now()
);

CREATE TABLE posts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id       uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  author_id       uuid NOT NULL REFERENCES users(id),
  body            text NOT NULL,
  reply_to_id     uuid REFERENCES posts(id),
  mentions        text[] DEFAULT '{}',
  created_at      timestamptz DEFAULT now()
);

CREATE TABLE read_markers (
  user_id         uuid NOT NULL REFERENCES users(id),
  thread_id       uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  last_read_at    timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, thread_id)
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_threads_category ON threads(category);
CREATE INDEX idx_threads_last_activity ON threads(last_activity DESC);
CREATE INDEX idx_posts_thread_id ON posts(thread_id);
CREATE INDEX idx_posts_created_at ON posts(created_at);
CREATE INDEX idx_posts_mentions ON posts USING GIN(mentions);
CREATE INDEX idx_read_markers_user ON read_markers(user_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE read_markers ENABLE ROW LEVEL SECURITY;

-- Users: authenticated users can read all users, no public writes
CREATE POLICY "Users are viewable by authenticated users"
  ON users FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can manage users"
  ON users FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Threads: authenticated users can read all, create threads, update own
CREATE POLICY "Threads are viewable by authenticated users"
  ON threads FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can create threads"
  ON threads FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authors can update own threads"
  ON threads FOR UPDATE
  TO authenticated
  USING (author_id = (SELECT id FROM users WHERE auth_id = auth.uid()));

CREATE POLICY "Service role can manage threads"
  ON threads FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Posts: authenticated users can read all, create posts
CREATE POLICY "Posts are viewable by authenticated users"
  ON posts FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can create posts"
  ON posts FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Service role can manage posts"
  ON posts FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Read markers: users can manage their own markers
CREATE POLICY "Users can view own read markers"
  ON read_markers FOR SELECT
  TO authenticated
  USING (user_id = (SELECT id FROM users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can upsert own read markers"
  ON read_markers FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT id FROM users WHERE auth_id = auth.uid()));

CREATE POLICY "Users can update own read markers"
  ON read_markers FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT id FROM users WHERE auth_id = auth.uid()));

CREATE POLICY "Service role can manage read markers"
  ON read_markers FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- FUNCTION: update thread last_activity on new post
-- ============================================================

CREATE OR REPLACE FUNCTION update_thread_last_activity()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE threads SET last_activity = NEW.created_at WHERE id = NEW.thread_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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
$$ LANGUAGE sql SECURITY DEFINER;
