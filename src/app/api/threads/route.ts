export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest, extractMentions, validateTitle, validateBody } from "@/lib/auth";
import { query, queryOne, queryAll } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";

// Rate limit: 30 writes per minute per user
const WRITE_RATE_LIMIT = { maxRequests: 30, windowMs: 60_000 };

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

interface UnreadCountRow {
  thread_id: string;
  count: string;
}

// GET /api/threads — List all threads with author, post count, and unread count
// Query params: category, limit (default 50, max 100), offset (default 0)
export async function GET(req: NextRequest) {
  const auth = await authenticateRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const category = req.nextUrl.searchParams.get("category");
  const limit = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get("limit") || "50") || 50, 1), 100);
  const offset = Math.max(parseInt(req.nextUrl.searchParams.get("offset") || "0") || 0, 0);

  let threads: ThreadRow[];
  let totalCount: number;

  if (category) {
    const validCategories = ["general", "projects", "philosophy", "chronicle", "random"];
    if (!validCategories.includes(category)) {
      return NextResponse.json({ error: "Invalid category" }, { status: 400 });
    }

    threads = await queryAll<ThreadRow>(
      `SELECT t.*,
        json_build_object('id', u.id, 'name', u.name, 'type', u.type, 'avatar_url', u.avatar_url) as author
      FROM threads t
      JOIN users u ON u.id = t.author_id
      WHERE t.category = $1
      ORDER BY t.pinned DESC, t.last_activity DESC
      LIMIT $2 OFFSET $3`,
      [category, limit, offset]
    );

    const countResult = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM threads WHERE category = $1`,
      [category]
    );
    totalCount = parseInt(countResult?.count || "0");
  } else {
    threads = await queryAll<ThreadRow>(
      `SELECT t.*,
        json_build_object('id', u.id, 'name', u.name, 'type', u.type, 'avatar_url', u.avatar_url) as author
      FROM threads t
      JOIN users u ON u.id = t.author_id
      ORDER BY t.pinned DESC, t.last_activity DESC
      LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const countResult = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM threads`
    );
    totalCount = parseInt(countResult?.count || "0");
  }

  const threadIds = threads.map((t) => t.id);

  if (threadIds.length === 0) {
    return NextResponse.json({
      threads: [],
      pagination: { total: totalCount, limit, offset, hasMore: false },
    });
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

  // Get unread counts per thread
  const unreadCounts = await queryAll<UnreadCountRow>(
    `SELECT p.thread_id, COUNT(*) as count
     FROM posts p
     LEFT JOIN read_markers rm ON rm.thread_id = p.thread_id AND rm.user_id = $1
     WHERE p.thread_id = ANY($2)
       AND (rm.last_read_at IS NULL OR p.created_at > rm.last_read_at)
     GROUP BY p.thread_id`,
    [auth.user.id, threadIds]
  );
  const unreadMap = new Map(unreadCounts.map((u) => [u.thread_id, parseInt(u.count)]));

  const enriched = threads.map((thread) => ({
    ...thread,
    post_count: countMap.get(thread.id) || 0,
    unread_count: unreadMap.get(thread.id) || 0,
    has_unread: readMap.has(thread.id)
      ? new Date(thread.last_activity) > new Date(readMap.get(thread.id)!)
      : true,
  }));

  return NextResponse.json({
    threads: enriched,
    pagination: {
      total: totalCount,
      limit,
      offset,
      hasMore: offset + limit < totalCount,
    },
  });
}

// POST /api/threads — Create a new thread with initial post
export async function POST(req: NextRequest) {
  const auth = await authenticateRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rate limit writes
  const rl = checkRateLimit(`write:${auth.user.id}`, WRITE_RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Please slow down." },
      { status: 429 }
    );
  }

  const { title, category, body } = await req.json();

  // Validate inputs
  const titleError = validateTitle(title);
  if (titleError) {
    return NextResponse.json({ error: titleError }, { status: 400 });
  }

  const bodyError = validateBody(body);
  if (bodyError) {
    return NextResponse.json({ error: bodyError }, { status: 400 });
  }

  const validCategories = ["general", "projects", "philosophy", "chronicle", "random"];
  if (category && !validCategories.includes(category)) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }

  // Create thread
  const thread = await queryOne<ThreadRow>(
    `INSERT INTO threads (title, category, author_id) VALUES ($1, $2, $3) RETURNING *`,
    [title.trim(), category || "general", auth.user.id]
  );

  if (!thread) {
    return NextResponse.json({ error: "Failed to create thread" }, { status: 500 });
  }

  // Create first post
  const mentions = extractMentions(body);
  const post = await queryOne(
    `INSERT INTO posts (thread_id, author_id, body, mentions) VALUES ($1, $2, $3, $4) RETURNING *`,
    [thread.id, auth.user.id, body.trim(), mentions]
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
