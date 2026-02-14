import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { execute } from "@/lib/db";

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
  const { resolution_status, resolution_notes, related_view } = body;

  // Validate status
  const validStatuses = [
    "unresolved",
    "view_created",
    "data_added",
    "tool_added",
    "documentation",
    "out_of_scope",
    "duplicate",
  ];
  if (resolution_status && !validStatuses.includes(resolution_status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  try {
    await execute(
      `
      UPDATE ops.tippy_capability_gaps
      SET
        resolution_status = COALESCE($1, resolution_status),
        resolved_by = $2,
        resolved_at = NOW(),
        resolution_notes = COALESCE($3, resolution_notes),
        related_view = COALESCE($4, related_view)
      WHERE question_id = $5
      `,
      [resolution_status, session.staff_id, resolution_notes, related_view, id]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating question:", error);
    return NextResponse.json(
      { error: "Failed to update question" },
      { status: 500 }
    );
  }
}
