import { NextRequest } from "next/server";
import { query, queryOne } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { apiSuccess, apiBadRequest, apiUnauthorized, apiNotFound, apiServerError } from "@/lib/api-response";

interface RouteParams {
  params: Promise<{ date: string; id: string }>;
}

/**
 * GET /api/admin/clinic-days/[date]/entries/[id]
 * Get a single entry
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    // Require auth
    const session = await getSession(request);
    if (!session) {
      return apiUnauthorized();
    }

    const { id } = await params;

    const entry = await queryOne(
      `SELECT * FROM ops.v_clinic_day_entries WHERE entry_id = $1`,
      [id]
    );

    if (!entry) {
      return apiNotFound("entry", id);
    }

    return apiSuccess({ entry });
  } catch (error) {
    console.error("Clinic day entry fetch error:", error);
    return apiServerError("Failed to fetch entry");
  }
}

/**
 * PATCH /api/admin/clinic-days/[date]/entries/[id]
 * Update an entry
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    // Require auth
    const session = await getSession(request);
    if (!session) {
      return apiUnauthorized();
    }

    const { id } = await params;
    const body = await request.json();

    // Check entry exists
    const existing = await queryOne<{ entry_id: string }>(
      `SELECT entry_id FROM ops.clinic_day_entries WHERE entry_id = $1`,
      [id]
    );

    if (!existing) {
      return apiNotFound("entry", id);
    }

    // Build update
    const updates: string[] = [];
    const updateParams: (string | number | null)[] = [];
    let paramIndex = 1;

    const allowedFields = [
      "trapper_person_id",
      "place_id",
      "request_id",
      "source_description",
      "cat_count",
      "female_count",
      "male_count",
      "unknown_sex_count",
      "status",
      "notes",
    ];

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updates.push(`${field} = $${paramIndex++}`);
        updateParams.push(body[field]);
      }
    }

    if (updates.length === 0) {
      return apiBadRequest("No fields to update");
    }

    // Validate status if provided — must match DB CHECK constraint
    if (body.status) {
      const validStatuses = [
        // Surgical workflow
        "checked_in", "in_surgery", "recovering", "released", "held",
        // Master list import
        "completed", "no_show", "cancelled", "partial", "pending",
      ];
      if (!validStatuses.includes(body.status)) {
        return apiBadRequest(`Invalid status. Must be one of: ${validStatuses.join(", ")}`);
      }
    }

    updates.push(`updated_at = NOW()`);

    await query(
      `UPDATE ops.clinic_day_entries SET ${updates.join(", ")} WHERE entry_id = $${paramIndex}`,
      [...updateParams, id]
    );

    return apiSuccess({ updated: true });
  } catch (error) {
    console.error("Clinic day entry update error:", error);
    return apiServerError("Failed to update entry");
  }
}

/**
 * DELETE /api/admin/clinic-days/[date]/entries/[id]
 * Delete an entry
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    // Require auth
    const session = await getSession(request);
    if (!session) {
      return apiUnauthorized();
    }

    const { id } = await params;

    // Check entry exists
    const existing = await queryOne<{ entry_id: string }>(
      `SELECT entry_id FROM ops.clinic_day_entries WHERE entry_id = $1`,
      [id]
    );

    if (!existing) {
      return apiNotFound("entry", id);
    }

    await query(
      `DELETE FROM ops.clinic_day_entries WHERE entry_id = $1`,
      [id]
    );

    return apiSuccess({ deleted: true });
  } catch (error) {
    console.error("Clinic day entry delete error:", error);
    return apiServerError("Failed to delete entry");
  }
}
