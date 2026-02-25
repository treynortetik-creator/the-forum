export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { queryOne } from "@/lib/db";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

// Rate limit: 10 login attempts per minute per IP
const LOGIN_RATE_LIMIT = { maxRequests: 10, windowMs: 60_000 };

// POST /api/auth/login — Human login via email + password
export async function POST(req: NextRequest) {
  // Rate limit check
  const ip = getClientIp(req);
  const rl = checkRateLimit(`login:${ip}`, LOGIN_RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many login attempts. Please try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)),
        },
      }
    );
  }

  let email: string, password: string;
  try {
    const body = await req.json();
    email = body.email;
    password = body.password;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!email || !password) {
    return NextResponse.json(
      { error: "email and password are required" },
      { status: 400 }
    );
  }

  if (typeof email !== "string" || typeof password !== "string") {
    return NextResponse.json({ error: "email and password must be strings" }, { status: 400 });
  }

  // Basic email format check to avoid unnecessary DB queries
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  if (email.length > 254) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  // Find user by email — only select needed columns
  const user = await queryOne<{
    id: string;
    name: string;
    email: string;
    type: string;
    avatar_url: string | null;
    password_hash: string | null;
    created_at: string;
  }>(
    `SELECT id, name, email, type, avatar_url, password_hash, created_at FROM users WHERE email = $1`,
    [email]
  );

  if (!user || !user.password_hash) {
    return NextResponse.json(
      { error: "Invalid credentials" },
      { status: 401 }
    );
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return NextResponse.json(
      { error: "Invalid credentials" },
      { status: 401 }
    );
  }

  // Return user info with their ID as the access token (simple session)
  return NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      type: user.type,
      avatar_url: user.avatar_url,
      created_at: user.created_at,
    },
    access_token: user.id, // Simple token: user's UUID
  });
}
