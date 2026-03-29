import { NextRequest } from "next/server";
import { queryRows, queryOne } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";
import { getServerConfig } from "@/lib/server-config";

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
  // MIG_3009: TNR data surfacing
  has_recent_breeding: boolean;
  last_breeding_detected: string | null;
  colony_trend: string;
  new_intact_arrivals: number;
  immigration_pressure: string;
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
      return apiServerError("Beacon places view not deployed. Run MIG_2082__beacon_views_implementation.sql");
    }

    // Fetch configurable colony status thresholds (FFS-640)
    const [managedPct, inProgressPct, needsWorkPct] = await Promise.all([
      getServerConfig("beacon.colony_managed_pct", 75),
      getServerConfig("beacon.colony_in_progress_pct", 50),
      getServerConfig("beacon.colony_needs_work_pct", 25),
    ]);

    const searchParams = request.nextUrl.searchParams;

    // Geographic bounds: "south,west,north,east" (lat,lng,lat,lng)
    const bounds = searchParams.get("bounds");

    // Filters
    const minCats = parseInt(searchParams.get("minCats") || "1", 10);
    const status = searchParams.get("status"); // managed, in_progress, needs_work, needs_attention
    const limit = Math.min(parseInt(searchParams.get("limit") || "1000", 10), 5000);

    // MIG_3009: New filter params
    const breeding = searchParams.get("breeding"); // true = only places with recent breeding
    const trend = searchParams.get("trend"); // growing, shrinking, stable
    const immigration = searchParams.get("immigration"); // high, moderate
    const readiness = searchParams.get("readiness"); // complete, nearly_complete, in_progress, needs_work

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
      // Map status to alteration rate ranges (thresholds from app_config)
      const statusConditions: Record<string, string> = {
        managed: `alteration_rate_pct >= ${managedPct}`,
        in_progress: `alteration_rate_pct >= ${inProgressPct} AND alteration_rate_pct < ${managedPct}`,
        needs_work: `alteration_rate_pct >= ${needsWorkPct} AND alteration_rate_pct < ${inProgressPct}`,
        needs_attention: `alteration_rate_pct < ${needsWorkPct} OR alteration_rate_pct IS NULL`,
      };
      if (statusConditions[status]) {
        whereClause += ` AND (${statusConditions[status]})`;
      }
    }

    // MIG_3009: New filters
    if (breeding === "true") {
      whereClause += ` AND has_recent_breeding = TRUE`;
    }
    if (trend && ["growing", "shrinking", "stable", "insufficient_data"].includes(trend)) {
      whereClause += ` AND colony_trend = '${trend}'`;
    }
    if (immigration && ["high", "moderate"].includes(immigration)) {
      whereClause += ` AND immigration_pressure = '${immigration}'`;
    }
    // Readiness filter: approximate from matview columns (avoids per-row function call)
    // needs_work = low alteration + breeding + unstable
    // complete = high alteration + no breeding + stable
    if (readiness === "needs_work") {
      whereClause += ` AND (alteration_rate_pct IS NULL OR alteration_rate_pct < 50)`;
    } else if (readiness === "in_progress") {
      whereClause += ` AND alteration_rate_pct >= 25 AND alteration_rate_pct < 75`;
    } else if (readiness === "nearly_complete") {
      whereClause += ` AND alteration_rate_pct >= 50 AND (has_recent_breeding = FALSE OR has_recent_breeding IS NULL) AND colony_trend != 'growing'`;
    } else if (readiness === "complete") {
      whereClause += ` AND alteration_rate_pct >= 75 AND (has_recent_breeding = FALSE OR has_recent_breeding IS NULL) AND colony_trend IN ('stable', 'insufficient_data')`;
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
        (known_status_cats - altered_cats) as verified_unaltered_count,
        COALESCE(colony_estimate, total_cats) as estimated_total,
        1 as estimate_source_count,
        last_appointment_date as latest_estimate_date,
        alteration_rate_pct as verified_alteration_rate,
        alteration_rate_pct as lower_bound_alteration_rate,
        CASE
          WHEN alteration_rate_pct >= ${managedPct} THEN 'managed'
          WHEN alteration_rate_pct >= ${inProgressPct} THEN 'in_progress'
          WHEN alteration_rate_pct >= ${needsWorkPct} THEN 'needs_work'
          ELSE 'needs_attention'
        END as colony_status,
        (total_appointments > 0) as has_cat_activity,
        (total_requests > 0) as has_trapping_activity,
        last_activity_at,
        total_requests as request_count,
        total_appointments as appointment_count,
        '{}'::JSONB as calculation_audit,
        -- MIG_3009: TNR data surfacing columns
        COALESCE(has_recent_breeding, FALSE) as has_recent_breeding,
        last_breeding_detected,
        COALESCE(colony_trend, 'insufficient_data') as colony_trend,
        COALESCE(new_intact_arrivals, 0) as new_intact_arrivals,
        COALESCE(immigration_pressure, 'none') as immigration_pressure
      FROM ops.v_beacon_place_metrics
      ${whereClause}
      ORDER BY total_cats DESC
      LIMIT $${paramIndex}
      `,
      [...params, limit]
    );

    // Get summary stats for this query - V2 column mapping
    // MIG_2861: Use known_status_cats as denominator for avg alteration rate
    const summary = await queryOne<{
      total_places: number;
      total_cats: number;
      total_altered: number;
      total_known_status: number;
      total_unknown_status: number;
      avg_alteration_rate: number;
    }>(
      `
      SELECT
        COUNT(*)::INT as total_places,
        COALESCE(SUM(total_cats), 0)::INT as total_cats,
        COALESCE(SUM(altered_cats), 0)::INT as total_altered,
        COALESCE(SUM(known_status_cats), 0)::INT as total_known_status,
        COALESCE(SUM(unknown_status_cats), 0)::INT as total_unknown_status,
        CASE
          WHEN SUM(known_status_cats) > 0 THEN
            ROUND(100.0 * SUM(altered_cats) / SUM(known_status_cats), 1)
          ELSE 0
        END as avg_alteration_rate
      FROM ops.v_beacon_place_metrics
      ${whereClause}
      `,
      params
    );

    return apiSuccess({
      places,
      summary: {
        total_places: summary?.total_places || 0,
        total_cats: summary?.total_cats || 0,
        total_altered: summary?.total_altered || 0,
        avg_alteration_rate: summary?.avg_alteration_rate || 0,
        known_status_cats: summary?.total_known_status || 0,
        unknown_status_cats: summary?.total_unknown_status || 0,
        places_returned: places.length,
        limit_applied: places.length === limit,
      },
      meta: {
        calculation_method: "lower_bound_alteration",
        scientific_basis: "Levy et al. JAVMA 2005 - 71-94% threshold",
        status_thresholds: {
          managed: `>= ${managedPct}%`,
          in_progress: `${inProgressPct}-${managedPct - 1}%`,
          needs_work: `${needsWorkPct}-${inProgressPct - 1}%`,
          needs_attention: `< ${needsWorkPct}%`,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching Beacon places:", error);

    const errorMessage = String(error);
    if (errorMessage.includes("does not exist") || errorMessage.includes("relation")) {
      return apiServerError("Beacon places view not found. Run deploy-critical-migrations.sh");
    }

    return apiServerError("Failed to fetch Beacon place data");
  }
}
