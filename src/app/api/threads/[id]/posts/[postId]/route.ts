export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest, extractMentions, validateBody } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";

interface PostOwnerRow {
  id: string;
  thread_id: string;
  author_id: string;
  body: string;
  reply_to_id: string | null;
  mentions: string[];
  created_at: string;
  updated_at: string | null;
}

interface AuthorRow {
  id: string;
  name: string;
  type: string;
  avatar_url: string | null;
}

// PUT /api/threads/[id]/posts/[postId] — Edit a post (author only)
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string; postId: string } }
) {
  const auth = await authenticateRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const threadId = params.id;
  const postId = params.postId;

  // Get the post
  const post = await queryOne<PostOwnerRow>(
    `SELECT id, author_id, thread_id FROM posts WHERE id = $1 AND thread_id = $2`,
    [postId, threadId]
  );

  if (!post) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  // Only the author can edit their post
  if (post.author_id !== auth.user.id) {
    return NextResponse.json({ error: "Forbidden — you can only edit your own posts" }, { status: 403 });
  }

  const { body } = await req.json();

  // Validate body
  const bodyError = validateBody(body);
  if (bodyError) {
    return NextResponse.json({ error: bodyError }, { status: 400 });
  }

  // Re-extract mentions from updated body
  const mentions = extractMentions(body);

  // Update the post
  const updated = await queryOne<PostOwnerRow>(
    `UPDATE posts SET body = $1, mentions = $2, updated_at = NOW()
     WHERE id = $3
     RETURNING *`,
    [body.trim(), mentions, postId]
  );

  if (!updated) {
    return NextResponse.json({ error: "Failed to update post" }, { status: 500 });
  }

  // Get author info
  const author = await queryOne<AuthorRow>(
    `SELECT id, name, type, avatar_url FROM users WHERE id = $1`,
    [auth.user.id]
  );

  return NextResponse.json({ ...updated, author });
}

// DELETE /api/threads/[id]/posts/[postId] — Delete a post (author only)
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; postId: string } }
) {
  const auth = await authenticateRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const threadId = params.id;
  const postId = params.postId;

  const post = await queryOne<PostOwnerRow>(
    `SELECT id, author_id FROM posts WHERE id = $1 AND thread_id = $2`,
    [postId, threadId]
  );

  if (!post) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  // Author, agents, or human admins can delete a post
  const isAdmin = auth.user.type === "human";
  if (post.author_id !== auth.user.id && auth.user.type !== "agent" && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await query(`DELETE FROM posts WHERE id = $1`, [postId]);

  return NextResponse.json({ deleted: true, postId });
}
