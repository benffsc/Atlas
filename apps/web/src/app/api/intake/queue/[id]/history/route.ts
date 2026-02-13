import { NextRequest, NextResponse } from "next/server";
import { queryRows } from "@/lib/db";

interface EditHistoryEntry {
  edit_id: string;
  field_name: string;
  old_value: unknown;
  new_value: unknown;
  edited_at: string;
  edited_by: string;
  edit_reason: string | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    // Fetch edit history from entity_edits table
    const history = await queryRows<EditHistoryEntry>(`
      SELECT
        edit_id,
        field_name,
        old_value,
        new_value,
        edited_at,
        edited_by,
        edit_reason
      FROM sot.entity_edits
      WHERE entity_type = 'intake_submission'
        AND entity_id = $1
      ORDER BY edited_at DESC
      LIMIT 50
    `, [id]);

    return NextResponse.json({ history });
  } catch (err) {
    console.error("Error fetching edit history:", err);
    return NextResponse.json(
      { error: "Failed to fetch edit history" },
      { status: 500 }
    );
  }
}
