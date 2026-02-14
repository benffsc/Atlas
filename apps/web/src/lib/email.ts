import { Resend } from "resend";
import { queryOne, queryRows } from "./db";

// Initialize Resend client
const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

// Default sender
const DEFAULT_FROM = process.env.EMAIL_FROM || "Forgotten Felines <noreply@forgottenfelines.org>";

export interface EmailTemplate {
  template_id: string;
  template_key: string;
  name: string;
  subject: string;
  body_html: string;
  body_text: string | null;
  placeholders: string[] | null;
}

export interface SendEmailParams {
  templateKey: string;
  to: string;
  toName?: string;
  placeholders?: Record<string, string>;
  submissionId?: string;
  personId?: string;
  sentBy?: string;
}

export interface SendEmailResult {
  success: boolean;
  emailId?: string;
  externalId?: string;
  error?: string;
}

/**
 * Replace placeholders in a template string
 * Placeholders are in format {{placeholder_name}}
 */
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
 * Get an email template by key
 */
export async function getEmailTemplate(
  templateKey: string
): Promise<EmailTemplate | null> {
  return queryOne<EmailTemplate>(
    `SELECT * FROM ops.email_templates WHERE template_key = $1 AND is_active = TRUE`,
    [templateKey]
  );
}

/**
 * Send an email using a template
 */
export async function sendTemplateEmail(
  params: SendEmailParams
): Promise<SendEmailResult> {
  const { templateKey, to, toName, placeholders = {}, submissionId, personId, sentBy } = params;

  // Check if Resend is configured
  if (!resend) {
    console.warn("RESEND_API_KEY not configured, email not sent");
    return {
      success: false,
      error: "Email service not configured (RESEND_API_KEY missing)",
    };
  }

  try {
    // Get template
    const template = await getEmailTemplate(templateKey);
    if (!template) {
      return {
        success: false,
        error: `Template not found: ${templateKey}`,
      };
    }

    // Replace placeholders
    const subject = replacePlaceholders(template.subject, placeholders);
    const bodyHtml = replacePlaceholders(template.body_html, placeholders);
    const bodyText = template.body_text
      ? replacePlaceholders(template.body_text, placeholders)
      : undefined;

    // Send via Resend
    const { data, error } = await resend.emails.send({
      from: DEFAULT_FROM,
      to: toName ? `${toName} <${to}>` : to,
      subject,
      html: bodyHtml,
      text: bodyText,
    });

    if (error) {
      // Log failure
      await logSentEmail({
        templateKey,
        recipientEmail: to,
        recipientName: toName,
        subjectRendered: subject,
        bodyHtmlRendered: bodyHtml,
        bodyTextRendered: bodyText,
        status: "failed",
        errorMessage: error.message,
        submissionId,
        personId,
        createdBy: sentBy,
      });

      return {
        success: false,
        error: error.message,
      };
    }

    // Log success
    const emailId = await logSentEmail({
      templateKey,
      recipientEmail: to,
      recipientName: toName,
      subjectRendered: subject,
      bodyHtmlRendered: bodyHtml,
      bodyTextRendered: bodyText,
      status: "sent",
      externalId: data?.id,
      submissionId,
      personId,
      createdBy: sentBy,
    });

    return {
      success: true,
      emailId,
      externalId: data?.id,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("Email send error:", err);

    return {
      success: false,
      error: errorMessage,
    };
  }
}

interface LogEmailParams {
  templateKey: string;
  recipientEmail: string;
  recipientName?: string;
  subjectRendered: string;
  bodyHtmlRendered?: string;
  bodyTextRendered?: string;
  status: "pending" | "sent" | "delivered" | "bounced" | "failed";
  errorMessage?: string;
  externalId?: string;
  submissionId?: string;
  personId?: string;
  createdBy?: string;
}

/**
 * Log a sent email to the database
 */
async function logSentEmail(params: LogEmailParams): Promise<string | undefined> {
  try {
    const result = await queryOne<{ email_id: string }>(`
      INSERT INTO ops.sent_emails (
        template_key,
        recipient_email,
        recipient_name,
        subject_rendered,
        body_html_rendered,
        body_text_rendered,
        status,
        error_message,
        external_id,
        submission_id,
        person_id,
        sent_at,
        created_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
        CASE WHEN $7 = 'sent' THEN NOW() ELSE NULL END,
        $12
      )
      RETURNING email_id
    `, [
      params.templateKey,
      params.recipientEmail,
      params.recipientName || null,
      params.subjectRendered,
      params.bodyHtmlRendered || null,
      params.bodyTextRendered || null,
      params.status,
      params.errorMessage || null,
      params.externalId || null,
      params.submissionId || null,
      params.personId || null,
      params.createdBy || "system",
    ]);

    return result?.email_id;
  } catch (err) {
    console.error("Failed to log email:", err);
    return undefined;
  }
}

/**
 * Send out-of-county email for a submission
 */
export async function sendOutOfCountyEmail(
  submissionId: string
): Promise<SendEmailResult> {
  // Get submission details
  const submission = await queryOne<{
    submission_id: string;
    first_name: string;
    email: string;
    county: string;
    out_of_county_email_sent_at: string | null;
  }>(`
    SELECT submission_id, first_name, email, county, out_of_county_email_sent_at
    FROM ops.web_intake_submissions
    WHERE submission_id = $1
  `, [submissionId]);

  if (!submission) {
    return { success: false, error: "Submission not found" };
  }

  if (!submission.email) {
    return { success: false, error: "No email address on submission" };
  }

  if (submission.out_of_county_email_sent_at) {
    return { success: false, error: "Email already sent" };
  }

  // Send the email
  const result = await sendTemplateEmail({
    templateKey: "out_of_county",
    to: submission.email,
    toName: submission.first_name,
    placeholders: {
      first_name: submission.first_name || "there",
      county: submission.county || "your",
    },
    submissionId,
    sentBy: "out_of_county_automation",
  });

  // If successful, mark as sent on submission
  if (result.success) {
    await queryOne(`
      SELECT ops.mark_out_of_county_email_sent($1, $2)
    `, [submissionId, result.emailId]);
  }

  return result;
}

/**
 * Get all pending out-of-county emails
 */
export async function getPendingOutOfCountyEmails(): Promise<Array<{
  submission_id: string;
  first_name: string;
  email: string;
  detected_county: string;
}>> {
  return queryRows(`
    SELECT submission_id, first_name, email, detected_county
    FROM ops.v_pending_out_of_county_emails
    LIMIT 50
  `);
}
