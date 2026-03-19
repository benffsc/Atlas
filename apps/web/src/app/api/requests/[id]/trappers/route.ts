import { NextRequest } from "next/server";
import { queryRows, queryOne, withTransaction } from "@/lib/db";
import { logFieldEdit } from "@/lib/audit";
import { apiNotFound, apiSuccess } from "@/lib/api-response";
import { withErrorHandling, ApiError, requireValidUUID } from "@/lib/api-validation";

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
export const GET = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  requireValidUUID(id, "request");

  const { searchParams } = new URL(request.url);
  const includeHistory = searchParams.get("history") === "true";

  const currentTrappers = await queryRows<TrapperAssignment>(
    `SELECT
      rta.id AS assignment_id,
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
});

// POST: Assign a trapper to this request
export const POST = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  requireValidUUID(id, "request");

  const body = await request.json();
  const { trapper_person_id, is_primary = false, reason } = body;

  if (!trapper_person_id) {
    throw new ApiError("trapper_person_id is required", 400);
  }

  const assignmentId = await withTransaction(async (tx) => {
    // If setting as primary, demote any existing primary assignment
    if (is_primary) {
      await tx.query(
        `UPDATE ops.request_trapper_assignments
         SET assignment_type = 'backup'
         WHERE request_id = $1 AND assignment_type = 'primary' AND status = 'active'`,
        [id]
      );
    }

    // Check if this trapper already has a record for this request
    const existing = await tx.queryOne<{ id: string }>(
      `SELECT id FROM ops.request_trapper_assignments
       WHERE request_id = $1 AND trapper_person_id = $2`,
      [id, trapper_person_id]
    );

    let aId: string;

    if (existing) {
      const updated = await tx.queryOne<{ id: string }>(
        `UPDATE ops.request_trapper_assignments
         SET status = 'active', assignment_type = $3, notes = $4, assigned_at = NOW()
         WHERE id = $5
         RETURNING id`,
        [id, trapper_person_id, is_primary ? "primary" : "backup", reason || "manual_assignment", existing.id]
      );
      aId = updated!.id;
    } else {
      const inserted = await tx.queryOne<{ id: string }>(
        `INSERT INTO ops.request_trapper_assignments (
          request_id, trapper_person_id, assignment_type, status, notes, source_system, assigned_at
        ) VALUES (
          $1::uuid, $2::uuid, $3, 'active', $4, 'web_app', NOW()
        )
        RETURNING id`,
        [id, trapper_person_id, is_primary ? "primary" : "backup", reason || "manual_assignment"]
      );
      aId = inserted!.id;
    }

    // Update assignment_status on the request
    await tx.query(
      `UPDATE ops.requests SET assignment_status = 'assigned', no_trapper_reason = NULL WHERE request_id = $1`,
      [id]
    );

    return aId;
  });

  // Log to entity_edits (outside transaction — audit log failure shouldn't roll back assignment)
  await logFieldEdit("request", id, "trapper_assigned", null, {
    trapper_person_id,
    is_primary,
    assignment_id: assignmentId,
  }, {
    editedBy: "web_user",
    editSource: "web_ui",
    reason: reason || "manual_assignment",
  });

  return apiSuccess({
    assignment_id: assignmentId,
  });
});

// DELETE: Unassign a trapper from this request
export const DELETE = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  requireValidUUID(id, "request");

  const { searchParams } = new URL(request.url);
  const trapperPersonId = searchParams.get("trapper_person_id");
  const reason = searchParams.get("reason") || "unassigned";

  if (!trapperPersonId) {
    throw new ApiError("trapper_person_id is required", 400);
  }

  await withTransaction(async (tx) => {
    const result = await tx.queryOne<{ id: string }>(
      `UPDATE ops.request_trapper_assignments
       SET status = 'declined', notes = COALESCE(notes || ' | ', '') || $3
       WHERE request_id = $1 AND trapper_person_id = $2 AND status = 'active'
       RETURNING id`,
      [id, trapperPersonId, reason]
    );

    if (!result) {
      throw new ApiError("Trapper assignment not found", 404);
    }

    // Update assignment_status if no more active trappers
    await tx.query(
      `UPDATE ops.requests
       SET assignment_status = CASE
         WHEN EXISTS(SELECT 1 FROM ops.request_trapper_assignments WHERE request_id = $1 AND status = 'active')
         THEN 'assigned' ELSE 'pending'
       END
       WHERE request_id = $1`,
      [id]
    );
  });

  // Log to entity_edits
  await logFieldEdit("request", id, "trapper_unassigned", {
    trapper_person_id: trapperPersonId,
  }, null, {
    editedBy: "web_user",
    editSource: "web_ui",
    reason,
  });

  return apiSuccess({ unassigned: true });
});
