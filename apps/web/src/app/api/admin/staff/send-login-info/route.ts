import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getEmailTemplate } from "@/lib/email";
import { buildOrgRenderContext } from "@/lib/email-render-context";
import { sendAsApp } from "@/lib/outlook";
import { apiSuccess, apiError, apiBadRequest } from "@/lib/api-response";
import { requireValidUUID } from "@/lib/api-validation";

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
 * Sends the welcome or reset email to a staff member via Outlook
 * (info@forgottenfelines.com). Admin only.
 *
 * Supports staff-edited subject/body overrides (same pattern as OOA emails).
 *
 * Body: {
 *   staff_id: string,
 *   email_type?: "welcome" | "reset",  // default "welcome"
 *   recipient_override?: string,        // override To address
 *   subject_override?: string,          // staff-edited subject
 *   body_html_override?: string,        // staff-edited HTML body
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

    // Look up staff
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

    if (!staff) {
      return apiError("Staff member not found", 404);
    }

    const recipientEmail = recipient_override || staff.email;
    if (!recipientEmail) {
      return apiBadRequest("Staff member has no email address");
    }
    if (!staff.is_active) {
      return apiBadRequest("Staff member is inactive");
    }

    // Get the Outlook sender account
    const outlookAccount = await queryOne<{ email: string }>(
      `SELECT email FROM ops.outlook_email_accounts
       WHERE email = 'info@forgottenfelines.com' AND is_active = TRUE`
    );
    if (!outlookAccount) {
      return apiError("Outlook sender account (info@forgottenfelines.com) not configured", 500);
    }

    // Determine template
    const templateKey = email_type === "reset" ? "password_reset_code" : "staff_welcome_login";
    const template = await getEmailTemplate(templateKey);
    if (!template) {
      return apiError(`Email template '${templateKey}' not found`, 500);
    }

    const defaultPassword = process.env.STAFF_DEFAULT_PASSWORD || "";
    const orgContext = await buildOrgRenderContext();
    const placeholders: Record<string, string> = {
      ...orgContext,
      staff_first_name: staff.first_name || staff.display_name.split(" ")[0],
      staff_name: staff.first_name || staff.display_name.split(" ")[0],
      staff_email: staff.email || recipientEmail,
      default_password: defaultPassword,
      login_url: "https://atlas.forgottenfelines.com/login",
      // For reset emails the real code is generated separately —
      // this preview placeholder only applies to welcome emails
      reset_code: "------",
      expiry_minutes: "60",
    };

    // Use staff-edited overrides if provided, otherwise render from template
    const subject = subject_override || replacePlaceholders(template.subject, placeholders);
    const bodyHtml = body_html_override || replacePlaceholders(template.body_html, placeholders);
    const bodyText = template.body_text
      ? replacePlaceholders(template.body_text, placeholders)
      : undefined;

    // Send via Outlook
    const result = await sendAsApp({
      fromEmail: outlookAccount.email,
      to: recipientEmail,
      toName: staff.display_name,
      subject,
      bodyHtml,
      bodyText,
    });

    if (!result.success) {
      return apiError(`Failed to send: ${result.error}`, 500);
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
      email_type: email_type,
    });
  } catch (error) {
    console.error("Send staff email error:", error);
    return apiError("Failed to send email", 500);
  }
}
