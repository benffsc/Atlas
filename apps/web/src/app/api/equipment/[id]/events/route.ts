import { queryRows, queryOne } from "@/lib/db";
import { apiSuccess, apiNotFound } from "@/lib/api-response";
import { requireValidUUID, parsePagination, withErrorHandling, ApiError } from "@/lib/api-validation";
import type { EquipmentEventRow } from "@/lib/types/view-contracts";
import { NextRequest } from "next/server";

/**
 * GET /api/equipment/[id]/events
 * Full event history for an equipment item
 */
export const GET = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  requireValidUUID(id, "equipment");

  const { searchParams } = new URL(request.url);
  const { limit, offset } = parsePagination(searchParams, { defaultLimit: 50 });

  const events = await queryRows<EquipmentEventRow>(
    `SELECT
       ev.event_id, ev.equipment_id, ev.event_type,
       ev.actor_person_id, ap.display_name AS actor_name,
       ev.custodian_person_id,
       COALESCE(cp.display_name, ev.custodian_name) AS custodian_name,
       ev.place_id, pl.formatted_address AS place_address,
       ev.request_id, ev.kit_id,
       ev.condition_before, ev.condition_after,
       ev.due_date::text, ev.notes, ev.source_system,
       ev.created_at::text,
       ev.checkout_type, ev.deposit_amount::numeric,
       ev.deposit_returned_at::text, ev.custodian_phone,
       ev.appointment_id,
       ev.checkout_purpose, ev.custodian_name_raw, ev.resolution_status,
       ev.photo_url
     FROM ops.equipment_events ev
     LEFT JOIN sot.people ap ON ap.person_id = ev.actor_person_id
     LEFT JOIN sot.people cp ON cp.person_id = ev.custodian_person_id
     LEFT JOIN sot.places pl ON pl.place_id = ev.place_id
     WHERE ev.equipment_id = $1
     ORDER BY ev.created_at DESC
     LIMIT $2 OFFSET $3`,
    [id, limit, offset]
  );

  const countResult = await queryOne<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM ops.equipment_events WHERE equipment_id = $1`,
    [id]
  );

  return apiSuccess(
    { events },
    { total: countResult?.total || 0, limit, offset, hasMore: events.length === limit }
  );
});

/**
 * POST /api/equipment/[id]/events
 * Record a new event (check_out, check_in, transfer, etc.)
 */
export const POST = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  requireValidUUID(id, "equipment");

  const body = await request.json();
  const {
    event_type, custodian_person_id, place_id, request_id,
    condition_after, due_date, notes,
    // MIG_2983 fields
    checkout_type, deposit_amount, custodian_name, custodian_phone, appointment_id,
    // MIG_2996 fields
    checkout_purpose, custodian_name_raw, resolution_status,
    // MIG_3005 fields
    photo_url,
  } = body;

  if (!event_type) {
    throw new ApiError("event_type is required", 400);
  }

  // Verify equipment exists
  const equipment = await queryOne<{ equipment_id: string; custody_status: string; condition_status: string }>(
    `SELECT equipment_id, custody_status, condition_status FROM ops.equipment WHERE equipment_id = $1`,
    [id]
  );
  if (!equipment) {
    return apiNotFound("equipment", id);
  }

  // Validate state transitions
  if (event_type === "check_out" && equipment.custody_status !== "available") {
    throw new ApiError(`Cannot check out: equipment is currently ${equipment.custody_status}`, 400);
  }
  if (event_type === "check_in" && equipment.custody_status !== "checked_out") {
    throw new ApiError(`Cannot check in: equipment is currently ${equipment.custody_status}`, 400);
  }
  // Allow check_out with either a resolved person OR free-text custodian_name (walk-ins)
  if (event_type === "check_out" && !custodian_person_id && !custodian_name) {
    throw new ApiError("custodian_person_id or custodian_name is required for check_out", 400);
  }

  // Validate UUIDs if provided
  if (custodian_person_id) requireValidUUID(custodian_person_id, "person");
  if (place_id) requireValidUUID(place_id, "place");
  if (request_id) requireValidUUID(request_id, "request");
  if (appointment_id) requireValidUUID(appointment_id, "appointment");

  // Validate checkout_type enum if provided
  if (checkout_type) {
    const validTypes = ["client", "trapper", "internal", "foster"];
    if (!validTypes.includes(checkout_type)) {
      throw new ApiError(`Invalid checkout_type: ${checkout_type}`, 400);
    }
  }

  // Validate checkout_purpose enum if provided (MIG_2996)
  if (checkout_purpose) {
    const validPurposes = ["tnr_appointment", "kitten_rescue", "colony_check", "feeding_station", "personal_pet"];
    if (!validPurposes.includes(checkout_purpose)) {
      throw new ApiError(`Invalid checkout_purpose: ${checkout_purpose}`, 400);
    }
  }

  // Validate resolution_status if provided (MIG_2996)
  if (resolution_status) {
    const validStatuses = ["resolved", "unresolved", "created"];
    if (!validStatuses.includes(resolution_status)) {
      throw new ApiError(`Invalid resolution_status: ${resolution_status}`, 400);
    }
  }

  // Validate deposit_amount if provided
  if (deposit_amount !== undefined && deposit_amount !== null) {
    const amount = Number(deposit_amount);
    if (isNaN(amount) || amount < 0) {
      throw new ApiError("deposit_amount must be a non-negative number", 400);
    }
  }

  // Insert event (trigger handles equipment table update)
  const result = await queryOne<{ event_id: string }>(
    `INSERT INTO ops.equipment_events (
       equipment_id, event_type, custodian_person_id,
       place_id, request_id,
       condition_before, condition_after,
       due_date, notes, source_system,
       checkout_type, deposit_amount, custodian_name, custodian_phone, appointment_id,
       checkout_purpose, custodian_name_raw, resolution_status,
       photo_url
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'atlas_ui', $10, $11, $12, $13, $14, $15, $16, $17, $18)
     RETURNING event_id`,
    [
      id, event_type, custodian_person_id || null,
      place_id || null, request_id || null,
      equipment.condition_status, condition_after || null,
      due_date || null, notes || null,
      checkout_type || null,
      deposit_amount !== undefined && deposit_amount !== null ? Number(deposit_amount) : null,
      custodian_name || null, custodian_phone || null,
      appointment_id || null,
      checkout_purpose || null, custodian_name_raw || null, resolution_status || null,
      photo_url || null,
    ]
  );

  return apiSuccess({ event_id: result?.event_id, event_type });
});
