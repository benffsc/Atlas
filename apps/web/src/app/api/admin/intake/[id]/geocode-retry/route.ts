/**
 * POST /api/admin/intake/[id]/geocode-retry
 *
 * Part of FFS-1181 Follow-Up Phase 4. Reset an intake submission's
 * geocode state to 'pending' and requeue immediately. Called from the
 * /admin/intake/geocoding DLQ review UI after staff fix an address or
 * confirm a transient failure should retry.
 *
 * Admin-only.
 */

import { NextRequest } from "next/server";
import {
  apiSuccess,
  apiForbidden,
  apiServerError,
  apiUnauthorized,
  apiNotFound,
  apiBadRequest,
} from "@/lib/api-response";
import { getSession } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { requireValidUUID, ApiError } from "@/lib/api-validation";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized();
  if (session.auth_role !== "admin" && session.auth_role !== "staff") {
    return apiForbidden("Only staff can retry geocoding");
  }

  try {
    const { id } = await params;
    requireValidUUID(id, "submission");

    const updated = await queryOne<{ submission_id: string }>(
      `UPDATE ops.intake_submissions
          SET geocode_status = 'pending',
              geocode_attempts = 0,
              geocode_last_error = NULL,
              geocode_next_attempt_at = NOW(),
              updated_at = NOW()
        WHERE submission_id = $1
        RETURNING submission_id`,
      [id]
    );

    if (!updated) return apiNotFound("Submission");

    return apiSuccess({
      submission_id: updated.submission_id,
      message: "Requeued for geocoding",
    });
  } catch (err) {
    if (err instanceof ApiError) {
      return apiBadRequest(err.message);
    }
    console.error("geocode-retry error:", err);
    return apiServerError("Failed to requeue submission");
  }
}
