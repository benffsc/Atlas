import { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { queryOne, query } from "@/lib/db";
import { sendOutlookEmail, sendTemplatedOutlookEmail, getAccountById } from "@/lib/outlook";
import { sendTemplateEmail, getEmailTemplate } from "@/lib/email";
import { apiSuccess, apiBadRequest, apiNotFound, apiServerError, apiError } from "@/lib/api-response";

interface EmailJob {
  job_id: string;
  category_key: string | null;
  template_key: string | null;
  recipient_email: string;
  recipient_name: string | null;
  recipient_person_id: string | null;
  custom_subject: string | null;
  custom_body_html: string | null;
  placeholders: Record<string, string>;
  outlook_account_id: string | null;
  submission_id: string | null;
  request_id: string | null;
  status: string;
  error_message: string | null;
  created_by: string;
}

/**
 * GET /api/admin/email-jobs/[id]
 *
 * Get a single email job with full details.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireRole(request, ["admin", "staff"]);
    const { id } = await params;

    const job = await queryOne<EmailJob & {
      template_name: string;
      template_subject: string;
      template_body_html: string;
      category_name: string;
      from_email: string;
      created_by_name: string;
    }>(`
      SELECT
        ej.*,
        et.name AS template_name,
        et.subject AS template_subject,
        et.body_html AS template_body_html,
        ec.display_name AS category_name,
        oa.email AS from_email,
        s.display_name AS created_by_name
      FROM ops.email_jobs ej
      LEFT JOIN ops.email_templates et ON et.template_key = ej.template_key
      LEFT JOIN ops.email_categories ec ON ec.category_key = ej.category_key
      LEFT JOIN ops.outlook_email_accounts oa ON oa.account_id = ej.outlook_account_id
      LEFT JOIN ops.staff s ON s.staff_id = ej.created_by
      WHERE ej.job_id = $1
    `, [id]);

    if (!job) {
      return apiNotFound("email job", id);
    }

    return apiSuccess({ job });
  } catch (error) {
    console.error("Get email job error:", error);

    if (error instanceof Error && "statusCode" in error) {
      const authError = error as { message: string; statusCode: number };
      return apiError(authError.message, authError.statusCode);
    }

    return apiServerError("Failed to get email job");
  }
}

/**
 * PATCH /api/admin/email-jobs/[id]
 *
 * Update an email job or send it.
 * action: 'update' | 'send' | 'cancel'
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const staff = await requireRole(request, ["admin", "staff"]);
    const { id } = await params;

    const body = await request.json();
    const { action, ...updates } = body;

    // Get current job
    const job = await queryOne<EmailJob>(`
      SELECT * FROM ops.email_jobs WHERE job_id = $1
    `, [id]);

    if (!job) {
      return apiNotFound("email job", id);
    }

    // Handle different actions
    if (action === "send") {
      // Can only send draft or queued jobs
      if (!["draft", "queued"].includes(job.status)) {
        return apiBadRequest("Can only send draft or queued jobs");
      }

      // Mark as sending
      await query(`
        UPDATE ops.email_jobs SET status = 'sending', updated_at = NOW() WHERE job_id = $1
      `, [id]);

      try {
        let result: { success: boolean; emailId?: string; error?: string };

        if (job.outlook_account_id) {
          // Send via Outlook
          if (job.template_key) {
            result = await sendTemplatedOutlookEmail({
              accountId: job.outlook_account_id,
              templateKey: job.template_key,
              to: job.recipient_email,
              toName: job.recipient_name || undefined,
              placeholders: job.placeholders || {},
              submissionId: job.submission_id || undefined,
              personId: job.recipient_person_id || undefined,
              sentBy: staff.staff_id,
            });
          } else if (job.custom_body_html && job.custom_subject) {
            const sendResult = await sendOutlookEmail({
              accountId: job.outlook_account_id,
              to: job.recipient_email,
              toName: job.recipient_name || undefined,
              subject: job.custom_subject,
              bodyHtml: job.custom_body_html,
            });
            result = { success: sendResult.success, error: sendResult.error };
          } else {
            throw new Error("No template or custom content to send");
          }
        } else if (job.template_key) {
          // Send via Resend (template only)
          result = await sendTemplateEmail({
            templateKey: job.template_key,
            to: job.recipient_email,
            toName: job.recipient_name || undefined,
            placeholders: job.placeholders || {},
            submissionId: job.submission_id || undefined,
            personId: job.recipient_person_id || undefined,
            sentBy: staff.staff_id,
          });
        } else {
          throw new Error("Custom emails require an Outlook account");
        }

        if (result.success) {
          await query(`
            UPDATE ops.email_jobs
            SET status = 'sent', sent_at = NOW(), sent_email_id = $2, updated_at = NOW()
            WHERE job_id = $1
          `, [id, result.emailId || null]);

          return apiSuccess({ success: true, emailId: result.emailId });
        } else {
          await query(`
            UPDATE ops.email_jobs
            SET status = 'failed', error_message = $2, updated_at = NOW()
            WHERE job_id = $1
          `, [id, result.error || "Unknown error"]);

          return apiServerError(result.error || "Failed to send email");
        }
      } catch (sendError) {
        const errorMessage = sendError instanceof Error ? sendError.message : "Send failed";
        await query(`
          UPDATE ops.email_jobs
          SET status = 'failed', error_message = $2, updated_at = NOW()
          WHERE job_id = $1
        `, [id, errorMessage]);

        return apiServerError(errorMessage);
      }
    } else if (action === "cancel") {
      if (!["draft", "queued"].includes(job.status)) {
        return apiBadRequest("Can only cancel draft or queued jobs");
      }

      await query(`
        UPDATE ops.email_jobs SET status = 'cancelled', updated_at = NOW() WHERE job_id = $1
      `, [id]);

      return apiSuccess({ success: true });
    } else {
      // Regular update
      if (job.status !== "draft") {
        return apiBadRequest("Can only update draft jobs");
      }

      const updateFields: string[] = [];
      const updateValues: (string | null)[] = [];
      let paramIndex = 1;

      const allowedFields = [
        "category_key", "template_key", "recipient_email", "recipient_name",
        "custom_subject", "custom_body_html", "placeholders", "outlook_account_id",
      ];

      for (const field of allowedFields) {
        if (field in updates) {
          updateFields.push(`${field} = $${paramIndex}`);
          updateValues.push(field === "placeholders" ? JSON.stringify(updates[field]) : updates[field]);
          paramIndex++;
        }
      }

      if (updateFields.length === 0) {
        return apiBadRequest("No valid fields to update");
      }

      updateFields.push(`updated_at = NOW()`);
      updateValues.push(id);

      await query(`
        UPDATE ops.email_jobs
        SET ${updateFields.join(", ")}
        WHERE job_id = $${paramIndex}
      `, updateValues);

      return apiSuccess({ success: true });
    }
  } catch (error) {
    console.error("Update email job error:", error);

    if (error instanceof Error && "statusCode" in error) {
      const authError = error as { message: string; statusCode: number };
      return apiError(authError.message, authError.statusCode);
    }

    return apiServerError("Failed to update email job");
  }
}

/**
 * DELETE /api/admin/email-jobs/[id]
 *
 * Delete a draft email job.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireRole(request, ["admin", "staff"]);
    const { id } = await params;

    const job = await queryOne<{ status: string }>(`
      SELECT status FROM ops.email_jobs WHERE job_id = $1
    `, [id]);

    if (!job) {
      return apiNotFound("email job", id);
    }

    if (job.status !== "draft") {
      return apiBadRequest("Can only delete draft jobs");
    }

    await query(`DELETE FROM ops.email_jobs WHERE job_id = $1`, [id]);

    return apiSuccess({ success: true });
  } catch (error) {
    console.error("Delete email job error:", error);

    if (error instanceof Error && "statusCode" in error) {
      const authError = error as { message: string; statusCode: number };
      return apiError(authError.message, authError.statusCode);
    }

    return apiServerError("Failed to delete email job");
  }
}
