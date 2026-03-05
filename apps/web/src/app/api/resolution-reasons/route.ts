import { NextRequest } from "next/server";
import { queryRows } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";

interface ResolutionReason {
  reason_code: string;
  reason_label: string;
  reason_description: string | null;
  applies_to_status: string[];
  requires_notes: boolean;
  display_order: number;
  outcome_category: string | null;
}

/**
 * GET /api/resolution-reasons
 * Fetch active resolution reasons for request completion/cancellation
 * Optionally filter by status using ?status=completed or ?status=cancelled
 * Optionally filter by outcome_category using ?outcome=successful
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const outcome = searchParams.get("outcome");

    let query = `
      SELECT
        reason_key as reason_code,
        reason_label,
        NULL::text as reason_description,
        applies_to_status,
        requires_notes,
        display_order,
        outcome_category
      FROM ops.request_resolution_reasons
      WHERE is_active = TRUE
    `;

    const params: string[] = [];
    let paramIdx = 1;

    if (status) {
      query += ` AND $${paramIdx} = ANY(applies_to_status)`;
      params.push(status);
      paramIdx++;
    }

    if (outcome) {
      query += ` AND outcome_category = $${paramIdx}`;
      params.push(outcome);
      paramIdx++;
    }

    query += ` ORDER BY display_order`;

    const reasons = await queryRows<ResolutionReason>(query, params);

    return apiSuccess({ reasons: reasons || [] });
  } catch (error) {
    console.error("Error fetching resolution reasons:", error);
    return apiServerError("Failed to fetch resolution reasons");
  }
}
