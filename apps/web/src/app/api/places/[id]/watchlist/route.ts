import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { apiBadRequest, apiSuccess, apiServerError } from "@/lib/api-response";

/**
 * Place Watchlist API
 *
 * PUT - Toggle watch list status for a place
 *
 * Body:
 * - watch_list: boolean - Whether to add or remove from watch list
 * - reason: string - Required when adding to watch list
 *
 * Uses the toggle_place_watchlist() function which:
 * - Requires reason when adding
 * - Logs to entity_edits for audit trail
 */

interface WatchlistResult {
  success: boolean;
  message: string;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return apiBadRequest("Place ID is required");
  }

  try {
    const body = await request.json();
    const { watch_list, reason } = body;

    if (typeof watch_list !== "boolean") {
      return apiBadRequest("watch_list must be a boolean");
    }

    // When adding to watchlist, reason is required
    if (watch_list && (!reason || !reason.trim())) {
      return apiBadRequest("Reason is required when adding to watch list");
    }

    // Use the database function which handles validation and audit logging
    const result = await queryOne<WatchlistResult>(
      `SELECT * FROM ops.toggle_place_watchlist($1, $2, $3, $4)`,
      [id, watch_list, reason || null, "atlas_ui"]
    );

    if (!result?.success) {
      return apiBadRequest(result?.message || "Failed to update watch list");
    }

    return apiSuccess({
      success: true,
      message: result.message,
      watch_list,
    });
  } catch (error) {
    console.error("Error updating watchlist:", error);
    return apiServerError("Failed to update watch list");
  }
}
