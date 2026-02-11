import { queryOne } from "./db";
import { AuditEventType } from "./types";
import { getClientIp } from "./rate-limit";

interface AuditEntry {
  event_type: AuditEventType;
  agent_id?: string | null;
  message_id?: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
  details?: Record<string, unknown>;
}

/**
 * Log an audit event to dm_audit_log.
 * Fire-and-forget — errors are logged but don't break the caller.
 */
export async function logAuditEvent(entry: AuditEntry): Promise<void> {
  try {
    await queryOne(
      `INSERT INTO dm_audit_log (event_type, agent_id, message_id, ip_address, user_agent, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        entry.event_type,
        entry.agent_id || null,
        entry.message_id || null,
        entry.ip_address || null,
        entry.user_agent || null,
        JSON.stringify(entry.details || {}),
      ]
    );
  } catch (err) {
    console.error("Audit log write failed:", err);
  }
}

/**
 * Extract audit context from a request.
 */
export function getAuditContext(req: Request): { ip: string; userAgent: string } {
  return {
    ip: getClientIp(req),
    userAgent: req.headers.get("user-agent") || "unknown",
  };
}
