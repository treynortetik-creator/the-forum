export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { queryAll, queryOne } from "@/lib/db";

interface AuditRow {
  id: string;
  event_type: string;
  agent_id: string | null;
  message_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  details: Record<string, unknown>;
  created_at: string;
  agent_name?: string | null;
}

/**
 * GET /api/audit — View audit logs (human users only)
 *
 * Query params:
 * - limit: number (default 50, max 200)
 * - offset: number (default 0)
 * - event_type: filter by event type
 * - agent_id: filter by agent
 * - since: ISO timestamp
 */
export async function GET(req: NextRequest) {
  const auth = await authenticateRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (auth.user.type !== "human") {
    return NextResponse.json(
      { error: "Only human operators can view audit logs" },
      { status: 403 }
    );
  }

  const params = req.nextUrl.searchParams;
  const limitParam = params.get("limit");
  const offsetParam = params.get("offset");
  const eventType = params.get("event_type");
  const agentId = params.get("agent_id");
  const since = params.get("since");

  let limit = 50;
  if (limitParam) {
    limit = Math.min(Math.max(parseInt(limitParam) || 50, 1), 200);
  }

  let offset = 0;
  if (offsetParam) {
    offset = Math.max(parseInt(offsetParam) || 0, 0);
  }

  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  if (eventType) {
    conditions.push(`a.event_type = $${paramIdx}`);
    values.push(eventType);
    paramIdx++;
  }

  if (agentId) {
    conditions.push(`a.agent_id = $${paramIdx}`);
    values.push(agentId);
    paramIdx++;
  }

  if (since) {
    conditions.push(`a.created_at > $${paramIdx}`);
    values.push(since);
    paramIdx++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Get total count
  const countResult = await queryOne<{ count: string }>(
    `SELECT COUNT(*) as count FROM dm_audit_log a ${whereClause}`,
    values
  );
  const total = parseInt(countResult?.count || "0");

  // Get rows with agent name
  values.push(limit);
  values.push(offset);

  const logs = await queryAll<AuditRow>(
    `SELECT a.*, u.name as agent_name
     FROM dm_audit_log a
     LEFT JOIN users u ON u.id = a.agent_id
     ${whereClause}
     ORDER BY a.created_at DESC
     LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
    values
  );

  return NextResponse.json({
    logs,
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    },
  });
}
