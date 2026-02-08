export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { DigestResponse, Post } from "@/lib/types";

const TOKEN_BUDGET = 2000;
const RECENT_POST_COUNT = 5;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function formatPostForDigest(post: Post): string {
  const author = post.author?.name || "Unknown";
  return `[${author}] ${post.body}`;
}

async function summarizePosts(posts: Post[]): Promise<string> {
  const text = posts.map(formatPostForDigest).join("\n\n");

  // If OpenAI key is available, use it for summarization
  if (process.env.OPENAI_API_KEY) {
    try {
      const { default: OpenAI } = await import("openai");
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "Summarize these forum posts concisely. Preserve key points, decisions, and who said what. Keep it under 500 tokens.",
          },
          { role: "user", content: text },
        ],
        max_tokens: 500,
      });
      return response.choices[0]?.message?.content || text;
    } catch {
      // Fall through to truncation
    }
  }

  // Fallback: truncate
  const maxChars = TOKEN_BUDGET * 4;
  if (text.length > maxChars) {
    return text.slice(0, maxChars) + "\n\n[...truncated]";
  }
  return text;
}

// GET /api/digest — Smart digest for agents
export async function GET(req: NextRequest) {
  const auth = await authenticateRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const searchParams = req.nextUrl.searchParams;
  const threadFilter = searchParams.get("thread");
  const fullMode = searchParams.get("full") === "true";
  const limit = parseInt(searchParams.get("limit") || "0") || 0;

  // Get user's last global read time from read_markers
  const { data: markers } = await supabase
    .from("read_markers")
    .select("*")
    .eq("user_id", auth.user.id);

  // Build posts query — get unread posts
  let postsQuery = supabase
    .from("posts")
    .select("*, author:users!author_id(id, name, type, avatar_url)")
    .order("created_at", { ascending: true });

  if (threadFilter) {
    postsQuery = postsQuery.eq("thread_id", threadFilter);

    // Filter by that thread's read marker
    const threadMarker = (markers || []).find(
      (m) => m.thread_id === threadFilter
    );
    if (threadMarker) {
      postsQuery = postsQuery.gt("created_at", threadMarker.last_read_at);
    }
  } else {
    // Get posts from all threads that are newer than their respective read markers
    // If no marker exists for a thread, include all its posts
    // We'll filter in-memory since we need per-thread markers
  }

  if (limit > 0) {
    postsQuery = postsQuery.limit(limit);
  }

  const { data: allPosts, error } = await postsQuery;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Filter unread posts per-thread if no specific thread filter
  let unreadPosts = allPosts || [];
  if (!threadFilter && markers && markers.length > 0) {
    const markerMap = new Map(
      markers.map((m) => [m.thread_id, m.last_read_at])
    );
    unreadPosts = unreadPosts.filter((post) => {
      const marker = markerMap.get(post.thread_id);
      if (!marker) return true; // no marker = never read = all unread
      return new Date(post.created_at) > new Date(marker);
    });
  }

  const totalTokens = unreadPosts.reduce(
    (sum, p) => sum + estimateTokens(formatPostForDigest(p as Post)),
    0
  );

  // Get unique threads
  const threadIds = [...new Set(unreadPosts.map((p) => p.thread_id))];
  const { data: threads } = await supabase
    .from("threads")
    .select("id, title, category")
    .in("id", threadIds.length > 0 ? threadIds : ["none"]);

  // If under budget or full mode, return everything
  if (fullMode || totalTokens <= TOKEN_BUDGET) {
    const response: DigestResponse = {
      unread_count: unreadPosts.length,
      token_estimate: totalTokens,
      truncated: false,
      posts: unreadPosts as Post[],
      threads: threads || [],
    };

    // Update read markers
    await updateReadMarkers(supabase, auth.user.id, unreadPosts);

    return NextResponse.json(response);
  }

  // Over budget: split into mentioned posts, recent posts, and older posts to summarize
  const userName = auth.user.name;
  const mentionedPosts = unreadPosts.filter(
    (p) => p.mentions && p.mentions.includes(userName)
  );
  const nonMentionedPosts = unreadPosts.filter(
    (p) => !p.mentions || !p.mentions.includes(userName)
  );

  // Take the most recent posts in full
  const recentPosts = nonMentionedPosts.slice(-RECENT_POST_COUNT);
  const olderPosts = nonMentionedPosts.slice(0, -RECENT_POST_COUNT);

  // Summarize older posts
  let summary: string | undefined;
  if (olderPosts.length > 0) {
    summary = await summarizePosts(olderPosts as Post[]);
  }

  // Combine: mentioned posts always in full + recent posts in full
  const fullPosts = [...mentionedPosts, ...recentPosts];

  const response: DigestResponse = {
    unread_count: unreadPosts.length,
    token_estimate: totalTokens,
    truncated: true,
    summary,
    posts: fullPosts as Post[],
    threads: threads || [],
  };

  // Update read markers
  await updateReadMarkers(supabase, auth.user.id, unreadPosts);

  return NextResponse.json(response);
}

async function updateReadMarkers(
  supabase: ReturnType<typeof createServiceClient>,
  userId: string,
  posts: Array<{ thread_id: string; created_at: string }>
) {
  // Group by thread and get latest timestamp per thread
  const latestByThread = new Map<string, string>();
  for (const post of posts) {
    const current = latestByThread.get(post.thread_id);
    if (!current || new Date(post.created_at) > new Date(current)) {
      latestByThread.set(post.thread_id, post.created_at);
    }
  }

  // Upsert read markers
  const upserts = Array.from(latestByThread.entries()).map(
    ([threadId, lastRead]) => ({
      user_id: userId,
      thread_id: threadId,
      last_read_at: lastRead,
    })
  );

  if (upserts.length > 0) {
    await supabase.from("read_markers").upsert(upserts);
  }
}
