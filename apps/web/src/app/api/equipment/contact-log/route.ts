import { queryOne, queryRows } from "@/lib/db";
import { apiSuccess } from "@/lib/api-response";
import { withErrorHandling, ApiError } from "@/lib/api-validation";
import { NextRequest } from "next/server";

/**
 * GET /api/equipment/contact-log?holder=NAME&person_id=UUID
 *
 * Fetch contact attempt history for a person/holder.
 */
export const GET = withErrorHandling(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const holder = searchParams.get("holder");
  const personId = searchParams.get("person_id");

  if (!holder && !personId) {
    throw new ApiError("holder or person_id is required", 400);
  }

  const attempts = await queryRows<{
    attempt_id: string;
    attempted_at: string;
    method: string;
    outcome: string;
    notes: string | null;
    staff_name: string | null;
  }>(
    `SELECT attempt_id, attempted_at::text, method, outcome, notes, staff_name
     FROM ops.equipment_contact_attempts
     WHERE ($1::uuid IS NOT NULL AND person_id = $1::uuid)
        OR ($2 IS NOT NULL AND holder_name = $2)
     ORDER BY attempted_at DESC
     LIMIT 20`,
    [personId || null, holder || null],
  );

  return apiSuccess({ attempts });
});

/**
 * POST /api/equipment/contact-log
 *
 * Log a contact attempt for equipment follow-up.
 * FFS-1335 (Equipment Follow-Up Call Queue epic FFS-1331).
 */
export const POST = withErrorHandling(async (request: NextRequest) => {
  const body = await request.json();
  const {
    person_id,
    holder_name,
    method,
    outcome,
    notes,
    staff_person_id,
    staff_name,
    equipment_ids,
  } = body;

  if (!holder_name) {
    throw new ApiError("holder_name is required", 400);
  }
  if (!method) {
    throw new ApiError("method is required (call, text, email, in_person)", 400);
  }
  if (!outcome) {
    throw new ApiError("outcome is required", 400);
  }

  const validMethods = ["call", "text", "email", "in_person", "system"];
  if (!validMethods.includes(method)) {
    throw new ApiError(`Invalid method: ${method}. Must be one of: ${validMethods.join(", ")}`, 400);
  }

  const validOutcomes = [
    "connected_will_return", "connected_needs_time", "connected_other",
    "left_voicemail", "no_answer", "wrong_number", "texted", "emailed",
    "auto_escalated",
  ];
  if (!validOutcomes.includes(outcome)) {
    throw new ApiError(`Invalid outcome: ${outcome}. Must be one of: ${validOutcomes.join(", ")}`, 400);
  }

  const result = await queryOne<{ attempt_id: string }>(
    `INSERT INTO ops.equipment_contact_attempts
       (person_id, holder_name, method, outcome, notes, staff_person_id, staff_name, equipment_ids)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING attempt_id`,
    [
      person_id || null,
      holder_name,
      method,
      outcome,
      notes?.trim() || null,
      staff_person_id || null,
      staff_name || null,
      equipment_ids || null,
    ],
  );

  return apiSuccess({ attempt_id: result?.attempt_id });
});
