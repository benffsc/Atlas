import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

// POST /api/trappers/materials/[id]/track - Track view/download
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json();
    const action = body.action as string;

    if (!["view", "download"].includes(action)) {
      return NextResponse.json(
        { error: "Invalid action" },
        { status: 400 }
      );
    }

    const column = action === "view" ? "view_count" : "download_count";

    await query(
      `UPDATE ops.education_materials
       SET ${column} = COALESCE(${column}, 0) + 1
       WHERE material_id = $1`,
      [id]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error tracking material:", error);
    return NextResponse.json(
      { error: "Failed to track" },
      { status: 500 }
    );
  }
}
