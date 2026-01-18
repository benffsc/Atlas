import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";

/**
 * Beacon Place-Level Metrics API
 *
 * Returns place-level TNR metrics from v_beacon_place_metrics view.
 * Supports geographic bounding box filtering for map visualization.
 *
 * Scientific basis:
 * - Lower-bound alteration rate: verified_altered / max(verified, estimated)
 * - Colony status thresholds: managed >= 75%, in_progress >= 50%
 * - Time-decay weighted estimates from multiple sources
 */

interface BeaconPlace {
  place_id: string;
  formatted_address: string;
  normalized_address: string;
  lat: number;
  lng: number;
  verified_cat_count: number;
  verified_altered_count: number;
  verified_unaltered_count: number;
  estimated_total: number;
  estimate_source_count: number;
  latest_estimate_date: string | null;
  verified_alteration_rate: number | null;
  lower_bound_alteration_rate: number | null;
  colony_status: string;
  has_cat_activity: boolean;
  has_trapping_activity: boolean;
  last_activity_at: string | null;
  request_count: number;
  appointment_count: number;
  calculation_audit: Record<string, unknown>;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    // Geographic bounds: "south,west,north,east" (lat,lng,lat,lng)
    const bounds = searchParams.get("bounds");

    // Filters
    const minCats = parseInt(searchParams.get("minCats") || "1", 10);
    const status = searchParams.get("status"); // managed, in_progress, needs_work, needs_attention
    const limit = Math.min(parseInt(searchParams.get("limit") || "1000", 10), 5000);

    // Build query
    let whereClause = "WHERE verified_cat_count >= $1";
    const params: unknown[] = [minCats];
    let paramIndex = 2;

    // Bounding box filter
    if (bounds) {
      const [south, west, north, east] = bounds.split(",").map(Number);
      if (!isNaN(south) && !isNaN(west) && !isNaN(north) && !isNaN(east)) {
        whereClause += ` AND lat BETWEEN $${paramIndex} AND $${paramIndex + 1}`;
        whereClause += ` AND lng BETWEEN $${paramIndex + 2} AND $${paramIndex + 3}`;
        params.push(south, north, west, east);
        paramIndex += 4;
      }
    }

    // Colony status filter
    if (status) {
      whereClause += ` AND colony_status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    // Query places
    const places = await queryRows<BeaconPlace>(
      `
      SELECT
        place_id,
        formatted_address,
        normalized_address,
        lat,
        lng,
        verified_cat_count,
        verified_altered_count,
        verified_unaltered_count,
        estimated_total,
        estimate_source_count,
        latest_estimate_date,
        verified_alteration_rate,
        lower_bound_alteration_rate,
        colony_status,
        has_cat_activity,
        has_trapping_activity,
        last_activity_at,
        request_count,
        appointment_count,
        calculation_audit
      FROM trapper.v_beacon_place_metrics
      ${whereClause}
      ORDER BY verified_cat_count DESC
      LIMIT $${paramIndex}
      `,
      [...params, limit]
    );

    // Get summary stats for this query
    const summary = await queryOne<{
      total_places: number;
      total_cats: number;
      total_altered: number;
      avg_alteration_rate: number;
    }>(
      `
      SELECT
        COUNT(*)::INT as total_places,
        COALESCE(SUM(verified_cat_count), 0)::INT as total_cats,
        COALESCE(SUM(verified_altered_count), 0)::INT as total_altered,
        CASE
          WHEN SUM(verified_cat_count) > 0 THEN
            ROUND(100.0 * SUM(verified_altered_count) / SUM(verified_cat_count), 1)
          ELSE 0
        END as avg_alteration_rate
      FROM trapper.v_beacon_place_metrics
      ${whereClause}
      `,
      params
    );

    return NextResponse.json({
      places,
      summary: {
        total_places: summary?.total_places || 0,
        total_cats: summary?.total_cats || 0,
        total_altered: summary?.total_altered || 0,
        avg_alteration_rate: summary?.avg_alteration_rate || 0,
        places_returned: places.length,
        limit_applied: places.length === limit,
      },
      meta: {
        calculation_method: "lower_bound_alteration",
        scientific_basis: "Levy et al. JAVMA 2005 - 71-94% threshold",
        status_thresholds: {
          managed: ">= 75%",
          in_progress: "50-74%",
          needs_work: "25-49%",
          needs_attention: "< 25%",
        },
      },
    });
  } catch (error) {
    console.error("Error fetching Beacon places:", error);
    return NextResponse.json(
      { error: "Failed to fetch Beacon place data" },
      { status: 500 }
    );
  }
}
