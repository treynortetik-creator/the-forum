import { queryAll, queryOne } from "./db";
import { checkRateLimit as checkInMemoryRateLimit } from "./rate-limit";
import { EnhancedLoopCheckResult, LoopState } from "./types";
import { logAuditEvent } from "./audit";

interface RateLimitResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Rate limit: max 30 messages per hour per agent (DB-based)
 */
export async function checkRateLimit(fromId: string): Promise<RateLimitResult> {
  const result = await queryOne<{ count: string }>(
    `SELECT COUNT(*) as count FROM direct_messages
     WHERE from_id = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
    [fromId]
  );

  const count = parseInt(result?.count || "0");
  if (count >= 30) {
    return {
      allowed: false,
      reason: `Rate limit exceeded: ${count}/30 messages in the last hour. Try again later.`,
    };
  }

  return { allowed: true };
}

/**
 * Burst protection: Max 5 messages in 10 seconds (in-memory)
 */
export function checkBurstLimit(fromId: string): RateLimitResult {
  const result = checkInMemoryRateLimit(`burst:${fromId}`, {
    maxRequests: 5,
    windowMs: 10 * 1000,
  });

  if (!result.allowed) {
    return {
      allowed: false,
      reason: `Burst limit exceeded: max 5 messages per 10 seconds. Retry after ${Math.ceil((result.resetAt - Date.now()) / 1000)}s.`,
    };
  }

  return { allowed: true };
}

/**
 * Enhanced conversation loop protection:
 * - Max 10 messages per conversation per 5-minute window
 * - Two consecutive "ack" intents → auto-close
 * - Bounce detection (3+ alternating exchanges)
 * - Pattern detection: 3+ consecutive messages between same 2 agents with <30s gaps
 * - Auto-cooldown: 2-minute cooldown when loop detected
 * - Escalation: After 2 loops in 1 hour, lock conversation for 15 min
 */
export async function checkConversationLoop(
  conversationId: string,
  intent: string,
  fromId: string
): Promise<EnhancedLoopCheckResult> {
  // Check for active lock or cooldown
  const loopState = await queryOne<LoopState>(
    `SELECT * FROM dm_loop_state WHERE conversation_id = $1`,
    [conversationId]
  );

  if (loopState) {
    const now = new Date();

    // Check hard lock
    if (loopState.locked_until && new Date(loopState.locked_until) > now) {
      const remainingSeconds = Math.ceil(
        (new Date(loopState.locked_until).getTime() - now.getTime()) / 1000
      );
      return {
        allowed: false,
        locked: true,
        cooldown_seconds: remainingSeconds,
        reason: `Conversation locked due to repeated loop detection. Unlocks in ${remainingSeconds}s.`,
      };
    }

    // Check cooldown
    if (loopState.cooldown_until && new Date(loopState.cooldown_until) > now) {
      const remainingSeconds = Math.ceil(
        (new Date(loopState.cooldown_until).getTime() - now.getTime()) / 1000
      );
      return {
        allowed: false,
        cooldown_seconds: remainingSeconds,
        reason: `Conversation in cooldown after loop detection. Retry in ${remainingSeconds}s.`,
      };
    }
  }

  // Check message count in 5-minute window
  const windowResult = await queryOne<{ count: string }>(
    `SELECT COUNT(*) as count FROM direct_messages
     WHERE conversation_id = $1 AND created_at > NOW() - INTERVAL '5 minutes'`,
    [conversationId]
  );

  const windowCount = parseInt(windowResult?.count || "0");
  if (windowCount >= 10) {
    await triggerLoopDetection(conversationId, fromId, "5min_window_exceeded");
    return {
      allowed: false,
      cooldown_seconds: 120,
      reason: `Conversation rate limit: ${windowCount}/10 messages in the last 5 minutes. Mandatory 2-minute cooldown.`,
    };
  }

  // Check for two consecutive "ack" intents → auto-close
  if (intent === "ack") {
    const lastMessages = await queryAll<{ intent: string }>(
      `SELECT intent FROM direct_messages
       WHERE conversation_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [conversationId]
    );

    if (lastMessages.length > 0 && lastMessages[0].intent === "ack") {
      return {
        allowed: false,
        auto_close: true,
        reason: "Two consecutive ack intents — conversation auto-closed.",
      };
    }
  }

  // Pattern detection: 3+ consecutive messages between same 2 agents with <30s gaps
  const recentMessages = await queryAll<{ from_id: string; to_id: string; created_at: string }>(
    `SELECT from_id, to_id, created_at FROM direct_messages
     WHERE conversation_id = $1
     ORDER BY created_at DESC LIMIT 6`,
    [conversationId]
  );

  let warning: string | undefined;

  if (recentMessages.length >= 3) {
    // Check for rapid-fire pattern (<30s gaps between same pair)
    let rapidCount = 0;
    const participants = new Set<string>();

    for (let i = 0; i < recentMessages.length - 1; i++) {
      const current = recentMessages[i];
      const next = recentMessages[i + 1];
      participants.add(current.from_id);
      participants.add(current.to_id);

      const gap = new Date(current.created_at).getTime() - new Date(next.created_at).getTime();
      if (gap < 30000 && current.from_id !== next.from_id) {
        rapidCount++;
      }
    }

    // If 3+ rapid alternating messages between same 2 agents
    if (rapidCount >= 3 && participants.size === 2) {
      await triggerLoopDetection(conversationId, fromId, "rapid_pattern");
      return {
        allowed: false,
        cooldown_seconds: 120,
        reason: "Loop pattern detected: rapid alternating messages between same agents. 2-minute cooldown enforced.",
      };
    }

    // Bounce detection (existing): 3+ alternating messages
    let bounceCount = 0;
    for (let i = 0; i < recentMessages.length - 1; i++) {
      if (recentMessages[i].from_id !== recentMessages[i + 1].from_id) {
        bounceCount++;
      }
    }
    if (bounceCount >= 3) {
      warning = "Conversation bounce detected (3+ alternating exchanges). Consider resolving or closing.";
    }
  }

  return { allowed: true, warning };
}

