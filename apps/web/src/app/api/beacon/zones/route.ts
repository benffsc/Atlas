import { NextRequest } from "next/server";
import { queryRows } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";
import type { VZoneAlterationRollupRow } from "@/lib/types/view-contracts";

/**
 * GET /api/beacon/zones?status=&service_zone=&min_cats=
 *
 * Zone-level TNR alteration rollups from beacon.v_zone_alteration_rollup.
 * Returns aggregated cat counts, alteration rates, and Chapman estimates per zone.
 *
 * FFS-538: P0 requirement — county/zone alteration rollups for Beacon MVP.
 */

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get("status");
    const serviceZone = searchParams.get("service_zone");
    const minCats = parseInt(searchParams.get("min_cats") || "0", 10);

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (status) {
      conditions.push(`zone_status = $${paramIndex++}`);
      params.push(status);
    }
    if (serviceZone) {
      conditions.push(`service_zone = $${paramIndex++}`);
      params.push(serviceZone);
    }
    if (minCats > 0) {
      conditions.push(`total_cats >= $${paramIndex++}`);
      params.push(minCats);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const zones = await queryRows<VZoneAlterationRollupRow>(
      `SELECT
        zone_id::text,
        zone_code,
        zone_name,
        service_zone,
        centroid_lat,
        centroid_lng,
        place_count,
        total_cats,
        altered_cats,
        intact_cats,
        unknown_status_cats,
        alteration_rate_pct,
        zone_status,
        total_requests,
        active_requests,
        total_appointments,
        last_appointment_date::text,
        appointments_last_90d,
        alterations_last_90d,
        estimated_population,
        adequate_estimates,
        total_estimates
      FROM beacon.v_zone_alteration_rollup
      ${whereClause}
      ORDER BY total_cats DESC`,
      params
    );

    // Aggregate summary
    const totalCats = zones.reduce((s, z) => s + z.total_cats, 0);
    const totalAltered = zones.reduce((s, z) => s + z.altered_cats, 0);
    const totalIntact = zones.reduce((s, z) => s + z.intact_cats, 0);
    const knownStatus = totalAltered + totalIntact;

    return apiSuccess({
      zones,
      summary: {
        total_zones: zones.length,
        total_places: zones.reduce((s, z) => s + z.place_count, 0),
        total_cats: totalCats,
        total_altered: totalAltered,
        alteration_rate_pct:
          knownStatus > 0 ? Math.round((1000 * totalAltered) / knownStatus) / 10 : null,
        status_breakdown: {
          managed: zones.filter((z) => z.zone_status === "managed").length,
          in_progress: zones.filter((z) => z.zone_status === "in_progress").length,
          needs_work: zones.filter((z) => z.zone_status === "needs_work").length,
          needs_attention: zones.filter((z) => z.zone_status === "needs_attention").length,
          no_data: zones.filter((z) => z.zone_status === "no_data").length,
        },
        total_estimated_population: zones.reduce(
          (s, z) => s + (z.estimated_population || 0),
          0
        ),
      },
    });
  } catch (error) {
    console.error("Error fetching zone rollups:", error);
    const msg = String(error);
    if (msg.includes("does not exist")) {
      return apiServerError("beacon.v_zone_alteration_rollup not found. Run MIG_2934__beacon_p0_analytics.sql");
    }
    return apiServerError("Failed to fetch zone rollup data");
  }
}
