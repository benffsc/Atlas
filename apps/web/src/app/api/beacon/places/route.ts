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
    // Check if the view exists before querying (V2: ops schema)
    const viewCheck = await queryOne<{ exists: boolean }>(`
      SELECT EXISTS(
        SELECT 1 FROM pg_views WHERE schemaname = 'ops' AND viewname = 'v_beacon_place_metrics'
      ) as exists
    `, []);

    if (!viewCheck?.exists) {
      return NextResponse.json({
        error: "Beacon places view not deployed",
        missing: ["v_beacon_place_metrics (MIG_2082)"],
        hint: "Run V2 beacon migrations: MIG_2082__beacon_views_implementation.sql",
        health_check: "/api/beacon/health",
      }, { status: 503 });
    }

    const searchParams = request.nextUrl.searchParams;

    // Geographic bounds: "south,west,north,east" (lat,lng,lat,lng)
    const bounds = searchParams.get("bounds");

    // Filters
    const minCats = parseInt(searchParams.get("minCats") || "1", 10);
    const status = searchParams.get("status"); // managed, in_progress, needs_work, needs_attention
    const limit = Math.min(parseInt(searchParams.get("limit") || "1000", 10), 5000);

    // Build query - V2 uses total_cats instead of verified_cat_count
    let whereClause = "WHERE total_cats >= $1";
    const params: unknown[] = [minCats];
    let paramIndex = 2;

    // Bounding box filter - V2 uses latitude/longitude
    if (bounds) {
      const [south, west, north, east] = bounds.split(",").map(Number);
      if (!isNaN(south) && !isNaN(west) && !isNaN(north) && !isNaN(east)) {
        whereClause += ` AND latitude BETWEEN $${paramIndex} AND $${paramIndex + 1}`;
        whereClause += ` AND longitude BETWEEN $${paramIndex + 2} AND $${paramIndex + 3}`;
        params.push(south, north, west, east);
        paramIndex += 4;
      }
    }

    // Colony status filter - V2 computes status from alteration_rate_pct
    if (status) {
      // Map status to alteration rate ranges
      const statusConditions: Record<string, string> = {
        managed: "alteration_rate_pct >= 75",
        in_progress: "alteration_rate_pct >= 50 AND alteration_rate_pct < 75",
        needs_work: "alteration_rate_pct >= 25 AND alteration_rate_pct < 50",
        needs_attention: "alteration_rate_pct < 25 OR alteration_rate_pct IS NULL",
      };
      if (statusConditions[status]) {
        whereClause += ` AND (${statusConditions[status]})`;
      }
    }

    // Query places - V2 column mapping
    const places = await queryRows<BeaconPlace>(
      `
      SELECT
        place_id,
        formatted_address,
        COALESCE(display_name, formatted_address) as normalized_address,
        latitude as lat,
        longitude as lng,
        total_cats as verified_cat_count,
        altered_cats as verified_altered_count,
        (total_cats - altered_cats) as verified_unaltered_count,
        COALESCE(colony_estimate, total_cats) as estimated_total,
        1 as estimate_source_count,
        last_appointment_date as latest_estimate_date,
        alteration_rate_pct as verified_alteration_rate,
        alteration_rate_pct as lower_bound_alteration_rate,
        CASE
          WHEN alteration_rate_pct >= 75 THEN 'managed'
          WHEN alteration_rate_pct >= 50 THEN 'in_progress'
          WHEN alteration_rate_pct >= 25 THEN 'needs_work'
          ELSE 'needs_attention'
        END as colony_status,
        (total_appointments > 0) as has_cat_activity,
        (total_requests > 0) as has_trapping_activity,
        last_activity_at,
        total_requests as request_count,
        total_appointments as appointment_count,
        '{}'::JSONB as calculation_audit
      FROM ops.v_beacon_place_metrics
      ${whereClause}
      ORDER BY total_cats DESC
      LIMIT $${paramIndex}
      `,
      [...params, limit]
    );

    // Get summary stats for this query - V2 column mapping
    const summary = await queryOne<{
      total_places: number;
      total_cats: number;
      total_altered: number;
      avg_alteration_rate: number;
    }>(
      `
      SELECT
        COUNT(*)::INT as total_places,
        COALESCE(SUM(total_cats), 0)::INT as total_cats,
        COALESCE(SUM(altered_cats), 0)::INT as total_altered,
        CASE
          WHEN SUM(total_cats) > 0 THEN
            ROUND(100.0 * SUM(altered_cats) / SUM(total_cats), 1)
          ELSE 0
        END as avg_alteration_rate
      FROM ops.v_beacon_place_metrics
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

    const errorMessage = String(error);
    if (errorMessage.includes("does not exist") || errorMessage.includes("relation")) {
      return NextResponse.json({
        error: "Beacon places view not found",
        details: errorMessage,
        hint: "Run: ./scripts/deploy-critical-migrations.sh",
        health_check: "/api/beacon/health",
      }, { status: 503 });
    }

    return NextResponse.json({
      error: "Failed to fetch Beacon place data",
      details: errorMessage,
      health_check: "/api/health/db",
    }, { status: 500 });
  }
}
