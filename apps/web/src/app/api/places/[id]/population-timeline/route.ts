import { NextRequest } from "next/server";
import { queryRows, queryOne } from "@/lib/db";
import { requireValidUUID } from "@/lib/api-validation";
import { apiBadRequest, apiSuccess, apiServerError } from "@/lib/api-response";

interface PopulationObservation {
  observation_id: string;
  observed_count: number;
  source_type: string;
  observation_date: string;
  estimate_before: number | null;
  estimate_after: number;
  variance_after: number;
  floor_count: number;
  ci_lower: number;
  ci_upper: number;
  confidence_level: string;
  created_at: string;
}

interface PopulationState {
  estimate: number;
  variance: number;
  last_observation_date: string | null;
  last_source_type: string | null;
  observation_count: number;
  floor_count: number;
  ci_lower: number;
  ci_upper: number;
  confidence_level: string;
}

/**
 * GET /api/places/[id]/population-timeline
 * Returns Kalman observation history + current state for a place
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return apiBadRequest("Place ID is required");
  }

  try {
    requireValidUUID(id, "place");

    // Get observation history
    const observations = await queryRows<PopulationObservation>(`
      SELECT
        po.observation_id,
        po.observed_count,
        po.source_type,
        po.observation_date,
        po.estimate_before,
        po.estimate_after,
        po.variance_after,
        po.floor_count,
        GREATEST(po.floor_count, FLOOR(po.estimate_after - 1.96 * SQRT(po.variance_after)))::INTEGER AS ci_lower,
        CEIL(po.estimate_after + 1.96 * SQRT(po.variance_after))::INTEGER AS ci_upper,
        CASE
          WHEN po.variance_after <= 5 THEN 'high'
          WHEN po.variance_after <= 20 THEN 'medium'
          ELSE 'low'
        END AS confidence_level,
        po.created_at
      FROM sot.population_observations po
      WHERE po.place_id = $1
      ORDER BY po.observation_date ASC, po.created_at ASC
    `, [id]);

    // Get current state
    const state = await queryOne<PopulationState>(`
      SELECT
        pps.estimate,
        pps.variance,
        pps.last_observation_date,
        pps.last_source_type,
        pps.observation_count,
        pps.floor_count,
        GREATEST(pps.floor_count, FLOOR(pps.estimate - 1.96 * SQRT(pps.variance)))::INTEGER AS ci_lower,
        CEIL(pps.estimate + 1.96 * SQRT(pps.variance))::INTEGER AS ci_upper,
        CASE
          WHEN pps.variance <= 5 THEN 'high'
          WHEN pps.variance <= 20 THEN 'medium'
          ELSE 'low'
        END AS confidence_level
      FROM sot.place_population_state pps
      WHERE pps.place_id = $1
    `, [id]);

    return apiSuccess({
      place_id: id,
      observations,
      state: state || null,
      has_data: observations.length > 0,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") {
      return apiBadRequest(error.message);
    }
    console.error("Population timeline error:", error);
    return apiServerError("Failed to fetch population timeline");
  }
}
