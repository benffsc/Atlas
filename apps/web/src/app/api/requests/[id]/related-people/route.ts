import { NextRequest } from "next/server";
import { queryRows, queryOne } from "@/lib/db";
import { requireValidUUID, withErrorHandling, ApiError } from "@/lib/api-validation";
import { apiSuccess, apiBadRequest, apiNotFound } from "@/lib/api-response";
import { getSession } from "@/lib/auth";

interface RelatedPersonRow {
  id: string;
  request_id: string;
  person_id: string;
  relationship_type: string;
  relationship_notes: string | null;
  notify_before_release: boolean;
  preferred_language: string | null;
  evidence_type: string;
  confidence: number;
  source_system: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // Joined from sot.people
  display_name: string | null;
  email: string | null;
  phone: string | null;
  person_preferred_language: string | null;
}

/**
 * GET /api/requests/[id]/related-people
 *
 * Returns all related people for a request, joined with person display info.
 */
export const GET = withErrorHandling(async (
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  requireValidUUID(id, "request");

  const rows = await queryRows<RelatedPersonRow>(
    `SELECT
      rrp.id,
      rrp.request_id,
      rrp.person_id::TEXT,
      rrp.relationship_type,
      rrp.relationship_notes,
      rrp.notify_before_release,
      rrp.preferred_language,
      rrp.evidence_type,
      rrp.confidence,
      rrp.source_system,
      rrp.created_by,
      rrp.created_at,
      rrp.updated_at,
      p.display_name,
      sot.get_email(p.person_id) AS email,
      sot.get_phone(p.person_id) AS phone,
      p.preferred_language AS person_preferred_language
    FROM ops.request_related_people rrp
    JOIN sot.people p ON p.person_id = rrp.person_id
    WHERE rrp.request_id = $1
    ORDER BY rrp.created_at ASC`,
    [id]
  );

  return apiSuccess({ related_people: rows });
});

/**
 * POST /api/requests/[id]/related-people
 *
 * Add a new related person to a request.
 * Auto-resolves person via find_or_create_person if person_id not provided.
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
    person_id?: string | null;
    raw_name?: string;
    raw_phone?: string;
    raw_email?: string;
    relationship_type: string;
    relationship_notes?: string;
    notify_before_release?: boolean;
    preferred_language?: string;
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

  let personId = body.person_id || null;

  // Auto-resolve person if not already resolved
  if (!personId && (body.raw_email || body.raw_phone)) {
    const nameParts = (body.raw_name || "").trim().split(/\s+/);
    const firstName = nameParts[0] || null;
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : null;

    const resolved = await queryOne<{ person_id: string }>(
      `SELECT sot.find_or_create_person(
        $1, $2, $3, $4, NULL, 'atlas_ui'
      )::TEXT AS person_id`,
      [body.raw_email ?? null, body.raw_phone ?? null, firstName, lastName]
    );
    personId = resolved?.person_id || null;
  }

  if (!personId) {
    throw new ApiError("Could not resolve person. Provide person_id or email/phone.", 400);
  }

  const row = await queryOne<{ id: string }>(
    `INSERT INTO ops.request_related_people (
      request_id, person_id, relationship_type, relationship_notes,
      notify_before_release, preferred_language, source_system, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, 'atlas_ui', $7)
    ON CONFLICT (request_id, person_id, relationship_type) DO UPDATE SET
      relationship_notes = EXCLUDED.relationship_notes,
      notify_before_release = EXCLUDED.notify_before_release,
      preferred_language = EXCLUDED.preferred_language,
      updated_at = NOW()
    RETURNING id::TEXT`,
    [
      id,
      personId,
      body.relationship_type,
      body.relationship_notes ?? null,
      body.notify_before_release ?? false,
      body.preferred_language ?? null,
      session.email || null,
    ]
  );

  // Best-effort: set preferred_language on person if currently NULL (Manual > AI)
  if (body.preferred_language) {
    try {
      await queryOne(
        `UPDATE sot.people SET preferred_language = $1
         WHERE person_id = $2 AND preferred_language IS NULL`,
        [body.preferred_language, personId]
      );
    } catch {
      // Non-blocking
    }
  }

  return apiSuccess({
    id: row?.id,
    person_id: personId,
    relationship_type: body.relationship_type,
  });
});

/**
 * DELETE /api/requests/[id]/related-people
 *
 * Remove a related person link by its id (passed as ?related_person_id=...).
 */
export const DELETE = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  requireValidUUID(id, "request");

  const session = await getSession(request);
  if (!session) return apiBadRequest("Not authenticated");

  const relatedPersonId = request.nextUrl.searchParams.get("related_person_id");
  if (!relatedPersonId) {
    throw new ApiError("related_person_id query parameter is required", 400);
  }
  requireValidUUID(relatedPersonId, "related_person");

  const deleted = await queryOne(
    `DELETE FROM ops.request_related_people
     WHERE id = $1 AND request_id = $2
     RETURNING id`,
    [relatedPersonId, id]
  );

  if (!deleted) {
    return apiNotFound("Related person link not found");
  }

  return apiSuccess({ deleted: true });
});
