export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest, extractMentions } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

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

  const supabase = createServiceClient();

  // Verify thread exists
  const { data: thread } = await supabase
    .from("threads")
    .select("id")
    .eq("id", threadId)
    .single();

  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  // Extract mentions
  const mentions = extractMentions(body);

  // Create post
  const { data: post, error } = await supabase
    .from("posts")
    .insert({
      thread_id: threadId,
      author_id: auth.user.id,
      body,
      reply_to_id: replyTo || null,
      mentions,
    })
    .select("*, author:users!author_id(id, name, type, avatar_url)")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Update read marker for poster
  await supabase.from("read_markers").upsert({
    user_id: auth.user.id,
    thread_id: threadId,
    last_read_at: new Date().toISOString(),
  });

  return NextResponse.json(post, { status: 201 });
}
