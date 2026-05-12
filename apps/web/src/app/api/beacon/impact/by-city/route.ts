import { NextRequest } from "next/server";
import { queryRows } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";
import type { VCityImpactRow } from "@/lib/types/view-contracts";

export const revalidate = 3600;

/**
 * GET /api/beacon/impact/by-city?tier=moderate
 *
 * Returns economic impact for all cities with boundary data.
 * Default tier is moderate. Supports conservative/moderate/high.
 */
export async function GET(request: NextRequest) {
  try {
    const tier = request.nextUrl.searchParams.get("tier") || "moderate";
    if (!["conservative", "moderate", "high"].includes(tier)) {
      return apiServerError("Invalid tier: must be conservative, moderate, or high");
    }

    const rows = await queryRows<VCityImpactRow>(`
      SELECT
        city_name,
        cats_altered,
        female_count,
        male_count,
        places_served,
        kittens_prevented::numeric,
        shelter_cost::numeric,
        animal_control_cost::numeric,
        property_damage_cost::numeric,
        disease_cost::numeric,
        placement_cost::numeric,
        indirect_cost::numeric,
        total_cost::numeric
      FROM ops.v_economic_impact_by_city
      WHERE tier = $1
      ORDER BY total_cost DESC
    `, [tier]);

    return apiSuccess({
      tier,
      cities: rows.map(r => ({
        ...r,
        kittens_prevented: Number(r.kittens_prevented),
        shelter_cost: Number(r.shelter_cost),
        animal_control_cost: Number(r.animal_control_cost),
        property_damage_cost: Number(r.property_damage_cost),
        disease_cost: Number(r.disease_cost),
        placement_cost: Number(r.placement_cost),
        indirect_cost: Number(r.indirect_cost),
        total_cost: Number(r.total_cost),
      })),
      computed_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching city impact:", error);
    return apiServerError("Failed to fetch city impact data");
  }
}
