import { NextRequest } from "next/server";
import { queryRows, queryOne, execute } from "@/lib/db";
import { apiSuccess, apiBadRequest, apiServerError } from "@/lib/api-response";

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
  show_in_kiosk: boolean;
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
        COALESCE(show_in_kiosk, FALSE) AS show_in_kiosk,
        created_at,
        updated_at
      FROM ops.staff
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
      SELECT DISTINCT department FROM ops.staff WHERE department IS NOT NULL ORDER BY department
    `);

    return apiSuccess({
      staff,
      departments: departments.map(d => d.department),
    });
  } catch (err) {
    console.error("Error fetching staff:", err);
    return apiServerError("Failed to fetch staff");
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
      person_id: linkedPersonId,
    } = body;

    if (!first_name) {
      return apiBadRequest("first_name is required");
    }

    if (!role) {
      return apiBadRequest("role is required");
    }

    // Create the staff record
    const result = await queryOne<{ staff_id: string }>(`
      INSERT INTO ops.staff (
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
      return apiServerError("Failed to create staff member");
    }

    // Link to existing person or create new one
    if (linkedPersonId) {
      // Direct link to existing person (from PersonReferencePicker)
      await execute(`
        UPDATE ops.staff SET person_id = $1 WHERE staff_id = $2
      `, [linkedPersonId, result.staff_id]);

      await execute(`
        INSERT INTO sot.person_roles (person_id, role, role_status, source_system, notes)
        VALUES ($1, 'staff', 'active', 'web_app', $2)
        ON CONFLICT (person_id, role) DO UPDATE SET role_status = 'active', updated_at = NOW()
      `, [linkedPersonId, role]);
    } else if (email) {
      // No linked person — try to create/find via Data Engine
      // FFSC org emails are rejected by the Data Engine gate — this is correct
      const emailNorm = email.toLowerCase().trim();
      const isOrgEmail = emailNorm.endsWith('@forgottenfelines.com') ||
                         emailNorm.endsWith('@forgottenfelines.org') ||
                         /^(info|office|contact|admin|support|help)@/i.test(emailNorm);

      if (!isOrgEmail) {
        const personResult = await queryOne<{ person_id: string }>(`
          SELECT sot.find_or_create_person(
            $1, $2, $3, $4, NULL, 'web_app'
          ) AS person_id
        `, [email, phone?.replace(/\D/g, '') || null, first_name, last_name || null]);

        if (personResult?.person_id) {
          await execute(`
            UPDATE ops.staff SET person_id = $1 WHERE staff_id = $2
          `, [personResult.person_id, result.staff_id]);

          await execute(`
            INSERT INTO sot.person_roles (person_id, role, role_status, source_system, notes)
            VALUES ($1, 'staff', 'active', 'web_app', $2)
            ON CONFLICT (person_id, role) DO UPDATE SET role_status = 'active', updated_at = NOW()
          `, [personResult.person_id, role]);
        }
      }
    }

    return apiSuccess({
      success: true,
      staff_id: result.staff_id,
    });
  } catch (err) {
    console.error("Error creating staff:", err);
    return apiServerError("Failed to create staff member");
  }
}
