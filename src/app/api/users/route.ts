export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { queryAll } from "@/lib/db";

interface UserListRow {
  id: string;
  name: string;
  type: string;
}

/**
 * GET /api/users — List all users (for DM recipient selection)
 * Returns minimal user info (id, name, type).
 */
export async function GET(req: NextRequest) {
  const auth = await authenticateRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const users = await queryAll<UserListRow>(
    `SELECT id, name, type FROM users WHERE id != $1 ORDER BY name`,
    [auth.user.id]
  );

  return NextResponse.json({ users });
}
