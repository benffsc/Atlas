import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";
import { requireRole, AuthError } from "@/lib/auth";

interface PotentialDuplicate {
  duplicate_id: string;
  new_person_id: string;
  new_name: string;
  existing_person_id: string;
  existing_name: string;
  match_type: string;
  matched_identifier: string;
  name_similarity: number;
  new_source_system: string;
  existing_source_system: string;
  new_confidence: number;
  existing_confidence: number;
  created_at: string;
  new_person_requests: number;
  existing_person_requests: number;
  new_person_submissions: number;
  existing_person_submissions: number;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || "pending";
  const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 100);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

  try {
    // Require admin role
    await requireRole(request, ["admin"]);

    // Get pending duplicates
    const duplicates = await queryRows<PotentialDuplicate>(
      `SELECT
        pd.duplicate_id,
        pd.person_id AS new_person_id,
        pd.new_name,
        pd.potential_match_id AS existing_person_id,
        pd.existing_name,
        pd.match_type,
        pd.matched_identifier,
        pd.name_similarity,
        pd.new_source_system,
        pd.existing_source_system,
        pd.new_confidence,
        pd.existing_confidence,
        pd.created_at,
        COALESCE((SELECT COUNT(*) FROM trapper.sot_requests r WHERE r.requester_person_id = pd.person_id), 0) AS new_person_requests,
        COALESCE((SELECT COUNT(*) FROM trapper.sot_requests r WHERE r.requester_person_id = pd.potential_match_id), 0) AS existing_person_requests,
        COALESCE((SELECT COUNT(*) FROM trapper.web_intake_submissions s WHERE s.matched_person_id = pd.person_id), 0) AS new_person_submissions,
        COALESCE((SELECT COUNT(*) FROM trapper.web_intake_submissions s WHERE s.matched_person_id = pd.potential_match_id), 0) AS existing_person_submissions
      FROM trapper.potential_person_duplicates pd
      WHERE pd.status = $1
      ORDER BY pd.created_at DESC
      LIMIT $2 OFFSET $3`,
      [status, limit, offset]
    );

    // Get counts by status
    const counts = await queryOne<{
      pending: number;
      merged: number;
      kept_separate: number;
      dismissed: number;
    }>(
      `SELECT
        COUNT(*) FILTER (WHERE status = 'pending') AS pending,
        COUNT(*) FILTER (WHERE status = 'merged') AS merged,
        COUNT(*) FILTER (WHERE status = 'kept_separate') AS kept_separate,
        COUNT(*) FILTER (WHERE status = 'dismissed') AS dismissed
      FROM trapper.potential_person_duplicates`
    );

    return NextResponse.json({
      duplicates,
      counts: counts || { pending: 0, merged: 0, kept_separate: 0, dismissed: 0 },
      pagination: { limit, offset, hasMore: duplicates.length === limit },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }
    console.error("Error fetching potential duplicates:", error);
    // Return empty result if table doesn't exist yet
    if (error instanceof Error && error.message.includes("does not exist")) {
      return NextResponse.json({
        duplicates: [],
        counts: { pending: 0, merged: 0, kept_separate: 0, dismissed: 0 },
        pagination: { limit, offset, hasMore: false },
        note: "Migration MIG_251 needs to be applied",
      });
    }
    return NextResponse.json(
      { error: "Failed to fetch potential duplicates" },
      { status: 500 }
    );
  }
}

// Resolve a potential duplicate
export async function POST(request: NextRequest) {
  try {
    // Require admin role
    await requireRole(request, ["admin"]);

    const body = await request.json();
    const { duplicate_id, action, notes } = body;

    if (!duplicate_id) {
      return NextResponse.json(
        { error: "duplicate_id is required" },
        { status: 400 }
      );
    }

    if (!["merge", "keep_separate", "dismiss"].includes(action)) {
      return NextResponse.json(
        { error: "action must be 'merge', 'keep_separate', or 'dismiss'" },
        { status: 400 }
      );
    }

    const result = await queryOne<{ resolve_person_duplicate: boolean }>(
      `SELECT trapper.resolve_person_duplicate($1, $2, $3, $4)`,
      [duplicate_id, action, "staff", notes || null]
    );

    return NextResponse.json({
      success: true,
      duplicate_id,
      action,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }
    console.error("Error resolving duplicate:", error);
    return NextResponse.json(
      { error: "Failed to resolve duplicate" },
      { status: 500 }
    );
  }
}
