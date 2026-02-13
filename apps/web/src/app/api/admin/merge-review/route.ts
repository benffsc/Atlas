import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";

/**
 * Merge Review API
 *
 * GET: List pending Tier 4 duplicate reviews (same name + same address)
 * POST: Bulk resolve reviews
 */

interface Tier4ReviewItem {
  duplicate_id: string;
  existing_person_id: string;
  potential_match_id: string;
  match_type: string;
  name_similarity: number;
  status: string;
  detected_at: string;
  existing_name: string;
  existing_created_at: string;
  existing_emails: string[] | null;
  existing_phones: string[] | null;
  new_name: string;
  new_source: string | null;
  shared_address: string | null;
  existing_cat_count: number;
  existing_request_count: number;
  existing_appointment_count: number;
  decision_id: string | null;
  decision_reason: string | null;
  incoming_email: string | null;
  incoming_phone: string | null;
  incoming_address: string | null;
  hours_in_queue: number;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);
  const offset = parseInt(searchParams.get("offset") || "0");
  const matchType = searchParams.get("match_type") || null;

  try {
    // Get pending Tier 4 reviews
    const reviews = await queryRows<Tier4ReviewItem>(`
      SELECT
        duplicate_id::text,
        existing_person_id::text,
        potential_match_id::text,
        match_type,
        COALESCE(name_similarity, 0)::numeric as name_similarity,
        status,
        detected_at::text,
        existing_name,
        existing_created_at::text,
        existing_emails,
        existing_phones,
        new_name,
        new_source,
        shared_address,
        COALESCE(existing_cat_count, 0)::int as existing_cat_count,
        COALESCE(existing_request_count, 0)::int as existing_request_count,
        COALESCE(existing_appointment_count, 0)::int as existing_appointment_count,
        decision_id::text,
        decision_reason,
        incoming_email,
        incoming_phone,
        incoming_address,
        COALESCE(hours_in_queue, 0)::numeric as hours_in_queue,
        resolved_by,
        resolved_at::text,
        resolution_notes
      FROM ops.v_tier4_pending_review
      WHERE ($1::text IS NULL OR match_type = $1)
      ORDER BY hours_in_queue DESC
      LIMIT $2 OFFSET $3
    `, [matchType, limit, offset]);

    // Get total count
    const countResult = await queryOne<{ count: number }>(`
      SELECT COUNT(*)::int as count
      FROM ops.v_tier4_pending_review
      WHERE ($1::text IS NULL OR match_type = $1)
    `, [matchType]);

    // Get stats
    const stats = await queryOne<{
      total_pending: number;
      same_name_same_address: number;
      tier4_same_name_same_address: number;
      avg_hours_in_queue: number;
    }>(`
      SELECT
        COUNT(*)::int as total_pending,
        COUNT(*) FILTER (WHERE match_type = 'same_name_same_address')::int as same_name_same_address,
        COUNT(*) FILTER (WHERE match_type = 'tier4_same_name_same_address')::int as tier4_same_name_same_address,
        COALESCE(AVG(hours_in_queue), 0)::numeric as avg_hours_in_queue
      FROM ops.v_tier4_pending_review
    `, []);

    return NextResponse.json({
      reviews,
      pagination: {
        total: countResult?.count || 0,
        limit,
        offset,
      },
      stats: stats || {
        total_pending: 0,
        same_name_same_address: 0,
        tier4_same_name_same_address: 0,
        avg_hours_in_queue: 0,
      },
    });
  } catch (error) {
    console.error("Error fetching merge reviews:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
