export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

// GET /api/threads/[id] — Get thread with all posts
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await authenticateRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const threadId = params.id;

  // Get thread
  const { data: thread, error: threadError } = await supabase
    .from("threads")
    .select("*, author:users!author_id(id, name, type, avatar_url)")
    .eq("id", threadId)
    .single();

  if (threadError || !thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  // Get posts with authors
  const { data: posts, error: postsError } = await supabase
    .from("posts")
    .select("*, author:users!author_id(id, name, type, avatar_url)")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });

  if (postsError) {
    return NextResponse.json({ error: postsError.message }, { status: 500 });
  }

  // Update read marker
  await supabase.from("read_markers").upsert({
    user_id: auth.user.id,
    thread_id: threadId,
    last_read_at: new Date().toISOString(),
  });

  return NextResponse.json({ ...thread, posts: posts || [] });
}
