import { NextRequest } from "next/server";
import { queryRows } from "@/lib/db";
import { requireValidUUID } from "@/lib/api-validation";
import { apiSuccess, apiServerError, apiBadRequest } from "@/lib/api-response";

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface PersonAddress {
  place_id: string;
  formatted_address: string | null;
  display_name: string | null;
  role: string;
  confidence: number | null;
}

/**
 * GET /api/people/[id]/addresses
 *
 * Returns all addresses associated with a person from sot.person_place.
 * Used for address autofill in intake forms.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  try {
    requireValidUUID(id, "person");

    // V2: Uses sot.person_place instead of sot.person_place_relationships, relationship_type instead of role
    const addresses = await queryRows<PersonAddress>(
      `
      SELECT
        pp.place_id,
        pl.formatted_address,
        pl.display_name,
        pp.relationship_type AS role,
        pp.confidence
      FROM sot.person_place pp
      JOIN sot.places pl ON pl.place_id = pp.place_id
      WHERE pp.person_id = $1
        AND pl.merged_into_place_id IS NULL
      ORDER BY
        pp.confidence DESC NULLS LAST,
        CASE pp.relationship_type
          WHEN 'resident' THEN 1
          WHEN 'owner' THEN 2
          WHEN 'requester' THEN 3
          ELSE 4
        END,
        pp.created_at DESC
      `,
      [id]
    );

    return apiSuccess({ addresses });
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") {
      return apiBadRequest(error.message);
    }
    console.error("Error fetching person addresses:", error);
    return apiServerError("Failed to fetch addresses");
  }
}
