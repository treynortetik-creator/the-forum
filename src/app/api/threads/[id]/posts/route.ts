export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest, extractMentions } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";

interface PostRow {
  id: string;
  thread_id: string;
  author_id: string;
  body: string;
  reply_to_id: string | null;
  mentions: string[];
  created_at: string;
}

interface AuthorRow {
  id: string;
  name: string;
  type: string;
  avatar_url: string | null;
}

// POST /api/threads/[id]/posts — Create a new post in a thread
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await authenticateRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const threadId = params.id;
  const { body, replyTo } = await req.json();

  if (!body) {
    return NextResponse.json({ error: "body is required" }, { status: 400 });
  }

  // Verify thread exists
  const thread = await queryOne<{ id: string }>(
    `SELECT id FROM threads WHERE id = $1`,
    [threadId]
  );

  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  // Extract mentions
  const mentions = extractMentions(body);

  // Create post
  const post = await queryOne<PostRow>(
    `INSERT INTO posts (thread_id, author_id, body, reply_to_id, mentions)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [threadId, auth.user.id, body, replyTo || null, mentions]
  );

  if (!post) {
    return NextResponse.json({ error: "Failed to create post" }, { status: 500 });
  }

  // Get author info
  const author = await queryOne<AuthorRow>(
    `SELECT id, name, type, avatar_url FROM users WHERE id = $1`,
    [auth.user.id]
  );

  // Update read marker for poster
  await query(
    `INSERT INTO read_markers (user_id, thread_id, last_read_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id, thread_id) DO UPDATE SET last_read_at = NOW()`,
    [auth.user.id, threadId]
  );

  return NextResponse.json({ ...post, author }, { status: 201 });
}
