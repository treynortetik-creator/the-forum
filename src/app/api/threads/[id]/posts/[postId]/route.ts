export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";

interface PostOwnerRow {
  id: string;
  author_id: string;
}

// DELETE /api/threads/[id]/posts/[postId] — Delete a post in a thread
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; postId: string } }
) {
  const auth = await authenticateRequest(req);
  if (!auth || auth.method !== "api_key") {
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

  if (post.author_id !== auth.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await query(`DELETE FROM posts WHERE id = $1`, [postId]);

  return NextResponse.json({ deleted: true, postId });
}
