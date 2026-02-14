import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";

interface PendingTrapperLink {
  pending_id: string;
  airtable_record_id: string;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  trapper_type: string | null;
  failure_reason: string | null;
  candidate_person_ids: string[] | null;
  candidate_scores: { person_id: string; score: number; reason: string }[] | null;
  status: string;
  created_at: string;
  candidate_details: { person_id: string; display_name: string }[] | null;
}

/**
 * GET /api/admin/trapper-linking
 * List pending trapper links for manual resolution
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || "pending";
  const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 100);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

  try {
    // Get pending trapper links
    const pending = await queryRows<PendingTrapperLink>(
      `SELECT
        ptl.pending_id,
        ptl.airtable_record_id,
        ptl.display_name,
        ptl.email,
        ptl.phone,
        ptl.address,
        ptl.trapper_type,
        ptl.failure_reason,
        ptl.candidate_person_ids,
        ptl.candidate_scores,
        ptl.status,
        ptl.created_at,
        (
          SELECT jsonb_agg(jsonb_build_object(
            'person_id', p.person_id,
            'display_name', p.display_name
          ))
          FROM sot.people p
          WHERE p.person_id = ANY(ptl.candidate_person_ids)
            AND p.merged_into_person_id IS NULL
        ) as candidate_details
      FROM ops.pending_trapper_links ptl
      WHERE ptl.status = $1
      ORDER BY ptl.created_at DESC
      LIMIT $2 OFFSET $3`,
      [status, limit, offset]
    );

    // Get counts by status
    const counts = await queryOne<{
      pending: number;
      linked: number;
      created: number;
      dismissed: number;
    }>(
      `SELECT
        COUNT(*) FILTER (WHERE status = 'pending') AS pending,
        COUNT(*) FILTER (WHERE status = 'linked') AS linked,
        COUNT(*) FILTER (WHERE status = 'created') AS created,
        COUNT(*) FILTER (WHERE status = 'dismissed') AS dismissed
      FROM ops.pending_trapper_links`
    );

    return NextResponse.json({
      pending,
      counts: counts || { pending: 0, linked: 0, created: 0, dismissed: 0 },
      pagination: { limit, offset, hasMore: pending.length === limit },
    });
  } catch (error) {
    console.error("Error fetching pending trapper links:", error);
    // Return empty result if table doesn't exist yet
    if (error instanceof Error && error.message.includes("does not exist")) {
      return NextResponse.json({
        pending: [],
        counts: { pending: 0, linked: 0, created: 0, dismissed: 0 },
        pagination: { limit, offset, hasMore: false },
        note: "MIG_558 needs to be applied",
      });
    }
    return NextResponse.json(
      { error: "Failed to fetch pending trapper links" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/trapper-linking
 * Resolve a pending trapper link
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { pending_id, person_id, action, notes } = body;

    if (!pending_id) {
      return NextResponse.json(
        { error: "pending_id is required" },
        { status: 400 }
      );
    }

    if (!["link", "create", "dismiss"].includes(action)) {
      return NextResponse.json(
        { error: "action must be 'link', 'create', or 'dismiss'" },
        { status: 400 }
      );
    }

    if (action !== "dismiss" && !person_id) {
      return NextResponse.json(
        { error: "person_id is required for link/create actions" },
        { status: 400 }
      );
    }

    const result = await queryOne<{ resolve_pending_trapper_link: { success: boolean; error?: string; person_id?: string } }>(
      `SELECT ops.resolve_pending_trapper_link($1, $2, $3, $4, $5)`,
      [pending_id, person_id || null, action, "staff", notes || null]
    );

    const response = result?.resolve_pending_trapper_link;

    if (!response?.success) {
      return NextResponse.json(
        { error: response?.error || "Failed to resolve" },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      pending_id,
      person_id: response.person_id,
      action,
    });
  } catch (error) {
    console.error("Error resolving pending trapper link:", error);
    return NextResponse.json(
      { error: "Failed to resolve pending trapper link" },
      { status: 500 }
    );
  }
}
