export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest, extractMentions } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

// GET /api/threads — List all threads with author and post count
export async function GET(req: NextRequest) {
  const auth = await authenticateRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const category = req.nextUrl.searchParams.get("category");

  let query = supabase
    .from("threads")
    .select("*, author:users!author_id(id, name, type, avatar_url)")
    .order("pinned", { ascending: false })
    .order("last_activity", { ascending: false });

  if (category) {
    query = query.eq("category", category);
  }

  const { data: threads, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Get post counts and unread counts for each thread
  const threadIds = (threads || []).map((t) => t.id);

  const { data: postCounts } = await supabase.rpc("get_post_counts", {
    thread_ids: threadIds,
  });

  // Get read markers for current user
  const { data: readMarkers } = await supabase
    .from("read_markers")
    .select("*")
    .eq("user_id", auth.user.id)
    .in("thread_id", threadIds);

  const readMap = new Map(
    (readMarkers || []).map((m) => [m.thread_id, m.last_read_at])
  );
  const countMap = new Map(
    (postCounts || []).map((c: { thread_id: string; count: number }) => [
      c.thread_id,
      c.count,
    ])
  );

  const enriched = (threads || []).map((thread) => {
    const postCount = countMap.get(thread.id) || 0;
    return {
      ...thread,
      post_count: postCount,
      has_unread: readMap.has(thread.id)
        ? new Date(thread.last_activity) > new Date(readMap.get(thread.id)!)
        : true,
    };
  });

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

  const validCategories = [
    "general",
    "projects",
    "philosophy",
    "chronicle",
    "random",
  ];
  if (category && !validCategories.includes(category)) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Create thread
  const { data: thread, error: threadError } = await supabase
    .from("threads")
    .insert({
      title,
      category: category || "general",
      author_id: auth.user.id,
    })
    .select()
    .single();

  if (threadError) {
    return NextResponse.json({ error: threadError.message }, { status: 500 });
  }

  // Create first post
  const mentions = extractMentions(body);
  const { data: post, error: postError } = await supabase
    .from("posts")
    .insert({
      thread_id: thread.id,
      author_id: auth.user.id,
      body,
      mentions,
    })
    .select("*, author:users!author_id(id, name, type, avatar_url)")
    .single();

  if (postError) {
    return NextResponse.json({ error: postError.message }, { status: 500 });
  }

  // Mark as read for the creator
  await supabase.from("read_markers").upsert({
    user_id: auth.user.id,
    thread_id: thread.id,
    last_read_at: new Date().toISOString(),
  });

  return NextResponse.json({ ...thread, posts: [post] }, { status: 201 });
}
