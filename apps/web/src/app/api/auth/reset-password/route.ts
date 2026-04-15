import { NextRequest } from "next/server";
import { resetPasswordWithCode } from "@/lib/auth";
import { apiSuccess, apiBadRequest, apiServerError } from "@/lib/api-response";

/**
 * POST /api/auth/reset-password
 *
 * Validates a 6-digit reset code and sets a new password.
 * Invalidates all existing sessions for the staff member.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, code, new_password, confirm_password } = body;

    if (!email || !code || !new_password || !confirm_password) {
      return apiBadRequest("All fields are required");
    }

    if (new_password !== confirm_password) {
      return apiBadRequest("Passwords do not match");
    }

    if (new_password.length < 8) {
      return apiBadRequest("Password must be at least 8 characters");
    }

    // Strip whitespace from code (users may copy-paste with spaces)
    const cleanCode = code.replace(/\s/g, "");
    if (!/^\d{6}$/.test(cleanCode)) {
      return apiBadRequest("Reset code must be 6 digits");
    }

    const result = await resetPasswordWithCode(email, cleanCode, new_password);

    if (!result.success) {
      return apiBadRequest(result.error || "Invalid or expired reset code");
    }

    return apiSuccess({ message: "Password has been reset successfully" });
  } catch (error) {
    console.error("Reset password error:", error);
    return apiServerError("Failed to reset password");
  }
}
