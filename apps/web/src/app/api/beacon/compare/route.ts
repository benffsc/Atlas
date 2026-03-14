import { NextRequest } from "next/server";
import { queryRows } from "@/lib/db";
import {
  apiSuccess,
  apiBadRequest,
  apiServerError,
} from "@/lib/api-response";
import { isValidUUID } from "@/lib/api-validation";
import type { BeaconPlaceComparisonRow } from "@/lib/types/view-contracts";

/**
 * GET /api/beacon/compare?places=id1,id2,id3
 *
 * Returns side-by-side metrics for multiple places.
 * Useful for comparing colonies, evaluating TNR progress across locations.
 *
 * Query params:
 *   - places: comma-separated place UUIDs (required, max 10)
 */
export async function GET(request: NextRequest) {
  try {
    const placesParam = request.nextUrl.searchParams.get("places");

    if (!placesParam) {
      return apiBadRequest("Missing required parameter: places (comma-separated UUIDs)");
    }

    const placeIds = placesParam.split(",").map((id) => id.trim());

    if (placeIds.length === 0) {
      return apiBadRequest("At least one place ID is required");
    }
    if (placeIds.length > 10) {
      return apiBadRequest("Maximum 10 places can be compared at once");
    }

    // Validate all UUIDs
    for (const id of placeIds) {
      if (!isValidUUID(id)) {
        return apiBadRequest(`Invalid UUID: ${id}`);
      }
    }

    const places = await queryRows<BeaconPlaceComparisonRow>(
      `SELECT
        place_id::TEXT,
        display_name,
        formatted_address,
        lat,
        lng,
        service_zone,
        total_cats,
        altered_cats,
        intact_cats,
        unknown_status_cats,
        alteration_rate_pct,
        colony_status,
        total_requests,
        active_requests,
        total_appointments,
        last_appointment_date::TEXT,
        first_appointment_date::TEXT,
        estimated_population,
        ci_lower,
        ci_upper,
        sample_adequate,
        people_count,
        days_since_last_activity
      FROM beacon.compare_places($1)`,
      [placeIds]
    );

    // Compute comparison summary
    const totalCats = places.reduce((s, p) => s + p.total_cats, 0);
    const totalAltered = places.reduce((s, p) => s + p.altered_cats, 0);
    const totalIntact = places.reduce((s, p) => s + p.intact_cats, 0);
    const knownStatus = totalAltered + totalIntact;

    const best = places.reduce(
      (best, p) =>
        (p.alteration_rate_pct ?? 0) > (best?.alteration_rate_pct ?? 0)
          ? p
          : best,
      places[0]
    );
    const worst = places.reduce(
      (worst, p) =>
        (p.alteration_rate_pct ?? 100) < (worst?.alteration_rate_pct ?? 100)
          ? p
          : worst,
      places[0]
    );

    const response = apiSuccess({
      places,
      summary: {
        places_compared: places.length,
        places_requested: placeIds.length,
        combined_cats: totalCats,
        combined_altered: totalAltered,
        combined_alteration_rate:
          knownStatus > 0
            ? Math.round((1000 * totalAltered) / knownStatus) / 10
            : null,
        best_performing: best
          ? {
              place_id: best.place_id,
              name: best.display_name || best.formatted_address,
              alteration_rate: best.alteration_rate_pct,
            }
          : null,
        worst_performing: worst
          ? {
              place_id: worst.place_id,
              name: worst.display_name || worst.formatted_address,
              alteration_rate: worst.alteration_rate_pct,
            }
          : null,
      },
    });
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=120, stale-while-revalidate=300"
    );
    return response;
  } catch (error) {
    console.error("Error comparing places:", error);
    return apiServerError("Failed to compare places");
  }
}
