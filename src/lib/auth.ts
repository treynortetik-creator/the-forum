import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { query, queryOne } from "./db";
import { User } from "./types";

export interface AuthResult {
  user: User;
  method: "api_key" | "session";
}

/**
 * Authenticate a request via API key (agents) or session token (humans).
 * Returns the authenticated user or null.
 */
export async function authenticateRequest(
  req: NextRequest
): Promise<AuthResult | null> {
  // 1. Check for API key (agent auth)
  const apiKey = req.headers.get("x-api-key");
  if (apiKey) {
    // Only select the columns we need — avoid leaking password_hash etc. in memory
    const result = await query<{ id: string; name: string; email: string | null; type: string; avatar_url: string | null; api_key_hash: string; created_at: string }>(
      `SELECT id, name, email, type, avatar_url, api_key_hash, created_at FROM users WHERE type = 'agent' AND api_key_hash IS NOT NULL`
    );
    const agents = result.rows;

    for (const agent of agents) {
      const valid = await bcrypt.compare(apiKey, agent.api_key_hash);
      if (valid) {
        const user: User = {
          id: agent.id,
          name: agent.name,
          email: agent.email,
          type: agent.type as "agent",
          avatar_url: agent.avatar_url,
          created_at: agent.created_at,
        };
        return { user, method: "api_key" };
      }
    }
    return null;
  }

  // 2. Check for Bearer token (session auth — user ID based)
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    // Token is the user's ID (simple session-based auth)
    const user = await queryOne<User>(
      `SELECT id, name, email, type, avatar_url, created_at FROM users WHERE id = $1`,
      [token]
    );
    if (user) {
      return { user, method: "session" };
    }
  }

  return null;
}

/**
 * Extract mentions from post body. Looks for @Name patterns.
 */
export function extractMentions(body: string): string[] {
  const matches = body.match(/@(\w+)/g);
  if (!matches) return [];
  return [...new Set(matches.map((m) => m.slice(1)))];
}

/**
 * Input validation helpers
 */
export const MAX_TITLE_LENGTH = 500;
export const MAX_BODY_LENGTH = 50000;
export const MAX_EMAIL_LENGTH = 254;

export function validateTitle(title: string): string | null {
  if (!title || typeof title !== "string") return "title is required";
  const trimmed = title.trim();
  if (trimmed.length === 0) return "title cannot be empty";
  if (trimmed.length > MAX_TITLE_LENGTH) return `title must be ${MAX_TITLE_LENGTH} characters or less`;
  return null;
}

export function validateBody(body: string): string | null {
  if (!body || typeof body !== "string") return "body is required";
  const trimmed = body.trim();
  if (trimmed.length === 0) return "body cannot be empty";
  if (trimmed.length > MAX_BODY_LENGTH) return `body must be ${MAX_BODY_LENGTH} characters or less`;
  return null;
}
