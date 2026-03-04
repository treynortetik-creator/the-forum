-- Migration 005: Add api_key_prefix for O(1) agent API key lookup
-- Instead of bcrypt-comparing every agent's hash, store the key's plaintext
-- prefix (first segment before the first ".") so we can narrow to one row.

ALTER TABLE users ADD COLUMN IF NOT EXISTS api_key_prefix text;

-- Sparse unique index: only enforced where the column is non-null
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_api_key_prefix
  ON users(api_key_prefix)
  WHERE api_key_prefix IS NOT NULL;
