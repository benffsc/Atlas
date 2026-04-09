/**
 * PATCH /api/admin/intake/[id]/geocode
 *
 * Part of FFS-1181 Follow-Up Phase 4. Staff actions on the
 * /admin/intake/geocoding DLQ review UI:
 *
 *   body: { action: "manual_override", lat: number, lng: number, formatted_address?: string }
 *   body: { action: "skip" }
 *   body: { action: "edit_address", cats_address: string, cats_city?: string, cats_zip?: string }
 *
 * Admin/staff only.
 */

import { NextRequest } from "next/server";
import {
  apiSuccess,
  apiBadRequest,
  apiForbidden,
  apiServerError,
  apiUnauthorized,
  apiNotFound,
} from "@/lib/api-response";
import { getSession } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { requireValidUUID, ApiError } from "@/lib/api-validation";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized();
  if (session.auth_role !== "admin" && session.auth_role !== "staff") {
    return apiForbidden("Only staff can edit geocoding state");
  }

  try {
    const { id } = await params;
    requireValidUUID(id, "submission");

    const body = await request.json().catch(() => ({}));
    const action = body?.action as string | undefined;

    if (action === "manual_override") {
      const lat = Number(body.lat);
      const lng = Number(body.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return apiBadRequest("lat and lng must be finite numbers");
      }
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return apiBadRequest("lat/lng out of range");
      }

      const row = await queryOne<{ submission_id: string }>(
        `UPDATE ops.intake_submissions
            SET geo_latitude            = $1,
                geo_longitude           = $2,
                geo_formatted_address   = COALESCE($3, geo_formatted_address),
                geo_confidence          = 1.0,
                geocode_status          = 'manual_override',
                geocode_last_error      = NULL,
                geocode_next_attempt_at = NULL,
                updated_at              = NOW()
          WHERE submission_id = $4
          RETURNING submission_id`,
        [lat, lng, body.formatted_address ?? null, id]
      );
      if (!row) return apiNotFound("Submission");
      return apiSuccess({ submission_id: row.submission_id, action });
    }

    if (action === "skip") {
      const row = await queryOne<{ submission_id: string }>(
        `UPDATE ops.intake_submissions
            SET geocode_status          = 'skipped',
                geocode_next_attempt_at = NULL,
                geocode_last_error      = NULL,
                updated_at              = NOW()
          WHERE submission_id = $1
          RETURNING submission_id`,
        [id]
      );
      if (!row) return apiNotFound("Submission");
      return apiSuccess({ submission_id: row.submission_id, action });
    }

    if (action === "edit_address") {
      const catsAddress = (body.cats_address as string | undefined)?.trim();
      if (!catsAddress) {
        return apiBadRequest("cats_address is required for edit_address");
      }
      const row = await queryOne<{ submission_id: string }>(
        `UPDATE ops.intake_submissions
            SET cats_address            = $1,
                cats_city               = COALESCE($2, cats_city),
                cats_zip                = COALESCE($3, cats_zip),
                geocode_status          = 'pending',
                geocode_attempts        = 0,
                geocode_next_attempt_at = NOW(),
                geocode_last_error      = NULL,
                updated_at              = NOW()
          WHERE submission_id = $4
          RETURNING submission_id`,
        [
          catsAddress,
          (body.cats_city as string | undefined) ?? null,
          (body.cats_zip as string | undefined) ?? null,
          id,
        ]
      );
      if (!row) return apiNotFound("Submission");
      return apiSuccess({ submission_id: row.submission_id, action });
    }

    return apiBadRequest(
      "action must be one of: manual_override, skip, edit_address"
    );
  } catch (err) {
    if (err instanceof ApiError) {
      return apiBadRequest(err.message);
    }
    console.error("admin/intake/geocode PATCH error:", err);
    return apiServerError("Failed to update geocoding state");
  }
}
