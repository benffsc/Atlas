import { NextRequest } from "next/server";
import { queryRows, queryOne } from "@/lib/db";
import { apiSuccess, apiError } from "@/lib/api-response";
import { sendTemplateEmail } from "@/lib/email";

/**
 * Equipment Return Reminder Cron
 *
 * Runs daily. Sends email reminders to borrowers whose equipment is:
 * - Due tomorrow (1 day before)
 * - Due today (day-of)
 * - 1 day overdue
 * - 3 days overdue
 * - 7 days overdue (weekly after that via the overdue alert cron)
 *
 * Only sends to borrowers with a resolved email address. Skips items
 * that have already received a reminder today (dedup via ops.email_log).
 *
 * FFS-1210 (Layer 2.4 of the Equipment Overhaul epic FFS-1201).
 *
 * Per HumanePro: "FCCO calls weekly to remind borrowers about loan
 * periods; also check in with people about the status of their cat
 * colonies and to help troubleshoot any problems."
 */

const CRON_SECRET = process.env.CRON_SECRET;

// Days relative to due_date when we send reminders
// Negative = before due, 0 = day-of, positive = after due
const REMINDER_DAYS = [-1, 0, 1, 3, 7];

interface DueItem {
  equipment_id: string;
  barcode: string | null;
  display_name: string;
  custodian_person_id: string | null;
  custodian_name: string | null;
  custodian_email: string | null;
  due_date: string;
  days_until_due: number;
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-vercel-cron");

  if (!cronHeader && CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return apiError("Unauthorized", 401);
  }

  try {
    // Find all checked-out items with a due_date that matches a reminder day
    const items = await queryRows<DueItem>(
      `SELECT
         e.equipment_id,
         e.barcode,
         COALESCE(e.equipment_name, e.barcode, et.display_name) AS display_name,
         e.current_custodian_id AS custodian_person_id,
         COALESCE(p.display_name, e.current_holder_name) AS custodian_name,
         sot.get_email(e.current_custodian_id) AS custodian_email,
         ev.due_date::text,
         (ev.due_date - CURRENT_DATE)::int AS days_until_due
       FROM ops.equipment_events ev
       JOIN ops.equipment e ON e.equipment_id = ev.equipment_id
       LEFT JOIN ops.equipment_types et ON et.type_key = e.equipment_type_key
       LEFT JOIN sot.people p ON p.person_id = e.current_custodian_id
       WHERE ev.event_type = 'check_out'
         AND e.custody_status = 'checked_out'
         AND e.retired_at IS NULL
         AND ev.due_date IS NOT NULL
         AND (ev.due_date - CURRENT_DATE)::int = ANY($1)
         AND NOT EXISTS (
           SELECT 1 FROM ops.equipment_events ev2
           WHERE ev2.equipment_id = ev.equipment_id
             AND ev2.event_type = 'check_in'
             AND ev2.created_at > ev.created_at
         )`,
      [REMINDER_DAYS],
    );

    let sent = 0;
    let skippedNoEmail = 0;
    let skippedAlreadySent = 0;

    for (const item of items) {
      if (!item.custodian_email) {
        skippedNoEmail++;
        continue;
      }

      // Dedup: check if we already sent a reminder for this item today
      const alreadySent = await queryOne<{ id: string }>(
        `SELECT email_id AS id FROM ops.email_log
         WHERE template_key = 'equipment_return_reminder'
           AND person_id = $1
           AND sent_at > CURRENT_DATE
           AND metadata->>'equipment_id' = $2`,
        [item.custodian_person_id, item.equipment_id],
      );

      if (alreadySent) {
        skippedAlreadySent++;
        continue;
      }

      // Compute days_status text
      let daysStatus: string;
      if (item.days_until_due > 0) {
        daysStatus = `due in ${item.days_until_due} day${item.days_until_due > 1 ? "s" : ""}`;
      } else if (item.days_until_due === 0) {
        daysStatus = "due today";
      } else {
        const overdue = Math.abs(item.days_until_due);
        daysStatus = `${overdue} day${overdue > 1 ? "s" : ""} overdue`;
      }

      const equipmentLabel = `${item.display_name}${item.barcode ? ` — ${item.barcode}` : ""}`;

      try {
        await sendTemplateEmail({
          templateKey: "equipment_return_reminder",
          to: item.custodian_email,
          toName: item.custodian_name || undefined,
          personId: item.custodian_person_id || undefined,
          placeholders: {
            borrower_name: item.custodian_name || "there",
            equipment_name: equipmentLabel,
            due_date: new Date(item.due_date).toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
            }),
            days_status: daysStatus,
          },
          flowSlug: "equipment_return_reminder",
        });
        sent++;
      } catch (err) {
        console.error(
          `[equipment-return-reminders] Failed to send to ${item.custodian_email}:`,
          err,
        );
      }
    }

    return apiSuccess({
      message: `${sent} reminder${sent !== 1 ? "s" : ""} sent`,
      items_checked: items.length,
      sent,
      skipped_no_email: skippedNoEmail,
      skipped_already_sent: skippedAlreadySent,
      reminder_days: REMINDER_DAYS,
    });
  } catch (err) {
    console.error("[equipment-return-reminders] Error:", err);
    return apiError(
      err instanceof Error ? err.message : "Return reminder check failed",
      500,
    );
  }
}
