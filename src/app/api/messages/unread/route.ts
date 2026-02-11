export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { queryOne, queryAll } from "@/lib/db";

interface UnreadCountRow {
  count: string;
}

interface UnreadByConversation {
  conversation_id: string;
  count: string;
  latest_intent: string;
  latest_from: string;
  latest_created: string;
}

/**
 * GET /api/messages/unread — Unread message count for authenticated user
 *
 * Returns:
 * - total: total unread count
 * - by_conversation: breakdown by conversation_id
 * - urgent: count of unread urgent messages
 */
export async function GET(req: NextRequest) {
  const auth = await authenticateRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Total unread
  const total = await queryOne<UnreadCountRow>(
    `SELECT COUNT(*) as count FROM direct_messages
     WHERE to_id = $1 AND read_at IS NULL`,
    [auth.user.id]
  );

  // Urgent unread
  const urgent = await queryOne<UnreadCountRow>(
    `SELECT COUNT(*) as count FROM direct_messages
     WHERE to_id = $1 AND read_at IS NULL AND priority = 'urgent'`,
    [auth.user.id]
  );

  // Breakdown by conversation
  const byConversation = await queryAll<UnreadByConversation>(
    `SELECT
       dm.conversation_id,
       COUNT(*) as count,
       (SELECT intent FROM direct_messages d2
        WHERE d2.conversation_id = dm.conversation_id
        ORDER BY d2.created_at DESC LIMIT 1) as latest_intent,
       (SELECT fu.name FROM direct_messages d3
        JOIN users fu ON fu.id = d3.from_id
        WHERE d3.conversation_id = dm.conversation_id
        ORDER BY d3.created_at DESC LIMIT 1) as latest_from,
       MAX(dm.created_at) as latest_created
     FROM direct_messages dm
     WHERE dm.to_id = $1 AND dm.read_at IS NULL
     GROUP BY dm.conversation_id
     ORDER BY latest_created DESC`,
    [auth.user.id]
  );

  return NextResponse.json({
    total: parseInt(total?.count || "0"),
    urgent: parseInt(urgent?.count || "0"),
    by_conversation: byConversation.map((c) => ({
      conversation_id: c.conversation_id,
      count: parseInt(c.count),
      latest_intent: c.latest_intent,
      latest_from: c.latest_from,
      latest_created: c.latest_created,
    })),
  });
}
