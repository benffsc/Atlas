import { NextRequest } from "next/server";
import { queryRows, queryOne, withTransaction } from "@/lib/db";
import { apiSuccess } from "@/lib/api-response";
import {
  withErrorHandling,
  ApiError,
  requireValidUUID,
  parsePagination,
  requireNonEmptyString,
} from "@/lib/api-validation";
import { ENTITY_ENUMS } from "@/lib/enums";
import { requireValidEnum } from "@/lib/api-validation";

interface CallSheetSummary {
  call_sheet_id: string;
  title: string;
  status: string;
  assigned_to_person_id: string | null;
  assigned_to_name: string | null;
  due_date: string | null;
  notes: string | null;
  total_items: number;
  pending_items: number;
  completed_items: number;
  converted_items: number;
  created_at: string;
  assigned_at: string | null;
  completed_at: string | null;
}

interface CallSheetStats {
  total: number;
  active: number;
  draft: number;
  completed: number;
  overdue: number;
  follow_ups_pending: number;
  conversion_rate: number;
}

// GET: List call sheets with stats
export const GET = withErrorHandling(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const { limit, offset } = parsePagination(searchParams);

  const status = searchParams.get("status");
  const assignedTo = searchParams.get("assigned_to");

  if (status) {
    requireValidEnum(status, ENTITY_ENUMS.CALL_SHEET_STATUS, "status");
  }
  if (assignedTo) {
    requireValidUUID(assignedTo, "assigned_to");
  }

  // Build WHERE clause
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (status) {
    conditions.push(`status = $${paramIdx++}`);
    params.push(status);
  }
  if (assignedTo) {
    conditions.push(`assigned_to_person_id = $${paramIdx++}`);
    params.push(assignedTo);
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const sheets = await queryRows<CallSheetSummary>(
    `SELECT * FROM ops.v_call_sheet_summary
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
    [...params, limit, offset]
  );

  // Get aggregate stats (unfiltered) — includes item-level rollups
  const stats = await queryOne<CallSheetStats>(
    `WITH sheet_stats AS (
       SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE cs.status IN ('assigned', 'in_progress'))::int AS active,
         COUNT(*) FILTER (WHERE cs.status = 'draft')::int AS draft,
         COUNT(*) FILTER (WHERE cs.status = 'completed')::int AS completed,
         COUNT(*) FILTER (WHERE cs.due_date < NOW() AND cs.status NOT IN ('completed', 'expired'))::int AS overdue
       FROM ops.call_sheets cs
     ),
     item_stats AS (
       SELECT
         COUNT(*) FILTER (WHERE csi.status = 'follow_up')::int AS follow_ups_pending,
         CASE
           WHEN COUNT(*) FILTER (WHERE csi.status NOT IN ('pending', 'skipped')) = 0 THEN 0
           ELSE ROUND(100.0 * COUNT(*) FILTER (WHERE csi.status = 'converted')
                 / NULLIF(COUNT(*) FILTER (WHERE csi.status NOT IN ('pending', 'skipped')), 0))::int
         END AS conversion_rate
       FROM ops.call_sheet_items csi
     )
     SELECT ss.*, ist.follow_ups_pending, ist.conversion_rate
     FROM sheet_stats ss, item_stats ist`
  );

  // Check if there are more results
  const hasMore = sheets.length === limit;

  return apiSuccess({
    sheets,
    stats: stats || { total: 0, active: 0, draft: 0, completed: 0, overdue: 0, follow_ups_pending: 0, conversion_rate: 0 },
    pagination: { limit, offset, hasMore },
  });
});

// POST: Create a new call sheet
export const POST = withErrorHandling(async (request: NextRequest) => {
  const body = await request.json();
  const { assigned_to_person_id, due_date, notes, items } = body;

  const title = requireNonEmptyString(body.title, "title");

  if (assigned_to_person_id) {
    requireValidUUID(assigned_to_person_id, "assigned_to_person_id");
  }

  // Determine initial status
  const initialStatus = assigned_to_person_id ? "assigned" : "draft";

  const callSheetId = await withTransaction(async (tx) => {
    const sheet = await tx.queryOne<{ id: string }>(
      `INSERT INTO ops.call_sheets (
        title, status, assigned_to_person_id, due_date, notes,
        assigned_at, created_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        ${assigned_to_person_id ? "NOW()" : "NULL"}, NOW()
      )
      RETURNING call_sheet_id AS id`,
      [title, initialStatus, assigned_to_person_id || null, due_date || null, notes || null]
    );

    if (!sheet) {
      throw new ApiError("Failed to create call sheet", 500);
    }

    // Insert items if provided
    if (items && Array.isArray(items) && items.length > 0) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        await tx.query(
          `INSERT INTO ops.call_sheet_items (
            call_sheet_id, contact_name, contact_phone, contact_email,
            place_id, place_address, request_id, person_id,
            context_summary, priority_order, status, attempt_count
          ) VALUES (
            $1, $2, $3, $4,
            $5, $6, $7, $8,
            $9, $10, 'pending', 0
          )`,
          [
            sheet.id,
            item.contact_name || null,
            item.contact_phone || null,
            item.contact_email || null,
            item.place_id || null,
            item.place_address || null,
            item.request_id || null,
            item.person_id || null,
            item.context_summary || null,
            i + 1,
          ]
        );
      }
    }

    return sheet.id;
  });

  return apiSuccess({ call_sheet_id: callSheetId });
});
