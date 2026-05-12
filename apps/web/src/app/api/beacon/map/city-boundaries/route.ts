import { queryRows } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";

export const revalidate = 86400; // 24 hours — boundaries don't change

/**
 * GET /api/beacon/map/city-boundaries
 *
 * Returns city boundary polygons with impact data for choropleth map layer.
 * Uses simplified geometries for lighter payloads.
 */
export async function GET() {
  try {
    const rows = await queryRows<{
      city_name: string;
      geojson: string;
      cats_altered: number;
      total_cost: number;
      kittens_prevented: number;
      places_served: number;
    }>(`
      SELECT
        cb.city_name,
        ST_AsGeoJSON(ST_Simplify(cb.geom, 0.001)) AS geojson,
        COALESCE(ci.cats_altered, 0)::int AS cats_altered,
        COALESCE(ci.total_cost, 0)::numeric AS total_cost,
        COALESCE(ci.kittens_prevented, 0)::numeric AS kittens_prevented,
        COALESCE(ci.places_served, 0)::int AS places_served
      FROM sot.city_boundaries cb
      LEFT JOIN ops.v_economic_impact_by_city ci
        ON ci.city_name = cb.city_name AND ci.tier = 'moderate'
      ORDER BY cb.city_name
    `);

    const features = rows.map(r => ({
      type: "Feature" as const,
      properties: {
        city_name: r.city_name,
        cats_altered: r.cats_altered,
        total_cost: Number(r.total_cost),
        kittens_prevented: Number(r.kittens_prevented),
        places_served: r.places_served,
      },
      geometry: JSON.parse(r.geojson),
    }));

    return apiSuccess({
      type: "FeatureCollection",
      features,
    }, {
      headers: { "Cache-Control": "public, max-age=86400, stale-while-revalidate=172800" },
    });
  } catch (error) {
    console.error("Error fetching city boundaries:", error);
    return apiServerError("Failed to fetch city boundaries");
  }
}
