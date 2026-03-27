import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { requireValidUUID } from "@/lib/api-validation";
import { apiSuccess, apiUnauthorized, apiBadRequest, apiNotFound, apiServerError } from "@/lib/api-response";

interface LookupDetail {
  lookup_id: string;
  title: string;
  query_text: string;
  summary: string | null;
  result_data: Record<string, unknown>;
  entity_type: string | null;
  entity_id: string | null;
  entity_display: string | null;
  tool_calls: unknown[] | null;
  created_at: string;
}

/**
 * GET /api/me/lookups/[id]
 *
 * Get full lookup detail including result_data
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession(request);

    if (!session?.staff_id) {
      return apiUnauthorized();
    }

    const { id } = await params;
    requireValidUUID(id, "lookup");

    const lookup = await queryOne<LookupDetail>(
      `SELECT
        l.lookup_id,
        l.title,
        l.query_text,
        l.summary,
        l.result_data,
        l.entity_type,
        l.entity_id,
        l.tool_calls,
        l.created_at,
        CASE
          WHEN l.entity_type = 'place' THEN (
            SELECT p.display_name FROM sot.places p WHERE p.place_id = l.entity_id
          )
          WHEN l.entity_type = 'cat' THEN (
            SELECT c.display_name FROM sot.cats c WHERE c.cat_id = l.entity_id
          )
          WHEN l.entity_type = 'person' THEN (
            SELECT per.display_name FROM sot.people per WHERE per.person_id = l.entity_id
          )
          WHEN l.entity_type = 'request' THEN (
            SELECT req.summary FROM ops.requests req WHERE req.request_id = l.entity_id
          )
          ELSE NULL
        END as entity_display
      FROM ops.staff_lookups l
      WHERE l.lookup_id = $1 AND l.staff_id = $2`,
      [id, session.staff_id]
    );

    if (!lookup) {
      return apiNotFound("lookup", id);
    }

    return apiSuccess({ lookup });
  } catch (error: any) {
    if (error?.code === '42P01') {
      // Table ops.staff_lookups doesn't exist yet
      return apiSuccess({ lookup: null });
    }
    console.error("Error fetching lookup:", error);
    return apiServerError("Failed to fetch lookup");
  }
}

/**
 * PATCH /api/me/lookups/[id]
 *
 * Archive a lookup
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession(request);

    if (!session?.staff_id) {
      return apiUnauthorized();
    }

    const { id } = await params;
    requireValidUUID(id, "lookup");
    const body = await request.json();
    const { status } = body;

    if (status !== "archived" && status !== "active") {
      return apiBadRequest("Invalid status");
    }

    const result = await queryOne<{ lookup_id: string }>(
      `UPDATE ops.staff_lookups
       SET
         status = $1,
         archived_at = ${status === "archived" ? "NOW()" : "NULL"},
         updated_at = NOW()
       WHERE lookup_id = $2 AND staff_id = $3
       RETURNING lookup_id`,
      [status, id, session.staff_id]
    );

    if (!result) {
      return apiNotFound("lookup", id);
    }

    return apiSuccess({
      success: true,
      message: status === "archived" ? "Lookup archived" : "Lookup restored",
    });
  } catch (error: any) {
    if (error?.code === '42P01') {
      // Table ops.staff_lookups doesn't exist yet
      return apiSuccess({ lookup: null });
    }
    console.error("Error updating lookup:", error);
    return apiServerError("Failed to update lookup");
  }
}

/**
 * DELETE /api/me/lookups/[id]
 *
 * Soft delete a lookup
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession(request);

    if (!session?.staff_id) {
      return apiUnauthorized();
    }

    const { id } = await params;
    requireValidUUID(id, "lookup");

    const result = await queryOne<{ lookup_id: string }>(
      `UPDATE ops.staff_lookups
       SET status = 'deleted', updated_at = NOW()
       WHERE lookup_id = $1 AND staff_id = $2
       RETURNING lookup_id`,
      [id, session.staff_id]
    );

    if (!result) {
      return apiNotFound("lookup", id);
    }

    return apiSuccess({
      success: true,
      message: "Lookup deleted",
    });
  } catch (error: any) {
    if (error?.code === '42P01') {
      // Table ops.staff_lookups doesn't exist yet
      return apiSuccess({ lookup: null });
    }
    console.error("Error deleting lookup:", error);
    return apiServerError("Failed to delete lookup");
  }
}
