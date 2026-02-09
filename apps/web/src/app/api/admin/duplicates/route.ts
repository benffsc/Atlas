import { NextResponse } from "next/server";

/**
 * Legacy Duplicates API - DEPRECATED
 *
 * This endpoint has been superseded by the Data Engine review system.
 * Use the following endpoints instead:
 *
 * - GET /api/admin/reviews/summary - Review queue summary with counts
 * - GET /api/admin/data-engine/review - Data Engine pending reviews
 * - GET /api/admin/reviews/identity - Identity review queue
 *
 * The legacy duplicates page now redirects to /admin/data
 */
export async function GET() {
  return NextResponse.json({
    deprecated: true,
    message: "This endpoint has been deprecated. Use /api/admin/reviews/summary or /api/admin/data-engine/review instead.",
    redirect: "/admin/data?tab=review",
    alternatives: [
      { endpoint: "/api/admin/reviews/summary", purpose: "Review queue summary with counts" },
      { endpoint: "/api/admin/data-engine/review", purpose: "Data Engine pending reviews" },
      { endpoint: "/api/admin/reviews/identity", purpose: "Identity review queue" },
    ],
    duplicates: [],
    counts: {
      pending: 0,
      merged: 0,
      kept_separate: 0,
      dismissed: 0,
    },
  });
}

export async function POST() {
  return NextResponse.json({
    deprecated: true,
    error: "This endpoint has been deprecated. Use /api/admin/data-engine/review/[id] for resolving reviews.",
    success: false,
  }, { status: 410 });
}