/**
 * Handle loop detection: set cooldown, track count, escalate if needed.
 */
async function triggerLoopDetection(
  conversationId: string,
  agentId: string,
  reason: string
): Promise<void> {
  const now = new Date();
  const cooldownUntil = new Date(now.getTime() + 2 * 60 * 1000); // 2 minutes

  // Upsert loop state
  const state = await queryOne<LoopState>(
    `INSERT INTO dm_loop_state (conversation_id, loop_count, last_loop_at, cooldown_until, updated_at)
     VALUES ($1, 1, NOW(), $2, NOW())
     ON CONFLICT (conversation_id) DO UPDATE SET
       loop_count = dm_loop_state.loop_count + 1,
       last_loop_at = NOW(),
       cooldown_until = $2,
       updated_at = NOW()
     RETURNING *`,
    [conversationId, cooldownUntil.toISOString()]
  );

  // Log audit event
  await logAuditEvent({
    event_type: "loop_detected",
    agent_id: agentId,
    details: {
      conversation_id: conversationId,
      reason,
      loop_count: state?.loop_count || 1,
    },
  });

  // Escalation: if 2+ loops within 1 hour, lock for 15 minutes
  if (state && state.loop_count >= 2 && state.last_loop_at) {
    const lastLoop = new Date(state.last_loop_at);
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    if (lastLoop > oneHourAgo) {
      const lockedUntil = new Date(now.getTime() + 15 * 60 * 1000); // 15 minutes
      await queryOne(
        `UPDATE dm_loop_state SET locked_until = $1, updated_at = NOW() WHERE conversation_id = $2`,
        [lockedUntil.toISOString(), conversationId]
      );

      await logAuditEvent({
        event_type: "loop_escalation",
        agent_id: agentId,
        details: {
          conversation_id: conversationId,
          reason: "2+ loops detected within 1 hour",
          locked_until: lockedUntil.toISOString(),
          loop_count: state.loop_count,
        },
      });
    }
  }
}
