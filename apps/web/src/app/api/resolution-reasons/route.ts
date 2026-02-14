import { NextRequest, NextResponse } from "next/server";
import { queryRows } from "@/lib/db";

interface ResolutionReason {
  reason_code: string;
  reason_label: string;
  reason_description: string | null;
  applies_to_status: string[];
  requires_notes: boolean;
  display_order: number;
}

/**
 * GET /api/resolution-reasons
 * Fetch active resolution reasons for request completion/cancellation
 * Optionally filter by status using ?status=completed or ?status=cancelled
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");

    let query = `
      SELECT
        reason_code,
        reason_label,
        reason_description,
        applies_to_status,
        requires_notes,
        display_order
      FROM ops.request_resolution_reasons
      WHERE is_active = TRUE
    `;

    const params: string[] = [];

    if (status) {
      query += ` AND $1 = ANY(applies_to_status)`;
      params.push(status);
    }

    query += ` ORDER BY display_order`;

    const reasons = await queryRows<ResolutionReason>(query, params);

    return NextResponse.json({
      reasons: reasons || [],
    });
  } catch (error) {
    console.error("Error fetching resolution reasons:", error);
    return NextResponse.json(
      { error: "Failed to fetch resolution reasons" },
      { status: 500 }
    );
  }
}
