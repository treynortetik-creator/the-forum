export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { queryOne, queryAll } from "@/lib/db";
import { checkRateLimit, checkBurstLimit, checkConversationLoop } from "@/lib/loop-protection";
import { logAuditEvent, getAuditContext } from "@/lib/audit";
import { verifyHmacSignature } from "@/lib/hmac";

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
  const audit = getAuditContext(req);

  const auth = await authenticateRequest(req);
  if (!auth) {
    await logAuditEvent({
      event_type: "auth_failure",
      ip_address: audit.ip,
      user_agent: audit.userAgent,
      details: { endpoint: "POST /api/messages" },
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Read raw body for HMAC verification
  let rawBody: string;
  let body: Record<string, unknown>;
  try {
    rawBody = await req.text();
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // HMAC verification for API-key authenticated agents
  if (auth.method === "api_key") {
    const hmacResult = await verifyHmacSignature(req, auth.user.id, rawBody);
    if (!hmacResult.valid) {
      await logAuditEvent({
        event_type: hmacResult.error?.includes("replay") ? "nonce_replay" : "hmac_failure",
        agent_id: auth.user.id,
        ip_address: audit.ip,
        user_agent: audit.userAgent,
        details: { error: hmacResult.error },
      });
      return NextResponse.json(
        { error: hmacResult.error },
        { status: 401 }
      );
    }
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

  if (typeof to !== "string" || to.trim().length === 0) {
    return NextResponse.json({ error: "Invalid recipient" }, { status: 400 });
  }

  if (typeof messageBody !== "string") {
    return NextResponse.json({ error: "body must be a string" }, { status: 400 });
  }

  const trimmedBody = messageBody.trim();
  if (trimmedBody.length === 0) {
    return NextResponse.json({ error: "body cannot be empty" }, { status: 400 });
  }

  const MAX_DM_BODY = 10000;
  if (trimmedBody.length > MAX_DM_BODY) {
    return NextResponse.json(
      { error: `body must be ${MAX_DM_BODY} characters or less` },
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

  // Validate conversation_id is a UUID if provided
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (conversation_id && !uuidRegex.test(conversation_id)) {
    return NextResponse.json({ error: "Invalid conversation_id format" }, { status: 400 });
  }

  // Resolve recipient — accept UUID or name
  let recipientId = to;
  if (!uuidRegex.test(to)) {
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

  // Burst protection
  const burstCheck = checkBurstLimit(auth.user.id);
  if (!burstCheck.allowed) {
    await logAuditEvent({
      event_type: "rate_limit_hit",
      agent_id: auth.user.id,
      ip_address: audit.ip,
      user_agent: audit.userAgent,
      details: { type: "burst", reason: burstCheck.reason },
    });
    return NextResponse.json(
      { error: burstCheck.reason },
      { status: 429 }
    );
  }

  // Rate limiting (30/hr)
  const rateCheck = await checkRateLimit(auth.user.id);
  if (!rateCheck.allowed) {
    await logAuditEvent({
      event_type: "rate_limit_hit",
      agent_id: auth.user.id,
      ip_address: audit.ip,
      user_agent: audit.userAgent,
      details: { type: "hourly", reason: rateCheck.reason },
    });
    return NextResponse.json(
      { error: rateCheck.reason },
      { status: 429 }
    );
  }

  // Conversation loop protection
  const convId = conversation_id as string | undefined;
  if (convId) {
    const loopCheck = await checkConversationLoop(convId, intent, auth.user.id);
    if (!loopCheck.allowed) {
      const responseBody: Record<string, unknown> = {
        error: loopCheck.reason,
        auto_closed: loopCheck.auto_close || false,
      };

      if (loopCheck.cooldown_seconds) {
        responseBody.cooldown_seconds = loopCheck.cooldown_seconds;
      }
      if (loopCheck.locked) {
        responseBody.locked = true;
      }

      return NextResponse.json(responseBody, { status: 429 });
    }

    // Add warning to metadata if bounce detected
    if (loopCheck.warning) {
      const existingMeta = (body.metadata as Record<string, unknown>) || {};
      body.metadata = { ...existingMeta, warning: loopCheck.warning };
    }
  }

  // Resolve conversation_id: reuse existing conversation between these two users,
  // or create a new one if this is the first message between them.
  let resolvedConvId = convId || null;
  if (!resolvedConvId) {
    const existing = await queryOne<{ conversation_id: string }>(
      `SELECT conversation_id FROM direct_messages
       WHERE (from_id = $1 AND to_id = $2) OR (from_id = $2 AND to_id = $1)
       ORDER BY created_at DESC LIMIT 1`,
      [auth.user.id, recipientId]
    );
    resolvedConvId = existing?.conversation_id || null;
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
      trimmedBody,
      priority || "normal",
      resolvedConvId,
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

  // Audit: message sent
  await logAuditEvent({
    event_type: "message_sent",
    agent_id: auth.user.id,
    message_id: message.id,
    ip_address: audit.ip,
    user_agent: audit.userAgent,
    details: {
      to_id: recipientId,
      conversation_id: message.conversation_id,
      intent,
      priority: priority || "normal",
    },
  });

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

  // Human users get admin visibility (can see all agent conversations)
  const isAdmin = auth.user.type === "human";

  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  if (!isAdmin) {
    conditions.push(`(dm.to_id = $${paramIdx} OR dm.from_id = $${paramIdx})`);
    values.push(auth.user.id);
    paramIdx++;
  }

  if (since) {
    conditions.push(`dm.created_at > $${paramIdx}`);
    values.push(since);
    paramIdx++;
  }

  if (unreadOnly) {
    conditions.push(`dm.read_at IS NULL`);
    // "Unread" only applies to the recipient. For non-admin users the
    // (to_id OR from_id) filter was already added above using $1; we
    // add a to_id-only condition using the same $1 placeholder — no
    // extra value push needed.
    if (!isAdmin) {
      conditions.push(`dm.to_id = $1`);
    }
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
     ${conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""}
     ORDER BY dm.created_at DESC
     LIMIT $${paramIdx}`,
    values
  );

  return NextResponse.json({
    messages,
    count: messages.length,
  });
}
