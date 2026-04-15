import { queryOne } from "@/lib/db";
import { apiSuccess, apiNotFound } from "@/lib/api-response";
import { withErrorHandling, ApiError } from "@/lib/api-validation";
import { NextRequest } from "next/server";

/**
 * POST /api/equipment/scan-slips/commit
 *
 * Takes a single reviewed slip and creates the check_out event.
 * Looks up equipment by barcode, then POSTs to the events endpoint
 * internally (same trigger-driven path as the kiosk).
 *
 * FFS-1234.
 */
export const POST = withErrorHandling(async (request: NextRequest) => {
  const body = await request.json();
  const {
    barcode,
    person_name,
    person_id,
    phone,
    email,
    address,
    purpose,
    deposit_amount,
    checkout_date,
    appointment_date,
    staff_name,
    notes,
    actor_person_id,
  } = body;

  if (!barcode) {
    throw new ApiError("barcode is required", 400);
  }
  if (!person_name) {
    throw new ApiError("person_name is required", 400);
  }

  // Look up equipment by barcode
  const equipment = await queryOne<{
    equipment_id: string;
    custody_status: string;
    display_name: string;
  }>(
    `SELECT equipment_id, custody_status,
            COALESCE(equipment_name, barcode, equipment_type) AS display_name
     FROM ops.equipment WHERE barcode = $1 AND retired_at IS NULL`,
    [barcode],
  );

  if (!equipment) {
    return apiNotFound("equipment with barcode", barcode);
  }

  // Build notes with context
  const notesParts = [
    notes,
    checkout_date ? `Actual checkout date: ${checkout_date}` : null,
    appointment_date ? `Appointment: ${appointment_date}` : null,
    phone ? `Phone: ${phone}` : null,
    email ? `Email: ${email}` : null,
    address ? `Address: ${address}` : null,
    staff_name ? `Staff: ${staff_name}` : null,
    "Entered via scan-slips batch processor",
  ]
    .filter(Boolean)
    .join(". ");

  // Determine event type — if already checked out, use transfer (auto-convert guard)
  const eventType =
    equipment.custody_status === "checked_out" ? "transfer" : "check_out";

  // Calculate due date from purpose
  const dueDays: Record<string, number> = {
    ffr: 3,
    well_check: 7,
    rescue_recovery: 14,
    trap_training: 7,
    transport: 3,
  };
  const offsetDays = dueDays[purpose] || 14;
  const baseDate = checkout_date ? new Date(checkout_date) : new Date();
  baseDate.setDate(baseDate.getDate() + offsetDays);
  const dueDate = baseDate.toISOString().split("T")[0];

  // Insert the event (trigger handles equipment table update)
  const result = await queryOne<{ event_id: string }>(
    `INSERT INTO ops.equipment_events (
       equipment_id, event_type, actor_person_id,
       custodian_person_id, custodian_name, custodian_name_raw,
       checkout_purpose, due_date, deposit_amount,
       notes, source_system, resolution_status
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, $9, $10, 'atlas_ui', $11)
     RETURNING event_id`,
    [
      equipment.equipment_id,
      eventType,
      actor_person_id || null,
      person_id || null,
      person_name,
      person_name,
      purpose || null,
      dueDate,
      deposit_amount > 0 ? deposit_amount : null,
      notesParts,
      person_id ? "resolved" : "unresolved",
    ],
  );

  return apiSuccess({
    event_id: result?.event_id,
    equipment_id: equipment.equipment_id,
    equipment_name: equipment.display_name,
    event_type: eventType,
  });
});
