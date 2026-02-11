import { queryAll, queryOne } from "./db";

interface RateLimitResult {
  allowed: boolean;
  reason?: string;
}

interface LoopCheckResult {
  allowed: boolean;
  warning?: string;
  auto_close?: boolean;
  reason?: string;
}

/**
 * Rate limit: max 30 messages per hour per agent
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
 * Conversation loop protection:
 * - Max 10 messages per conversation per 5-minute window
 * - If same topic bounces 3+ times → warning flag
 * - Two consecutive "ack" intents = conversation auto-closed
 */
export async function checkConversationLoop(
  conversationId: string,
  intent: string
): Promise<LoopCheckResult> {
  // Check message count in 5-minute window
  const windowResult = await queryOne<{ count: string }>(
    `SELECT COUNT(*) as count FROM direct_messages
     WHERE conversation_id = $1 AND created_at > NOW() - INTERVAL '5 minutes'`,
    [conversationId]
  );

  const windowCount = parseInt(windowResult?.count || "0");
  if (windowCount >= 10) {
    return {
      allowed: false,
      reason: `Conversation rate limit: ${windowCount}/10 messages in the last 5 minutes. Mandatory cooldown.`,
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

  // Check for bounce detection: 3+ alternating messages on similar topic
  const recentMessages = await queryAll<{ from_id: string; body: string }>(
    `SELECT from_id, body FROM direct_messages
     WHERE conversation_id = $1
     ORDER BY created_at DESC LIMIT 6`,
    [conversationId]
  );

  let warning: string | undefined;
  if (recentMessages.length >= 3) {
    // Detect alternating pattern (A→B→A→B→A→B)
    let bounceCount = 0;
    for (let i = 0; i < recentMessages.length - 1; i++) {
      if (recentMessages[i].from_id !== recentMessages[i + 1].from_id) {
        bounceCount++;
      }
    }
    if (bounceCount >= 3) {
      warning =
        "Conversation bounce detected (3+ alternating exchanges). Consider resolving or closing.";
    }
  }

  return { allowed: true, warning };
}
