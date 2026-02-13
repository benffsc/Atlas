import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { queryOne, query, queryRows } from "@/lib/db";
import { sendOutlookEmail } from "@/lib/outlook";

interface EmailBatch {
  batch_id: string;
  batch_type: string;
  recipient_email: string;
  recipient_name: string | null;
  recipient_person_id: string | null;
  outlook_account_id: string | null;
  subject: string;
  body_html: string;
  status: string;
  error_message: string | null;
  created_by: string;
  created_at: string;
  sent_at: string | null;
}

/**
 * GET /api/admin/email-batches/[id]
 *
 * Get a single email batch with full details.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireRole(request, ["admin", "staff"]);
    const { id } = await params;

    const batch = await queryOne<EmailBatch & {
      from_email: string;
      created_by_name: string;
    }>(`
      SELECT
        eb.*,
        oa.email AS from_email,
        s.display_name AS created_by_name
      FROM trapper.email_batches eb
      LEFT JOIN trapper.outlook_email_accounts oa ON oa.account_id = eb.outlook_account_id
      LEFT JOIN ops.staff s ON s.staff_id = eb.created_by
      WHERE eb.batch_id = $1
    `, [id]);

    if (!batch) {
      return NextResponse.json({ error: "Email batch not found" }, { status: 404 });
    }

    // Get linked requests
    const requests = await queryRows<{
      request_id: string;
      source_record_id: string;
      email_summary: string;
      requester_name: string;
      formatted_address: string;
      estimated_cat_count: number | null;
    }>(`
      SELECT
        r.request_id,
        r.source_record_id,
        r.email_summary,
        r.estimated_cat_count,
        p.display_name AS requester_name,
        pl.formatted_address
      FROM ops.requests r
      LEFT JOIN sot.people p ON p.person_id = r.requester_person_id
      LEFT JOIN sot.places pl ON pl.place_id = r.place_id
      WHERE r.email_batch_id = $1
      ORDER BY r.created_at
    `, [id]);

    return NextResponse.json({
      batch,
      requests,
    });
  } catch (error) {
    console.error("Get email batch error:", error);

    if (error instanceof Error && "statusCode" in error) {
      const authError = error as { message: string; statusCode: number };
      return NextResponse.json({ error: authError.message }, { status: authError.statusCode });
    }

    return NextResponse.json({ error: "Failed to get email batch" }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/email-batches/[id]
 *
 * Update an email batch or send it.
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

    // Get current batch
    const batch = await queryOne<EmailBatch>(`
      SELECT * FROM trapper.email_batches WHERE batch_id = $1
    `, [id]);

    if (!batch) {
      return NextResponse.json({ error: "Email batch not found" }, { status: 404 });
    }

    // Handle send action
    if (action === "send") {
      if (batch.status !== "draft") {
        return NextResponse.json({ error: "Can only send draft batches" }, { status: 400 });
      }

      if (!batch.outlook_account_id) {
        return NextResponse.json({ error: "No Outlook account configured for this batch" }, { status: 400 });
      }

      // Mark as sending
      await query(`
        UPDATE trapper.email_batches SET status = 'sending', updated_at = NOW() WHERE batch_id = $1
      `, [id]);

      try {
        // Send via Outlook
        const result = await sendOutlookEmail({
          accountId: batch.outlook_account_id,
          to: batch.recipient_email,
          toName: batch.recipient_name || undefined,
          subject: batch.subject,
          bodyHtml: batch.body_html,
        });

        if (result.success) {
          // Mark batch as sent
          await query(`
            UPDATE trapper.email_batches
            SET status = 'sent', sent_at = NOW(), updated_at = NOW()
            WHERE batch_id = $1
          `, [id]);

          // Clear ready_to_email flags on linked requests
          await query(`
            UPDATE ops.requests
            SET ready_to_email = FALSE, updated_at = NOW()
            WHERE email_batch_id = $1
          `, [id]);

          // Log the sent email
          await query(`
            INSERT INTO trapper.sent_emails (
              recipient_email, recipient_name, recipient_person_id,
              subject, body_html, sent_via, sent_by, outlook_account_id
            ) VALUES ($1, $2, $3, $4, $5, 'outlook', $6, $7)
          `, [
            batch.recipient_email,
            batch.recipient_name,
            batch.recipient_person_id,
            batch.subject,
            batch.body_html,
            staff.staff_id,
            batch.outlook_account_id,
          ]);

          return NextResponse.json({ success: true });
        } else {
          await query(`
            UPDATE trapper.email_batches
            SET status = 'failed', error_message = $2, updated_at = NOW()
            WHERE batch_id = $1
          `, [id, result.error || "Unknown error"]);

          return NextResponse.json({ error: result.error || "Failed to send email" }, { status: 500 });
        }
      } catch (sendError) {
        const errorMessage = sendError instanceof Error ? sendError.message : "Send failed";
        await query(`
          UPDATE trapper.email_batches
          SET status = 'failed', error_message = $2, updated_at = NOW()
          WHERE batch_id = $1
        `, [id, errorMessage]);

        return NextResponse.json({ error: errorMessage }, { status: 500 });
      }
    }

    // Handle cancel action
    if (action === "cancel") {
      if (batch.status !== "draft") {
        return NextResponse.json({ error: "Can only cancel draft batches" }, { status: 400 });
      }

      // Unlink requests from batch
      await query(`
        UPDATE ops.requests
        SET email_batch_id = NULL, updated_at = NOW()
        WHERE email_batch_id = $1
      `, [id]);

      // Mark batch as cancelled
      await query(`
        UPDATE trapper.email_batches SET status = 'cancelled', updated_at = NOW() WHERE batch_id = $1
      `, [id]);

      return NextResponse.json({ success: true });
    }

    // Regular update
    if (batch.status !== "draft") {
      return NextResponse.json({ error: "Can only update draft batches" }, { status: 400 });
    }

    const updateFields: string[] = [];
    const updateValues: (string | null)[] = [];
    let paramIndex = 1;

    const allowedFields = ["subject", "body_html", "outlook_account_id", "recipient_email", "recipient_name"];

    for (const field of allowedFields) {
      if (field in updates) {
        updateFields.push(`${field} = $${paramIndex}`);
        updateValues.push(updates[field]);
        paramIndex++;
      }
    }

    if (updateFields.length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    updateFields.push(`updated_at = NOW()`);
    updateValues.push(id);

    await query(`
      UPDATE trapper.email_batches
      SET ${updateFields.join(", ")}
      WHERE batch_id = $${paramIndex}
    `, updateValues);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Update email batch error:", error);

    if (error instanceof Error && "statusCode" in error) {
      const authError = error as { message: string; statusCode: number };
      return NextResponse.json({ error: authError.message }, { status: authError.statusCode });
    }

    return NextResponse.json({ error: "Failed to update email batch" }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/email-batches/[id]
 *
 * Delete a draft email batch.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireRole(request, ["admin", "staff"]);
    const { id } = await params;

    const batch = await queryOne<{ status: string }>(`
      SELECT status FROM trapper.email_batches WHERE batch_id = $1
    `, [id]);

    if (!batch) {
      return NextResponse.json({ error: "Email batch not found" }, { status: 404 });
    }

    if (batch.status !== "draft") {
      return NextResponse.json({ error: "Can only delete draft batches" }, { status: 400 });
    }

    // Unlink requests first
    await query(`
      UPDATE ops.requests
      SET email_batch_id = NULL, updated_at = NOW()
      WHERE email_batch_id = $1
    `, [id]);

    // Delete the batch
    await query(`DELETE FROM trapper.email_batches WHERE batch_id = $1`, [id]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete email batch error:", error);

    if (error instanceof Error && "statusCode" in error) {
      const authError = error as { message: string; statusCode: number };
      return NextResponse.json({ error: authError.message }, { status: authError.statusCode });
    }

    return NextResponse.json({ error: "Failed to delete email batch" }, { status: 500 });
  }
}
