import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { getSession, createPasswordResetToken } from "@/lib/auth";
import { getEmailTemplate } from "@/lib/email";
import { buildOrgRenderContext } from "@/lib/email-render-context";
import { sendAsApp } from "@/lib/outlook";
import { apiSuccess, apiError, apiBadRequest } from "@/lib/api-response";
import { requireValidUUID } from "@/lib/api-validation";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://atlas.forgottenfelines.com";

function replacePlaceholders(
  template: string,
  values: Record<string, string>
): string {
  let result = template;
  for (const [key, value] of Object.entries(values)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value || "");
  }
  return result;
}

/**
 * POST /api/admin/staff/send-login-info
 *
 * Sends a welcome or reset email to a staff member via Outlook.
 * Generates a real one-time reset token and includes the link.
 *
 * Body: {
 *   staff_id: string,
 *   email_type?: "welcome" | "reset",
 *   recipient_override?: string,
 *   subject_override?: string,
 *   body_html_override?: string,
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session || session.auth_role !== "admin") {
      return apiError("Admin access required", 403);
    }

    const body = await request.json();
    const {
      staff_id,
      email_type = "welcome",
      recipient_override,
      subject_override,
      body_html_override,
    } = body;

    if (!staff_id) {
      return apiBadRequest("staff_id is required");
    }
    requireValidUUID(staff_id, "staff");

    const staff = await queryOne<{
      staff_id: string;
      display_name: string;
      first_name: string;
      email: string | null;
      is_active: boolean;
    }>(
      `SELECT staff_id, display_name, first_name, email, is_active
       FROM ops.staff WHERE staff_id = $1`,
      [staff_id]
    );

    if (!staff) return apiError("Staff member not found", 404);

    const recipientEmail = recipient_override || staff.email;
    if (!recipientEmail) return apiBadRequest("Staff member has no email address");
    if (!staff.is_active) return apiBadRequest("Staff member is inactive");

    // Get Outlook sender
    const outlookAccount = await queryOne<{ email: string }>(
      `SELECT email FROM ops.outlook_email_accounts
       WHERE email = 'info@forgottenfelines.com' AND is_active = TRUE`
    );
    if (!outlookAccount) {
      return apiError("Outlook sender (info@forgottenfelines.com) not configured", 500);
    }

    // Generate a real one-time reset token
    const { token } = await createPasswordResetToken(staff.staff_id);
    const resetUrl = `${APP_URL}/reset-password?token=${token}`;

    // Determine template
    const templateKey = email_type === "reset" ? "password_reset_link" : "staff_welcome_login";
    const template = await getEmailTemplate(templateKey);
    if (!template) {
      return apiError(`Email template '${templateKey}' not found`, 500);
    }

    const orgContext = await buildOrgRenderContext();
    const placeholders: Record<string, string> = {
      ...orgContext,
      staff_first_name: staff.first_name || staff.display_name.split(" ")[0],
      staff_name: staff.first_name || staff.display_name.split(" ")[0],
      staff_email: staff.email || recipientEmail,
      reset_url: resetUrl,
      login_url: `${APP_URL}/login`,
      expiry_minutes: "60",
    };

    const subject = subject_override || replacePlaceholders(template.subject, placeholders);
    // If admin edited the body, the preview had PREVIEW_TOKEN — replace it with the real URL
    let bodyHtml = body_html_override || replacePlaceholders(template.body_html, placeholders);
    if (body_html_override) {
      bodyHtml = bodyHtml.replace(/PREVIEW_TOKEN/g, token);
    }
    const bodyText = template.body_text
      ? replacePlaceholders(template.body_text, placeholders)
      : undefined;

    const result = await sendAsApp({
      fromEmail: outlookAccount.email,
      to: recipientEmail,
      toName: staff.display_name,
      subject,
      bodyHtml,
      bodyText,
    });

    if (!result.success) {
      // Don't clear token — return the URL so admin can test the link directly
      return apiSuccess({
        message: `Email delivery failed (${result.error}), but the reset link was generated. Copy it to test manually.`,
        staff_name: staff.display_name,
        email_type,
        send_failed: true,
        reset_url: resetUrl,
      });
    }

    // Log it
    await queryOne(`
      INSERT INTO ops.sent_emails (
        template_key, recipient_email, recipient_name,
        subject_rendered, body_html_rendered, body_text_rendered,
        status, sent_at, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, 'sent', NOW(), $7)
    `, [
      templateKey,
      recipientEmail,
      staff.display_name,
      subject,
      bodyHtml,
      bodyText || null,
      session.display_name,
    ]);

    return apiSuccess({
      message: `Email sent to ${recipientEmail}`,
      staff_name: staff.display_name,
      email_type,
    });
  } catch (error) {
    console.error("Send staff email error:", error);
    return apiError("Failed to send email", 500);
  }
}
