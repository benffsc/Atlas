import { NextRequest } from "next/server";
import { query, queryOne } from "@/lib/db";
import { apiSuccess } from "@/lib/api-response";
import { requireValidUUID, withErrorHandling, ApiError } from "@/lib/api-validation";

export const POST = withErrorHandling(async (request: NextRequest) => {
  const body = await request.json();
  const { submission_id, converted_by = "web_user" } = body;

  if (!submission_id) {
    throw new ApiError("submission_id is required", 400);
  }

  requireValidUUID(submission_id, "submission");

  // Call the SQL function to convert to request (MIG_2531: using ops schema)
  let result: { request_id: string } | null;
  try {
    result = await queryOne<{ request_id: string }>(
      `SELECT ops.convert_intake_to_request($1, $2) as request_id`,
      [submission_id, converted_by]
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Convert error:", msg);

    if (msg.includes("not found")) {
      throw new ApiError("intake submission not found", 404);
    }
    if (msg.includes("already converted")) {
      throw new ApiError(msg, 409);
    }
    throw new ApiError(msg, 500);
  }

  if (!result?.request_id) {
    console.error("Error converting intake: no request_id returned");
    throw new ApiError("Failed to convert submission to request", 500);
  }

  // Forward wizard form data to the created request (FFS-107)
  // The CreateRequestWizard sends these fields that the SQL function doesn't handle
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  const fieldMap: Record<string, string> = {
    priority: "priority",
    permission_status: "permission_status",
    access_notes: "access_notes",
    traps_overnight_safe: "traps_overnight_safe",
    best_contact_times: "best_contact_times",
    urgency_notes: "urgency_notes",
    trapper_notes: "notes",
    summary: "summary",
  };

  for (const [bodyField, dbColumn] of Object.entries(fieldMap)) {
    if (body[bodyField] !== undefined && body[bodyField] !== null && body[bodyField] !== "") {
      setClauses.push(`${dbColumn} = $${paramIdx}`);
      values.push(body[bodyField]);
      paramIdx++;
    }
  }

  // urgency_reasons is TEXT[] - handle separately
  if (body.urgency_reasons && Array.isArray(body.urgency_reasons) && body.urgency_reasons.length > 0) {
    setClauses.push(`urgency_reasons = $${paramIdx}::text[]`);
    values.push(body.urgency_reasons);
    paramIdx++;
  }

  if (setClauses.length > 0) {
    values.push(result.request_id);
    await query(
      `UPDATE ops.requests SET ${setClauses.join(", ")} WHERE request_id = $${paramIdx}`,
      values
    );
  }

  return apiSuccess({ request_id: result.request_id });
});
