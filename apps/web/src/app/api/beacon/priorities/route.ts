import { NextRequest, NextResponse } from "next/server";
import { queryRows } from "@/lib/db";

/**
 * GET /api/beacon/priorities
 *
 * Returns observation priority data for Beacon field planning.
 * Supports different granularity levels: zone, zip, or place.
 *
 * Query params:
 *   - level: 'zone' | 'zip' | 'place' (default: 'zone')
 *   - zone: filter by service_zone (optional)
 *   - zip: filter by zip code (optional)
 *   - priority: filter by priority tier (high, medium, low)
 *   - limit: max results (default: 100 for place level)
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const level = searchParams.get("level") || "zone";
  const zone = searchParams.get("zone");
  const zip = searchParams.get("zip");
  const priority = searchParams.get("priority");
  const limit = parseInt(searchParams.get("limit") || "100", 10);

  try {
    if (level === "zone") {
      const rows = await queryRows<{
        service_zone: string;
        total_places: number;
        places_with_observations: number;
        places_needing_obs: number;
        high_priority_sites: number;
        medium_priority_sites: number;
        low_priority_sites: number;
        total_cats: number;
        cats_needing_obs: number;
        high_priority_cats: number;
        pct_gap: number;
        zone_priority_score: number;
      }>(
        `SELECT * FROM ops.v_zone_observation_priority
         ${zone ? "WHERE service_zone = $1" : ""}
         ORDER BY zone_priority_score DESC`,
        zone ? [zone] : []
      );

      return NextResponse.json({
        level: "zone",
        data: rows,
        summary: {
          total_zones: rows.length,
          total_places_needing_obs: rows.reduce(
            (sum, r) => sum + r.places_needing_obs,
            0
          ),
          total_cats_needing_obs: rows.reduce(
            (sum, r) => sum + r.cats_needing_obs,
            0
          ),
          total_high_priority_sites: rows.reduce(
            (sum, r) => sum + r.high_priority_sites,
            0
          ),
        },
      });
    }

    if (level === "zip") {
      let whereClause = "WHERE 1=1";
      const params: (string | number)[] = [];
      let paramIndex = 1;

      if (zone) {
        whereClause += ` AND service_zone = $${paramIndex++}`;
        params.push(zone);
      }
      if (zip) {
        whereClause += ` AND zip = $${paramIndex++}`;
        params.push(zip);
      }

      const rows = await queryRows<{
        zip: string;
        service_zone: string;
        places_with_cats: number;
        cats_needing_obs: number;
        high_priority_sites: number;
        medium_priority_sites: number;
        pct_gap: number;
        population_2023: number | null;
        median_household_income_2023: number | null;
        urbanization: string | null;
        city: string | null;
        zip_priority_score: number;
        cats_per_1000_households: number | null;
      }>(
        `SELECT * FROM ops.v_zip_observation_priority
         ${whereClause}
         ORDER BY zip_priority_score DESC
         LIMIT $${paramIndex}`,
        [...params, limit]
      );

      return NextResponse.json({
        level: "zip",
        filters: { zone, zip },
        data: rows,
        summary: {
          total_zips: rows.length,
          total_cats_needing_obs: rows.reduce(
            (sum, r) => sum + r.cats_needing_obs,
            0
          ),
          total_high_priority_sites: rows.reduce(
            (sum, r) => sum + r.high_priority_sites,
            0
          ),
        },
      });
    }

    if (level === "place") {
      let whereClause = "WHERE 1=1";
      const params: (string | number)[] = [];
      let paramIndex = 1;

      if (zone) {
        whereClause += ` AND service_zone = $${paramIndex++}`;
        params.push(zone);
      }
      if (zip) {
        whereClause += ` AND zip = $${paramIndex++}`;
        params.push(zip);
      }
      if (priority) {
        whereClause += ` AND priority_tier = $${paramIndex++}`;
        params.push(priority);
      }

      const rows = await queryRows<{
        place_id: string;
        formatted_address: string;
        service_zone: string;
        colony_classification: string | null;
        verified_cats: number;
        last_alteration_date: string | null;
        last_eartip_obs: string | null;
        max_eartips_seen: number | null;
        max_cats_observed: number | null;
        max_colony_estimate: number | null;
        has_eartip_observation: boolean;
        has_colony_estimate: boolean;
        active_requests: number;
        priority_tier: string;
        place_priority_score: number;
        observation_status: string;
        zip: string | null;
      }>(
        `SELECT * FROM sot.v_place_observation_priority
         ${whereClause}
         ORDER BY place_priority_score DESC
         LIMIT $${paramIndex}`,
        [...params, limit]
      );

      return NextResponse.json({
        level: "place",
        filters: { zone, zip, priority },
        data: rows,
        summary: {
          total_places: rows.length,
          total_verified_cats: rows.reduce((sum, r) => sum + r.verified_cats, 0),
          places_with_active_requests: rows.filter((r) => r.active_requests > 0)
            .length,
          priority_breakdown: {
            high: rows.filter((r) => r.priority_tier === "high").length,
            medium: rows.filter((r) => r.priority_tier === "medium").length,
            low: rows.filter((r) => r.priority_tier === "low").length,
          },
        },
      });
    }

    return NextResponse.json(
      { error: "Invalid level. Use: zone, zip, or place" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Error fetching beacon priorities:", error);
    return NextResponse.json(
      { error: "Failed to fetch priority data" },
      { status: 500 }
    );
  }
}
