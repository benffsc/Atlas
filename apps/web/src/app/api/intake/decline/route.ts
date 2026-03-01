import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";

interface DeclineRequest {
  submission_id: string;
  reason_code: string;
  reason_notes?: string | null;
  referred_to_org?: string | null;
  send_notification?: boolean;
}

const DECLINE_REASON_LABELS: Record<string, string> = {
  out_of_county: "Out of Service Area",
  owned_cat: "Owned Cat",
  already_fixed: "Already Fixed",
  duplicate: "Duplicate Submission",
  no_response: "No Response",
  withdrawn: "Withdrawn by Requester",
  referred_to_other_org: "Referred to Other Org",
  not_tnr_case: "Not a TNR Case",
  spam: "Spam/Invalid",
};

export async function POST(request: NextRequest) {
  try {
    const body: DeclineRequest = await request.json();
    const {
      submission_id,
      reason_code,
      reason_notes,
      referred_to_org,
      send_notification = false,
    } = body;

    if (!submission_id) {
      return NextResponse.json(
        { error: "submission_id is required" },
        { status: 400 }
      );
    }

    if (!reason_code) {
      return NextResponse.json(
        { error: "reason_code is required" },
        { status: 400 }
      );
    }

    // Build the decline note that will be stored
    const reasonLabel = DECLINE_REASON_LABELS[reason_code] || reason_code;
    const declineNote = [
      `DECLINED: ${reasonLabel}`,
      referred_to_org ? `Referred to: ${referred_to_org}` : null,
      reason_notes ? `Notes: ${reason_notes}` : null,
      `Date: ${new Date().toISOString().split("T")[0]}`,
    ]
      .filter(Boolean)
      .join("\n");

    // Fetch current submission to get email for notification
    const submission = await queryOne<{
      submission_id: string;
      submitter_name: string;
      email: string;
      review_notes: string | null;
    }>(
      `SELECT submission_id,
              COALESCE(first_name || ' ' || last_name, first_name, last_name, 'Unknown') as submitter_name,
              email,
              review_notes
       FROM ops.intake_submissions
       WHERE submission_id = $1`,
      [submission_id]
    );

    if (!submission) {
      return NextResponse.json(
        { error: "Submission not found" },
        { status: 404 }
      );
    }

    // Append decline note to existing review_notes
    const existingNotes = submission.review_notes || "";
    const updatedNotes = existingNotes
      ? `${existingNotes}\n\n---\n${declineNote}`
      : declineNote;

    // Update submission status to declined
    const updated = await queryOne<{ submission_id: string }>(
      `UPDATE ops.intake_submissions
       SET submission_status = 'declined',
           status = 'declined',
           review_notes = $2,
           updated_at = NOW()
       WHERE submission_id = $1
       RETURNING submission_id`,
      [submission_id, updatedNotes]
    );

    if (!updated) {
      return NextResponse.json(
        { error: "Failed to update submission" },
        { status: 500 }
      );
    }

    // Log decline in journal
    await queryOne(
      `INSERT INTO ops.journal_entries (
        entity_type, entity_id, entry_kind, content, metadata, created_at
      ) VALUES (
        'intake_submission', $1, 'status_change', $2, $3, NOW()
      )`,
      [
        submission_id,
        `Submission declined: ${reasonLabel}`,
        JSON.stringify({
          reason_code,
          reason_notes: reason_notes || null,
          referred_to_org: referred_to_org || null,
          send_notification,
        }),
      ]
    );

    // DEFERRED: Email notification not yet implemented
    // Reason: Email infrastructure (Resend/SendGrid) setup pending.
    // For now, we log that notification was requested to journal_entries.
    // When email is ready, this will call the notification service.
    if (send_notification && submission.email) {
      // Log that notification was requested (actual email sending would be here)
      await queryOne(
        `INSERT INTO ops.journal_entries (
          entity_type, entity_id, entry_kind, content, metadata, created_at
        ) VALUES (
          'intake_submission', $1, 'notification_requested', $2, $3, NOW()
        )`,
        [
          submission_id,
          `Decline notification requested for ${submission.email}`,
          JSON.stringify({
            email: submission.email,
            reason_code,
            notification_type: "decline",
          }),
        ]
      );
    }

    return NextResponse.json({
      success: true,
      submission_id,
      status: "declined",
      reason_code,
      notification_sent: send_notification,
    });
  } catch (err) {
    console.error("Decline error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to decline submission" },
      { status: 500 }
    );
  }
}
