import { NextRequest, NextResponse } from "next/server";
import { queryOne, execute } from "@/lib/db";

interface Staff {
  staff_id: string;
  person_id: string | null;
  first_name: string;
  last_name: string | null;
  display_name: string;
  email: string | null;
  phone: string | null;
  work_extension: string | null;
  role: string;
  department: string | null;
  is_active: boolean;
  hired_date: string | null;
  end_date: string | null;
  source_record_id: string | null;
  ai_access_level: string | null;
  created_at: string;
  updated_at: string;
}

// GET - Get single staff member
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const staff = await queryOne<Staff>(`
      SELECT
        staff_id,
        person_id,
        first_name,
        last_name,
        display_name,
        email,
        phone,
        work_extension,
        role,
        department,
        is_active,
        hired_date,
        end_date,
        source_record_id,
        ai_access_level,
        created_at,
        updated_at
      FROM ops.staff
      WHERE staff_id = $1
    `, [id]);

    if (!staff) {
      return NextResponse.json(
        { error: "Staff member not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ staff });
  } catch (err) {
    console.error("Error fetching staff:", err);
    return NextResponse.json(
      { error: "Failed to fetch staff member" },
      { status: 500 }
    );
  }
}

// PATCH - Update staff member
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json();
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    // Build dynamic update query based on provided fields
    const allowedFields = [
      'first_name',
      'last_name',
      'email',
      'phone',
      'work_extension',
      'role',
      'department',
      'is_active',
      'hired_date',
      'end_date',
      'ai_access_level',
    ];

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updates.push(`${field} = $${paramIndex}`);
        values.push(body[field] === '' ? null : body[field]);
        paramIndex++;
      }
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    values.push(id);

    const result = await queryOne<{ staff_id: string }>(`
      UPDATE ops.staff
      SET ${updates.join(', ')}
      WHERE staff_id = $${paramIndex}
      RETURNING staff_id
    `, values);

    if (!result) {
      return NextResponse.json(
        { error: "Staff member not found" },
        { status: 404 }
      );
    }

    // If deactivating, update person_roles too
    if (body.is_active === false) {
      const staff = await queryOne<{ person_id: string | null }>(`
        SELECT person_id FROM ops.staff WHERE staff_id = $1
      `, [id]);

      if (staff?.person_id) {
        await execute(`
          UPDATE sot.person_roles
          SET role_status = 'inactive', ended_at = NOW()
          WHERE person_id = $1 AND role = 'staff'
        `, [staff.person_id]);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Error updating staff:", err);
    return NextResponse.json(
      { error: "Failed to update staff member" },
      { status: 500 }
    );
  }
}

// DELETE - Soft delete (set inactive) or hard delete
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const hardDelete = searchParams.get("hard") === "true";

  try {
    if (hardDelete) {
      // Hard delete - only if no Airtable source
      const result = await queryOne<{ staff_id: string }>(`
        DELETE FROM ops.staff
        WHERE staff_id = $1 AND source_record_id IS NULL
        RETURNING staff_id
      `, [id]);

      if (!result) {
        return NextResponse.json(
          { error: "Cannot hard delete Airtable-synced staff. Use soft delete instead." },
          { status: 400 }
        );
      }
    } else {
      // Soft delete - set inactive
      await execute(`
        UPDATE ops.staff
        SET is_active = FALSE, end_date = CURRENT_DATE
        WHERE staff_id = $1
      `, [id]);

      // Update person_roles
      const staff = await queryOne<{ person_id: string | null }>(`
        SELECT person_id FROM ops.staff WHERE staff_id = $1
      `, [id]);

      if (staff?.person_id) {
        await execute(`
          UPDATE sot.person_roles
          SET role_status = 'inactive', ended_at = NOW()
          WHERE person_id = $1 AND role = 'staff'
        `, [staff.person_id]);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Error deleting staff:", err);
    return NextResponse.json(
      { error: "Failed to delete staff member" },
      { status: 500 }
    );
  }
}
