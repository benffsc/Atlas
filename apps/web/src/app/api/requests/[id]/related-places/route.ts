import { NextRequest } from "next/server";
import { queryRows, queryOne } from "@/lib/db";
import { requireValidUUID, withErrorHandling, ApiError } from "@/lib/api-validation";
import { apiSuccess, apiBadRequest, apiNotFound } from "@/lib/api-response";
import { getSession } from "@/lib/auth";

interface RelatedPlaceRow {
  id: string;
  request_id: string;
  place_id: string;
  relationship_type: string;
  relationship_notes: string | null;
  is_primary_trapping_site: boolean;
  evidence_type: string;
  confidence: number;
  source_system: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // Joined from sot.places
  display_name: string | null;
  formatted_address: string | null;
  locality: string | null;
  place_kind: string | null;
  latitude: number | null;
  longitude: number | null;
}

/**
 * GET /api/requests/[id]/related-places
 *
 * Returns all related places for a request, joined with place display info.
 */
export const GET = withErrorHandling(async (
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  requireValidUUID(id, "request");

  const rows = await queryRows<RelatedPlaceRow>(
    `SELECT
      rrpl.id,
      rrpl.request_id,
      rrpl.place_id::TEXT,
      rrpl.relationship_type,
      rrpl.relationship_notes,
      rrpl.is_primary_trapping_site,
      rrpl.evidence_type,
      rrpl.confidence,
      rrpl.source_system,
      rrpl.created_by,
      rrpl.created_at,
      rrpl.updated_at,
      p.display_name,
      p.formatted_address,
      p.locality,
      p.place_kind,
      p.latitude,
      p.longitude
    FROM ops.request_related_places rrpl
    JOIN sot.places p ON p.place_id = rrpl.place_id
    WHERE rrpl.request_id = $1
    ORDER BY rrpl.is_primary_trapping_site DESC, rrpl.created_at ASC`,
    [id]
  );

  return apiSuccess({ related_places: rows });
});

/**
 * POST /api/requests/[id]/related-places
 *
 * Add a new related place to a request.
 * Accepts place_id (resolved) or raw_address (auto-resolve via find_or_create_place_deduped).
 */
export const POST = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  requireValidUUID(id, "request");

  const session = await getSession(request);
  if (!session) return apiBadRequest("Not authenticated");

  let body: {
    place_id?: string | null;
    raw_address?: string;
    relationship_type: string;
    relationship_notes?: string;
    is_primary_trapping_site?: boolean;
  };

  try {
    body = await request.json();
  } catch {
    throw new ApiError("Invalid JSON", 400);
  }

  if (!body.relationship_type) {
    throw new ApiError("relationship_type is required", 400);
  }

  // Verify request exists
  const requestExists = await queryOne(
    `SELECT 1 FROM ops.requests WHERE request_id = $1`,
    [id]
  );
  if (!requestExists) return apiNotFound("Request not found");

  let placeId = body.place_id || null;

  // Auto-resolve place if not already resolved
  if (!placeId && body.raw_address) {
    const resolved = await queryOne<{ place_id: string }>(
      `SELECT sot.find_or_create_place_deduped(
        $1, NULL, NULL, NULL, 'atlas_ui'
      )::TEXT AS place_id`,
      [body.raw_address]
    );
    placeId = resolved?.place_id || null;
  }

  if (!placeId) {
    throw new ApiError("Could not resolve place. Provide place_id or raw_address.", 400);
  }

  requireValidUUID(placeId, "place");

  const row = await queryOne<{ id: string }>(
    `INSERT INTO ops.request_related_places (
      request_id, place_id, relationship_type, relationship_notes,
      is_primary_trapping_site, source_system, created_by
    ) VALUES ($1, $2, $3, $4, $5, 'atlas_ui', $6)
    ON CONFLICT (request_id, place_id, relationship_type) DO UPDATE SET
      relationship_notes = EXCLUDED.relationship_notes,
      is_primary_trapping_site = EXCLUDED.is_primary_trapping_site,
      updated_at = NOW()
    RETURNING id::TEXT`,
    [
      id,
      placeId,
      body.relationship_type,
      body.relationship_notes ?? null,
      body.is_primary_trapping_site ?? false,
      session.email || null,
    ]
  );

  return apiSuccess({
    id: row?.id,
    place_id: placeId,
    relationship_type: body.relationship_type,
  });
});

/**
 * DELETE /api/requests/[id]/related-places
 *
 * Remove a related place link by its id (passed as ?related_place_id=...).
 */
export const DELETE = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  requireValidUUID(id, "request");

  const session = await getSession(request);
  if (!session) return apiBadRequest("Not authenticated");

  const relatedPlaceId = request.nextUrl.searchParams.get("related_place_id");
  if (!relatedPlaceId) {
    throw new ApiError("related_place_id query parameter is required", 400);
  }
  requireValidUUID(relatedPlaceId, "related_place");

  const deleted = await queryOne(
    `DELETE FROM ops.request_related_places
     WHERE id = $1 AND request_id = $2
     RETURNING id`,
    [relatedPlaceId, id]
  );

  if (!deleted) {
    return apiNotFound("Related place link not found");
  }

  return apiSuccess({ deleted: true });
});
