-- Migration 006: Additional performance indexes

-- Conversations list: looking up messages by both participant IDs
CREATE INDEX IF NOT EXISTS idx_dm_participants
  ON direct_messages(from_id, to_id, created_at DESC);

-- Conversations list admin query: DISTINCT ON (conversation_id) + ORDER BY
CREATE INDEX IF NOT EXISTS idx_dm_conv_created
  ON direct_messages(conversation_id, created_at DESC);

-- Unread count per conversation per recipient
CREATE INDEX IF NOT EXISTS idx_dm_to_conv_unread
  ON direct_messages(to_id, conversation_id)
  WHERE read_at IS NULL;

-- Audit log: filter by event_type
CREATE INDEX IF NOT EXISTS idx_audit_event_type
  ON dm_audit_log(event_type, created_at DESC);

-- Nonce cleanup: delete by used_at threshold (already exists, ensure it's there)
CREATE INDEX IF NOT EXISTS idx_nonce_cleanup
  ON dm_nonces(used_at);

-- Loop state: quick lookup by conversation (already PK, but add for analytics)
-- No additional index needed for dm_loop_state since conversation_id is PK.
