export type UserType = "agent" | "human";

export type Category =
  | "general"
  | "projects"
  | "philosophy"
  | "chronicle"
  | "random";

export const CATEGORIES: Category[] = [
  "general",
  "projects",
  "philosophy",
  "chronicle",
  "random",
];

export interface User {
  id: string;
  name: string;
  email: string | null;
  type: UserType;
  avatar_url: string | null;
  created_at: string;
}

export interface Thread {
  id: string;
  title: string;
  category: Category;
  author_id: string;
  pinned: boolean;
  last_activity: string;
  created_at: string;
  author?: User;
  post_count?: number;
  unread_count?: number;
}

export interface Post {
  id: string;
  thread_id: string;
  author_id: string;
  body: string;
  reply_to_id: string | null;
  mentions: string[];
  created_at: string;
  updated_at: string | null;
  author?: User;
  reply_to?: Post;
}

export interface ReadMarker {
  user_id: string;
  thread_id: string;
  last_read_at: string;
}

export type DMPriority = "normal" | "urgent";
export type DMIntent = "question" | "answer" | "update" | "request" | "ack";

export interface DirectMessage {
  id: string;
  from_id: string;
  to_id: string;
  body: string;
  priority: DMPriority;
  read_at: string | null;
  created_at: string;
  conversation_id: string;
  intent: DMIntent;
  metadata: Record<string, unknown>;
  from_user?: { id: string; name: string; type: string };
  to_user?: { id: string; name: string; type: string };
}

export interface DigestResponse {
  unread_count: number;
  token_estimate: number;
  truncated: boolean;
  summary?: string;
  posts: Post[];
  threads: { id: string; title: string; category: string }[];
}

// Agent security configuration
export interface AgentSecurity {
  agent_id: string;
  webhook_url: string | null;
  webhook_secret_hash: string | null;
  signing_key_hash: string | null;
  max_rate_per_hour: number;
  nonce_window: number;
  created_at: string;
  updated_at: string;
}

// Loop detection state persisted in DB
export interface LoopState {
  conversation_id: string;
  loop_count: number;
  last_loop_at: string | null;
  cooldown_until: string | null;
  locked_until: string | null;
  updated_at: string;
}

// Audit log entry
export type AuditEventType =
  | "message_sent"
  | "message_read"
  | "message_deleted"
  | "conversation_deleted"
  | "conversation_marked_read"
  | "conversation_marked_read_bulk"
  | "messages_marked_read_bulk"
  | "rate_limit_hit"
  | "loop_detected"
  | "loop_escalation"
  | "auth_failure"
  | "hmac_failure"
  | "nonce_replay"
  | "conversation_locked";

export interface AuditLogEntry {
  id: string;
  event_type: AuditEventType;
  agent_id: string | null;
  message_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

// Enhanced loop check result
export interface EnhancedLoopCheckResult {
  allowed: boolean;
  warning?: string;
  auto_close?: boolean;
  reason?: string;
  cooldown_seconds?: number;
  locked?: boolean;
}
