import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";
import { logFieldEdit } from "@/lib/audit";

interface TrapperAssignment {
  assignment_id: string;
  trapper_person_id: string;
  trapper_name: string;
  trapper_type: string;
  is_ffsc_trapper: boolean;
  is_primary: boolean;
  assigned_at: string;
  assignment_reason: string | null;
}

interface AssignmentHistory {
  trapper_person_id: string;
  trapper_name: string;
  is_primary: boolean;
  assigned_at: string;
  unassigned_at: string | null;
  assignment_reason: string | null;
  unassignment_reason: string | null;
  status: string;
}

// GET: List trappers assigned to this request
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const includeHistory = searchParams.get("history") === "true";

  if (!id) {
    return NextResponse.json(
      { error: "Request ID is required" },
      { status: 400 }
    );
  }

  try {
    // Get current trappers
    const currentTrappers = await queryRows<TrapperAssignment>(
      `SELECT
        rta.assignment_id,
        rta.trapper_person_id,
        p.display_name AS trapper_name,
        pr.trapper_type,
        pr.trapper_type IN ('coordinator', 'head_trapper', 'ffsc_trapper') AS is_ffsc_trapper,
        rta.is_primary,
        rta.assigned_at,
        rta.assignment_reason
      FROM trapper.request_trapper_assignments rta
      JOIN trapper.sot_people p ON p.person_id = rta.trapper_person_id
      LEFT JOIN trapper.person_roles pr ON pr.person_id = rta.trapper_person_id AND pr.role = 'trapper'
      WHERE rta.request_id = $1
        AND rta.unassigned_at IS NULL
      ORDER BY rta.is_primary DESC, rta.assigned_at`,
      [id]
    );

    // Optionally get assignment history
    let history: AssignmentHistory[] = [];
    if (includeHistory) {
      history = await queryRows<AssignmentHistory>(
        `SELECT
          rta.trapper_person_id,
          p.display_name AS trapper_name,
          rta.is_primary,
          rta.assigned_at,
          rta.unassigned_at,
          rta.assignment_reason,
          rta.unassignment_reason,
          CASE WHEN rta.unassigned_at IS NULL THEN 'active' ELSE 'inactive' END AS status
        FROM trapper.request_trapper_assignments rta
        JOIN trapper.sot_people p ON p.person_id = rta.trapper_person_id
        WHERE rta.request_id = $1
        ORDER BY rta.assigned_at`,
        [id]
      );
    }

    // SC_004: Fetch no_trapper_reason and assignment_status for UI display
    const requestStatus = await queryOne<{
      no_trapper_reason: string | null;
      assignment_status: string;
    }>(
      `SELECT no_trapper_reason, assignment_status::TEXT
       FROM trapper.sot_requests WHERE request_id = $1`,
      [id]
    );

    return NextResponse.json({
      trappers: currentTrappers,
      history: includeHistory ? history : undefined,
      no_trapper_reason: requestStatus?.no_trapper_reason || null,
      assignment_status: requestStatus?.assignment_status || "pending",
    });
  } catch (error) {
    console.error("Error fetching request trappers:", error);
    return NextResponse.json(
      { error: "Failed to fetch request trappers" },
      { status: 500 }
    );
  }
}

// POST: Assign a trapper to this request
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Request ID is required" },
      { status: 400 }
    );
  }

  try {
    const body = await request.json();
    const { trapper_person_id, is_primary = false, reason } = body;

    if (!trapper_person_id) {
      return NextResponse.json(
        { error: "trapper_person_id is required" },
        { status: 400 }
      );
    }

    // Use the assign function
    const result = await queryOne<{ assign_trapper_to_request: string }>(
      `SELECT trapper.assign_trapper_to_request(
        $1::uuid,
        $2::uuid,
        $3::boolean,
        $4::text,
        'web_app',
        'web_user'
      ) AS assign_trapper_to_request`,
      [id, trapper_person_id, is_primary, reason || "manual"]
    );

    if (!result) {
      return NextResponse.json(
        { error: "Failed to assign trapper" },
        { status: 500 }
      );
    }

    // Log to entity_edits for SOT audit trail
    await logFieldEdit("request", id, "trapper_assigned", null, {
      trapper_person_id,
      is_primary,
      assignment_id: result.assign_trapper_to_request,
    }, {
      editedBy: "web_user",
      editSource: "web_ui",
      reason: reason || "manual_assignment",
    });

    return NextResponse.json({
      success: true,
      assignment_id: result.assign_trapper_to_request,
    });
  } catch (error) {
    console.error("Error assigning trapper:", error);
    return NextResponse.json(
      { error: "Failed to assign trapper" },
      { status: 500 }
    );
  }
}

// DELETE: Unassign a trapper from this request
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const trapperPersonId = searchParams.get("trapper_person_id");
  const reason = searchParams.get("reason") || "unassigned";

  if (!id || !trapperPersonId) {
    return NextResponse.json(
      { error: "Request ID and trapper_person_id are required" },
      { status: 400 }
    );
  }

  try {
    const result = await queryOne<{ unassign_trapper_from_request: boolean }>(
      `SELECT trapper.unassign_trapper_from_request($1::uuid, $2::uuid, $3::text) AS unassign_trapper_from_request`,
      [id, trapperPersonId, reason]
    );

    if (!result?.unassign_trapper_from_request) {
      return NextResponse.json(
        { error: "Trapper was not assigned to this request" },
        { status: 404 }
      );
    }

    // Log to entity_edits for SOT audit trail
    await logFieldEdit("request", id, "trapper_unassigned", {
      trapper_person_id: trapperPersonId,
    }, null, {
      editedBy: "web_user",
      editSource: "web_ui",
      reason,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error unassigning trapper:", error);
    return NextResponse.json(
      { error: "Failed to unassign trapper" },
      { status: 500 }
    );
  }
}
