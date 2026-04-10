import { queryOne } from "@/lib/db";
import { apiSuccess, apiNotFound } from "@/lib/api-response";
import { requireValidUUID, withErrorHandling, ApiError } from "@/lib/api-validation";
import { NextRequest } from "next/server";

/**
 * POST /api/equipment/[id]/agreement
 *
 * Store a signed equipment loan agreement. Called after the checkout
 * event succeeds — the event_id links the agreement to the checkout.
 *
 * The agreement_text is a SNAPSHOT of what was displayed to the borrower
 * at the time of signing. Even if the admin changes the config-driven
 * agreement template later, the signed version is preserved.
 *
 * FFS-1207 (Layer 2.1 of the Equipment Overhaul epic FFS-1201).
 */
export const POST = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  requireValidUUID(id, "equipment");

  const body = await request.json();
  const {
    event_id,
    person_id,
    person_name,
    agreement_version,
    agreement_text,
    signature_value,
    signature_type,
  } = body;

  if (!person_name?.trim()) {
    throw new ApiError("person_name is required", 400);
  }
  if (!agreement_text?.trim()) {
    throw new ApiError("agreement_text is required", 400);
  }
  if (!signature_value?.trim()) {
    throw new ApiError("signature_value (typed name) is required", 400);
  }

  // Verify equipment exists
  const equipment = await queryOne<{ equipment_id: string }>(
    `SELECT equipment_id FROM ops.equipment WHERE equipment_id = $1`,
    [id],
  );
  if (!equipment) {
    return apiNotFound("equipment", id);
  }

  // Validate event_id if provided
  if (event_id) {
    requireValidUUID(event_id, "event");
  }
  if (person_id) {
    requireValidUUID(person_id, "person");
  }

  const result = await queryOne<{ agreement_id: string }>(
    `INSERT INTO ops.equipment_agreements (
       event_id, equipment_id, person_id, person_name,
       agreement_version, agreement_text,
       signature_type, signature_value,
       source_system
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'atlas_ui')
     RETURNING agreement_id`,
    [
      event_id || null,
      id,
      person_id || null,
      person_name.trim(),
      agreement_version || "1.0",
      agreement_text.trim(),
      signature_type || "typed_name",
      signature_value.trim(),
    ],
  );

  return apiSuccess({ agreement_id: result?.agreement_id });
});
