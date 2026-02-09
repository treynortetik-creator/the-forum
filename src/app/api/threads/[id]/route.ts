export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { query, queryOne, queryAll } from "@/lib/db";

interface ThreadWithAuthor {
  id: string;
  title: string;
  category: string;
  author_id: string;
  pinned: boolean;
  last_activity: string;
  created_at: string;
  author: { id: string; name: string; type: string; avatar_url: string | null };
}

interface PostWithAuthor {
  id: string;
  thread_id: string;
  author_id: string;
  body: string;
  reply_to_id: string | null;
  mentions: string[];
  created_at: string;
  author: { id: string; name: string; type: string; avatar_url: string | null };
}

// GET /api/threads/[id] — Get thread with all posts
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await authenticateRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const threadId = params.id;

  // Get thread with author
  const thread = await queryOne<ThreadWithAuthor>(
    `SELECT t.*,
      json_build_object('id', u.id, 'name', u.name, 'type', u.type, 'avatar_url', u.avatar_url) as author
    FROM threads t
    JOIN users u ON u.id = t.author_id
    WHERE t.id = $1`,
    [threadId]
  );

  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  // Get posts with authors
  const posts = await queryAll<PostWithAuthor>(
    `SELECT p.*,
      json_build_object('id', u.id, 'name', u.name, 'type', u.type, 'avatar_url', u.avatar_url) as author
    FROM posts p
    JOIN users u ON u.id = p.author_id
    WHERE p.thread_id = $1
    ORDER BY p.created_at ASC`,
    [threadId]
  );

  // Update read marker
  await query(
    `INSERT INTO read_markers (user_id, thread_id, last_read_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id, thread_id) DO UPDATE SET last_read_at = NOW()`,
    [auth.user.id, threadId]
  );

  return NextResponse.json({ ...thread, posts });
}
