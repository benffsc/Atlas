import { NextRequest } from "next/server";
import { queryRows } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api-response";

interface StaffAuthRow {
  staff_id: string;
  display_name: string;
  email: string | null;
  auth_role: string;
  is_active: boolean;
  password_hash: string | null;
  password_change_required: boolean;
  password_set_at: string | null;
  last_login: string | null;
  login_count: number;
}

/**
 * GET /api/admin/staff/auth-overview
 *
 * Returns staff with auth status data: password state, login history.
 * Admin only.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session || session.auth_role !== "admin") {
      return apiError("Admin access required", 403);
    }

    const rows = await queryRows<StaffAuthRow>(`
      SELECT
        s.staff_id,
        s.display_name,
        s.email,
        s.auth_role,
        s.is_active,
        s.password_hash,
        COALESCE(s.password_change_required, FALSE) AS password_change_required,
        s.password_set_at,
        MAX(ss.created_at) AS last_login,
        COUNT(ss.session_id)::int AS login_count
      FROM ops.staff s
      LEFT JOIN ops.staff_sessions ss ON ss.staff_id = s.staff_id
      WHERE s.is_active = TRUE
      GROUP BY s.staff_id
      ORDER BY s.display_name
    `);

    const staff = rows.map((r) => ({
      staff_id: r.staff_id,
      display_name: r.display_name,
      email: r.email,
      auth_role: r.auth_role,
      is_active: r.is_active,
      password_status: !r.password_hash
        ? "not_set"
        : r.password_change_required
          ? "default"
          : "set",
      password_set_at: r.password_set_at,
      last_login: r.last_login,
      login_count: r.login_count,
    }));

    return apiSuccess({ staff });
  } catch (error) {
    console.error("Auth overview error:", error);
    return apiError("Failed to load auth overview", 500);
  }
}
