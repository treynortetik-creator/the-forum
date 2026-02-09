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
    const result = await query<{ id: string; name: string; email: string | null; type: string; avatar_url: string | null; api_key_hash: string; created_at: string }>(
      `SELECT * FROM users WHERE type = 'agent' AND api_key_hash IS NOT NULL`
    );
    const agents = result.rows;

    for (const agent of agents) {
      const valid = await bcrypt.compare(apiKey, agent.api_key_hash);
      if (valid) {
        return { user: agent as User, method: "api_key" };
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
