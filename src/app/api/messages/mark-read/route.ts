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

interface MarkReadRequest {
  conversation_id?: string;
  message_ids?: string[];
}

/**
 * POST /api/messages/mark-read — Flexible mark-read endpoint
 * 
 * Accepts either:
 * - { conversation_id: string } — marks all unread messages in conversation as read
 * - { message_ids: string[] } — marks specific messages as read
 * 
 * Only the recipient of messages can mark them as read.
 */
export async function POST(req: NextRequest) {
  const audit = getAuditContext(req);
  const auth = await authenticateRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: MarkReadRequest;
  try {
    body = await req.json();
  } catch (error) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { conversation_id, message_ids } = body;

  // Validate input - must provide either conversation_id or message_ids
  if (!conversation_id && (!message_ids || message_ids.length === 0)) {
    return NextResponse.json(
      { error: "Must provide either conversation_id or message_ids" },
      { status: 400 }
    );
  }

  if (conversation_id && message_ids) {
    return NextResponse.json(
      { error: "Cannot provide both conversation_id and message_ids" },
      { status: 400 }
    );
  }

  let updatedMessages: DMRow[] = [];

  if (conversation_id) {
    // Mark all unread messages in conversation as read
    const unreadMessages = await queryAll<DMRow>(
      `SELECT * FROM direct_messages 
       WHERE conversation_id = $1 AND to_id = $2 AND read_at IS NULL`,
      [conversation_id, auth.user.id]
    );

    if (unreadMessages.length === 0) {
      return NextResponse.json({
        method: "conversation",
        conversation_id,
        marked_read_count: 0,
        message: "No unread messages in this conversation",
      });
    }

    updatedMessages = await queryAll<DMRow>(
      `UPDATE direct_messages 
       SET read_at = NOW() 
       WHERE conversation_id = $1 AND to_id = $2 AND read_at IS NULL 
       RETURNING *`,
      [conversation_id, auth.user.id]
    );

    // Audit: conversation mark-read
    await logAuditEvent({
      event_type: "conversation_marked_read_bulk",
      agent_id: auth.user.id,
      ip_address: audit.ip,
      user_agent: audit.userAgent,
      details: {
        conversation_id,
        messages_marked_read: updatedMessages.length,
        message_ids: updatedMessages.map(m => m.id),
      },
    });

    return NextResponse.json({
      method: "conversation",
      conversation_id,
      marked_read_count: updatedMessages.length,
      messages: updatedMessages,
    });
  } else if (message_ids) {
    // Mark specific messages as read
    if (message_ids.length > 100) {
      return NextResponse.json(
        { error: "Cannot mark more than 100 messages at once" },
        { status: 400 }
      );
    }

    // Verify all messages exist and user is the recipient
    const messagesToUpdate = await queryAll<DMRow>(
      `SELECT * FROM direct_messages 
       WHERE id = ANY($1) AND to_id = $2`,
      [message_ids, auth.user.id]
    );

    if (messagesToUpdate.length === 0) {
      return NextResponse.json(
        { error: "No valid messages found for the authenticated user" },
        { status: 404 }
      );
    }

    if (messagesToUpdate.length !== message_ids.length) {
      const foundIds = messagesToUpdate.map(m => m.id);
      const notFoundIds = message_ids.filter(id => !foundIds.includes(id));
      return NextResponse.json(
        { 
          error: "Some messages not found or not owned by user",
          not_found_ids: notFoundIds,
          found_count: messagesToUpdate.length,
          requested_count: message_ids.length,
        },
        { status: 404 }
      );
    }

    // Filter out already read messages
    const unreadMessages = messagesToUpdate.filter(m => m.read_at === null);
    
    if (unreadMessages.length === 0) {
      return NextResponse.json({
        method: "specific_messages",
        message_ids,
        marked_read_count: 0,
        message: "All specified messages were already read",
      });
    }

    // Update only unread messages
    const unreadIds = unreadMessages.map(m => m.id);
    updatedMessages = await queryAll<DMRow>(
      `UPDATE direct_messages 
       SET read_at = NOW() 
       WHERE id = ANY($1) AND to_id = $2 AND read_at IS NULL 
       RETURNING *`,
      [unreadIds, auth.user.id]
    );

    // Audit: specific messages mark-read
    await logAuditEvent({
      event_type: "messages_marked_read_bulk",
      agent_id: auth.user.id,
      ip_address: audit.ip,
      user_agent: audit.userAgent,
      details: {
        messages_marked_read: updatedMessages.length,
        message_ids: updatedMessages.map(m => m.id),
        conversation_ids: [...new Set(updatedMessages.map(m => m.conversation_id))],
      },
    });

    return NextResponse.json({
      method: "specific_messages",
      message_ids,
      marked_read_count: updatedMessages.length,
      messages: updatedMessages,
      already_read_count: messagesToUpdate.length - unreadMessages.length,
    });
  }

  // Should never reach here due to validation above
  return NextResponse.json({ error: "Invalid request" }, { status: 400 });
}