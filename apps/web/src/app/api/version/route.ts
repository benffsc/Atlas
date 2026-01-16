import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    version: "v2-test",
    timestamp: new Date().toISOString(),
    deployed: "2026-01-16-test"
  });
}
