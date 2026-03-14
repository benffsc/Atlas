import { NextRequest } from "next/server";
import { queryRows } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";
import type { VServiceZoneSummaryRow } from "@/lib/types/view-contracts";

/**
 * GET /api/beacon/service-zones?status=&min_cats=
 *
 * City-level TNR statistics from beacon.v_service_zone_summary.
 * Service zones are extracted from place addresses (e.g., Santa Rosa, Petaluma).
 *
 * FFS-538: Staff think in terms of cities, not DBSCAN clusters.
 */

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get("status");
    const minCats = parseInt(searchParams.get("min_cats") || "0", 10);

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (status) {
      conditions.push(`zone_status = $${paramIndex++}`);
      params.push(status);
    }
    if (minCats > 0) {
      conditions.push(`total_cats >= $${paramIndex++}`);
      params.push(minCats);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const zones = await queryRows<VServiceZoneSummaryRow>(
      `SELECT
        service_zone,
        total_places::int,
        geocoded_places::int,
        centroid_lat,
        centroid_lng,
        total_cats::int,
        altered_cats::int,
        intact_cats::int,
        unknown_status_cats::int,
        alteration_rate_pct,
        zone_status,
        total_requests::int,
        active_requests::int,
        total_appointments::int,
        last_appointment_date::text,
        appointments_last_90d::int,
        alterations_last_90d::int,
        people_count::int
      FROM beacon.v_service_zone_summary
      ${whereClause}
      ORDER BY total_cats DESC`,
      params
    );

    // Aggregate summary
    const totalCats = zones.reduce((s, z) => s + z.total_cats, 0);
    const totalAltered = zones.reduce((s, z) => s + z.altered_cats, 0);
    const totalIntact = zones.reduce((s, z) => s + z.intact_cats, 0);
    const knownStatus = totalAltered + totalIntact;

    const response = apiSuccess({
      zones,
      summary: {
        total_zones: zones.length,
        total_places: zones.reduce((s, z) => s + z.total_places, 0),
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
      },
    });
    response.headers.set("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    return response;
  } catch (error) {
    console.error("Error fetching service zone summary:", error);
    const msg = String(error);
    if (msg.includes("does not exist")) {
      return apiServerError(
        "beacon.v_service_zone_summary not found. Run MIG_2937__service_zone_summary.sql"
      );
    }
    return apiServerError("Failed to fetch service zone data");
  }
}
