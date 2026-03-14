import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { apiSuccess, apiNotFound, apiServerError } from "@/lib/api-response";
import { requireValidUUID } from "@/lib/api-validation";
import type { BeaconPopulationEstimate } from "@/lib/types/view-contracts";

/**
 * GET /api/beacon/population/[placeId]
 *
 * Returns Chapman mark-recapture population estimate for a place.
 * Formula: N = ((M+1)(C+1)/(R+1)) - 1
 *
 * Query params:
 *   - days: observation window in days (default: 365)
 *
 * Scientific basis:
 *   - Chapman (1951) modified Petersen estimator
 *   - Seber (1982) variance formula for 95% CI
 *   - Sample adequacy: R >= 7 recaptures (rule of thumb)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ placeId: string }> }
) {
  try {
    const { placeId } = await params;
    requireValidUUID(placeId, "place");

    const days = parseInt(
      request.nextUrl.searchParams.get("days") || "365",
      10
    );
    const observationDays = Math.min(Math.max(days, 30), 730);

    // Call the existing Chapman estimation function
    const estimate = await queryOne<BeaconPopulationEstimate>(
      `SELECT
        place_id::TEXT,
        estimated_population,
        ci_lower,
        ci_upper,
        marked_count,
        capture_count,
        recapture_count,
        sample_adequate,
        confidence_level,
        observation_start::TEXT,
        observation_end::TEXT,
        last_calculated_at::TEXT
      FROM beacon.estimate_colony_population($1, $2)
      WHERE place_id IS NOT NULL`,
      [placeId, observationDays]
    );

    if (!estimate) {
      return apiNotFound(
        "Insufficient data for population estimate. Need appointments in both halves of the observation window."
      );
    }

    const response = apiSuccess({
      estimate,
      meta: {
        method: "chapman_mark_recapture",
        formula: "N = ((M+1)(C+1)/(R+1)) - 1",
        observation_days: observationDays,
        scientific_references: [
          "Chapman DG. Some properties of the hypergeometric distribution with applications to zoological censuses. Univ Calif Publ Stat 1951;1:131-160",
          "Seber GAF. The Estimation of Animal Abundance. 2nd ed. London: Griffin; 1982",
        ],
        sample_adequacy_threshold: "R >= 7 recaptures",
      },
    });
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=300, stale-while-revalidate=600"
    );
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") {
      const apiError = error as Error & { status: number };
      return new Response(
        JSON.stringify({
          success: false,
          error: { message: error.message, code: "VALIDATION_ERROR" },
        }),
        { status: apiError.status, headers: { "Content-Type": "application/json" } }
      );
    }
    console.error("Error fetching population estimate:", error);
    return apiServerError("Failed to calculate population estimate");
  }
}
