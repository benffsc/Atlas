import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { apiSuccess, apiServerError, apiError } from "@/lib/api-response";

// Google Maps Entry Linking Cron Job (V2)
//
// Daily composite-confidence linking of GM entries to Atlas places.
// All logic lives in ops.link_gm_entries_by_proximity():
//   Phase 1: Update nearest_place_id (500m radius)
//   Phase 2: Composite scoring + auto-link >= 0.85
//   Phase 3: Multi-unit flagging (never auto-link)
//
// Vercel Cron: Add to vercel.json:
//   "crons": [{ "path": "/api/cron/google-entry-linking", "schedule": "0 9 * * *" }]
//   (9 AM UTC = 1-2 AM Pacific)

export const maxDuration = 120; // 2 minutes for heavy batch operations

const CRON_SECRET = process.env.CRON_SECRET;

interface LinkingResult {
  auto_linked: number;
  spot_check_logged: number;
  multi_unit_flagged: number;
  nearest_updated: number;
}

interface LinkingStats {
  linked: number;
  needs_unit_selection: number;
  unlinked: number;
  total: number;
}

export async function GET(request: NextRequest) {
  // Verify this is from Vercel Cron or has valid secret
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-vercel-cron");

  if (!cronHeader && CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return apiError("Unauthorized", 401);
  }

  const startTime = Date.now();

  try {
    // Run composite-confidence linking (handles nearest update + scoring + linking)
    const linkResult = await queryOne<LinkingResult>(
      `SELECT * FROM ops.link_gm_entries_by_proximity(5000, false)`
    );

    // Get current stats
    const stats = await queryOne<LinkingStats>(
      `SELECT * FROM ops.v_gm_linking_stats`
    );

    return apiSuccess({
      message: "Daily Google Maps linking complete",
      operations: {
        auto_linked: linkResult?.auto_linked || 0,
        spot_check_logged: linkResult?.spot_check_logged || 0,
        multi_unit_flagged: linkResult?.multi_unit_flagged || 0,
        nearest_updated: linkResult?.nearest_updated || 0,
      },
      current_stats: stats,
      duration_ms: Date.now() - startTime,
    });
  } catch (error) {
    console.error("Google entry linking cron error:", error);
    return apiServerError(error instanceof Error ? error.message : "Google entry linking failed");
  }
}

// POST endpoint for manual triggers
export async function POST(request: NextRequest) {
  return GET(request);
}
