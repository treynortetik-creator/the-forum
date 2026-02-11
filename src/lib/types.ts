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
