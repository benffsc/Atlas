import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireValidUUID, requireValidEnum } from "@/lib/api-validation";
import {
  apiSuccess,
  apiBadRequest,
  apiServerError,
  apiUnauthorized,
} from "@/lib/api-response";
import { PERSON_PLACE_ROLE } from "@/lib/enums";

/**
 * POST /api/entity-links
 *
 * Centralized endpoint for creating entity relationships.
 * Currently supports person→place links via sot.link_person_to_place().
 *
 * FFS-498: All person-place relationship creation should route through here
 * (or through SQL functions that call sot.link_person_to_place() directly).
 *
 * Body:
 * {
 *   link_type: "person_place",
 *   person_id: string (UUID),
 *   place_id: string (UUID),
 *   role: PersonPlaceRole,       // e.g., "resident", "property_owner", "site_contact"
 *   confidence?: number,          // 0.0-1.0, default 0.9
 *   evidence_type?: string,       // "manual" (default), "inferred", "imported"
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session) {
      return apiUnauthorized("Authentication required");
    }

    const body = await request.json();
    const { link_type, person_id, place_id, role, confidence, evidence_type } =
      body;

    if (!link_type) {
      return apiBadRequest("link_type is required");
    }

    if (link_type !== "person_place") {
      return apiBadRequest(
        `Unsupported link_type: ${link_type}. Supported: person_place`
      );
    }

    // Validate required fields
    requireValidUUID(person_id, "person_id");
    requireValidUUID(place_id, "place_id");

    if (!role) {
      return apiBadRequest("role is required");
    }

    requireValidEnum(role, PERSON_PLACE_ROLE, "role");

    // Validate confidence range if provided
    const linkConfidence =
      confidence !== undefined && confidence !== null
        ? Number(confidence)
        : 0.9;
    if (isNaN(linkConfidence) || linkConfidence < 0 || linkConfidence > 1) {
      return apiBadRequest("confidence must be a number between 0 and 1");
    }

    const linkEvidenceType = evidence_type || "manual";

    // Call centralized SQL function
    const result = await queryOne<{ link_person_to_place: string | null }>(
      `SELECT sot.link_person_to_place(
        p_person_id := $1::UUID,
        p_place_id := $2::UUID,
        p_relationship_type := $3,
        p_evidence_type := $4,
        p_source_system := 'atlas_ui',
        p_confidence := $5::NUMERIC
      )`,
      [person_id, place_id, role, linkEvidenceType, linkConfidence]
    );

    const linkId = result?.link_person_to_place;

    if (!linkId) {
      return apiBadRequest(
        "Could not create link. Person or place may not exist, or may be merged into another entity."
      );
    }

    return apiSuccess({
      link_id: linkId,
      link_type: "person_place",
      person_id,
      place_id,
      role,
      confidence: linkConfidence,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") {
      return apiBadRequest(error.message);
    }
    console.error("[POST /api/entity-links] Error:", error);
    return apiServerError("Failed to create entity link");
  }
}
