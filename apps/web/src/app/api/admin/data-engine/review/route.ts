import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";

/**
 * Data Engine Review Queue API
 *
 * GET: List pending identity reviews
 */

interface ReviewItem {
  decision_id: string;
  source_system: string;
  incoming_email: string | null;
  incoming_phone: string | null;
  incoming_name: string | null;
  incoming_address: string | null;
  candidates_evaluated: number;
  top_candidate_person_id: string | null;
  top_candidate_name: string | null;
  candidate_was_merged: boolean;
  top_candidate_score: number;
  decision_type: string;
  decision_reason: string | null;
  resulting_person_id: string | null;
  resulting_name: string | null;
  score_breakdown: Record<string, number> | null;
  processed_at: string;
  review_status: string;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const status = searchParams.get("status") || "pending";
  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);
  const offset = parseInt(searchParams.get("offset") || "0");

  try {
    // Get review items
    // Handle merged persons: if candidate was merged, show the canonical person
    // Note: Use decision_type = 'review_pending' for pending items (consistent with summary API)
    const statusCondition = status === "pending"
      ? "d.decision_type = 'review_pending' AND d.reviewed_at IS NULL"
      : "d.reviewed_at IS NOT NULL";

    const reviews = await queryRows<ReviewItem>(`
      SELECT
        d.decision_id::text,
        d.source_system,
        d.incoming_email,
        d.incoming_phone,
        d.incoming_name,
        d.incoming_address,
        d.candidates_evaluated,
        -- Use canonical person if candidate was merged
        COALESCE(top_p.merged_into_person_id, d.top_candidate_person_id)::text as top_candidate_person_id,
        COALESCE(canonical_p.display_name, top_p.display_name) as top_candidate_name,
        top_p.merged_into_person_id IS NOT NULL as candidate_was_merged,
        COALESCE(d.top_candidate_score, 0)::numeric as top_candidate_score,
        d.decision_type,
        d.decision_reason,
        d.resulting_person_id::text,
        res_p.display_name as resulting_name,
        d.score_breakdown,
        d.processed_at::text,
        CASE WHEN d.reviewed_at IS NULL THEN 'pending' ELSE 'reviewed' END as review_status
      FROM trapper.data_engine_match_decisions d
      LEFT JOIN trapper.sot_people top_p ON top_p.person_id = d.top_candidate_person_id
      LEFT JOIN trapper.sot_people canonical_p ON canonical_p.person_id = top_p.merged_into_person_id
      LEFT JOIN trapper.sot_people res_p ON res_p.person_id = d.resulting_person_id
      WHERE ${statusCondition}
      ORDER BY d.processed_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    // Get total count using same condition
    const countResult = await queryOne<{ count: number }>(`
      SELECT COUNT(*)::int as count
      FROM trapper.data_engine_match_decisions d
      WHERE ${statusCondition}
    `, []);

    return NextResponse.json({
      reviews,
      pagination: {
        total: countResult?.count || 0,
        limit,
        offset,
        status,
      },
    });
  } catch (error) {
    console.error("Error fetching reviews:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
