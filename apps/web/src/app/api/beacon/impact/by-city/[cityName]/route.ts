import { NextRequest } from "next/server";
import { queryRows } from "@/lib/db";
import { apiSuccess, apiNotFound, apiServerError } from "@/lib/api-response";

export const revalidate = 3600;

/**
 * GET /api/beacon/impact/by-city/[cityName]?granularity=year
 *
 * Returns single city with all 3 tiers + timeseries data.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ cityName: string }> }
) {
  try {
    const { cityName } = await params;
    const decodedCity = decodeURIComponent(cityName);
    const granularity = request.nextUrl.searchParams.get("granularity") || "year";

    // Get all 3 tiers for this city
    const tiers = await queryRows<{
      tier: string;
      cats_altered: number;
      female_count: number;
      male_count: number;
      places_served: number;
      kittens_prevented: number;
      shelter_cost: number;
      animal_control_cost: number;
      property_damage_cost: number;
      disease_cost: number;
      placement_cost: number;
      indirect_cost: number;
      total_cost: number;
    }>(`
      SELECT tier, cats_altered, female_count, male_count, places_served,
             kittens_prevented::numeric, shelter_cost::numeric,
             animal_control_cost::numeric, property_damage_cost::numeric,
             disease_cost::numeric, placement_cost::numeric,
             indirect_cost::numeric, total_cost::numeric
      FROM ops.v_economic_impact_by_city
      WHERE city_name ILIKE $1
    `, [decodedCity]);

    if (tiers.length === 0) {
      return apiNotFound(`No impact data for city: ${decodedCity}`);
    }

    // Get timeseries
    const timeseries = await queryRows<{
      period: string;
      cats_altered: number;
      female_count: number;
      male_count: number;
      kittens_prevented_moderate: number;
      total_cost_moderate: number;
    }>(`
      SELECT period, cats_altered, female_count, male_count,
             kittens_prevented_moderate::numeric, total_cost_moderate::numeric
      FROM ops.city_impact_timeseries($1, $2)
    `, [decodedCity, granularity]);

    const tierMap = Object.fromEntries(tiers.map(t => [t.tier, {
      ...t,
      kittens_prevented: Number(t.kittens_prevented),
      shelter_cost: Number(t.shelter_cost),
      animal_control_cost: Number(t.animal_control_cost),
      property_damage_cost: Number(t.property_damage_cost),
      disease_cost: Number(t.disease_cost),
      placement_cost: Number(t.placement_cost),
      indirect_cost: Number(t.indirect_cost),
      total_cost: Number(t.total_cost),
    }]));

    return apiSuccess({
      city_name: decodedCity,
      tiers: tierMap,
      timeseries: timeseries.map(t => ({
        ...t,
        kittens_prevented_moderate: Number(t.kittens_prevented_moderate),
        total_cost_moderate: Number(t.total_cost_moderate),
      })),
      computed_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching city impact detail:", error);
    return apiServerError("Failed to fetch city impact detail");
  }
}
