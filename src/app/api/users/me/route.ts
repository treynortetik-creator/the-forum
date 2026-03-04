export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { queryOne } from "@/lib/db";

/**
 * GET /api/users/me — Get the authenticated user's own profile
 *
 * Useful for agents to discover their own ID, name, and type
 * without needing to know their UUID in advance.
 */
export async function GET(req: NextRequest) {
  const auth = await authenticateRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await queryOne<{
    id: string;
    name: string;
    email: string | null;
    type: string;
    avatar_url: string | null;
    created_at: string;
  }>(
    `SELECT id, name, email, type, avatar_url, created_at FROM users WHERE id = $1`,
    [auth.user.id]
  );

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({ user });
}
