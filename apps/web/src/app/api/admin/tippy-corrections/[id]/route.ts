import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { queryOne, execute } from "@/lib/db";

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
    const correction = await queryOne(
      `
      SELECT
        pc.*,
        pc.entity_id::text,
        pc.conversation_id::text,
        pc.reviewed_by::text,
        pc.current_value::text,
        pc.proposed_value::text,
        CASE pc.entity_type
          WHEN 'person' THEN (SELECT display_name FROM sot.people WHERE person_id = pc.entity_id)
          WHEN 'cat' THEN (SELECT display_name FROM sot.cats WHERE cat_id = pc.entity_id)
          WHEN 'place' THEN (SELECT formatted_address FROM sot.places WHERE place_id = pc.entity_id)
          WHEN 'request' THEN (SELECT 'Request #' || source_record_id FROM ops.requests WHERE request_id = pc.entity_id)
        END as entity_display_name,
        s.display_name as reviewer_name
      FROM ops.tippy_proposed_corrections pc
      LEFT JOIN ops.staff s ON s.staff_id = pc.reviewed_by
      WHERE pc.correction_id = $1
      `,
      [id]
    );

    if (!correction) {
      return NextResponse.json({ error: "Correction not found" }, { status: 404 });
    }

    return NextResponse.json(correction);
  } catch (error) {
    console.error("Error fetching correction:", error);
    return NextResponse.json(
      { error: "Failed to fetch correction" },
      { status: 500 }
    );
  }
}

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
  const { status, review_notes } = body;

  // Validate status
  const validStatuses = ["proposed", "approved", "applied", "rejected"];
  if (status && !validStatuses.includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  try {
    await execute(
      `
      UPDATE ops.tippy_proposed_corrections
      SET
        status = COALESCE($1, status),
        reviewed_by = $2,
        reviewed_at = NOW(),
        review_notes = COALESCE($3, review_notes),
        updated_at = NOW()
      WHERE correction_id = $4
      `,
      [status, session.staff_id, review_notes, id]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating correction:", error);
    return NextResponse.json(
      { error: "Failed to update correction" },
      { status: 500 }
    );
  }
}
