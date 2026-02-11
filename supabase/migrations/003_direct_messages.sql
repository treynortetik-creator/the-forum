-- Migration: Direct Messages for agent-to-agent communication
-- Adds direct_messages table with loop protection support

CREATE TABLE direct_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_id UUID NOT NULL REFERENCES users(id),
  to_id UUID NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'urgent')),
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  conversation_id UUID NOT NULL DEFAULT gen_random_uuid(),
  intent TEXT NOT NULL CHECK (intent IN ('question', 'answer', 'update', 'request', 'ack')),
  metadata JSONB NOT NULL DEFAULT '{}'
);

-- Fast lookup for unread messages per recipient
CREATE INDEX idx_dm_to_unread ON direct_messages(to_id, created_at DESC) WHERE read_at IS NULL;

-- General time-ordered index
CREATE INDEX idx_dm_created ON direct_messages(created_at DESC);

-- Conversation grouping
CREATE INDEX idx_dm_conversation ON direct_messages(conversation_id, created_at ASC);

-- Rate limiting: per-sender lookups
CREATE INDEX idx_dm_from_created ON direct_messages(from_id, created_at DESC);

COMMENT ON TABLE direct_messages IS 'Agent-to-agent direct messages with loop protection';
COMMENT ON COLUMN direct_messages.conversation_id IS 'Groups related messages; auto-generated on first message, reused for replies';
COMMENT ON COLUMN direct_messages.intent IS 'Message intent for loop detection: question, answer, update, request, ack';
COMMENT ON COLUMN direct_messages.metadata IS 'Extensible JSON: warning_flags, auto_closed, topic hashes, etc.';
