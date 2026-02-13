import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { queryRows, queryOne } from "@/lib/db";

/**
 * GET /api/admin/ai-access
 *
 * List all staff members with their AI access levels.
 * Only accessible to admins.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request);

    if (!session?.staff_id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user is admin
    const admin = await queryOne<{ auth_role: string }>(
      `SELECT auth_role FROM ops.staff WHERE staff_id = $1`,
      [session.staff_id]
    );

    if (admin?.auth_role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    // Get all staff with AI access info
    const staff = await queryRows<{
      staff_id: string;
      display_name: string;
      email: string;
      auth_role: string;
      ai_access_level: string | null;
      is_active: boolean;
    }>(
      `SELECT
        staff_id,
        display_name,
        email,
        auth_role,
        COALESCE(ai_access_level::text, 'read_only') as ai_access_level,
        is_active
      FROM ops.staff
      ORDER BY
        CASE WHEN auth_role = 'admin' THEN 1 ELSE 2 END,
        display_name`
    );

    return NextResponse.json({
      staff,
      access_levels: [
        { value: "none", label: "None", description: "Tippy disabled for this user" },
        { value: "read_only", label: "Read Only", description: "Can query data but not write anything" },
        { value: "read_write", label: "Read/Write", description: "Can query data and log field events" },
        { value: "full", label: "Full Access", description: "Full AI access including admin operations" },
      ],
    });
  } catch (error) {
    console.error("Error fetching AI access levels:", error);
    return NextResponse.json(
      { error: "Failed to fetch AI access levels" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/admin/ai-access
 *
 * Update a staff member's AI access level.
 * Only accessible to admins.
 */
export async function PATCH(request: NextRequest) {
  try {
    const session = await getSession(request);

    if (!session?.staff_id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user is admin
    const admin = await queryOne<{ auth_role: string }>(
      `SELECT auth_role FROM ops.staff WHERE staff_id = $1`,
      [session.staff_id]
    );

    if (admin?.auth_role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const body = await request.json();
    const { staff_id, ai_access_level } = body;

    if (!staff_id || !ai_access_level) {
      return NextResponse.json(
        { error: "staff_id and ai_access_level are required" },
        { status: 400 }
      );
    }

    // Validate access level
    const validLevels = ["none", "read_only", "read_write", "full"];
    if (!validLevels.includes(ai_access_level)) {
      return NextResponse.json(
        { error: "Invalid access level" },
        { status: 400 }
      );
    }

    // Update the staff member's AI access level
    const result = await queryOne<{ staff_id: string; display_name: string }>(
      `UPDATE ops.staff
       SET ai_access_level = $1,
           updated_at = NOW()
       WHERE staff_id = $2
       RETURNING staff_id, display_name`,
      [ai_access_level, staff_id]
    );

    if (!result) {
      return NextResponse.json(
        { error: "Staff member not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Updated AI access for ${result.display_name} to ${ai_access_level}`,
    });
  } catch (error) {
    console.error("Error updating AI access level:", error);
    return NextResponse.json(
      { error: "Failed to update AI access level" },
      { status: 500 }
    );
  }
}
