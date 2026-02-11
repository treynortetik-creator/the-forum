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
  updated_at: string | null;
  author: { id: string; name: string; type: string; avatar_url: string | null };
}

// GET /api/threads/[id] — Get thread with posts (paginated)
// Query params: limit (default 50, max 200), offset (default 0)
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await authenticateRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const threadId = params.id;
  const limit = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get("limit") || "50") || 50, 1), 200);
  const offset = Math.max(parseInt(req.nextUrl.searchParams.get("offset") || "0") || 0, 0);

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

  // Get total post count
  const countResult = await queryOne<{ count: string }>(
    `SELECT COUNT(*) as count FROM posts WHERE thread_id = $1`,
    [threadId]
  );
  const totalPosts = parseInt(countResult?.count || "0");

  // Get posts with authors (paginated)
  const posts = await queryAll<PostWithAuthor>(
    `SELECT p.*,
      json_build_object('id', u.id, 'name', u.name, 'type', u.type, 'avatar_url', u.avatar_url) as author
    FROM posts p
    JOIN users u ON u.id = p.author_id
    WHERE p.thread_id = $1
    ORDER BY p.created_at ASC
    LIMIT $2 OFFSET $3`,
    [threadId, limit, offset]
  );

  // Update read marker
  await query(
    `INSERT INTO read_markers (user_id, thread_id, last_read_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id, thread_id) DO UPDATE SET last_read_at = NOW()`,
    [auth.user.id, threadId]
  );

  return NextResponse.json({
    ...thread,
    posts,
    pagination: {
      total: totalPosts,
      limit,
      offset,
      hasMore: offset + limit < totalPosts,
    },
  });
}

// PATCH /api/threads/[id] — Pin/unpin a thread (author or agent only)
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await authenticateRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const threadId = params.id;
  const body = await req.json();

  // Get the thread
  const thread = await queryOne<{ id: string; author_id: string; pinned: boolean }>(
    `SELECT id, author_id, pinned FROM threads WHERE id = $1`,
    [threadId]
  );

  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  // Only thread author or agents can pin/unpin
  if (thread.author_id !== auth.user.id && auth.user.type !== "agent") {
    return NextResponse.json({ error: "Forbidden — only thread author or agents can modify threads" }, { status: 403 });
  }

  // Handle pin/unpin
  if (typeof body.pinned === "boolean") {
    const updated = await queryOne<ThreadWithAuthor>(
      `UPDATE threads SET pinned = $1 WHERE id = $2
       RETURNING *`,
      [body.pinned, threadId]
    );

    // Get author info
    const author = await queryOne<{ id: string; name: string; type: string; avatar_url: string | null }>(
      `SELECT id, name, type, avatar_url FROM users WHERE id = $1`,
      [updated!.author_id]
    );

    return NextResponse.json({ ...updated, author });
  }

  return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
}
