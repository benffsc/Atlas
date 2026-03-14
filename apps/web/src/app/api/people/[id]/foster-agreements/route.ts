import { NextRequest } from "next/server";
import { queryRows } from "@/lib/db";
import { requireValidUUID } from "@/lib/api-validation";
import { apiSuccess, apiServerError, apiBadRequest } from "@/lib/api-response";

/**
 * GET /api/people/[id]/foster-agreements
 * Returns all foster agreements for a person (imported from Airtable).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    requireValidUUID(id, "person");

    const agreements = await queryRows<{
      agreement_id: string;
      agreement_type: string;
      signed_at: string | null;
      source_system: string;
      notes: string | null;
      created_at: string;
    }>(
      `SELECT
        agreement_id,
        agreement_type,
        signed_at::TEXT,
        source_system,
        notes,
        created_at::TEXT
      FROM ops.foster_agreements
      WHERE person_id = $1
      ORDER BY signed_at DESC NULLS LAST, created_at DESC`,
      [id]
    );

    return apiSuccess({ agreements });
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") {
      return apiBadRequest(error.message);
    }
    console.error("Error fetching foster agreements:", error);
    return apiServerError("Failed to fetch foster agreements");
  }
}
