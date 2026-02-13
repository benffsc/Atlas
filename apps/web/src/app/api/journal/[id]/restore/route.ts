import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";

// POST /api/journal/[id]/restore - Restore an archived journal entry
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const restoredBy = request.nextUrl.searchParams.get("restored_by") || "app_user";

  try {
    const result = await queryOne<{ id: string }>(
      `UPDATE ops.journal_entries
       SET is_archived = FALSE,
           updated_by = $2,
           meta = meta - 'archive_reason'
       WHERE id = $1 AND is_archived = TRUE
       RETURNING id`,
      [id, restoredBy]
    );

    if (!result) {
      const existing = await queryOne<{ is_archived: boolean }>(
        `SELECT is_archived FROM ops.journal_entries WHERE id = $1`,
        [id]
      );

      if (!existing) {
        return NextResponse.json(
          { error: "Journal entry not found" },
          { status: 404 }
        );
      }

      if (!existing.is_archived) {
        return NextResponse.json(
          { error: "Journal entry is not archived" },
          { status: 400 }
        );
      }
    }

    return NextResponse.json({
      id,
      restored: true,
      success: true,
    });
  } catch (error) {
    console.error("Error restoring journal entry:", error);
    return NextResponse.json(
      { error: "Failed to restore journal entry" },
      { status: 500 }
    );
  }
}
