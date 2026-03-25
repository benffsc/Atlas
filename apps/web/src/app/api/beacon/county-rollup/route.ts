import { queryRows } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";

/**
 * GET /api/beacon/county-rollup
 *
 * County-level TNR alteration rollups from beacon.v_county_alteration_rollup.
 * Aggregates zone-level data by county for high-level impact reporting.
 */

interface CountyRollupRow {
  county: string;
  zone_count: number;
  place_count: number;
  total_cats: number;
  altered_cats: number;
  intact_cats: number;
  unknown_status_cats: number;
  alteration_rate_pct: number | null;
  total_requests: number;
  active_requests: number;
  alterations_last_90d: number;
  estimated_population: number;
}

export async function GET() {
  try {
    const counties = await queryRows<CountyRollupRow>(
      `SELECT
        county,
        zone_count,
        place_count,
        total_cats,
        altered_cats,
        intact_cats,
        unknown_status_cats,
        alteration_rate_pct,
        total_requests,
        active_requests,
        alterations_last_90d,
        estimated_population
      FROM beacon.v_county_alteration_rollup
      ORDER BY total_cats DESC`
    );

    const totalCats = counties.reduce((s, c) => s + c.total_cats, 0);
    const totalAltered = counties.reduce((s, c) => s + c.altered_cats, 0);
    const totalIntact = counties.reduce((s, c) => s + c.intact_cats, 0);
    const knownStatus = totalAltered + totalIntact;

    return apiSuccess({
      counties,
      summary: {
        total_counties: counties.filter(c => c.total_cats > 0).length,
        total_places: counties.reduce((s, c) => s + c.place_count, 0),
        total_cats: totalCats,
        total_altered: totalAltered,
        alteration_rate_pct: knownStatus > 0
          ? Math.round((1000 * totalAltered) / knownStatus) / 10
          : null,
      },
    });
  } catch (error) {
    console.error("Error fetching county rollups:", error);
    const msg = String(error);
    if (msg.includes("does not exist")) {
      return apiServerError(
        "beacon.v_county_alteration_rollup not found. Run MIG_2971__beacon_county_rollup.sql"
      );
    }
    return apiServerError("Failed to fetch county rollup data");
  }
}
