import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getEmailTemplate } from "@/lib/email";
import { buildOrgRenderContext } from "@/lib/email-render-context";
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
 * GET /api/admin/staff/preview-email?staff_id=...&type=welcome|reset
 *
 * Renders a preview of the staff welcome or reset email.
 * Uses a placeholder URL for the reset link (real token generated on send).
 * Never sends, never logs. Admin only.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session || session.auth_role !== "admin") {
      return apiError("Admin access required", 403);
    }

    const staffId = request.nextUrl.searchParams.get("staff_id");
    const emailType = request.nextUrl.searchParams.get("type") || "welcome";

    if (!staffId) return apiBadRequest("staff_id is required");
    requireValidUUID(staffId, "staff");

    const staff = await queryOne<{
      staff_id: string;
      display_name: string;
      first_name: string;
      email: string | null;
    }>(
      `SELECT staff_id, display_name, first_name, email FROM ops.staff WHERE staff_id = $1`,
      [staffId]
    );

    if (!staff) return apiError("Staff not found", 404);

    const templateKey = emailType === "reset" ? "password_reset_link" : "staff_welcome_login";
    const template = await getEmailTemplate(templateKey);
    if (!template) {
      return apiError(`Template '${templateKey}' not found or inactive`, 500);
    }

    const orgContext = await buildOrgRenderContext();

    const placeholders: Record<string, string> = {
      ...orgContext,
      staff_first_name: staff.first_name || staff.display_name.split(" ")[0],
      staff_name: staff.first_name || staff.display_name.split(" ")[0],
      staff_email: staff.email || "",
      // Preview placeholder — real token generated at send time
      reset_url: `${APP_URL}/reset-password?token=PREVIEW_TOKEN`,
      login_url: `${APP_URL}/login`,
      expiry_minutes: "60",
    };

    const subject = replacePlaceholders(template.subject, placeholders);
    const bodyHtml = replacePlaceholders(template.body_html, placeholders);

    return apiSuccess({
      staff_id: staffId,
      template_key: templateKey,
      email_type: emailType,
      recipient: {
        email: staff.email,
        name: staff.display_name,
      },
      subject,
      body_html: bodyHtml,
    });
  } catch (error) {
    console.error("Preview staff email error:", error);
    return apiError("Failed to render preview", 500);
  }
}
