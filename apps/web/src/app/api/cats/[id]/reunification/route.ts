import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne, query } from "@/lib/db";

interface Reunification {
  reunification_id: string;
  cat_id: string;
  original_owner_person_id: string | null;
  original_owner_name: string | null;
  current_caretaker_person_id: string | null;
  current_caretaker_name: string | null;
  original_place_id: string | null;
  original_address: string | null;
  found_at_place_id: string | null;
  found_at_address: string | null;
  reunification_status: string;
  reunification_date: string | null;
  how_identified: string | null;
  notes: string | null;
  recorded_by: string | null;
  recorded_at: string;
  confirmed_by: string | null;
  confirmed_at: string | null;
}

// GET /api/cats/[id]/reunification - Get reunification history
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Cat ID is required" },
      { status: 400 }
    );
  }

  try {
    const sql = `
      SELECT
        r.reunification_id,
        r.cat_id,
        r.original_owner_person_id,
        p1.display_name AS original_owner_name,
        r.current_caretaker_person_id,
        p2.display_name AS current_caretaker_name,
        r.original_place_id,
        pl1.formatted_address AS original_address,
        r.found_at_place_id,
        pl2.formatted_address AS found_at_address,
        r.reunification_status,
        r.reunification_date,
        r.how_identified,
        r.notes,
        r.recorded_by,
        r.recorded_at,
        r.confirmed_by,
        r.confirmed_at
      FROM trapper.cat_reunifications r
      LEFT JOIN sot.people p1 ON p1.person_id = r.original_owner_person_id
      LEFT JOIN sot.people p2 ON p2.person_id = r.current_caretaker_person_id
      LEFT JOIN sot.places pl1 ON pl1.place_id = r.original_place_id
      LEFT JOIN sot.places pl2 ON pl2.place_id = r.found_at_place_id
      WHERE r.cat_id = $1
      ORDER BY r.recorded_at DESC
    `;

    const reunifications = await queryRows<Reunification>(sql, [id]);

    return NextResponse.json({
      reunifications,
      has_reunification: reunifications.some(r => r.reunification_status === 'confirmed'),
    });
  } catch (error) {
    console.error("Error fetching reunifications:", error);
    return NextResponse.json(
      { error: "Failed to fetch reunifications" },
      { status: 500 }
    );
  }
}

// POST /api/cats/[id]/reunification - Record a reunification
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Cat ID is required" },
      { status: 400 }
    );
  }

  try {
    const body = await request.json();

    const {
      original_owner_person_id,
      current_caretaker_person_id,
      original_place_id,
      found_at_place_id,
      reunification_status,
      reunification_date,
      how_identified,
      notes,
      recorded_by,
    } = body;

    const result = await queryOne<{ reunification_id: string }>(
      `INSERT INTO trapper.cat_reunifications (
        cat_id,
        original_owner_person_id,
        current_caretaker_person_id,
        original_place_id,
        found_at_place_id,
        reunification_status,
        reunification_date,
        how_identified,
        notes,
        recorded_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING reunification_id`,
      [
        id,
        original_owner_person_id || null,
        current_caretaker_person_id || null,
        original_place_id || null,
        found_at_place_id || null,
        reunification_status || 'pending',
        reunification_date || null,
        how_identified || null,
        notes || null,
        recorded_by || 'web_app',
      ]
    );

    return NextResponse.json({
      success: true,
      reunification_id: result?.reunification_id,
    });
  } catch (error) {
    console.error("Error recording reunification:", error);
    return NextResponse.json(
      { error: "Failed to record reunification" },
      { status: 500 }
    );
  }
}

// PATCH /api/cats/[id]/reunification - Update reunification status
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const searchParams = request.nextUrl.searchParams;
  const reunificationId = searchParams.get("reunification_id");

  if (!id || !reunificationId) {
    return NextResponse.json(
      { error: "Cat ID and reunification_id are required" },
      { status: 400 }
    );
  }

  try {
    const body = await request.json();

    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (body.reunification_status !== undefined) {
      updates.push(`reunification_status = $${paramIndex}`);
      values.push(body.reunification_status);
      paramIndex++;
    }

    if (body.reunification_date !== undefined) {
      updates.push(`reunification_date = $${paramIndex}`);
      values.push(body.reunification_date);
      paramIndex++;
    }

    if (body.notes !== undefined) {
      updates.push(`notes = $${paramIndex}`);
      values.push(body.notes);
      paramIndex++;
    }

    if (body.reunification_status === 'confirmed' && body.confirmed_by) {
      updates.push(`confirmed_by = $${paramIndex}`);
      values.push(body.confirmed_by);
      paramIndex++;
      updates.push(`confirmed_at = NOW()`);
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 }
      );
    }

    values.push(reunificationId);
    values.push(id);

    await query(
      `UPDATE trapper.cat_reunifications
       SET ${updates.join(", ")}
       WHERE reunification_id = $${paramIndex}
         AND cat_id = $${paramIndex + 1}`,
      values
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating reunification:", error);
    return NextResponse.json(
      { error: "Failed to update reunification" },
      { status: 500 }
    );
  }
}
