import { NextRequest, NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";
import { getSession } from "@/lib/auth";

/**
 * GET /api/admin/auth/status
 * Get overview of staff authentication status
 */
export async function GET(request: NextRequest) {
  try {
    // Require admin auth
    const session = await getSession(request);
    if (!session || session.auth_role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    // Get aggregate stats
    const stats = await queryOne<{
      total_staff: number;
      active_staff: number;
      with_password: number;
      without_password: number;
      password_change_required: number;
      pending_reset: number;
      admins: number;
      staff_role: number;
      volunteers: number;
    }>(
      `SELECT
        COUNT(*) as total_staff,
        COUNT(*) FILTER (WHERE is_active = TRUE) as active_staff,
        COUNT(*) FILTER (WHERE is_active = TRUE AND password_hash IS NOT NULL AND password_hash != '') as with_password,
        COUNT(*) FILTER (WHERE is_active = TRUE AND (password_hash IS NULL OR password_hash = '')) as without_password,
        COUNT(*) FILTER (WHERE is_active = TRUE AND password_change_required = TRUE) as password_change_required,
        COUNT(*) FILTER (WHERE is_active = TRUE AND password_reset_expires_at > NOW()) as pending_reset,
        COUNT(*) FILTER (WHERE is_active = TRUE AND auth_role = 'admin') as admins,
        COUNT(*) FILTER (WHERE is_active = TRUE AND auth_role = 'staff') as staff_role,
        COUNT(*) FILTER (WHERE is_active = TRUE AND auth_role = 'volunteer') as volunteers
      FROM trapper.staff`
    );

    // Get list of staff with auth details
    const staffList = await queryRows<{
      staff_id: string;
      display_name: string;
      email: string;
      auth_role: string;
      is_active: boolean;
      has_password: boolean;
      password_change_required: boolean;
      password_set_at: string | null;
      has_pending_reset: boolean;
      last_login: string | null;
    }>(
      `SELECT
        s.staff_id,
        s.display_name,
        s.email,
        s.auth_role,
        s.is_active,
        (s.password_hash IS NOT NULL AND s.password_hash != '') as has_password,
        COALESCE(s.password_change_required, FALSE) as password_change_required,
        s.password_set_at,
        (s.password_reset_expires_at > NOW()) as has_pending_reset,
        (SELECT MAX(created_at) FROM trapper.staff_sessions WHERE staff_id = s.staff_id) as last_login
      FROM trapper.staff s
      WHERE s.is_active = TRUE
      ORDER BY s.display_name`
    );

    return NextResponse.json({
      stats,
      staff: staffList,
    });
  } catch (error) {
    console.error("Auth status error:", error);
    return NextResponse.json(
      { error: "Failed to fetch auth status" },
      { status: 500 }
    );
  }
}
