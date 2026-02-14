import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";

/**
 * Merge Review Resolution API
 *
 * GET: Get details of a specific duplicate review
 * POST: Resolve a pending duplicate review
 */

interface DuplicateReview {
  duplicate_id: string;
  person_id: string;
  person_name: string;
  potential_match_id: string;
  match_name: string;
  match_type: string;
  matched_identifier: string | null;
  name_similarity: number;
  status: string;
  created_at: string;
  // Context
  person_emails: string[] | null;
  person_phones: string[] | null;
  match_emails: string[] | null;
  match_phones: string[] | null;
  shared_address: string | null;
  person_cat_count: number;
  person_request_count: number;
  match_cat_count: number;
  match_request_count: number;
  // Resolution info
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const review = await queryOne<DuplicateReview>(`
      SELECT
        ppd.duplicate_id::text,
        ppd.person_id::text,
        p1.display_name as person_name,
        ppd.potential_match_id::text,
        p2.display_name as match_name,
        ppd.match_type,
        ppd.matched_identifier,
        COALESCE(ppd.name_similarity, 0)::numeric as name_similarity,
        ppd.status,
        ppd.created_at::text,
        -- Person identifiers
        (SELECT array_agg(DISTINCT pi.id_value_norm)
         FROM sot.person_identifiers pi
         WHERE pi.person_id = p1.person_id AND pi.id_type = 'email') as person_emails,
        (SELECT array_agg(DISTINCT pi.id_value_norm)
         FROM sot.person_identifiers pi
         WHERE pi.person_id = p1.person_id AND pi.id_type = 'phone') as person_phones,
        -- Match identifiers
        (SELECT array_agg(DISTINCT pi.id_value_norm)
         FROM sot.person_identifiers pi
         WHERE pi.person_id = p2.person_id AND pi.id_type = 'email') as match_emails,
        (SELECT array_agg(DISTINCT pi.id_value_norm)
         FROM sot.person_identifiers pi
         WHERE pi.person_id = p2.person_id AND pi.id_type = 'phone') as match_phones,
        -- Shared address
        (SELECT pl.formatted_address
         FROM sot.person_place_relationships ppr
         JOIN sot.places pl ON pl.place_id = ppr.place_id
         WHERE ppr.person_id = p1.person_id
         LIMIT 1) as shared_address,
        -- Counts
        (SELECT COUNT(*) FROM sot.person_cat_relationships pcr WHERE pcr.person_id = p1.person_id)::int as person_cat_count,
        (SELECT COUNT(*) FROM ops.requests r WHERE r.requester_person_id = p1.person_id)::int as person_request_count,
        (SELECT COUNT(*) FROM sot.person_cat_relationships pcr WHERE pcr.person_id = p2.person_id)::int as match_cat_count,
        (SELECT COUNT(*) FROM ops.requests r WHERE r.requester_person_id = p2.person_id)::int as match_request_count,
        -- Resolution info
        ppd.resolved_by,
        ppd.resolved_at::text,
        ppd.resolution_notes
      FROM sot.person_dedup_candidates ppd
      JOIN sot.people p1 ON p1.person_id = ppd.person_id
      JOIN sot.people p2 ON p2.person_id = ppd.potential_match_id
      WHERE ppd.duplicate_id = $1::uuid
    `, [id]);

    if (!review) {
      return NextResponse.json({ error: "Review not found" }, { status: 404 });
    }

    return NextResponse.json({ review });
  } catch (error) {
    console.error("Error fetching review:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

interface ResolveResult {
  success: boolean;
  message: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json();
    const { action, notes, resolved_by } = body;

    if (!action) {
      return NextResponse.json(
        { error: "action is required (merge, keep_separate, dismiss)" },
        { status: 400 }
      );
    }

    const validActions = ["merge", "keep_separate", "dismiss"];
    if (!validActions.includes(action)) {
      return NextResponse.json(
        { error: `Invalid action. Must be one of: ${validActions.join(", ")}` },
        { status: 400 }
      );
    }

    // Call the resolution function
    const result = await queryOne<{ resolve_person_duplicate: boolean }>(`
      SELECT trapper.resolve_person_duplicate($1::uuid, $2, $3, $4)
    `, [id, action, resolved_by || "api_user", notes || null]);

    if (!result?.resolve_person_duplicate) {
      return NextResponse.json(
        { error: "Failed to resolve review" },
        { status: 500 }
      );
    }

    // Get the updated status
    const updated = await queryOne<{ status: string; resolved_at: string }>(`
      SELECT status, resolved_at::text
      FROM sot.person_dedup_candidates
      WHERE duplicate_id = $1::uuid
    `, [id]);

    return NextResponse.json({
      success: true,
      message: `Review resolved with action: ${action}`,
      duplicate_id: id,
      action,
      resolved_by: resolved_by || "api_user",
      status: updated?.status,
      resolved_at: updated?.resolved_at,
    });
  } catch (error) {
    console.error("Error resolving review:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    // Check for specific error messages
    if (errorMessage.includes("not found")) {
      return NextResponse.json({ error: "Review not found" }, { status: 404 });
    }
    if (errorMessage.includes("already resolved")) {
      return NextResponse.json({ error: "Review already resolved" }, { status: 409 });
    }

    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
