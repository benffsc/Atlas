import { NextRequest, NextResponse } from "next/server";
import { queryRows } from "@/lib/db";

/**
 * Entity History API
 *
 * GET /api/entities/{type}/{id}/history - Get complete edit history for an entity
 */

interface EditHistoryRow {
  edit_id: string;
  entity_type: string;
  entity_id: string;
  edit_type: string;
  field_name: string | null;
  old_value: string | null;
  new_value: string | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
  reason: string | null;
  notes: string | null;
  batch_id: string | null;
  editor: string;
  edit_source: string;
  created_at: string;
  is_rolled_back: boolean;
  rolled_back_at: string | null;
  related_entity_name: string | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ type: string; id: string }> }
) {
  const { type, id } = await params;
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get("limit") || "50");

  const history = await queryRows<EditHistoryRow>(`
    SELECT
      e.edit_id,
      e.entity_type,
      e.entity_id,
      e.edit_type,
      e.field_name,
      e.old_value,
      e.new_value,
      e.related_entity_type,
      e.related_entity_id,
      e.reason,
      e.notes,
      e.batch_id,
      COALESCE(e.edited_by_name, e.edited_by) as editor,
      e.edit_source,
      e.created_at,
      e.is_rolled_back,
      e.rolled_back_at,
      -- Get related entity name if exists
      CASE e.related_entity_type
        WHEN 'person' THEN (SELECT display_name FROM sot.people WHERE person_id = e.related_entity_id)
        WHEN 'cat' THEN (SELECT display_name FROM sot.cats WHERE cat_id = e.related_entity_id)
        WHEN 'place' THEN (SELECT display_name FROM sot.places WHERE place_id = e.related_entity_id)
        ELSE NULL
      END as related_entity_name
    FROM sot.entity_edits e
    WHERE e.entity_type = $1
      AND e.entity_id = $2
    ORDER BY e.created_at DESC
    LIMIT $3
  `, [type, id, limit]);

  // Group by batch_id for related changes
  const grouped: Record<string, EditHistoryRow[]> = {};
  const ungrouped: EditHistoryRow[] = [];

  for (const row of history) {
    if (row.batch_id) {
      if (!grouped[row.batch_id]) {
        grouped[row.batch_id] = [];
      }
      grouped[row.batch_id].push(row);
    } else {
      ungrouped.push(row);
    }
  }

  return NextResponse.json({
    history,
    grouped_changes: grouped,
    individual_changes: ungrouped,
    total: history.length,
  });
}
