export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest, extractMentions } from "@/lib/auth";
import { query, queryOne, queryAll } from "@/lib/db";

interface ThreadRow {
  id: string;
  title: string;
  category: string;
  author_id: string;
  pinned: boolean;
  last_activity: string;
  created_at: string;
  author: { id: string; name: string; type: string; avatar_url: string | null };
}

interface PostCountRow {
  thread_id: string;
  count: string;
}

interface ReadMarkerRow {
  thread_id: string;
  last_read_at: string;
}

// GET /api/threads — List all threads with author and post count
export async function GET(req: NextRequest) {
  const auth = await authenticateRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const category = req.nextUrl.searchParams.get("category");

  let threads: ThreadRow[];

  if (category) {
    threads = await queryAll<ThreadRow>(
      `SELECT t.*,
        json_build_object('id', u.id, 'name', u.name, 'type', u.type, 'avatar_url', u.avatar_url) as author
      FROM threads t
      JOIN users u ON u.id = t.author_id
      WHERE t.category = $1
      ORDER BY t.pinned DESC, t.last_activity DESC`,
      [category]
    );
  } else {
    threads = await queryAll<ThreadRow>(
      `SELECT t.*,
        json_build_object('id', u.id, 'name', u.name, 'type', u.type, 'avatar_url', u.avatar_url) as author
      FROM threads t
      JOIN users u ON u.id = t.author_id
      ORDER BY t.pinned DESC, t.last_activity DESC`
    );
  }

  const threadIds = threads.map((t) => t.id);

  if (threadIds.length === 0) {
    return NextResponse.json([]);
  }

  // Get post counts
  const postCounts = await queryAll<PostCountRow>(
    `SELECT thread_id, COUNT(*) as count FROM posts WHERE thread_id = ANY($1) GROUP BY thread_id`,
    [threadIds]
  );
  const countMap = new Map(postCounts.map((c) => [c.thread_id, parseInt(c.count)]));

  // Get read markers for current user
  const readMarkers = await queryAll<ReadMarkerRow>(
    `SELECT thread_id, last_read_at FROM read_markers WHERE user_id = $1 AND thread_id = ANY($2)`,
    [auth.user.id, threadIds]
  );
  const readMap = new Map(readMarkers.map((m) => [m.thread_id, m.last_read_at]));

  const enriched = threads.map((thread) => ({
    ...thread,
    post_count: countMap.get(thread.id) || 0,
    has_unread: readMap.has(thread.id)
      ? new Date(thread.last_activity) > new Date(readMap.get(thread.id)!)
      : true,
  }));

  return NextResponse.json(enriched);
}

// POST /api/threads — Create a new thread with initial post
export async function POST(req: NextRequest) {
  const auth = await authenticateRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { title, category, body } = await req.json();

  if (!title || !body) {
    return NextResponse.json(
      { error: "title and body are required" },
      { status: 400 }
    );
  }

  const validCategories = ["general", "projects", "philosophy", "chronicle", "random"];
  if (category && !validCategories.includes(category)) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }

  // Create thread
  const thread = await queryOne<ThreadRow>(
    `INSERT INTO threads (title, category, author_id) VALUES ($1, $2, $3) RETURNING *`,
    [title, category || "general", auth.user.id]
  );

  if (!thread) {
    return NextResponse.json({ error: "Failed to create thread" }, { status: 500 });
  }

  // Create first post
  const mentions = extractMentions(body);
  const post = await queryOne(
    `INSERT INTO posts (thread_id, author_id, body, mentions) VALUES ($1, $2, $3, $4) RETURNING *`,
    [thread.id, auth.user.id, body, mentions]
  );

  // Get author info for the post
  const authorInfo = await queryOne(
    `SELECT id, name, type, avatar_url FROM users WHERE id = $1`,
    [auth.user.id]
  );

  // Mark as read for the creator
  await query(
    `INSERT INTO read_markers (user_id, thread_id, last_read_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id, thread_id) DO UPDATE SET last_read_at = NOW()`,
    [auth.user.id, thread.id]
  );

  return NextResponse.json(
    { ...thread, posts: [{ ...post, author: authorInfo }] },
    { status: 201 }
  );
}
