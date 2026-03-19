import { NextRequest } from "next/server";
import { queryOne, withTransaction } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { apiSuccess } from "@/lib/api-response";
import { withErrorHandling, ApiError, requireValidUUID } from "@/lib/api-validation";
import { PERSON_PLACE_ROLE } from "@/lib/enums";

interface HandoffResult {
  original_request_id: string;
  new_request_id: string;
  handoff_status: string;
}

interface ExistingPerson {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
}

/**
 * POST /api/requests/[id]/handoff
 *
 * Hands off a request to a new caretaker at a new location.
 * Unlike redirect (which implies the original address was wrong),
 * handoff represents legitimate succession of responsibility.
 *
 * Creates a new request linked to the original with non-overlapping
 * attribution windows to prevent double-counting in Beacon stats.
 */
export const POST = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const session = await getSession(request);
  if (!session) {
    throw new ApiError("Authentication required", 401);
  }

  const { id: requestId } = await params;
  requireValidUUID(requestId, "request");
  const body = await request.json();

  const {
    handoff_reason,
    existing_target_request_id,
    new_address,
    new_place_id,
    existing_person_id,
    new_requester_first_name,
    new_requester_last_name,
    new_requester_phone,
    new_requester_email,
    summary,
    notes,
    estimated_cat_count,
    has_kittens,
    kitten_count,
    kitten_age_weeks,
    kitten_assessment_status,
    kitten_assessment_outcome,
    kitten_not_needed_reason,
    new_person_role,
    is_property_owner,
    new_person_is_site_contact,
  } = body;

  if (!handoff_reason) {
    throw new ApiError("Handoff reason is required", 400);
  }

  if (new_person_role && !(PERSON_PLACE_ROLE as readonly string[]).includes(new_person_role)) {
    throw new ApiError(`Invalid person role: ${new_person_role}`, 400);
  }

  // --- Link to existing request path ---
  if (existing_target_request_id) {
    await withTransaction(async (tx) => {
      const target = await tx.queryOne<{ request_id: string; status: string }>(
        `SELECT request_id, status::TEXT FROM ops.requests WHERE request_id = $1`,
        [existing_target_request_id]
      );
      if (!target) {
        throw new ApiError(`Request with ID ${existing_target_request_id} not found`, 404);
      }
      if (["cancelled", "redirected", "handed_off"].includes(target.status)) {
        throw new ApiError("Target request is already closed and cannot be linked to", 400);
      }

      await tx.query(
        `UPDATE ops.requests SET
          status = 'handed_off',
          redirected_to_request_id = $2,
          redirect_reason = $3,
          redirect_at = NOW(),
          resolved_at = NOW(),
          transfer_type = 'handoff',
          resolution_notes = $4
        WHERE request_id = $1
          AND status NOT IN ('redirected', 'handed_off', 'cancelled')`,
        [requestId, existing_target_request_id, handoff_reason, `Handed off to existing request ${existing_target_request_id}`]
      );

      await tx.query(
        `UPDATE ops.requests SET
          redirected_from_request_id = $1,
          transfer_type = COALESCE(transfer_type, 'handoff'),
          is_property_owner = COALESCE($3, is_property_owner),
          requester_is_site_contact = COALESCE($4, requester_is_site_contact)
        WHERE request_id = $2
          AND redirected_from_request_id IS NULL`,
        [requestId, existing_target_request_id, is_property_owner ?? null, new_person_is_site_contact ?? null]
      );

      await tx.query(
        `INSERT INTO sot.entity_edits (entity_type, entity_id, edit_type, field_name, new_value, reason, edited_by)
         VALUES ('request', $1, 'field_update', 'status', to_jsonb('handed_off'::TEXT), $2, $3)`,
        [requestId, `Handed off to existing request ${existing_target_request_id}: ${handoff_reason}`, `staff:${session.staff_id}`]
      );
    });

    return apiSuccess({
      original_request_id: requestId,
      new_request_id: existing_target_request_id,
      handoff_url: `/requests/${existing_target_request_id}`,
    });
  }

  // --- Create new request path ---
  if (!new_address) {
    throw new ApiError("New address is required for handoff", 400);
  }

  let firstName = new_requester_first_name;
  let lastName = new_requester_last_name;
  let phone = new_requester_phone;
  let email = new_requester_email;

  let resolvedPersonId = existing_person_id || null;
  if (existing_person_id) {
    const existingPerson = await queryOne<ExistingPerson & { person_id: string }>(
      `WITH RECURSIVE merged AS (
         SELECT person_id, first_name, last_name, merged_into_person_id
         FROM sot.people WHERE person_id = $1
         UNION ALL
         SELECT p.person_id, p.first_name, p.last_name, p.merged_into_person_id
         FROM sot.people p
         JOIN merged m ON m.merged_into_person_id = p.person_id
       )
       SELECT m.person_id::TEXT, m.first_name, m.last_name,
         (SELECT id_value_norm FROM sot.person_identifiers
          WHERE person_id = m.person_id AND id_type = 'email' AND confidence >= 0.5
          ORDER BY confidence DESC NULLS LAST LIMIT 1) as email,
         (SELECT id_value_norm FROM sot.person_identifiers
          WHERE person_id = m.person_id AND id_type = 'phone' AND confidence >= 0.5
          ORDER BY confidence DESC NULLS LAST LIMIT 1) as phone
       FROM merged m
       WHERE m.merged_into_person_id IS NULL
       LIMIT 1`,
      [existing_person_id]
    );
    if (existingPerson) {
      resolvedPersonId = existingPerson.person_id;
      firstName = existingPerson.first_name || firstName;
      lastName = existingPerson.last_name || lastName;
      if (!phone) phone = existingPerson.phone;
      if (!email) email = existingPerson.email;
    }
  }

  const new_requester_name = lastName && firstName
    ? `${lastName}, ${firstName}`
    : lastName || firstName || null;

  if (!new_requester_name) {
    throw new ApiError("New caretaker name is required (first and last name)", 400);
  }

  const result = await queryOne<HandoffResult>(
    `SELECT * FROM ops.handoff_request(
      p_original_request_id := $1,
      p_handoff_reason := $2,
      p_new_address := $3,
      p_new_requester_name := $4,
      p_new_requester_phone := $5,
      p_new_requester_email := $6,
      p_summary := $7,
      p_notes := $8,
      p_estimated_cat_count := $9,
      p_created_by := $10,
      p_new_requester_person_id := $11,
      p_has_kittens := $12,
      p_kitten_count := $13,
      p_kitten_age_weeks := $14,
      p_kitten_assessment_status := $15,
      p_kitten_assessment_outcome := $16,
      p_kitten_not_needed_reason := $17,
      p_new_person_role := $18,
      p_is_property_owner := $19,
      p_new_person_is_site_contact := $20,
      p_resolved_place_id := $21
    )`,
    [
      requestId,
      handoff_reason,
      new_address,
      new_requester_name,
      phone || null,
      email || null,
      summary || null,
      notes || null,
      estimated_cat_count ?? null,
      `staff:${session.staff_id}`,
      resolvedPersonId || null,
      has_kittens ?? false,
      kitten_count ?? null,
      kitten_age_weeks ?? null,
      kitten_assessment_status || null,
      kitten_assessment_outcome || null,
      kitten_not_needed_reason || null,
      new_person_role || null,
      is_property_owner ?? null,
      new_person_is_site_contact ?? true,
      new_place_id || null,
    ]
  );

  if (!result) {
    throw new ApiError("Failed to hand off request", 500);
  }

  return apiSuccess({
    original_request_id: result.original_request_id,
    new_request_id: result.new_request_id,
    handoff_url: `/requests/${result.new_request_id}`,
  });
});
