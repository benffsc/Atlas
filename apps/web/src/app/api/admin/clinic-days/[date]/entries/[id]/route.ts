import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { getSession } from "@/lib/auth";

interface RouteParams {
  params: Promise<{ date: string; id: string }>;
}

/**
 * GET /api/admin/clinic-days/[date]/entries/[id]
 * Get a single entry
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    // Require auth
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const entry = await queryOne(
      `SELECT * FROM trapper.v_clinic_day_entries WHERE entry_id = $1`,
      [id]
    );

    if (!entry) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    }

    return NextResponse.json({ entry });
  } catch (error) {
    console.error("Clinic day entry fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch entry" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/admin/clinic-days/[date]/entries/[id]
 * Update an entry
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    // Require auth
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();

    // Check entry exists
    const existing = await queryOne<{ entry_id: string }>(
      `SELECT entry_id FROM trapper.clinic_day_entries WHERE entry_id = $1`,
      [id]
    );

    if (!existing) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    }

    // Build update
    const updates: string[] = [];
    const updateParams: (string | number | null)[] = [];
    let paramIndex = 1;

    const allowedFields = [
      "trapper_person_id",
      "place_id",
      "request_id",
      "source_description",
      "cat_count",
      "female_count",
      "male_count",
      "unknown_sex_count",
      "status",
      "notes",
    ];

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updates.push(`${field} = $${paramIndex++}`);
        updateParams.push(body[field]);
      }
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    // Validate status if provided
    if (body.status) {
      const validStatuses = ["completed", "no_show", "cancelled", "partial", "pending"];
      if (!validStatuses.includes(body.status)) {
        return NextResponse.json(
          { error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` },
          { status: 400 }
        );
      }
    }

    updates.push(`updated_at = NOW()`);

    await query(
      `UPDATE trapper.clinic_day_entries SET ${updates.join(", ")} WHERE entry_id = $${paramIndex}`,
      [...updateParams, id]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Clinic day entry update error:", error);
    return NextResponse.json(
      { error: "Failed to update entry" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/clinic-days/[date]/entries/[id]
 * Delete an entry
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    // Require auth
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // Check entry exists
    const existing = await queryOne<{ entry_id: string }>(
      `SELECT entry_id FROM trapper.clinic_day_entries WHERE entry_id = $1`,
      [id]
    );

    if (!existing) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    }

    await query(
      `DELETE FROM trapper.clinic_day_entries WHERE entry_id = $1`,
      [id]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Clinic day entry delete error:", error);
    return NextResponse.json(
      { error: "Failed to delete entry" },
      { status: 500 }
    );
  }
}
