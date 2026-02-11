export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";

// GET /api/health — Health check (no auth required)
export async function GET() {
  const start = Date.now();

  try {
    // Check database connectivity
    const dbResult = await queryOne<{ now: string }>(`SELECT NOW() as now`);
    const dbLatencyMs = Date.now() - start;

    return NextResponse.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: {
        connected: true,
        latency_ms: dbLatencyMs,
        server_time: dbResult?.now,
      },
      version: process.env.npm_package_version || "0.1.0",
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: {
          connected: false,
          error: "Database connection failed",
        },
      },
      { status: 503 }
    );
  }
}
