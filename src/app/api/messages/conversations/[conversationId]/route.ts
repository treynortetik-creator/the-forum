export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { query, queryOne, queryAll } from "@/lib/db";
import { logAuditEvent, getAuditContext } from "@/lib/audit";

interface DMRow {
  id: string;
  from_id: string;
  to_id: string;
  body: string;
  priority: string;
  read_at: string | null;
  created_at: string;
  conversation_id: string;
  intent: string;
  metadata: Record<string, unknown>;
}

/**
 * PATCH /api/messages/conversations/:conversationId — Mark all unread messages in conversation as read
 *
 * Only the recipient of messages can mark them as read.
 * This endpoint marks all unread messages in the specified conversation as read for the authenticated user.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { conversationId: string } }
) {
  const audit = getAuditContext(req);
  const auth = await authenticateRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { conversationId } = params;

  // Check if conversation exists and get unread messages for this user
  const unreadMessages = await queryAll<DMRow>(
    `SELECT * FROM direct_messages 
     WHERE conversation_id = $1 AND to_id = $2 AND read_at IS NULL
     ORDER BY created_at DESC`,
    [conversationId, auth.user.id]
  );

  if (unreadMessages.length === 0) {
    return NextResponse.json(
      { 
        message: "No unread messages in this conversation",
        conversation_id: conversationId,
        marked_read_count: 0
      },
      { status: 200 }
    );
  }

  // Mark all unread messages as read
  const updatedMessages = await queryAll<DMRow>(
    `UPDATE direct_messages 
     SET read_at = NOW() 
     WHERE conversation_id = $1 AND to_id = $2 AND read_at IS NULL 
     RETURNING *`,
    [conversationId, auth.user.id]
  );

  // Audit: bulk message read
  await logAuditEvent({
    event_type: "conversation_marked_read",
    agent_id: auth.user.id,
    ip_address: audit.ip,
    user_agent: audit.userAgent,
    details: {
      conversation_id: conversationId,
      messages_marked_read: updatedMessages.length,
      message_ids: updatedMessages.map(m => m.id),
    },
  });

  return NextResponse.json({
    conversation_id: conversationId,
    marked_read_count: updatedMessages.length,
    messages: updatedMessages,
  });
}

/**
 * DELETE /api/messages/conversations/:conversationId — Delete entire DM conversation
 * Human users can delete any conversation. Agents can only delete conversations they're part of.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { conversationId: string } }
) {
  const audit = getAuditContext(req);
  const auth = await authenticateRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { conversationId } = params;

  // Check conversation exists
  const msgCount = await queryOne<{ count: string }>(
    `SELECT COUNT(*) as count FROM direct_messages WHERE conversation_id = $1`,
    [conversationId]
  );

  if (!msgCount || parseInt(msgCount.count) === 0) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  // Non-admin: verify they're part of this conversation
  const isAdmin = auth.user.type === "human";
  if (!isAdmin) {
    const participation = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM direct_messages 
       WHERE conversation_id = $1 AND (from_id = $2 OR to_id = $2)`,
      [conversationId, auth.user.id]
    );
    if (!participation || parseInt(participation.count) === 0) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // Delete all messages in the conversation
  await query(`DELETE FROM direct_messages WHERE conversation_id = $1`, [conversationId]);

  // Clean up loop state if exists
  await query(`DELETE FROM dm_loop_state WHERE conversation_id = $1`, [conversationId]);

  await logAuditEvent({
    event_type: "conversation_deleted",
    agent_id: auth.user.id,
    ip_address: audit.ip,
    user_agent: audit.userAgent,
    details: {
      conversation_id: conversationId,
      messages_deleted: parseInt(msgCount.count),
      deleted_by: auth.user.name,
    },
  });

  return NextResponse.json({
    deleted: true,
    conversationId,
    messagesDeleted: parseInt(msgCount.count),
  });
}