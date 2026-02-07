import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne, execute } from "@/lib/db";

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
  source_record_id: string | null;
  ai_access_level: string | null;
  created_at: string;
  updated_at: string;
}

// GET - List all staff
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const activeOnly = searchParams.get("active") !== "false";
  const department = searchParams.get("department");

  try {
    let sql = `
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
        source_record_id,
        ai_access_level,
        created_at,
        updated_at
      FROM trapper.staff
      WHERE 1=1
    `;
    const params: unknown[] = [];
    let paramIndex = 1;

    if (activeOnly) {
      sql += ` AND is_active = TRUE`;
    }

    if (department) {
      sql += ` AND department = $${paramIndex}`;
      params.push(department);
      paramIndex++;
    }

    sql += ` ORDER BY display_name`;

    const staff = await queryRows<Staff>(sql, params);

    // Get unique departments for filtering
    const departments = await queryRows<{ department: string }>(`
      SELECT DISTINCT department FROM trapper.staff WHERE department IS NOT NULL ORDER BY department
    `);

    return NextResponse.json({
      staff,
      departments: departments.map(d => d.department),
    }, {
      headers: {
        // Cache staff list for 5 minutes - rarely changes
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      }
    });
  } catch (err) {
    console.error("Error fetching staff:", err);
    return NextResponse.json(
      { error: "Failed to fetch staff" },
      { status: 500 }
    );
  }
}

// POST - Create new staff member
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      first_name,
      last_name,
      email,
      phone,
      work_extension,
      role,
      department,
      hired_date,
    } = body;

    if (!first_name) {
      return NextResponse.json(
        { error: "first_name is required" },
        { status: 400 }
      );
    }

    if (!role) {
      return NextResponse.json(
        { error: "role is required" },
        { status: 400 }
      );
    }

    // Create the staff record
    const result = await queryOne<{ staff_id: string }>(`
      INSERT INTO trapper.staff (
        first_name,
        last_name,
        email,
        phone,
        work_extension,
        role,
        department,
        hired_date,
        source_system
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'web_app')
      RETURNING staff_id
    `, [
      first_name,
      last_name || null,
      email || null,
      phone || null,
      work_extension || null,
      role,
      department || null,
      hired_date || null,
    ]);

    if (!result) {
      return NextResponse.json(
        { error: "Failed to create staff member" },
        { status: 500 }
      );
    }

    // If email provided, create/link person
    // Note: FFSC organizational emails (@forgottenfelines.com) will be rejected
    // by the Data Engine consolidated gate (MIG_919, INV-17). This is correct
    // behavior - FFSC staff are internal accounts, not external contacts in sot_people.
    if (email) {
      // Check if this is an org email that will be rejected
      const emailNorm = email.toLowerCase().trim();
      const isOrgEmail = emailNorm.endsWith('@forgottenfelines.com') ||
                         emailNorm.endsWith('@forgottenfelines.org') ||
                         /^(info|office|contact|admin|support|help)@/i.test(emailNorm);

      if (!isOrgEmail) {
        // Only attempt person creation for non-org emails
        const personResult = await queryOne<{ person_id: string }>(`
          SELECT trapper.find_or_create_person(
            $1, $2, $3, $4, NULL, 'web_app'
          ) AS person_id
        `, [email, phone?.replace(/\D/g, '') || null, first_name, last_name || null]);

        if (personResult?.person_id) {
          await execute(`
            UPDATE trapper.staff SET person_id = $1 WHERE staff_id = $2
          `, [personResult.person_id, result.staff_id]);

          // Add staff role
          await execute(`
            INSERT INTO trapper.person_roles (person_id, role, role_status, source_system, notes)
            VALUES ($1, 'staff', 'active', 'web_app', $2)
            ON CONFLICT (person_id, role) DO UPDATE SET role_status = 'active', updated_at = NOW()
          `, [personResult.person_id, role]);
        }
      }
      // For org emails: staff record created successfully, no person linking needed
    }

    return NextResponse.json({
      success: true,
      staff_id: result.staff_id,
    });
  } catch (err) {
    console.error("Error creating staff:", err);
    return NextResponse.json(
      { error: "Failed to create staff member" },
      { status: 500 }
    );
  }
}
