export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { queryOne, queryAll } from "@/lib/db";
import { checkRateLimit, checkConversationLoop } from "@/lib/loop-protection";

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
  from_user?: { id: string; name: string; type: string };
  to_user?: { id: string; name: string; type: string };
}

const VALID_INTENTS = ["question", "answer", "update", "request", "ack"];
const VALID_PRIORITIES = ["normal", "urgent"];

/**
 * POST /api/messages — Send a direct message
 *
 * Body: { to, body, intent, priority?, conversation_id? }
 * - `to`: recipient user ID (UUID) or name (string)
 * - `body`: message text
 * - `intent`: one of question, answer, update, request, ack
 * - `priority`: optional, "normal" (default) or "urgent"
 * - `conversation_id`: optional UUID to continue a conversation
 */
export async function POST(req: NextRequest) {
  const auth = await authenticateRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { to, body: messageBody, intent, priority, conversation_id } = body as {
    to?: string;
    body?: string;
    intent?: string;
    priority?: string;
    conversation_id?: string;
  };

  // Validation
  if (!to || !messageBody || !intent) {
    return NextResponse.json(
      { error: "Required fields: to, body, intent" },
      { status: 400 }
    );
  }

  if (!VALID_INTENTS.includes(intent)) {
    return NextResponse.json(
      { error: `Invalid intent. Must be one of: ${VALID_INTENTS.join(", ")}` },
      { status: 400 }
    );
  }

  if (priority && !VALID_PRIORITIES.includes(priority)) {
    return NextResponse.json(
      { error: `Invalid priority. Must be one of: ${VALID_PRIORITIES.join(", ")}` },
      { status: 400 }
    );
  }

  // Resolve recipient — accept UUID or name
  let recipientId = to;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(to)) {
    // Try to find user by name (case-insensitive)
    const user = await queryOne<{ id: string }>(
      `SELECT id FROM users WHERE LOWER(name) = LOWER($1)`,
      [to]
    );
    if (!user) {
      return NextResponse.json(
        { error: `Recipient not found: ${to}` },
        { status: 404 }
      );
    }
    recipientId = user.id;
  } else {
    // Verify the UUID exists
    const user = await queryOne<{ id: string }>(
      `SELECT id FROM users WHERE id = $1`,
      [to]
    );
    if (!user) {
      return NextResponse.json(
        { error: `Recipient not found: ${to}` },
        { status: 404 }
      );
    }
  }

  // Don't allow sending to self
  if (recipientId === auth.user.id) {
    return NextResponse.json(
      { error: "Cannot send a message to yourself" },
      { status: 400 }
    );
  }

  // Rate limiting
  const rateCheck = await checkRateLimit(auth.user.id);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: rateCheck.reason },
      { status: 429 }
    );
  }

  // Conversation loop protection
  const convId = conversation_id as string | undefined;
  if (convId) {
    const loopCheck = await checkConversationLoop(convId, intent);
    if (!loopCheck.allowed) {
      const metadata: Record<string, unknown> = {};
      if (loopCheck.auto_close) {
        metadata.auto_closed = true;
        metadata.auto_closed_at = new Date().toISOString();
      }

      return NextResponse.json(
        {
          error: loopCheck.reason,
          auto_closed: loopCheck.auto_close || false,
          metadata,
        },
        { status: 429 }
      );
    }

    // Add warning to metadata if bounce detected
    if (loopCheck.warning) {
      // We'll add the warning into the message metadata below
      const existingMeta = (body.metadata as Record<string, unknown>) || {};
      body.metadata = { ...existingMeta, warning: loopCheck.warning };
    }
  }

  // Insert the message
  const msgMetadata = (body.metadata as Record<string, unknown>) || {};

  const message = await queryOne<DMRow>(
    `INSERT INTO direct_messages (from_id, to_id, body, priority, conversation_id, intent, metadata)
     VALUES ($1, $2, $3, $4, COALESCE($5::uuid, gen_random_uuid()), $6, $7)
     RETURNING *`,
    [
      auth.user.id,
      recipientId,
      messageBody,
      priority || "normal",
      convId || null,
      intent,
      JSON.stringify(msgMetadata),
    ]
  );

  if (!message) {
    return NextResponse.json(
      { error: "Failed to send message" },
      { status: 500 }
    );
  }

  // Enrich with user info
  const fromUser = await queryOne<{ id: string; name: string; type: string }>(
    `SELECT id, name, type FROM users WHERE id = $1`,
    [auth.user.id]
  );
  const toUser = await queryOne<{ id: string; name: string; type: string }>(
    `SELECT id, name, type FROM users WHERE id = $1`,
    [recipientId]
  );

  return NextResponse.json(
    { ...message, from_user: fromUser, to_user: toUser },
    { status: 201 }
  );
}

/**
 * GET /api/messages — List messages for authenticated user
 *
 * Query params:
 * - since: ISO timestamp — only messages after this time
 * - limit: number (default 50, max 200)
 * - unread_only: "true" to filter only unread
 * - conversation_id: UUID to filter by conversation
 */
export async function GET(req: NextRequest) {
  const auth = await authenticateRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = req.nextUrl.searchParams;
  const since = params.get("since");
  const limitParam = params.get("limit");
  const unreadOnly = params.get("unread_only") === "true";
  const conversationId = params.get("conversation_id");

  let limit = 50;
  if (limitParam) {
    limit = Math.min(Math.max(parseInt(limitParam) || 50, 1), 200);
  }

  const conditions: string[] = ["(dm.to_id = $1 OR dm.from_id = $1)"];
  const values: unknown[] = [auth.user.id];
  let paramIdx = 2;

  if (since) {
    conditions.push(`dm.created_at > $${paramIdx}`);
    values.push(since);
    paramIdx++;
  }

  if (unreadOnly) {
    conditions.push(`dm.read_at IS NULL`);
    conditions.push(`dm.to_id = $1`); // only unread messages TO this user
  }

  if (conversationId) {
    conditions.push(`dm.conversation_id = $${paramIdx}`);
    values.push(conversationId);
    paramIdx++;
  }

  values.push(limit);

  const messages = await queryAll<DMRow>(
    `SELECT dm.*,
      json_build_object('id', fu.id, 'name', fu.name, 'type', fu.type) as from_user,
      json_build_object('id', tu.id, 'name', tu.name, 'type', tu.type) as to_user
     FROM direct_messages dm
     JOIN users fu ON fu.id = dm.from_id
     JOIN users tu ON tu.id = dm.to_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY dm.created_at DESC
     LIMIT $${paramIdx}`,
    values
  );

  return NextResponse.json({
    messages,
    count: messages.length,
  });
}
