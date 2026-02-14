import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";

interface LinkBody {
  place_id: string;
  linked_by?: string;
}

// POST /api/google-map-entries/[id]/link - Link entry to a place
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Entry ID is required" },
      { status: 400 }
    );
  }

  try {
    const body: LinkBody = await request.json();

    if (!body.place_id) {
      return NextResponse.json(
        { error: "place_id is required" },
        { status: 400 }
      );
    }

    const result = await queryOne<{
      success: boolean;
      message: string;
    }>(
      `SELECT * FROM ops.manual_link_google_entry($1, $2, $3)`,
      [id, body.place_id, body.linked_by ?? "web_app"]
    );

    if (!result || !result.success) {
      return NextResponse.json(
        { error: result?.message || "Failed to link entry" },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    console.error("Error linking Google Map entry:", error);
    return NextResponse.json(
      { error: "Failed to link entry" },
      { status: 500 }
    );
  }
}

// DELETE /api/google-map-entries/[id]/link - Unlink entry from place
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Entry ID is required" },
      { status: 400 }
    );
  }

  try {
    let unlinkedBy = "web_app";
    try {
      const body = await request.json();
      if (body.unlinked_by) unlinkedBy = body.unlinked_by;
    } catch {
      // Body is optional for DELETE
    }

    const result = await queryOne<{
      success: boolean;
      message: string;
    }>(
      `SELECT * FROM ops.unlink_google_entry($1, $2)`,
      [id, unlinkedBy]
    );

    if (!result || !result.success) {
      return NextResponse.json(
        { error: result?.message || "Failed to unlink entry" },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    console.error("Error unlinking Google Map entry:", error);
    return NextResponse.json(
      { error: "Failed to unlink entry" },
      { status: 500 }
    );
  }
}
