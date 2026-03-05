import { NextRequest } from "next/server";
import { queryRows, queryOne } from "@/lib/db";
import { logFieldEdit } from "@/lib/audit";
import { apiBadRequest, apiNotFound, apiSuccess, apiServerError } from "@/lib/api-response";

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
    return apiBadRequest("Request ID is required");
  }

  try {
    // Get current trappers
    // V2: Uses assignment_type='primary' instead of is_primary, status='active' instead of unassigned_at IS NULL
    const currentTrappers = await queryRows<TrapperAssignment>(
      `SELECT
        rta.assignment_id,
        rta.trapper_person_id,
        p.display_name AS trapper_name,
        pr.trapper_type,
        pr.trapper_type IN ('coordinator', 'head_trapper', 'ffsc_trapper') AS is_ffsc_trapper,
        COALESCE(rta.assignment_type = 'primary', false) AS is_primary,
        rta.assigned_at,
        rta.notes AS assignment_reason
      FROM ops.request_trapper_assignments rta
      JOIN sot.people p ON p.person_id = rta.trapper_person_id
      LEFT JOIN sot.person_roles pr ON pr.person_id = rta.trapper_person_id AND pr.role = 'trapper'
      WHERE rta.request_id = $1
        AND rta.status = 'active'
      ORDER BY (rta.assignment_type = 'primary') DESC, rta.assigned_at`,
      [id]
    );

    // Optionally get assignment history
    // V2: Uses assignment_type='primary' instead of is_primary, status column instead of unassigned_at
    let history: AssignmentHistory[] = [];
    if (includeHistory) {
      history = await queryRows<AssignmentHistory>(
        `SELECT
          rta.trapper_person_id,
          p.display_name AS trapper_name,
          COALESCE(rta.assignment_type = 'primary', false) AS is_primary,
          rta.assigned_at,
          NULL::TIMESTAMPTZ AS unassigned_at,
          rta.notes AS assignment_reason,
          NULL::TEXT AS unassignment_reason,
          rta.status
        FROM ops.request_trapper_assignments rta
        JOIN sot.people p ON p.person_id = rta.trapper_person_id
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
       FROM ops.requests WHERE request_id = $1`,
      [id]
    );

    return apiSuccess({
      trappers: currentTrappers,
      history: includeHistory ? history : undefined,
      no_trapper_reason: requestStatus?.no_trapper_reason || null,
      assignment_status: requestStatus?.assignment_status || "pending",
    });
  } catch (error) {
    console.error("Error fetching request trappers:", error);
    return apiServerError("Failed to fetch request trappers");
  }
}

// POST: Assign a trapper to this request
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return apiBadRequest("Request ID is required");
  }

  try {
    const body = await request.json();
    const { trapper_person_id, is_primary = false, reason } = body;

    if (!trapper_person_id) {
      return apiBadRequest("trapper_person_id is required");
    }

    // If setting as primary, demote any existing primary assignment
    if (is_primary) {
      await queryOne(
        `UPDATE ops.request_trapper_assignments
         SET assignment_type = 'backup'
         WHERE request_id = $1 AND assignment_type = 'primary' AND status = 'active'`,
        [id]
      );
    }

    // Insert assignment (or reactivate if previously unassigned)
    const result = await queryOne<{ assignment_id: string }>(
      `INSERT INTO ops.request_trapper_assignments (
        request_id, trapper_person_id, assignment_type, status, notes, source_system, assigned_at
      ) VALUES (
        $1::uuid, $2::uuid, $3, 'active', $4, 'web_app', NOW()
      )
      ON CONFLICT (request_id, trapper_person_id)
      DO UPDATE SET
        status = 'active',
        assignment_type = EXCLUDED.assignment_type,
        notes = EXCLUDED.notes,
        assigned_at = NOW()
      RETURNING assignment_id`,
      [id, trapper_person_id, is_primary ? "primary" : "backup", reason || "manual_assignment"]
    );

    if (!result) {
      return apiServerError("Failed to assign trapper");
    }

    // Update assignment_status on the request
    await queryOne(
      `UPDATE ops.requests SET assignment_status = 'assigned', no_trapper_reason = NULL WHERE request_id = $1`,
      [id]
    );

    // Log to entity_edits for SOT audit trail
    await logFieldEdit("request", id, "trapper_assigned", null, {
      trapper_person_id,
      is_primary,
      assignment_id: result.assignment_id,
    }, {
      editedBy: "web_user",
      editSource: "web_ui",
      reason: reason || "manual_assignment",
    });

    return apiSuccess({
      assignment_id: result.assignment_id,
    });
  } catch (error) {
    console.error("Error assigning trapper:", error);
    return apiServerError("Failed to assign trapper");
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
    return apiBadRequest("Request ID and trapper_person_id are required");
  }

  try {
    const result = await queryOne<{ assignment_id: string }>(
      `UPDATE ops.request_trapper_assignments
       SET status = 'declined', notes = COALESCE(notes || ' | ', '') || $3
       WHERE request_id = $1 AND trapper_person_id = $2 AND status = 'active'
       RETURNING assignment_id`,
      [id, trapperPersonId, reason]
    );

    if (!result) {
      return apiNotFound("Trapper assignment", trapperPersonId);
    }

    // Update assignment_status if no more active trappers
    await queryOne(
      `UPDATE ops.requests
       SET assignment_status = CASE
         WHEN EXISTS(SELECT 1 FROM ops.request_trapper_assignments WHERE request_id = $1 AND status = 'active')
         THEN 'assigned' ELSE 'pending'
       END
       WHERE request_id = $1`,
      [id]
    );

    // Log to entity_edits for SOT audit trail
    await logFieldEdit("request", id, "trapper_unassigned", {
      trapper_person_id: trapperPersonId,
    }, null, {
      editedBy: "web_user",
      editSource: "web_ui",
      reason,
    });

    return apiSuccess({ unassigned: true });
  } catch (error) {
    console.error("Error unassigning trapper:", error);
    return apiServerError("Failed to unassign trapper");
  }
}
