import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";

// POST /api/colonies/[id]/requests - Link a request to colony
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: colonyId } = await params;

  try {
    const body = await request.json();
    const { request_id, added_by } = body;

    if (!request_id) {
      return NextResponse.json(
        { error: "request_id is required" },
        { status: 400 }
      );
    }

    if (!added_by?.trim()) {
      return NextResponse.json(
        { error: "added_by is required" },
        { status: 400 }
      );
    }

    // Verify colony exists
    const colony = await queryOne<{ colony_id: string }>(
      `SELECT colony_id FROM trapper.colonies WHERE colony_id = $1`,
      [colonyId]
    );

    if (!colony) {
      return NextResponse.json({ error: "Colony not found" }, { status: 404 });
    }

    // Verify request exists
    const req = await queryOne<{ request_id: string }>(
      `SELECT request_id FROM trapper.sot_requests WHERE request_id = $1`,
      [request_id]
    );

    if (!req) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }

    // Insert the link (ignore if already exists)
    await queryOne(
      `INSERT INTO trapper.colony_requests (colony_id, request_id, added_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (colony_id, request_id) DO NOTHING`,
      [colonyId, request_id, added_by.trim()]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error linking request to colony:", error);
    return NextResponse.json(
      { error: "Failed to link request" },
      { status: 500 }
    );
  }
}

// DELETE /api/colonies/[id]/requests?requestId=xxx - Unlink a request
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: colonyId } = await params;
  const { searchParams } = new URL(request.url);
  const requestId = searchParams.get("requestId");

  if (!requestId) {
    return NextResponse.json(
      { error: "requestId query parameter is required" },
      { status: 400 }
    );
  }

  try {
    const result = await queryOne<{ colony_id: string }>(
      `DELETE FROM trapper.colony_requests
       WHERE colony_id = $1 AND request_id = $2
       RETURNING colony_id`,
      [colonyId, requestId]
    );

    if (!result) {
      return NextResponse.json(
        { error: "Request link not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error unlinking request:", error);
    return NextResponse.json(
      { error: "Failed to unlink request" },
      { status: 500 }
    );
  }
}
