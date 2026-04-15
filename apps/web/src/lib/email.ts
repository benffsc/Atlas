/**
 * Email sending — FFSC / Atlas
 *
 * ─────────────────────────────────────────────────────────────────────
 * SAFETY GATE — Out-of-Service-Area pipeline (FFS-1181 / FFS-1182)
 * ─────────────────────────────────────────────────────────────────────
 *
 * The legacy out_of_county pipeline in this file (sendOutOfCountyEmail
 * + getPendingOutOfCountyEmails) is silently broken: the view
 * ops.v_pending_out_of_county_emails references columns that no longer
 * exist on ops.intake_submissions, and the out_of_county flag the view
 * needs is never set. As of FFS-1182, every entry point into this code
 * path is guarded by lib/email-safety.ts assertOutOfAreaLive(), which
 * requires BOTH:
 *
 *   1. ENV var EMAIL_OUT_OF_AREA_LIVE=true   (redeploy to flip)
 *   2. DB config email.out_of_area.live=true (admin toggle)
 *
 * The replacement pipeline (FFS-1186 / Phase 3) lives in
 * sendOutOfServiceAreaEmail() and uses the new
 * v_pending_out_of_service_area_emails view. The old function below
 * is kept ONLY to preserve audit log compatibility — it hard-fails on
 * call until Go Live.
 *
 * See:
 *   - lib/email-safety.ts
 *   - docs/RUNBOOKS/out_of_service_area_email_golive.md
 *   - Linear FFS-1181 (epic), FFS-1182 (Phase 0)
 */

import { Resend } from "resend";
import { queryOne, queryRows } from "./db";
import { getOrgEmailFrom } from "./org-config";
import {
  assertOutOfAreaLive,
  OutOfAreaPipelineDisabledError,
} from "./email-safety";
import { renderCountyResources } from "./email-resource-renderer";
import { isDryRunEnabled, getTestRecipientOverride } from "./email-config";
import { buildOrgRenderContext } from "./email-render-context";
import { isFlowDryRun, getFlowTestRecipient, getFlow } from "./email-flows";
import { buildUnsubscribeUrl } from "./unsubscribe-tokens";
import { sendOutlookEmail, sendAsApp } from "./outlook";

// Initialize Resend client
const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

// Default sender — env var takes precedence, then DB config, then hardcoded fallback
async function getDefaultFrom(): Promise<string> {
  if (process.env.EMAIL_FROM) return process.env.EMAIL_FROM;
  return getOrgEmailFrom();
}

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
  /**
   * FFS-1181 follow-up Phase 3: optional flow_slug for per-flow safety
   * gates. When provided, dry-run / test-override / suppression respect
   * the ops.email_flows row. When absent, falls through to global gates.
   */
  flowSlug?: string;
  /** Staff-edited HTML body — bypasses template rendering when provided */
  bodyHtmlOverride?: string;
  /** Staff-edited subject line — bypasses template subject when provided */
  subjectOverride?: string;
  /** CC recipients — email addresses to copy on the send */
  cc?: string[];
}

export interface SendEmailResult {
  success: boolean;
  emailId?: string;
  externalId?: string;
  error?: string;
  // FFS-1188 — set when send was intercepted by dry-run mode
  dryRun?: boolean;
  // FFS-1188 — set when send was redirected to test recipient override
  testOverride?: { originalRecipient: string; overrideRecipient: string };
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
  const {
    templateKey,
    to,
    toName,
    placeholders = {},
    submissionId,
    personId,
    sentBy,
    flowSlug,
    bodyHtmlOverride,
    subjectOverride,
    cc,
  } = params;

