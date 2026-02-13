import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { queryRows, queryOne } from "@/lib/db";

export async function GET(request: NextRequest) {
  const session = await getSession(request);
  if (!session || session.auth_role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || "proposed";
  const limit = parseInt(searchParams.get("limit") || "50");
  const offset = parseInt(searchParams.get("offset") || "0");

  try {
    // Build status filter
    const statusFilter =
      status === "all"
        ? ""
        : "WHERE pc.status = $1";
    const params = status === "all" ? [] : [status];

    // Get corrections
    const corrections = await queryRows(
      `
      SELECT
        pc.correction_id,
        pc.entity_type,
        pc.entity_id::text,
        pc.field_name,
        pc.current_value::text,
        pc.proposed_value::text,
        pc.confidence,
        pc.discovery_context,
        pc.reasoning,
        pc.evidence_sources,
        pc.status,
        pc.conversation_id::text,
        pc.reviewed_by::text,
        pc.reviewed_at,
        pc.review_notes,
        pc.created_at,
        -- Entity display name
        CASE pc.entity_type
          WHEN 'person' THEN (SELECT display_name FROM sot.people WHERE person_id = pc.entity_id)
          WHEN 'cat' THEN (SELECT display_name FROM sot.cats WHERE cat_id = pc.entity_id)
          WHEN 'place' THEN (SELECT formatted_address FROM sot.places WHERE place_id = pc.entity_id)
          WHEN 'request' THEN (SELECT 'Request #' || source_record_id FROM ops.requests WHERE request_id = pc.entity_id)
        END as entity_display_name,
        -- Reviewer name
        s.display_name as reviewer_name
      FROM trapper.tippy_proposed_corrections pc
      LEFT JOIN ops.staff s ON s.staff_id = pc.reviewed_by
      ${statusFilter}
      ORDER BY
        CASE pc.confidence WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
        pc.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
      `,
      params
    );

    // Get stats
    const stats = await queryOne<{
      proposed: string;
      approved: string;
      applied: string;
      rejected: string;
      total: string;
    }>(
      `
      SELECT
        COUNT(*) FILTER (WHERE status = 'proposed') as proposed,
        COUNT(*) FILTER (WHERE status = 'approved') as approved,
        COUNT(*) FILTER (WHERE status = 'applied') as applied,
        COUNT(*) FILTER (WHERE status = 'rejected') as rejected,
        COUNT(*) as total
      FROM trapper.tippy_proposed_corrections
      `
    );

    return NextResponse.json({
      corrections,
      stats: stats
        ? {
            proposed: parseInt(stats.proposed),
            approved: parseInt(stats.approved),
            applied: parseInt(stats.applied),
            rejected: parseInt(stats.rejected),
            total: parseInt(stats.total),
          }
        : null,
    });
  } catch (error) {
    console.error("Error fetching corrections:", error);
    return NextResponse.json(
      { error: "Failed to fetch corrections" },
      { status: 500 }
    );
  }
}
