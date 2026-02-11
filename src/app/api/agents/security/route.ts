export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { registerSigningKey } from "@/lib/hmac";

interface SecurityConfigRow {
  agent_id: string;
  webhook_url: string | null;
  max_rate_per_hour: number;
  nonce_window: number;
  has_signing_key: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * POST /api/agents/security — Register/update signing key and webhook URL
 *
 * Body: { signing_key, webhook_url? }
 * Only agents can register security config.
 */
export async function POST(req: NextRequest) {
  const auth = await authenticateRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (auth.user.type !== "agent") {
    return NextResponse.json(
      { error: "Only agents can configure security settings" },
      { status: 403 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { signing_key, webhook_url } = body as {
    signing_key?: string;
    webhook_url?: string;
  };

  if (!signing_key || typeof signing_key !== "string") {
    return NextResponse.json(
      { error: "signing_key is required (string)" },
      { status: 400 }
    );
  }

  if (signing_key.length < 32) {
    return NextResponse.json(
      { error: "signing_key must be at least 32 characters" },
      { status: 400 }
    );
  }

  if (webhook_url && typeof webhook_url === "string") {
    try {
      new URL(webhook_url);
    } catch {
      return NextResponse.json(
        { error: "webhook_url must be a valid URL" },
        { status: 400 }
      );
    }
  }

  await registerSigningKey(
    auth.user.id,
    signing_key,
    webhook_url || null
  );

  return NextResponse.json({
    message: "Security configuration updated",
    has_signing_key: true,
    webhook_configured: !!webhook_url,
  });
}

/**
 * GET /api/agents/security — Get own security config (no secrets returned)
 */
export async function GET(req: NextRequest) {
  const auth = await authenticateRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (auth.user.type !== "agent") {
    return NextResponse.json(
      { error: "Only agents can view security settings" },
      { status: 403 }
    );
  }

  const config = await queryOne<SecurityConfigRow>(
    `SELECT agent_id, webhook_url, max_rate_per_hour, nonce_window,
            (signing_key_hash IS NOT NULL) as has_signing_key,
            created_at, updated_at
     FROM agent_security WHERE agent_id = $1`,
    [auth.user.id]
  );

  if (!config) {
    return NextResponse.json({
      configured: false,
      has_signing_key: false,
      webhook_url: null,
      max_rate_per_hour: 30,
      nonce_window: 1000,
    });
  }

  return NextResponse.json({
    configured: true,
    has_signing_key: config.has_signing_key,
    webhook_url: config.webhook_url,
    max_rate_per_hour: config.max_rate_per_hour,
    nonce_window: config.nonce_window,
    created_at: config.created_at,
    updated_at: config.updated_at,
  });
}
