import { NextRequest } from "next/server";
import { queryRows, queryOne } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { apiSuccess, apiError, apiServerError } from "@/lib/api-response";
import { requireValidUUID } from "@/lib/api-validation";

interface SuggestedTrapper {
  person_id: string;
  trapper_name: string;
  trapper_type: string;
  service_type: string;
  role: string | null;
  match_reason: string;
}

/** GET /api/requests/[id]/suggested-trappers — Suggest trappers based on place */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession(request);
    if (!session) return apiError("Authentication required", 401);

    const { id } = await params;
    requireValidUUID(id, "request");

    // Get the request's place_id
    const req = await queryOne<{ place_id: string | null }>(
      `SELECT place_id FROM ops.requests WHERE request_id = $1`,
      [id]
    );

    if (!req) return apiError("Request not found", 404);
    if (!req.place_id) return apiSuccess({ suggestions: [] });

    // Get already-assigned trapper IDs
    const assigned = await queryRows<{ trapper_person_id: string }>(
      `SELECT trapper_person_id FROM ops.request_trapper_assignments
       WHERE request_id = $1 AND status = 'active'`,
      [id]
    );
    const assignedIds = new Set(assigned.map(a => a.trapper_person_id));

    // Call the DB function
    const suggestions = await queryRows<SuggestedTrapper>(
      `SELECT * FROM sot.find_trappers_for_place($1)`,
      [req.place_id]
    );

    // Filter out already-assigned trappers
    const filtered = suggestions.filter(s => !assignedIds.has(s.person_id));

    return apiSuccess({ suggestions: filtered });
  } catch (error) {
    console.error("[API] Error fetching suggested trappers:", error);
    return apiServerError("Failed to fetch suggested trappers");
  }
}
