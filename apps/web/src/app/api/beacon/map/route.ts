import { NextRequest } from "next/server";
import { queryRows } from "@/lib/db";
import { apiSuccess, apiBadRequest, apiServerError } from "@/lib/api-response";
import type { BeaconMapDataFilteredRow } from "@/lib/types/view-contracts";

/**
 * GET /api/beacon/map?from=&to=&zone=
 *
 * Date-range filtered map data for the Beacon map slider.
 * Wraps beacon.map_data_filtered(date_from, date_to, service_zone).
 *
 * FFS-538: P0 requirement — date-range filtering is the spec's #1 map feature.
 */

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const zone = searchParams.get("zone");

    // Validate date params if provided
    if (from && isNaN(Date.parse(from))) {
      return apiBadRequest("Invalid 'from' date format. Use YYYY-MM-DD.");
    }
    if (to && isNaN(Date.parse(to))) {
      return apiBadRequest("Invalid 'to' date format. Use YYYY-MM-DD.");
    }

    const places = await queryRows<BeaconMapDataFilteredRow>(
      `SELECT
        place_id::text,
        formatted_address,
        display_name,
        lat,
        lng,
        service_zone,
        place_kind,
        cat_count::int,
        altered_count::int,
        intact_count::int,
        alteration_rate_pct,
        appointment_count::int,
        request_count::int,
        last_activity_date::text,
        colony_status
      FROM beacon.map_data_filtered($1::date, $2::date, $3)`,
      [from || null, to || null, zone || null]
    );

    // Summary stats
    const totalCats = places.reduce((s, p) => s + p.cat_count, 0);
    const totalAltered = places.reduce((s, p) => s + p.altered_count, 0);
    const totalIntact = places.reduce((s, p) => s + p.intact_count, 0);
    const knownStatus = totalAltered + totalIntact;

    const response = apiSuccess({
      places,
      summary: {
        total_places: places.length,
        total_cats: totalCats,
        total_altered: totalAltered,
        total_intact: totalIntact,
        alteration_rate_pct:
          knownStatus > 0 ? Math.round((1000 * totalAltered) / knownStatus) / 10 : null,
        status_breakdown: {
          managed: places.filter((p) => p.colony_status === "managed").length,
          in_progress: places.filter((p) => p.colony_status === "in_progress").length,
          needs_work: places.filter((p) => p.colony_status === "needs_work").length,
          needs_attention: places.filter((p) => p.colony_status === "needs_attention").length,
          no_data: places.filter((p) => p.colony_status === "no_data").length,
        },
      },
      filters: {
        from: from || null,
        to: to || null,
        zone: zone || null,
      },
    });
    response.headers.set("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120");
    return response;
  } catch (error) {
    console.error("Error fetching filtered map data:", error);
    const msg = String(error);
    if (msg.includes("does not exist")) {
      return apiServerError("beacon.map_data_filtered not found. Run MIG_2934__beacon_p0_analytics.sql");
    }
    return apiServerError("Failed to fetch filtered map data");
  }
}
