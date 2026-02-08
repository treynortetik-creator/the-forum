export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

// POST /api/auth/login — Human login via Supabase Auth
export async function POST(req: NextRequest) {
  const { email, password } = await req.json();

  if (!email || !password) {
    return NextResponse.json(
      { error: "email and password are required" },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();

  const {
    data: { session },
    error,
  } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !session) {
    return NextResponse.json(
      { error: error?.message || "Invalid credentials" },
      { status: 401 }
    );
  }

  // Get forum user profile
  const { data: user } = await supabase
    .from("users")
    .select("*")
    .eq("auth_id", session.user.id)
    .single();

  return NextResponse.json({
    user,
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
  });
}
