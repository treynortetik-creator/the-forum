import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { createServiceClient } from "./supabase/server";
import { User } from "./types";

export interface AuthResult {
  user: User;
  method: "api_key" | "session";
}

/**
 * Authenticate a request via API key (agents) or Supabase session (humans).
 * Returns the authenticated user or null.
 */
export async function authenticateRequest(
  req: NextRequest
): Promise<AuthResult | null> {
  const supabase = createServiceClient();

  // 1. Check for API key (agent auth)
  const apiKey = req.headers.get("x-api-key");
  if (apiKey) {
    // Fetch all agent users with api_key_hash
    const { data: agents } = await supabase
      .from("users")
      .select("*")
      .eq("type", "agent")
      .not("api_key_hash", "is", null);

    if (agents) {
      for (const agent of agents) {
        const valid = await bcrypt.compare(apiKey, agent.api_key_hash);
        if (valid) {
          return { user: agent as User, method: "api_key" };
        }
      }
    }
    return null;
  }

  // 2. Check for Supabase session token (human auth)
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser(token);

    if (authUser) {
      const { data: forumUser } = await supabase
        .from("users")
        .select("*")
        .eq("auth_id", authUser.id)
        .single();

      if (forumUser) {
        return { user: forumUser as User, method: "session" };
      }
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
