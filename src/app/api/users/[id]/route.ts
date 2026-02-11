export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { queryOne, queryAll } from "@/lib/db";

interface UserPublicRow {
  id: string;
  name: string;
  type: string;
  avatar_url: string | null;
  created_at: string;
}

interface UserStatsRow {
  thread_count: string;
  post_count: string;
}

interface RecentThreadRow {
  id: string;
  title: string;
  category: string;
  created_at: string;
  last_activity: string;
}

// GET /api/users/[id] — Get public user profile
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await authenticateRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = params.id;

  // Get public user info only — no email, no hashes
  const user = await queryOne<UserPublicRow>(
    `SELECT id, name, type, avatar_url, created_at FROM users WHERE id = $1`,
    [userId]
  );

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Get activity stats
  const stats = await queryOne<UserStatsRow>(
    `SELECT
      (SELECT COUNT(*) FROM threads WHERE author_id = $1) as thread_count,
      (SELECT COUNT(*) FROM posts WHERE author_id = $1) as post_count`,
    [userId]
  );

  // Get recent threads by this user (last 5)
  const recentThreads = await queryAll<RecentThreadRow>(
    `SELECT id, title, category, created_at, last_activity
     FROM threads
     WHERE author_id = $1
     ORDER BY created_at DESC
     LIMIT 5`,
    [userId]
  );

  return NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      type: user.type,
      avatar_url: user.avatar_url,
      created_at: user.created_at,
    },
    stats: {
      thread_count: parseInt(stats?.thread_count || "0"),
      post_count: parseInt(stats?.post_count || "0"),
    },
    recent_threads: recentThreads,
  });
}
