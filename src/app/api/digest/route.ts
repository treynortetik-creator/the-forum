export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { query, queryAll } from "@/lib/db";
import { DigestResponse, Post } from "@/lib/types";

const TOKEN_BUDGET = 2000;
const RECENT_POST_COUNT = 5;

interface ReadMarkerRow {
  user_id: string;
  thread_id: string;
  last_read_at: string;
}

interface PostRow {
  id: string;
  thread_id: string;
  author_id: string;
  body: string;
  reply_to_id: string | null;
  mentions: string[];
  created_at: string;
  author: { id: string; name: string; type: string; avatar_url: string | null };
}

interface ThreadSummaryRow {
  id: string;
  title: string;
  category: string;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function formatPostForDigest(post: Post): string {
  const author = post.author?.name || "Unknown";
  return `[${author}] ${post.body}`;
}

async function summarizePosts(posts: Post[]): Promise<string> {
  const text = posts.map(formatPostForDigest).join("\n\n");

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

  const searchParams = req.nextUrl.searchParams;
  const threadFilter = searchParams.get("thread");
  const fullMode = searchParams.get("full") === "true";
  const limit = Math.max(parseInt(searchParams.get("limit") || "0") || 0, 0);

  // Validate thread filter is a UUID if provided
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (threadFilter && !uuidRegex.test(threadFilter)) {
    return NextResponse.json({ error: "Invalid thread UUID format" }, { status: 400 });
  }

  // Get user's read markers
  const markers = await queryAll<ReadMarkerRow>(
    `SELECT * FROM read_markers WHERE user_id = $1`,
    [auth.user.id]
  );

  // Build posts query
  let postsSQL: string;
  let postsParams: unknown[];

  if (threadFilter) {
    const threadMarker = markers.find((m) => m.thread_id === threadFilter);
    if (threadMarker) {
      postsSQL = `
        SELECT p.*,
          json_build_object('id', u.id, 'name', u.name, 'type', u.type, 'avatar_url', u.avatar_url) as author
        FROM posts p
        JOIN users u ON u.id = p.author_id
        WHERE p.thread_id = $1 AND p.created_at > $2
        ORDER BY p.created_at ASC
      `;
      postsParams = [threadFilter, threadMarker.last_read_at];
    } else {
      postsSQL = `
        SELECT p.*,
          json_build_object('id', u.id, 'name', u.name, 'type', u.type, 'avatar_url', u.avatar_url) as author
        FROM posts p
        JOIN users u ON u.id = p.author_id
        WHERE p.thread_id = $1
        ORDER BY p.created_at ASC
      `;
      postsParams = [threadFilter];
    }
  } else {
    postsSQL = `
      SELECT p.*,
        json_build_object('id', u.id, 'name', u.name, 'type', u.type, 'avatar_url', u.avatar_url) as author
      FROM posts p
      JOIN users u ON u.id = p.author_id
      ORDER BY p.created_at ASC
    `;
    postsParams = [];
  }

  if (limit > 0) {
    postsParams.push(limit);
    postsSQL += ` LIMIT $${postsParams.length}`;
  }

  const allPosts = await queryAll<PostRow>(postsSQL, postsParams);

  // Filter unread posts per-thread if no specific thread filter
  let unreadPosts: PostRow[] = allPosts;
  if (!threadFilter && markers.length > 0) {
    const markerMap = new Map(
      markers.map((m) => [m.thread_id, m.last_read_at])
    );
    unreadPosts = unreadPosts.filter((post) => {
      const marker = markerMap.get(post.thread_id);
      if (!marker) return true;
      return new Date(post.created_at) > new Date(marker);
    });
  }

  const totalTokens = unreadPosts.reduce(
    (sum, p) => sum + estimateTokens(formatPostForDigest(p as unknown as Post)),
    0
  );

  // Get unique threads
  const threadIds = [...new Set(unreadPosts.map((p) => p.thread_id))];
  const threads =
    threadIds.length > 0
      ? await queryAll<ThreadSummaryRow>(
          `SELECT id, title, category FROM threads WHERE id = ANY($1)`,
          [threadIds]
        )
      : [];

  // If under budget or full mode, return everything
  if (fullMode || totalTokens <= TOKEN_BUDGET) {
    const response: DigestResponse = {
      unread_count: unreadPosts.length,
      token_estimate: totalTokens,
      truncated: false,
      posts: unreadPosts as unknown as Post[],
      threads,
    };

    await updateReadMarkers(auth.user.id, unreadPosts);
    return NextResponse.json(response);
  }

  // Over budget: split
  const userName = auth.user.name;
  const mentionedPosts = unreadPosts.filter(
    (p) => p.mentions && p.mentions.includes(userName)
  );
  const nonMentionedPosts = unreadPosts.filter(
    (p) => !p.mentions || !p.mentions.includes(userName)
  );

  const recentPosts = nonMentionedPosts.slice(-RECENT_POST_COUNT);
  const olderPosts = nonMentionedPosts.slice(0, -RECENT_POST_COUNT);

  let summary: string | undefined;
  if (olderPosts.length > 0) {
    summary = await summarizePosts(olderPosts as unknown as Post[]);
  }

  const fullPosts = [...mentionedPosts, ...recentPosts];

  const response: DigestResponse = {
    unread_count: unreadPosts.length,
    token_estimate: totalTokens,
    truncated: true,
    summary,
    posts: fullPosts as unknown as Post[],
    threads,
  };

  await updateReadMarkers(auth.user.id, unreadPosts);
  return NextResponse.json(response);
}

async function updateReadMarkers(
  userId: string,
  posts: Array<{ thread_id: string; created_at: string }>
) {
  const latestByThread = new Map<string, string>();
  for (const post of posts) {
    const current = latestByThread.get(post.thread_id);
    if (!current || new Date(post.created_at) > new Date(current)) {
      latestByThread.set(post.thread_id, post.created_at);
    }
  }

  for (const [threadId, lastRead] of latestByThread.entries()) {
    await query(
      `INSERT INTO read_markers (user_id, thread_id, last_read_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, thread_id) DO UPDATE SET last_read_at = $3`,
      [userId, threadId, lastRead]
    );
  }
}
