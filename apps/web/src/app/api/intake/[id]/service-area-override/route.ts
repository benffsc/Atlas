/**
 * POST /api/intake/[id]/service-area-override
 *
 * Body: { status: 'in' | 'out' }
 *
 * FFS-1187 (Phase 4). Lets staff override the auto-classified
 * service_area_status on an intake submission. Sets
 * service_area_status_source = 'staff_override' so the trigger from
 * MIG_3057 (compute_service_area_status) won't reverse the decision
 * on subsequent geocode updates.
 *
 * Audit-logged via ops.entity_edits (the existing trigger fires on
 * the UPDATE).
 */

import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { requireValidUUID } from "@/lib/api-validation";
import {
  apiSuccess,
  apiBadRequest,
  apiNotFound,
  apiServerError,
} from "@/lib/api-response";
import { requireAuth, AuthError } from "@/lib/auth";

const ALLOWED = new Set(["in", "out"]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const staff = await requireAuth(request);

    const { id } = await params;
    if (!id) return apiBadRequest("Submission ID is required");
    requireValidUUID(id, "intake");

    const body = await request.json().catch(() => ({}));
    const { status } = body as { status?: string };

    if (!status || !ALLOWED.has(status)) {
      return apiBadRequest(
        "status must be 'in' or 'out'",
        { allowed: Array.from(ALLOWED) }
      );
    }

    const updated = await queryOne<{
      submission_id: string;
      service_area_status: string;
      service_area_status_source: string;
      service_area_status_set_at: string;
    }>(
      `UPDATE ops.intake_submissions
          SET service_area_status        = $2,
              service_area_status_source = 'staff_override',
              service_area_status_set_at = NOW(),
              updated_at                 = NOW()
        WHERE submission_id = $1
       RETURNING submission_id,
                 service_area_status,
                 service_area_status_source,
                 service_area_status_set_at`,
      [id, status]
    );

    if (!updated) return apiNotFound("intake submission", id);

    return apiSuccess({
      submission: updated,
      overridden_by: staff.staff_id,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return apiBadRequest(err.message);
    }
    console.error("service-area-override error:", err);
    return apiServerError(
      err instanceof Error ? err.message : "Failed to override service area"
    );
  }
}
