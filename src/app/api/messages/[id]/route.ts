export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
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
 * PATCH /api/messages/:id — Mark a message as read
 *
 * Only the recipient can mark a message as read.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const audit = getAuditContext(req);
  const auth = await authenticateRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = params;

  const message = await queryOne<DMRow>(
    `SELECT * FROM direct_messages WHERE id = $1`,
    [id]
  );

  if (!message) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }

  if (message.to_id !== auth.user.id) {
    return NextResponse.json(
      { error: "Only the recipient can mark a message as read" },
      { status: 403 }
    );
  }

  if (message.read_at) {
    return NextResponse.json(
      { ...message, already_read: true },
      { status: 200 }
    );
  }

  const updated = await queryOne<DMRow>(
    `UPDATE direct_messages SET read_at = NOW() WHERE id = $1 RETURNING *`,
    [id]
  );

  // Audit: message read
  await logAuditEvent({
    event_type: "message_read",
    agent_id: auth.user.id,
    message_id: id,
    ip_address: audit.ip,
    user_agent: audit.userAgent,
    details: {
      conversation_id: message.conversation_id,
      from_id: message.from_id,
    },
  });

  return NextResponse.json(updated);
}

/**
 * GET /api/messages/:id — Get a single message by ID
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await authenticateRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = params;

  const message = await queryOne<DMRow & {
    from_user: { id: string; name: string; type: string };
    to_user: { id: string; name: string; type: string };
  }>(
    `SELECT dm.*,
      json_build_object('id', fu.id, 'name', fu.name, 'type', fu.type) as from_user,
      json_build_object('id', tu.id, 'name', tu.name, 'type', tu.type) as to_user
     FROM direct_messages dm
     JOIN users fu ON fu.id = dm.from_id
     JOIN users tu ON tu.id = dm.to_id
     WHERE dm.id = $1`,
    [id]
  );

  if (!message) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }

  // Only sender, recipient, or human admin can view
  const isAdmin = auth.user.type === "human";
  if (!isAdmin && message.from_id !== auth.user.id && message.to_id !== auth.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json(message);
}

/**
 * DELETE /api/messages/:id — Delete a single DM
 * Human users can delete any message. Agents can only delete messages they sent.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const audit = getAuditContext(req);
  const auth = await authenticateRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = params;
  const message = await queryOne<DMRow>(
    `SELECT * FROM direct_messages WHERE id = $1`,
    [id]
  );

  if (!message) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }

  const isAdmin = auth.user.type === "human";
  if (!isAdmin && message.from_id !== auth.user.id) {
    return NextResponse.json({ error: "Forbidden — only sender or admin can delete" }, { status: 403 });
  }

  await query(`DELETE FROM direct_messages WHERE id = $1`, [id]);

  await logAuditEvent({
    event_type: "message_deleted",
    agent_id: auth.user.id,
    message_id: id,
    ip_address: audit.ip,
    user_agent: audit.userAgent,
    details: { conversation_id: message.conversation_id, deleted_by: auth.user.name },
  });

  return NextResponse.json({ deleted: true, messageId: id });
}
