import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { createPasswordResetToken } from "@/lib/auth";
import { sendTemplateEmail } from "@/lib/email";
import { apiSuccess, apiBadRequest, apiServerError } from "@/lib/api-response";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://atlas.forgottenfelines.com";

/**
 * POST /api/auth/forgot-password
 *
 * Generates a one-time reset link and emails it to the staff member.
 * Always returns success to prevent email enumeration.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email } = body;

    if (!email) {
      return apiBadRequest("Email is required");
    }

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
        twoMinutesAgo.setMinutes(twoMinutesAgo.getMinutes() + 58);
        if (expiresAt > twoMinutesAgo) {
          return apiSuccess({ message: "If that email is registered, a reset link has been sent." });
        }
      }

      const { token } = await createPasswordResetToken(staff.staff_id);
      const resetUrl = `${APP_URL}/reset-password?token=${token}`;

      await sendTemplateEmail({
        templateKey: "password_reset_link",
        to: staff.email,
        toName: staff.display_name,
        placeholders: {
          staff_name: staff.display_name.split(" ")[0] || staff.display_name,
          reset_url: resetUrl,
          expiry_minutes: "60",
        },
        sentBy: "password_reset",
      });
    }

    // Always return success to prevent email enumeration
    return apiSuccess({ message: "If that email is registered, a reset link has been sent." });
  } catch (error) {
    console.error("Forgot password error:", error);
    return apiServerError("Failed to process request");
  }
}
