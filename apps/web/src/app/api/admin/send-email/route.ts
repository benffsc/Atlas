import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { queryRows } from "@/lib/db";
import { getConnectedAccounts, sendOutlookEmail, sendTemplatedOutlookEmail, isOutlookConfigured } from "@/lib/outlook";
import { sendTemplateEmail, getEmailTemplate } from "@/lib/email";

interface EmailTemplate {
  template_id: string;
  template_key: string;
  name: string;
  subject: string;
}

/**
 * GET /api/admin/send-email
 *
 * Get available email accounts and templates for the send email modal.
 * Admin and staff can access.
 */
export async function GET(request: NextRequest) {
  try {
    await requireRole(request, ["admin", "staff"]);

    // Get configured accounts
    const outlookConfigured = isOutlookConfigured();
    const outlookAccounts = outlookConfigured ? await getConnectedAccounts() : [];

    // Get active email templates
    const templates = await queryRows<EmailTemplate>(`
      SELECT template_id, template_key, name, subject
      FROM ops.email_templates
      WHERE is_active = TRUE
      ORDER BY name
    `);

    // Check if Resend fallback is configured
    const resendConfigured = !!process.env.RESEND_API_KEY;

    return NextResponse.json({
      outlookAccounts: outlookAccounts.filter(a => !a.token_expired && !a.connection_error),
      templates,
      hasOutlook: outlookConfigured && outlookAccounts.length > 0,
      hasResend: resendConfigured,
    });
  } catch (error) {
    console.error("Get send email options error:", error);

    if (error instanceof Error && "statusCode" in error) {
      const authError = error as { message: string; statusCode: number };
      return NextResponse.json(
        { error: authError.message },
        { status: authError.statusCode }
      );
    }

    return NextResponse.json(
      { error: "Failed to get email options" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/send-email
 *
 * Send an email via Outlook or Resend.
 * Admin and staff can access.
 */
export async function POST(request: NextRequest) {
  try {
    const staff = await requireRole(request, ["admin", "staff"]);

    const body = await request.json();
    const {
      outlookAccountId,
      templateKey,
      to,
      toName,
      customSubject,
      customBody,
      placeholders,
      submissionId,
      personId,
    } = body;

    // Validate required fields
    if (!to || typeof to !== "string" || !to.includes("@")) {
      return NextResponse.json({ error: "Valid email address is required" }, { status: 400 });
    }

    // Must have either a template or custom content
    if (!templateKey && !customBody) {
      return NextResponse.json({ error: "Either a template or custom body is required" }, { status: 400 });
    }

    // If using custom content, must have subject too
    if (customBody && !customSubject) {
      return NextResponse.json({ error: "Subject is required for custom emails" }, { status: 400 });
    }

    // Determine sending method
    const useOutlook = outlookAccountId && isOutlookConfigured();

    if (useOutlook) {
      // Send via Outlook
      if (templateKey) {
        // Use template
        const result = await sendTemplatedOutlookEmail({
          accountId: outlookAccountId,
          templateKey,
          to,
          toName,
          placeholders: placeholders || {},
          submissionId,
          personId,
          sentBy: staff.staff_id,
        });

        if (!result.success) {
          return NextResponse.json({ error: result.error || "Failed to send email" }, { status: 500 });
        }

        return NextResponse.json({
          success: true,
          emailId: result.emailId,
          method: "outlook",
          account: outlookAccountId,
        });
      } else {
        // Custom email
        const result = await sendOutlookEmail({
          accountId: outlookAccountId,
          to,
          toName,
          subject: customSubject,
          bodyHtml: customBody,
        });

        if (!result.success) {
          return NextResponse.json({ error: result.error || "Failed to send email" }, { status: 500 });
        }

        return NextResponse.json({
          success: true,
          method: "outlook",
          account: outlookAccountId,
        });
      }
    } else {
      // Fall back to Resend
      if (!process.env.RESEND_API_KEY) {
        return NextResponse.json(
          { error: "No email service configured. Connect an Outlook account or configure RESEND_API_KEY." },
          { status: 503 }
        );
      }

      if (templateKey) {
        const result = await sendTemplateEmail({
          templateKey,
          to,
          toName,
          placeholders: placeholders || {},
          submissionId,
          personId,
          sentBy: staff.staff_id,
        });

        if (!result.success) {
          return NextResponse.json({ error: result.error || "Failed to send email" }, { status: 500 });
        }

        return NextResponse.json({
          success: true,
          emailId: result.emailId,
          method: "resend",
        });
      } else {
        // Custom emails via Resend not supported yet
        return NextResponse.json(
          { error: "Custom emails require an Outlook account. Templates can use Resend." },
          { status: 400 }
        );
      }
    }
  } catch (error) {
    console.error("Send email error:", error);

    if (error instanceof Error && "statusCode" in error) {
      const authError = error as { message: string; statusCode: number };
      return NextResponse.json(
        { error: authError.message },
        { status: authError.statusCode }
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to send email" },
      { status: 500 }
    );
  }
}
