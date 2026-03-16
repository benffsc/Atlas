import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { queryRows } from "@/lib/db";
import { apiSuccess, apiUnauthorized, apiServerError } from "@/lib/api-response";

interface Lookup {
  lookup_id: string;
  title: string;
  query_text: string;
  summary: string | null;
  entity_type: string | null;
  entity_id: string | null;
  entity_display: string | null;
  created_at: string;
}

/**
 * GET /api/me/lookups
 *
 * List current staff member's saved lookups
 * Query params: status (active|archived|all)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request);

    if (!session?.staff_id) {
      return apiUnauthorized();
    }

    const url = new URL(request.url);
    const status = url.searchParams.get("status") || "active";

    let statusFilter = "AND status = 'active'";
    if (status === "all") {
      statusFilter = "AND status != 'deleted'";
    } else if (status === "archived") {
      statusFilter = "AND status = 'archived'";
    }

    const lookups = await queryRows<Lookup>(
      `SELECT
        l.lookup_id,
        l.title,
        l.query_text,
        l.summary,
        l.entity_type,
        l.entity_id,
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
      WHERE l.staff_id = $1
        ${statusFilter}
      ORDER BY l.created_at DESC`,
      [session.staff_id]
    );

    return apiSuccess({ lookups });
  } catch (error: any) {
    if (error?.code === '42P01') {
      // Table ops.staff_lookups doesn't exist yet
      return apiSuccess({ lookups: [] });
    }
    console.error("Error fetching lookups:", error);
    return apiServerError("Failed to fetch lookups");
  }
}