  try {
    // Get template
    const template = await getEmailTemplate(templateKey);
    if (!template) {
      return {
        success: false,
        error: `Template not found: ${templateKey}`,
      };
    }

    // FFS-1181 follow-up Phase 2: every template gets org placeholders
    // for free. Caller-provided values win on collision.
    const mergedPlaceholders: Record<string, string> = {
      ...(await buildOrgRenderContext()),
      ...placeholders,
    };

    // Replace placeholders — staff overrides bypass template rendering
    const subject = subjectOverride || replacePlaceholders(template.subject, mergedPlaceholders);
    const bodyHtml = bodyHtmlOverride || replacePlaceholders(template.body_html, mergedPlaceholders);
    const bodyText = template.body_text
      ? replacePlaceholders(template.body_text, mergedPlaceholders)
      : undefined;

    // ─── Three-layer safety gate (FFS-1188 + FFS-1181 Phase 3) ────────
    // Per-flow config in ops.email_flows takes precedence; falls through
    // to global email.* keys when no flow_slug is provided.
    const dryRun = flowSlug
      ? await isFlowDryRun(flowSlug)
      : await isDryRunEnabled();

    // Layer 3a — DRY RUN: render + log but never call Resend
    if (dryRun) {
      const dryRunEmailId = await logSentEmail({
        templateKey,
        recipientEmail: to,
        recipientName: toName,
        subjectRendered: `[DRY RUN] ${subject}`,
        bodyHtmlRendered: bodyHtml,
        bodyTextRendered: bodyText,
        status: "dry_run",
        errorMessage: flowSlug
          ? `Dry-run mode (flow ${flowSlug}) — not sent`
          : "Dry-run mode (email.global.dry_run) — not sent",
        submissionId,
        personId,
        createdBy: sentBy,
      });
      return {
        success: true,
        emailId: dryRunEmailId,
        dryRun: true,
      };
    }

    // Layer 3b — TEST OVERRIDE: substitute recipient + tag subject
    const override = flowSlug
      ? await getFlowTestRecipient(flowSlug)
      : await getTestRecipientOverride();
    let actualRecipient = to;
    let actualSubject = subject;
    let testOverride: SendEmailResult["testOverride"] = undefined;
    if (override) {
      actualRecipient = override;
      actualSubject = `[TEST → ${to}] ${subject}`;
      testOverride = {
        originalRecipient: to,
        overrideRecipient: override,
      };
    }

    // Layer 3c — LIVE send (only reached when dry-run + test-override
    // are both resolved). Route to the provider specified by the flow.

    // Check if this flow sends via Outlook (Microsoft Graph) instead of Resend
    const flow = flowSlug ? await getFlow(flowSlug) : null;

    // Merge CC from params + flow config (comma-separated in DB)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const flowCcRaw = (flow as any)?.cc_recipients;
    const flowCc: string[] = flowCcRaw
      ? String(flowCcRaw).split(",").map((e: string) => e.trim()).filter(Boolean)
      : [];
    const mergedCc = [...new Set([...(cc || []), ...flowCc])];

    if (flow?.send_via === "outlook" && flow.outlook_account_email) {
      // Try app-permission path first (no OAuth dance needed — the Entra
      // app has Mail.Send application permission). Falls back to the
      // delegated-account path if a connected account exists and app
      // permissions aren't configured.
      let outlookResult: { success: boolean; error?: string };

      // Check if a delegated account exists (legacy per-user OAuth path)
      const delegatedAccount = await queryOne<{ account_id: string }>(
        `SELECT account_id FROM ops.outlook_email_accounts
          WHERE email = $1 AND is_active = TRUE`,
        [flow.outlook_account_email]
      );

      if (delegatedAccount) {
        // Use delegated path (sends "as" that user, replies thread to their inbox)
        outlookResult = await sendOutlookEmail({
          accountId: delegatedAccount.account_id,
          to: actualRecipient,
          toName,
          cc: mergedCc.length > 0 ? mergedCc : undefined,
          subject: actualSubject,
          bodyHtml,
          bodyText,
        });
      } else {
        // Use app-permission path (simpler, no connected account needed)
        outlookResult = await sendAsApp({
          fromEmail: flow.outlook_account_email,
          to: actualRecipient,
          toName,
          cc: mergedCc.length > 0 ? mergedCc : undefined,
          subject: actualSubject,
          bodyHtml,
          bodyText,
        });
      }

      if (outlookResult.error) {
        await logSentEmail({
          templateKey,
          recipientEmail: to,
          recipientName: toName,
          subjectRendered: actualSubject,
          bodyHtmlRendered: bodyHtml,
          bodyTextRendered: bodyText,
          status: "failed",
          errorMessage: outlookResult.error,
          submissionId,
          personId,
          createdBy: sentBy,
        });
        return {
          success: false,
          error: outlookResult.error,
        };
      }

      const outlookEmailId = await logSentEmail({
        templateKey,
        recipientEmail: to,
        recipientName: toName,
        subjectRendered: actualSubject,
        bodyHtmlRendered: bodyHtml,
        bodyTextRendered: bodyText,
        status: "sent",
        submissionId,
        personId,
        createdBy: sentBy,
      });

      return {
        success: true,
        emailId: outlookEmailId,
        ...(testOverride && { testOverride }),
      };
    }

    // Resend path — guard: Resend client must be configured.
    // This check is intentionally AFTER the dry-run gate so that
    // testing works even when RESEND_API_KEY is not set.
    if (!resend) {
      console.warn("RESEND_API_KEY not configured, email not sent");
      return {
        success: false,
        error: "Email service not configured (RESEND_API_KEY missing)",
      };
    }

    const fromAddress = await getDefaultFrom();
    const { data, error } = await resend.emails.send({
      from: fromAddress,
      to: toName ? `${toName} <${actualRecipient}>` : actualRecipient,
      subject: actualSubject,
      html: bodyHtml,
      text: bodyText,
    });

    if (error) {
      // Log failure — preserve original recipient on the audit log
      await logSentEmail({
        templateKey,
        recipientEmail: to,
        recipientName: toName,
        subjectRendered: actualSubject,
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
      subjectRendered: actualSubject,
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
      ...(testOverride && { testOverride }),
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
  // FFS-1188 — added 'dry_run' status (MIG_3062)
  status: "pending" | "sent" | "delivered" | "bounced" | "failed" | "dry_run";
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
 *
 * @deprecated Use sendOutOfServiceAreaEmail() (FFS-1186 / Phase 3).
 *
 * FFS-1182: hard-fails until BOTH EMAIL_OUT_OF_AREA_LIVE env var and
 * email.out_of_area.live DB config are explicitly enabled. This guards
 * against accidental schema fixes silently re-activating the broken
 * out_of_county pipeline.
 */
export async function sendOutOfCountyEmail(
  submissionId: string
): Promise<SendEmailResult> {
  // FFS-1182 Phase 0: hard-fail before any DB query
  try {
    await assertOutOfAreaLive();
  } catch (err) {
    if (err instanceof OutOfAreaPipelineDisabledError) {
      return { success: false, error: err.message };
    }
    throw err;
  }

  // Get submission details
  const submission = await queryOne<{
    submission_id: string;
    first_name: string;
    email: string;
    county: string;
    out_of_county_email_sent_at: string | null;
  }>(`
    SELECT submission_id, first_name, email, county, out_of_county_email_sent_at
    FROM ops.intake_submissions
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
 *
 * @deprecated Use getPendingOutOfServiceAreaEmails() (FFS-1186 / Phase 3).
 *             The legacy view ops.v_pending_out_of_county_emails was
 *             dropped in MIG_3061 and this function is retained only
 *             to satisfy callers that the safety gate hard-fails before.
 */
export async function getPendingOutOfCountyEmails(): Promise<Array<{
  submission_id: string;
  first_name: string;
  email: string;
  detected_county: string;
}>> {
  return queryRows(`
    SELECT submission_id, first_name, email, detected_county
    FROM ops.v_pending_out_of_service_area_emails
    LIMIT 50
  `);
}

/**
 * Get all pending out-of-service-area emails (FFS-1186).
 *
 * Returns submissions that are:
 *   - Classified service_area_status = 'out'
 *   - Manually approved by staff
 *   - Not already sent
 *   - Not within the 90-day suppression window
 */
export async function getPendingOutOfServiceAreaEmails(): Promise<Array<{
  submission_id: string;
  first_name: string;
  email: string;
  detected_county: string;
}>> {
  return queryRows(`
    SELECT submission_id, first_name, email, detected_county
    FROM ops.v_pending_out_of_service_area_emails
    LIMIT 50
  `);
}

// ============================================================================
// FFS-1186 — Out-of-Service-Area email send
// ============================================================================

interface OutOfServiceAreaSubmissionRow {
  submission_id: string;
  first_name: string | null;
  email: string | null;
  county: string | null;
  service_area_status: string | null;
  out_of_service_area_approved_at: string | null;
  out_of_service_area_email_sent_at: string | null;
}

/**
 * Send the out-of-service-area resource referral email for a submission.
 *
 * Validation chain:
 *   1. Hard-fail until Go Live (assertOutOfAreaLive) — env + DB flags
 *   2. Submission exists
 *   3. service_area_status = 'out'
 *   4. Manual staff approval recorded (approve_out_of_service_area_email)
 *   5. Not already sent
 *   6. Has a non-null email
 *   7. Not in 90-day suppression window
 *
 * On success (or dry-run), the new template is rendered with the
 * org placeholders + dynamically-rendered resource cards from
 * lib/email-resource-renderer.ts.
 *
 * The actual Resend / Outlook send is delegated to sendTemplateEmail()
 * which honors the Phase 5 dry-run + test recipient override layers.
 *
 * Only writes to ops.intake_submissions (mark_sent + transition to
 * 'redirected') when the send was a real send, not a dry-run.
 */
export async function sendOutOfServiceAreaEmail(
  submissionId: string,
  approvedBy: string,
  overrides?: { bodyHtml?: string; subject?: string; recipientOverride?: string }
): Promise<SendEmailResult> {
  // Layer 1 — hard-fail until Go Live
  try {
    await assertOutOfAreaLive();
  } catch (err) {
    if (err instanceof OutOfAreaPipelineDisabledError) {
      return { success: false, error: err.message };
    }
    throw err;
  }

  // Load submission
  const submission = await queryOne<OutOfServiceAreaSubmissionRow>(
    `SELECT submission_id, first_name, email, county,
            service_area_status,
            out_of_service_area_approved_at,
            out_of_service_area_email_sent_at
       FROM ops.intake_submissions
      WHERE submission_id = $1`,
    [submissionId]
  );

  if (!submission) return { success: false, error: "Submission not found" };
  if (submission.service_area_status !== "out") {
    return {
      success: false,
      error: `Submission is not classified out-of-service-area (got ${submission.service_area_status ?? "null"})`,
    };
  }
  if (!submission.out_of_service_area_approved_at) {
    return { success: false, error: "Submission has not been approved by staff" };
  }
  if (submission.out_of_service_area_email_sent_at) {
    return { success: false, error: "Email has already been sent for this submission" };
  }
  if (!submission.email) {
    return { success: false, error: "No email address on submission" };
  }

  // Suppression check — skipped for staff-initiated sends (approvedBy is set).
  // Only enforced for automated/cron sends where approvedBy would be a system ID.
  // Per-submission dedup is handled by out_of_service_area_email_sent_at above.
  // Staff clicking Approve & Send has already reviewed the submission and
  // should be allowed to send regardless of prior emails to this address.

  // Render dynamic resource cards
  const resources = await renderCountyResources(submission.county);

  // FFS-1181 follow-up Phase 2: org placeholders are injected by
  // sendTemplateEmail() via buildOrgRenderContext(). This call site
  // only provides template-specific payload.
  // Phase 5: inject a per-recipient unsubscribe URL. Failure to mint
  // the token (missing EMAIL_UNSUBSCRIBE_SECRET) is non-fatal — the
  // template falls back to an empty string and the `mailto:` fallback
  // in the footer remains the recipient's way out.
  let unsubscribeUrl = "";
  try {
    unsubscribeUrl = buildUnsubscribeUrl(submission.email, "out_of_service_area");
  } catch (err) {
    console.warn("Failed to mint unsubscribe URL:", err);
  }

  const placeholders: Record<string, string> = {
    first_name: submission.first_name || "there",
    detected_county: submission.county || "your area",
    nearest_county_resources_html: resources.countyHtml,
    statewide_resources_html: resources.statewideHtml,
    nearest_county_resources_text: resources.countyText,
    statewide_resources_text: resources.statewideText,
    unsubscribe_url: unsubscribeUrl,
  };

  const result = await sendTemplateEmail({
    templateKey: "out_of_service_area",
    to: overrides?.recipientOverride || submission.email,
    toName: submission.first_name || undefined,
    placeholders,
    submissionId,
    sentBy: approvedBy || "out_of_service_area_pipeline",
    flowSlug: "out_of_service_area",
    bodyHtmlOverride: overrides?.bodyHtml,
    subjectOverride: overrides?.subject,
  });

  // Only mark as sent (and transition to redirected) on a real send.
  // Dry-run rows are logged in ops.sent_emails but should not change
  // submission state.
  if (result.success && !result.dryRun && result.emailId) {
    await queryOne(
      `SELECT ops.mark_out_of_service_area_email_sent($1, $2) AS marked`,
      [submissionId, result.emailId]
    );
  }

  return result;
}
