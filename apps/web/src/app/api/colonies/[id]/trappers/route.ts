import { NextRequest } from "next/server";
import { queryRows, queryOne } from "@/lib/db";
import { requireValidUUID, withErrorHandling } from "@/lib/api-validation";
import { apiSuccess, apiBadRequest } from "@/lib/api-response";

interface SiteTrapper {
  id: string;
  trapper_person_id: string;
  display_name: string | null;
  trapper_type: string | null;
  is_primary: boolean;
  status: string;
  assigned_at: string;
  notes: string | null;
}

/**
 * GET /api/colonies/[id]/trappers
 * Returns active trapper assignments for this site.
 */
export const GET = withErrorHandling(async (
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id: siteId } = await params;
  requireValidUUID(siteId, "colony");

  const trappers = await queryRows<SiteTrapper>(
    `SELECT
       sa.id::TEXT,
       sa.trapper_person_id::TEXT,
       p.display_name,
       tp.trapper_type,
       sa.is_primary,
       sa.status,
       sa.assigned_at::TEXT,
       sa.notes
     FROM ops.site_assignments sa
     JOIN sot.people p ON p.person_id = sa.trapper_person_id
     LEFT JOIN sot.trapper_profiles tp ON tp.person_id = sa.trapper_person_id
     WHERE sa.site_id = $1
       AND sa.status = 'active'
     ORDER BY sa.is_primary DESC, sa.assigned_at ASC`,
    [siteId]
  );

  return apiSuccess({ trappers });
});

/**
 * POST /api/colonies/[id]/trappers
 * Assign a trapper to this site.
 * Body: { trapper_person_id, is_primary?, notes? }
 */
export const POST = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id: siteId } = await params;
  requireValidUUID(siteId, "colony");

  const body = await request.json();
  const { trapper_person_id, is_primary = false, notes } = body;

  if (!trapper_person_id) {
    return apiBadRequest("trapper_person_id is required");
  }
  requireValidUUID(trapper_person_id, "person");

  // Insert assignment (ON CONFLICT: if already active, do nothing)
  const result = await queryOne<{ id: string }>(
    `INSERT INTO ops.site_assignments (site_id, trapper_person_id, is_primary, notes, assigned_by)
     VALUES ($1, $2, $3, $4, 'web_user')
     ON CONFLICT (site_id, trapper_person_id) WHERE status = 'active'
     DO NOTHING
     RETURNING id::TEXT`,
    [siteId, trapper_person_id, is_primary, notes || null]
  );

  // Add timeline event
  const person = await queryOne<{ display_name: string | null }>(
    `SELECT display_name FROM sot.people WHERE person_id = $1`,
    [trapper_person_id]
  );

  await queryOne(
    `INSERT INTO ops.site_timeline (site_id, event_date, event_type, title, actor, source_table, source_id)
     VALUES ($1, NOW(), 'assignment', $2, 'staff', 'site_assignments', $3)`,
    [siteId, `Trapper assigned: ${person?.display_name || "Unknown"}`, result?.id || null]
  );

  return apiSuccess({ success: true, id: result?.id });
});

/**
 * DELETE /api/colonies/[id]/trappers
 * Unassign a trapper from this site.
 * Body: { assignment_id }
 */
export const DELETE = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id: siteId } = await params;
  requireValidUUID(siteId, "colony");

  const body = await request.json();
  const { assignment_id } = body;

  if (!assignment_id) {
    return apiBadRequest("assignment_id is required");
  }
  requireValidUUID(assignment_id, "assignment");

  // Get trapper name before completing
  const assignment = await queryOne<{ trapper_person_id: string; display_name: string | null }>(
    `SELECT sa.trapper_person_id::TEXT, p.display_name
     FROM ops.site_assignments sa
     JOIN sot.people p ON p.person_id = sa.trapper_person_id
     WHERE sa.id = $1 AND sa.site_id = $2`,
    [assignment_id, siteId]
  );

  await queryOne(
    `UPDATE ops.site_assignments
     SET status = 'completed', completed_at = NOW()
     WHERE id = $1 AND site_id = $2`,
    [assignment_id, siteId]
  );

  // Timeline event
  await queryOne(
    `INSERT INTO ops.site_timeline (site_id, event_date, event_type, title, actor, source_table, source_id)
     VALUES ($1, NOW(), 'assignment', $2, 'staff', 'site_assignments', $3)`,
    [siteId, `Trapper unassigned: ${assignment?.display_name || "Unknown"}`, assignment_id]
  );

  return apiSuccess({ success: true });
});
