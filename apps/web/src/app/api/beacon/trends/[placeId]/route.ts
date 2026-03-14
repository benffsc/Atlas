import { NextRequest } from "next/server";
import { queryRows } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";
import { requireValidUUID } from "@/lib/api-validation";
import type { BeaconTemporalTrendRow } from "@/lib/types/view-contracts";

/**
 * GET /api/beacon/trends/[placeId]?months=24
 *
 * Per-place temporal trends from beacon.place_temporal_trends().
 * Returns monthly time-series: new cats, alterations, cumulative totals.
 *
 * FFS-538: P0 requirement — temporal trends for Beacon MVP.
 */

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ placeId: string }> }
) {
  try {
    const { placeId } = await params;
    requireValidUUID(placeId, "place");

    const searchParams = request.nextUrl.searchParams;
    const months = Math.min(
      Math.max(parseInt(searchParams.get("months") || "24", 10) || 24, 1),
      120
    );

    const trends = await queryRows<BeaconTemporalTrendRow>(
      `SELECT
        month::text,
        month_label,
        new_cats_seen,
        alterations,
        cumulative_cats,
        cumulative_altered,
        alteration_rate_pct
      FROM beacon.place_temporal_trends($1, $2)`,
      [placeId, months]
    );

    // Summary stats
    const totalNewCats = trends.reduce((s, t) => s + t.new_cats_seen, 0);
    const totalAlterations = trends.reduce((s, t) => s + t.alterations, 0);
    const latest = trends[trends.length - 1];

    return apiSuccess({
      place_id: placeId,
      months_back: months,
      trends,
      summary: {
        total_new_cats: totalNewCats,
        total_alterations: totalAlterations,
        current_cumulative_cats: latest?.cumulative_cats || 0,
        current_cumulative_altered: latest?.cumulative_altered || 0,
        current_alteration_rate: latest?.alteration_rate_pct || null,
        months_with_activity: trends.filter(
          (t) => t.new_cats_seen > 0 || t.alterations > 0
        ).length,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") {
      const apiErr = error as Error & { status: number };
      return new Response(
        JSON.stringify({ success: false, error: { message: error.message, code: "VALIDATION_ERROR" } }),
        { status: apiErr.status, headers: { "Content-Type": "application/json" } }
      );
    }
    console.error("Error fetching place trends:", error);
    const msg = String(error);
    if (msg.includes("does not exist")) {
      return apiServerError("beacon.place_temporal_trends not found. Run MIG_2934__beacon_p0_analytics.sql");
    }
    return apiServerError("Failed to fetch place trend data");
  }
}
