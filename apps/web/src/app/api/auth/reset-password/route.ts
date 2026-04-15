import { NextRequest } from "next/server";
import { validateResetToken, resetPasswordWithToken } from "@/lib/auth";
import { apiSuccess, apiBadRequest, apiServerError } from "@/lib/api-response";

/**
 * GET /api/auth/reset-password?token=...
 *
 * Validates the token and returns staff info (for the UI to show who's resetting).
 */
export async function GET(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get("token");
    if (!token) {
      return apiBadRequest("Token is required");
    }

    const staff = await validateResetToken(token);
    if (!staff) {
      return apiBadRequest("This reset link is invalid or has expired");
    }

    return apiSuccess({
      valid: true,
      display_name: staff.display_name,
      email: staff.email,
    });
  } catch (error) {
    console.error("Validate reset token error:", error);
    return apiServerError("Failed to validate token");
  }
}

/**
 * POST /api/auth/reset-password
 *
 * Sets a new password using a one-time reset token.
 * Invalidates all existing sessions.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token, new_password, confirm_password } = body;

    if (!token || !new_password || !confirm_password) {
      return apiBadRequest("All fields are required");
    }

    if (new_password !== confirm_password) {
      return apiBadRequest("Passwords do not match");
    }

    if (new_password.length < 8) {
      return apiBadRequest("Password must be at least 8 characters");
    }

    const result = await resetPasswordWithToken(token, new_password);

    if (!result.success) {
      return apiBadRequest(result.error || "Invalid or expired reset link");
    }

    return apiSuccess({ message: "Password has been reset successfully" });
  } catch (error) {
    console.error("Reset password error:", error);
    return apiServerError("Failed to reset password");
  }
}
