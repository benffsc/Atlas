import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";

/**
 * Link Google Maps Entries API (V2)
 *
 * POST - Run composite-confidence linking of GM entries to nearby places
 *
 * Body params:
 *   - limit: number (default 5000) - max entries to process
 *   - dry_run: boolean (default false) - preview without linking
 *
 * Uses ops.link_gm_entries_by_proximity() which handles nearest update,
 * composite scoring, auto-linking (>= 0.85), and multi-unit flagging.
 */

interface LinkResult {
  auto_linked: number;
  spot_check_logged: number;
  multi_unit_flagged: number;
  nearest_updated: number;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const limit = Math.min(Math.max(body.limit || 5000, 1), 10000);
    const dryRun = body.dry_run === true;

    const result = await queryOne<LinkResult>(
      `SELECT * FROM ops.link_gm_entries_by_proximity($1, $2)`,
      [limit, dryRun]
    );

    if (!result) {
      return apiServerError("Linking function not available - run MIG_2823 first");
    }

    return apiSuccess({
      success: true,
      auto_linked: result.auto_linked,
      spot_check_logged: result.spot_check_logged,
      multi_unit_flagged: result.multi_unit_flagged,
      nearest_updated: result.nearest_updated,
      dry_run: dryRun,
      limit,
      message: `Linked ${result.auto_linked} entries (${result.spot_check_logged} logged for spot-check, ${result.multi_unit_flagged} multi-unit flagged, ${result.nearest_updated} nearest updated)`,
    });
  } catch (error) {
    console.error("Error linking Google Maps entries:", error);
    if (error instanceof Error && error.message.includes("does not exist")) {
      return apiServerError("Linking function not available - run MIG_2823 migration first");
    }
    return apiServerError("Failed to link Google Maps entries");
  }
}
