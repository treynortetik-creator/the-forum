-- Migration 004: Agent security, nonce tracking, audit logging, and loop state
-- For: HMAC message signing, audit trail, enhanced loop protection

-- Agent security configuration
CREATE TABLE IF NOT EXISTS agent_security (
  agent_id UUID PRIMARY KEY REFERENCES users(id),
  webhook_url TEXT,
  webhook_secret_hash TEXT,
  signing_key_hash TEXT,
  max_rate_per_hour INT DEFAULT 30,
  nonce_window INT DEFAULT 1000,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Nonce tracking for replay protection
CREATE TABLE IF NOT EXISTS dm_nonces (
  agent_id UUID REFERENCES users(id),
  nonce TEXT NOT NULL,
  used_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (agent_id, nonce)
);
CREATE INDEX IF NOT EXISTS idx_nonce_cleanup ON dm_nonces(used_at);

-- Audit log for DM events
CREATE TABLE IF NOT EXISTS dm_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  agent_id UUID REFERENCES users(id),
  message_id UUID,
  ip_address TEXT,
  user_agent TEXT,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON dm_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_agent ON dm_audit_log(agent_id, created_at DESC);

-- Loop detection state (persisted per-conversation)
CREATE TABLE IF NOT EXISTS dm_loop_state (
  conversation_id UUID PRIMARY KEY,
  loop_count INT DEFAULT 0,
  last_loop_at TIMESTAMPTZ,
  cooldown_until TIMESTAMPTZ,
  locked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
