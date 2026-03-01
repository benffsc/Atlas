import { NextRequest } from "next/server";
import {
  getCurrentStaff,
  changePassword,
  setStaffPassword,
} from "@/lib/auth";
import { apiSuccess, apiBadRequest, apiUnauthorized, apiForbidden, apiNotFound, apiServerError } from "@/lib/api-response";

/**
 * PUT /api/auth/password
 *
 * Change the current user's password (requires current password).
 */
export async function PUT(request: NextRequest) {
  try {
    const staff = await getCurrentStaff(request);

    if (!staff) {
      return apiUnauthorized("Authentication required");
    }

    const body = await request.json();
    const { currentPassword, newPassword } = body;

    // Validate required fields
    if (!currentPassword || !newPassword) {
      return apiBadRequest("Current password and new password are required");
    }

    // Validate password strength
    if (newPassword.length < 8) {
      return apiBadRequest("New password must be at least 8 characters");
    }

    // Attempt password change
    const result = await changePassword(
      staff.staff_id,
      currentPassword,
      newPassword
    );

    if (!result.success) {
      return apiBadRequest(result.error || "Password change failed");
    }

    return apiSuccess({ passwordChanged: true });
  } catch (error) {
    console.error("Password change error:", error);
    return apiServerError("Failed to change password");
  }
}

/**
 * POST /api/auth/password
 *
 * Admin endpoint to set a user's password (no current password required).
 * Requires admin role.
 */
export async function POST(request: NextRequest) {
  try {
    const staff = await getCurrentStaff(request);

    if (!staff) {
      return apiUnauthorized("Authentication required");
    }

    // Only admins can set passwords for other users
    if (staff.auth_role !== "admin") {
      return apiForbidden("Admin access required");
    }

    const body = await request.json();
    const { staffId, newPassword } = body;

    // Validate required fields
    if (!staffId || !newPassword) {
      return apiBadRequest("Staff ID and new password are required");
    }

    // Validate password strength
    if (newPassword.length < 8) {
      return apiBadRequest("Password must be at least 8 characters");
    }

    // Set the password
    const updated = await setStaffPassword(staffId, newPassword);

    if (!updated) {
      return apiNotFound("staff", staffId);
    }

    return apiSuccess({ passwordSet: true });
  } catch (error) {
    console.error("Set password error:", error);
    return apiServerError("Failed to set password");
  }
}
