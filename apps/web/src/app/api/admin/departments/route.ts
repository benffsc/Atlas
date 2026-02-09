import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne, execute } from "@/lib/db";

interface Department {
  org_id: string;
  org_code: string;
  display_name: string;
  org_type: string;
  description: string | null;
  parent_org_id: string | null;
  parent_name: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * GET /api/admin/departments
 *
 * Returns FFSC internal departments and teams.
 * These are NOT external partner organizations - those are in /api/admin/orgs.
 */
export async function GET() {
  try {
    const departments = await queryRows<Department>(
      `
      SELECT
        o.org_id,
        o.org_code,
        o.display_name,
        o.org_type,
        o.description,
        o.parent_org_id,
        p.display_name AS parent_name,
        o.created_at,
        o.updated_at
      FROM trapper.organizations o
      LEFT JOIN trapper.organizations p ON p.org_id = o.parent_org_id
      WHERE o.is_internal = TRUE
      ORDER BY
        CASE o.org_type
          WHEN 'parent' THEN 1
          WHEN 'department' THEN 2
          WHEN 'team' THEN 3
          ELSE 4
        END,
        o.display_name
      `
    );

    // Build hierarchy
    const ffsc = departments.find((d) => d.org_type === "parent");
    const depts = departments.filter((d) => d.org_type === "department");
    const teams = departments.filter((d) => d.org_type === "team");

    return NextResponse.json({
      departments,
      hierarchy: {
        ffsc,
        departments: depts,
        teams,
      },
      stats: {
        total: departments.length,
        departments: depts.length,
        teams: teams.length,
      },
    });
  } catch (error) {
    console.error("Error fetching FFSC departments:", error);
    return NextResponse.json(
      { error: "Failed to fetch departments" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/departments
 *
 * Creates a new FFSC internal department or team.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { org_code, display_name, org_type, description, parent_org_id } =
      body;

    if (!org_code || !display_name || !org_type) {
      return NextResponse.json(
        { error: "org_code, display_name, and org_type are required" },
        { status: 400 }
      );
    }

    if (!["department", "team"].includes(org_type)) {
      return NextResponse.json(
        { error: "org_type must be 'department' or 'team'" },
        { status: 400 }
      );
    }

    // Get FFSC parent if not specified
    let parentId = parent_org_id;
    if (!parentId && org_type === "department") {
      const ffsc = await queryOne<{ org_id: string }>(
        `SELECT org_id FROM trapper.organizations WHERE org_code = 'FFSC' LIMIT 1`
      );
      parentId = ffsc?.org_id;
    }

    const result = await queryOne<{ org_id: string }>(
      `
      INSERT INTO trapper.organizations (
        org_code, display_name, org_type, description, parent_org_id, is_internal
      ) VALUES ($1, $2, $3, $4, $5, TRUE)
      RETURNING org_id
      `,
      [org_code, display_name, org_type, description || null, parentId]
    );

    return NextResponse.json({ success: true, org_id: result?.org_id });
  } catch (error) {
    console.error("Error creating department:", error);

    // Check for unique constraint violation
    if (
      error instanceof Error &&
      error.message.includes("organizations_org_code_key")
    ) {
      return NextResponse.json(
        { error: "A department with this code already exists" },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to create department" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/admin/departments
 *
 * Updates an existing FFSC department.
 * Requires org_id in the request body.
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { org_id, display_name, description } = body;

    if (!org_id) {
      return NextResponse.json({ error: "org_id is required" }, { status: 400 });
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (display_name !== undefined) {
      updates.push(`display_name = $${paramIndex}`);
      values.push(display_name);
      paramIndex++;
    }

    if (description !== undefined) {
      updates.push(`description = $${paramIndex}`);
      values.push(description);
      paramIndex++;
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 }
      );
    }

    updates.push(`updated_at = NOW()`);
    values.push(org_id);

    const result = await queryOne<{ org_id: string }>(
      `
      UPDATE trapper.organizations
      SET ${updates.join(", ")}
      WHERE org_id = $${paramIndex} AND is_internal = TRUE
      RETURNING org_id
      `,
      values
    );

    if (!result) {
      return NextResponse.json(
        { error: "Department not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, org_id: result.org_id });
  } catch (error) {
    console.error("Error updating department:", error);
    return NextResponse.json(
      { error: "Failed to update department" },
      { status: 500 }
    );
  }
}
