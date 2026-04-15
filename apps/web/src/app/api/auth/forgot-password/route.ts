import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { createPasswordResetToken } from "@/lib/auth";
import { sendTemplateEmail } from "@/lib/email";
import { apiSuccess, apiBadRequest, apiServerError } from "@/lib/api-response";

/**
 * POST /api/auth/forgot-password
 *
 * Sends a 6-digit password reset code to the staff member's email.
 * Always returns success to prevent email enumeration.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email } = body;

    if (!email) {
      return apiBadRequest("Email is required");
    }

    // Look up staff — but always return success regardless
    const staff = await queryOne<{
      staff_id: string;
      display_name: string;
      email: string;
      is_active: boolean;
      password_reset_expires_at: string | null;
    }>(
      `SELECT staff_id, display_name, email, is_active, password_reset_expires_at
       FROM ops.staff
       WHERE LOWER(email) = LOWER($1)`,
      [email]
    );

    if (staff && staff.is_active) {
      // Rate limit: skip if reset requested within last 2 minutes
      if (staff.password_reset_expires_at) {
        const expiresAt = new Date(staff.password_reset_expires_at);
        const twoMinutesAgo = new Date();
        // If expiry is still more than (EXPIRY - 2 min) away, a code was just issued
        twoMinutesAgo.setMinutes(twoMinutesAgo.getMinutes() + 58); // 60 - 2 = 58 min from now
        if (expiresAt > twoMinutesAgo) {
          // Code was generated less than 2 minutes ago — don't resend
          return apiSuccess({ message: "If that email is registered, a reset code has been sent." });
        }
      }

      // Generate and store code
      const { code } = await createPasswordResetToken(staff.staff_id);

      // Send email
      await sendTemplateEmail({
        templateKey: "password_reset_code",
        to: staff.email,
        toName: staff.display_name,
        placeholders: {
          reset_code: code,
          staff_name: staff.display_name.split(" ")[0] || staff.display_name,
          expiry_minutes: "60",
        },
        sentBy: "password_reset",
      });
    }

    // Always return success to prevent email enumeration
    return apiSuccess({ message: "If that email is registered, a reset code has been sent." });
  } catch (error) {
    console.error("Forgot password error:", error);
    return apiServerError("Failed to process request");
  }
}
