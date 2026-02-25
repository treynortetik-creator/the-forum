export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { queryAll, queryOne } from "@/lib/db";
import { CATEGORIES } from "@/lib/types";

interface SearchResultRow {
  thread_id: string;
  thread_title: string;
  thread_category: string;
  thread_pinned: boolean;
  thread_last_activity: string;
  post_id: string;
  post_body: string;
  post_created_at: string;
  author_id: string;
  author_name: string;
  author_type: string;
}

// GET /api/threads/search?q=term — Search across thread titles and post bodies
// Query params: q (required), category (optional), limit (default 20, max 50), offset (default 0)
export async function GET(req: NextRequest) {
  const auth = await authenticateRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchTerm = req.nextUrl.searchParams.get("q");
  if (!searchTerm || searchTerm.trim().length === 0) {
    return NextResponse.json({ error: "Search query 'q' is required" }, { status: 400 });
  }

  if (searchTerm.length > 200) {
    return NextResponse.json({ error: "Search query too long (max 200 characters)" }, { status: 400 });
  }

  const category = req.nextUrl.searchParams.get("category");
  const limit = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get("limit") || "20") || 20, 1), 50);
  const offset = Math.max(parseInt(req.nextUrl.searchParams.get("offset") || "0") || 0, 0);

  // Use ILIKE for case-insensitive search with wildcards
  const searchPattern = `%${searchTerm.trim()}%`;

  let results: SearchResultRow[];
  let totalCount: number;

  if (category) {
    if (!(CATEGORIES as readonly string[]).includes(category)) {
      return NextResponse.json({ error: "Invalid category" }, { status: 400 });
    }

    results = await queryAll<SearchResultRow>(
      `SELECT DISTINCT ON (t.id)
        t.id as thread_id,
        t.title as thread_title,
        t.category as thread_category,
        t.pinned as thread_pinned,
        t.last_activity as thread_last_activity,
        p.id as post_id,
        p.body as post_body,
        p.created_at as post_created_at,
        u.id as author_id,
        u.name as author_name,
        u.type as author_type
      FROM threads t
      LEFT JOIN posts p ON p.thread_id = t.id
      JOIN users u ON u.id = COALESCE(p.author_id, t.author_id)
      WHERE t.category = $1
        AND (t.title ILIKE $2 OR p.body ILIKE $2)
      ORDER BY t.id, t.last_activity DESC
      LIMIT $3 OFFSET $4`,
      [category, searchPattern, limit, offset]
    );

    const countResult = await queryOne<{ count: string }>(
      `SELECT COUNT(DISTINCT t.id) as count
       FROM threads t
       LEFT JOIN posts p ON p.thread_id = t.id
       WHERE t.category = $1
         AND (t.title ILIKE $2 OR p.body ILIKE $2)`,
      [category, searchPattern]
    );
    totalCount = parseInt(countResult?.count || "0");
  } else {
    results = await queryAll<SearchResultRow>(
      `SELECT DISTINCT ON (t.id)
        t.id as thread_id,
        t.title as thread_title,
        t.category as thread_category,
        t.pinned as thread_pinned,
        t.last_activity as thread_last_activity,
        p.id as post_id,
        p.body as post_body,
        p.created_at as post_created_at,
        u.id as author_id,
        u.name as author_name,
        u.type as author_type
      FROM threads t
      LEFT JOIN posts p ON p.thread_id = t.id
      JOIN users u ON u.id = COALESCE(p.author_id, t.author_id)
      WHERE t.title ILIKE $1 OR p.body ILIKE $1
      ORDER BY t.id, t.last_activity DESC
      LIMIT $2 OFFSET $3`,
      [searchPattern, limit, offset]
    );

    const countResult = await queryOne<{ count: string }>(
      `SELECT COUNT(DISTINCT t.id) as count
       FROM threads t
       LEFT JOIN posts p ON p.thread_id = t.id
       WHERE t.title ILIKE $1 OR p.body ILIKE $1`,
      [searchPattern]
    );
    totalCount = parseInt(countResult?.count || "0");
  }

  // Format results
  const formatted = results.map((r) => ({
    thread: {
      id: r.thread_id,
      title: r.thread_title,
      category: r.thread_category,
      pinned: r.thread_pinned,
      last_activity: r.thread_last_activity,
    },
    matching_post: r.post_id
      ? {
          id: r.post_id,
          body: r.post_body.length > 300 ? r.post_body.slice(0, 300) + "..." : r.post_body,
          created_at: r.post_created_at,
          author: {
            id: r.author_id,
            name: r.author_name,
            type: r.author_type,
          },
        }
      : null,
  }));

  return NextResponse.json({
    query: searchTerm.trim(),
    results: formatted,
    pagination: {
      total: totalCount,
      limit,
      offset,
      hasMore: offset + limit < totalCount,
    },
  });
}
