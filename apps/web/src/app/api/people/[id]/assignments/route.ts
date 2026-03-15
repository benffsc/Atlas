import { NextRequest } from "next/server";
import { queryRows } from "@/lib/db";
import { requireValidUUID } from "@/lib/api-validation";
import { apiSuccess, apiServerError, apiBadRequest } from "@/lib/api-response";

interface AssignmentRow {
  assignment_id: string;
  request_id: string;
  request_address: string | null;
  request_status: string;
  assignment_type: string;
  assignment_status: string;
  assigned_at: string;
  notes: string | null;
  estimated_cat_count: number | null;
  cats_attributed: number;
}

/** GET /api/people/[id]/assignments — Assignment history for a trapper */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    requireValidUUID(id, "person");

    const assignments = await queryRows<AssignmentRow>(
      `SELECT
        rta.id AS assignment_id,
        rta.request_id,
        COALESCE(r.formatted_address, r.address) AS request_address,
        r.status AS request_status,
        rta.assignment_type,
        rta.status AS assignment_status,
        rta.assigned_at,
        rta.notes,
        r.estimated_cat_count,
        (
          SELECT COUNT(*)::int
          FROM ops.appointments a
          WHERE a.inferred_place_id = r.place_id
            AND COALESCE(a.resolved_person_id, a.person_id) = rta.trapper_person_id
        ) AS cats_attributed
      FROM ops.request_trapper_assignments rta
      JOIN ops.requests r ON r.request_id = rta.request_id
      WHERE rta.trapper_person_id = $1
      ORDER BY
        CASE rta.status WHEN 'active' THEN 0 WHEN 'completed' THEN 1 ELSE 2 END,
        rta.assigned_at DESC
      LIMIT 50`,
      [id]
    );

    return apiSuccess({ assignments });
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") {
      return apiBadRequest(error.message);
    }
    console.error("Error fetching assignments:", error);
    return apiServerError("Failed to fetch assignments");
  }
}
