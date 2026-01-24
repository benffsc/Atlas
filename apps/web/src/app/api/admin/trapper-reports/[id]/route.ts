import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { queryOne, queryRows, execute } from "@/lib/db";

/**
 * GET /api/admin/trapper-reports/[id]
 * Get a single trapper report submission with all items
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession(request);
  if (!session || session.auth_role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { id } = await params;

  try {
    // Get submission
    const submission = await queryOne(
      `
      SELECT
        s.submission_id::text,
        s.reporter_email,
        s.reporter_person_id::text,
        s.reporter_match_confidence,
        s.reporter_match_candidates,
        s.raw_content,
        s.content_type,
        s.received_at,
        s.extraction_status,
        s.extracted_at,
        s.ai_extraction,
        s.reviewed_by,
        s.reviewed_at,
        s.review_notes,
        s.extraction_error,
        s.created_at,
        s.source_system,
        -- Reporter details
        p.display_name as reporter_name
      FROM trapper.trapper_report_submissions s
      LEFT JOIN trapper.sot_people p ON p.person_id = s.reporter_person_id
      WHERE s.submission_id = $1
      `,
      [id]
    );

    if (!submission) {
      return NextResponse.json({ error: "Submission not found" }, { status: 404 });
    }

    // Get all items with entity details
    const items = await queryRows(
      `
      SELECT
        i.item_id::text,
        i.submission_id::text,
        i.item_type,
        i.target_entity_type,
        i.target_entity_id::text,
        i.match_confidence,
        i.match_candidates,
        i.extracted_text,
        i.extracted_data,
        i.review_status,
        i.final_entity_id::text,
        i.final_data,
        i.committed_at,
        i.commit_result,
        i.created_at,
        -- Entity display name based on type
        CASE i.target_entity_type
          WHEN 'person' THEN (SELECT display_name FROM trapper.sot_people WHERE person_id = i.target_entity_id)
          WHEN 'place' THEN (SELECT formatted_address FROM trapper.places WHERE place_id = i.target_entity_id)
          WHEN 'request' THEN (
            SELECT 'Request at ' || COALESCE(pl.formatted_address, 'unknown')
            FROM trapper.sot_requests r
            LEFT JOIN trapper.places pl ON pl.place_id = r.place_id
            WHERE r.request_id = i.target_entity_id
          )
        END as target_entity_name,
        -- Request status for request items
        CASE WHEN i.target_entity_type = 'request' THEN
          (SELECT status::text FROM trapper.sot_requests WHERE request_id = i.target_entity_id)
        END as current_request_status
      FROM trapper.trapper_report_items i
      WHERE i.submission_id = $1
      ORDER BY i.created_at
      `,
      [id]
    );

    return NextResponse.json({
      submission,
      items,
    });
  } catch (error) {
    console.error("Error fetching trapper report:", error);
    return NextResponse.json(
      { error: "Failed to fetch trapper report" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/admin/trapper-reports/[id]
 * Update submission review status
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession(request);
  if (!session || session.auth_role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();
  const { extraction_status, review_notes } = body;

  // Validate status
  const validStatuses = ["pending", "extracting", "extracted", "reviewed", "committed", "failed"];
  if (extraction_status && !validStatuses.includes(extraction_status)) {
    return NextResponse.json(
      { error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` },
      { status: 400 }
    );
  }

  try {
    await execute(
      `
      UPDATE trapper.trapper_report_submissions
      SET
        extraction_status = COALESCE($1, extraction_status),
        reviewed_by = $2,
        reviewed_at = CASE WHEN $1 = 'reviewed' THEN NOW() ELSE reviewed_at END,
        review_notes = COALESCE($3, review_notes)
      WHERE submission_id = $4
      `,
      [extraction_status, session.staff_id || session.email, review_notes, id]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating trapper report:", error);
    return NextResponse.json(
      { error: "Failed to update trapper report" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/trapper-reports/[id]
 * Delete a submission and its items
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession(request);
  if (!session || session.auth_role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { id } = await params;

  try {
    // Check if any items have been committed
    const committed = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM trapper.trapper_report_items WHERE submission_id = $1 AND committed_at IS NOT NULL`,
      [id]
    );

    if (committed && parseInt(committed.count) > 0) {
      return NextResponse.json(
        { error: "Cannot delete submission with committed items" },
        { status: 400 }
      );
    }

    // Delete items first (due to FK)
    await execute(
      `DELETE FROM trapper.trapper_report_items WHERE submission_id = $1`,
      [id]
    );

    // Delete submission
    await execute(
      `DELETE FROM trapper.trapper_report_submissions WHERE submission_id = $1`,
      [id]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting trapper report:", error);
    return NextResponse.json(
      { error: "Failed to delete trapper report" },
      { status: 500 }
    );
  }
}
