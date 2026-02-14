import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { queryOne } from "@/lib/db";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession(request);
  if (!session || session.auth_role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { id } = await params;

  try {
    // Apply the correction using the SQL function
    const result = await queryOne<{
      success: boolean;
      edit_id?: string;
      correction_id?: string;
      error?: string;
      manual_required?: boolean;
    }>(
      `SELECT * FROM ops.tippy_apply_correction($1, $2)`,
      [id, session.staff_id]
    );

    if (!result?.success) {
      return NextResponse.json(
        {
          error: result?.error || "Failed to apply correction",
          manual_required: result?.manual_required,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      edit_id: result.edit_id,
      correction_id: result.correction_id,
    });
  } catch (error) {
    console.error("Error applying correction:", error);
    return NextResponse.json(
      { error: "Failed to apply correction" },
      { status: 500 }
    );
  }
}
