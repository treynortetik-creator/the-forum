export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { queryOne } from "@/lib/db";

// POST /api/auth/login — Human login via email + password
export async function POST(req: NextRequest) {
  const { email, password } = await req.json();

  if (!email || !password) {
    return NextResponse.json(
      { error: "email and password are required" },
      { status: 400 }
    );
  }

  // Find user by email
  const user = await queryOne<{
    id: string;
    name: string;
    email: string;
    type: string;
    avatar_url: string | null;
    password_hash: string | null;
    created_at: string;
  }>(`SELECT * FROM users WHERE email = $1`, [email]);

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
