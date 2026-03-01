import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { getSession, hashPassword, verifyPassword } from "@/lib/auth";
import { apiSuccess, apiBadRequest, apiUnauthorized, apiServerError } from "@/lib/api-response";

/**
 * POST /api/auth/change-password
 * Change the current user's password
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session) {
      return apiUnauthorized("Authentication required");
    }

    const body = await request.json();
    const { current_password, new_password, confirm_password } = body;

    // Validate inputs
    if (!current_password || !new_password || !confirm_password) {
      return apiBadRequest("All fields are required");
    }

    if (new_password !== confirm_password) {
      return apiBadRequest("New passwords do not match");
    }

    if (new_password.length < 8) {
      return apiBadRequest("Password must be at least 8 characters");
    }

    // Get current password hash
    const staff = await queryOne<{ password_hash: string | null }>(
      `SELECT password_hash FROM ops.staff WHERE staff_id = $1`,
      [session.staff_id]
    );

    if (!staff || !staff.password_hash) {
      return apiBadRequest("Staff not found or password not set");
    }

    // Verify current password
    const isValid = await verifyPassword(current_password, staff.password_hash);
    if (!isValid) {
      return apiBadRequest("Current password is incorrect");
    }

    // Hash new password
    const newHash = await hashPassword(new_password);

    // Update password and clear change requirement
    await queryOne(
      `UPDATE ops.staff
       SET password_hash = $1,
           password_change_required = FALSE,
           password_set_at = NOW(),
           password_reset_token_hash = NULL,
           password_reset_expires_at = NULL
       WHERE staff_id = $2`,
      [newHash, session.staff_id]
    );

    return apiSuccess({ message: "Password changed successfully" });
  } catch (error) {
    console.error("Change password error:", error);
    return apiServerError("Failed to change password");
  }
}
