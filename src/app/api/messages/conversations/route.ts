export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { queryAll } from "@/lib/db";

interface ConversationRow {
  conversation_id: string;
  other_user_id: string;
  other_user_name: string;
  other_user_type: string;
  last_message_body: string;
  last_message_at: string;
  last_message_from_id: string;
  last_intent: string;
  last_priority: string;
  unread_count: string;
  total_count: string;
}

/**
 * GET /api/messages/conversations — List all conversations for a user
 *
 * Human users (type "human") see ALL conversations (admin visibility).
 * Agent users see only their own conversations.
 *
 * Returns conversations sorted by most recent message.
 */
export async function GET(req: NextRequest) {
  const auth = await authenticateRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isAdmin = auth.user.type === "human";

  // For humans: show ALL conversations. For agents: show only their conversations.
  const conversations = isAdmin
    ? await queryAll<ConversationRow>(
        `WITH conv_summary AS (
          SELECT DISTINCT ON (dm.conversation_id)
            dm.conversation_id,
            dm.body as last_message_body,
            dm.created_at as last_message_at,
            dm.from_id as last_message_from_id,
            dm.intent as last_intent,
            dm.priority as last_priority
          FROM direct_messages dm
          ORDER BY dm.conversation_id, dm.created_at DESC
        ),
        conv_participants AS (
          SELECT
            dm.conversation_id,
            CASE
              WHEN dm.from_id != $1 THEN dm.from_id
              ELSE dm.to_id
            END as other_user_id
          FROM direct_messages dm
          GROUP BY dm.conversation_id, other_user_id
        ),
        conv_unread AS (
          SELECT
            dm.conversation_id,
            COUNT(*) FILTER (WHERE dm.read_at IS NULL AND dm.to_id = $1) as unread_count,
            COUNT(*) as total_count
          FROM direct_messages dm
          GROUP BY dm.conversation_id
        )
        SELECT
          cs.conversation_id,
          COALESCE(cp.other_user_id, cs.last_message_from_id) as other_user_id,
          u.name as other_user_name,
          u.type as other_user_type,
          cs.last_message_body,
          cs.last_message_at,
          cs.last_message_from_id,
          cs.last_intent,
          cs.last_priority,
          COALESCE(cu.unread_count, 0) as unread_count,
          COALESCE(cu.total_count, 0) as total_count
        FROM conv_summary cs
        LEFT JOIN conv_participants cp ON cp.conversation_id = cs.conversation_id
        LEFT JOIN conv_unread cu ON cu.conversation_id = cs.conversation_id
        LEFT JOIN users u ON u.id = COALESCE(cp.other_user_id, cs.last_message_from_id)
        ORDER BY cs.last_message_at DESC`,
        [auth.user.id]
      )
    : await queryAll<ConversationRow>(
        `WITH my_conversations AS (
          SELECT DISTINCT conversation_id
          FROM direct_messages
          WHERE from_id = $1 OR to_id = $1
        ),
        conv_summary AS (
          SELECT DISTINCT ON (dm.conversation_id)
            dm.conversation_id,
            dm.body as last_message_body,
            dm.created_at as last_message_at,
            dm.from_id as last_message_from_id,
            dm.intent as last_intent,
            dm.priority as last_priority,
            CASE
              WHEN dm.from_id = $1 THEN dm.to_id
              ELSE dm.from_id
            END as other_user_id
          FROM direct_messages dm
          JOIN my_conversations mc ON mc.conversation_id = dm.conversation_id
          ORDER BY dm.conversation_id, dm.created_at DESC
        ),
        conv_unread AS (
          SELECT
            dm.conversation_id,
            COUNT(*) FILTER (WHERE dm.read_at IS NULL AND dm.to_id = $1) as unread_count,
            COUNT(*) as total_count
          FROM direct_messages dm
          JOIN my_conversations mc ON mc.conversation_id = dm.conversation_id
          GROUP BY dm.conversation_id
        )
        SELECT
          cs.conversation_id,
          cs.other_user_id,
          u.name as other_user_name,
          u.type as other_user_type,
          cs.last_message_body,
          cs.last_message_at,
          cs.last_message_from_id,
          cs.last_intent,
          cs.last_priority,
          COALESCE(cu.unread_count, 0) as unread_count,
          COALESCE(cu.total_count, 0) as total_count
        FROM conv_summary cs
        LEFT JOIN conv_unread cu ON cu.conversation_id = cs.conversation_id
        LEFT JOIN users u ON u.id = cs.other_user_id
        ORDER BY cs.last_message_at DESC`,
        [auth.user.id]
      );

  return NextResponse.json({
    conversations: conversations.map((c) => ({
      conversation_id: c.conversation_id,
      other_user: {
        id: c.other_user_id,
        name: c.other_user_name,
        type: c.other_user_type,
      },
      last_message: {
        body: c.last_message_body,
        at: c.last_message_at,
        from_id: c.last_message_from_id,
        intent: c.last_intent,
        priority: c.last_priority,
      },
      unread_count: parseInt(c.unread_count as string) || 0,
      total_count: parseInt(c.total_count as string) || 0,
    })),
  });
}
