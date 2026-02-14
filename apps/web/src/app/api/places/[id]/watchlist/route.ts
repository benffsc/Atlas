import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";

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
    return NextResponse.json({ error: "Place ID is required" }, { status: 400 });
  }

  try {
    const body = await request.json();
    const { watch_list, reason } = body;

    if (typeof watch_list !== "boolean") {
      return NextResponse.json(
        { error: "watch_list must be a boolean" },
        { status: 400 }
      );
    }

    // When adding to watchlist, reason is required
    if (watch_list && (!reason || !reason.trim())) {
      return NextResponse.json(
        { error: "Reason is required when adding to watch list" },
        { status: 400 }
      );
    }

    // Use the database function which handles validation and audit logging
    const result = await queryOne<WatchlistResult>(
      `SELECT * FROM ops.toggle_place_watchlist($1, $2, $3, $4)`,
      [id, watch_list, reason || null, "atlas_ui"]
    );

    if (!result?.success) {
      return NextResponse.json(
        { error: result?.message || "Failed to update watch list" },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: result.message,
      watch_list,
    });
  } catch (error) {
    console.error("Error updating watchlist:", error);
    return NextResponse.json(
      { error: "Failed to update watch list" },
      { status: 500 }
    );
  }
}
