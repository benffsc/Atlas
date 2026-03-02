import { NextRequest } from "next/server";
import { queryOne, queryRows } from "@/lib/db";
import { getSession, hashPassword } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api-response";

/**
 * POST /api/admin/auth/set-default-passwords
 * Set default password for all staff without passwords
 * Forces password change on first login
 *
 * Default password is configured via STAFF_DEFAULT_PASSWORD env var
 */
export async function POST(request: NextRequest) {
  try {
    // Require admin auth
    const session = await getSession(request);
    if (!session || session.auth_role !== "admin") {
      return apiError("Admin access required", 403);
    }

    // Default password from environment variable (secure)
    const DEFAULT_PASSWORD = process.env.STAFF_DEFAULT_PASSWORD;
    if (!DEFAULT_PASSWORD) {
      return apiError("STAFF_DEFAULT_PASSWORD environment variable is not configured", 500);
    }

    // Hash the default password
    const passwordHash = await hashPassword(DEFAULT_PASSWORD);

    // Get list of staff that will be updated
    const staffToUpdate = await queryRows<{ staff_id: string; email: string; display_name: string }>(
      `SELECT staff_id, email, display_name
       FROM ops.staff
       WHERE (password_hash IS NULL OR password_hash = '')
         AND is_active = TRUE`
    );

    if (staffToUpdate.length === 0) {
      return apiSuccess({
        message: "All active staff members already have passwords set.",
        updated_count: 0,
        staff_updated: [],
      });
    }

    // Update all staff without passwords
    await queryOne(
      `UPDATE ops.staff
       SET password_hash = $1,
           password_change_required = TRUE,
           password_set_at = NOW()
       WHERE (password_hash IS NULL OR password_hash = '')
         AND is_active = TRUE`,
      [passwordHash]
    );

    return apiSuccess({
      message: `Default password set for ${staffToUpdate.length} staff members. They will be required to change it on first login.`,
      updated_count: staffToUpdate.length,
      staff_updated: staffToUpdate.map((s) => ({
        email: s.email,
        display_name: s.display_name,
      })),
      // Note: Password is NOT returned in response for security
    });
  } catch (error) {
    console.error("Set default passwords error:", error);
    return apiError("Failed to set default passwords", 500);
  }
}
