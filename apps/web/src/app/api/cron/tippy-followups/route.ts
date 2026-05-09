import { NextRequest } from "next/server";
import { queryRows, execute } from "@/lib/db";
import { apiSuccess, apiError } from "@/lib/api-response";

/**
 * Tippy Followup Notification Cron
 *
 * Runs daily. Creates staff_notifications for:
 * 1. Tippy tickets with followup_date due within 7 days or overdue
 * 2. Staff reminders that are due and haven't been notified today
 *
 * Idempotent: checks source + source_id to prevent duplicate notifications.
 */

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-vercel-cron");

  if (!cronHeader && CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return apiError("Unauthorized", 401);
  }

  try {
    let ticketsNotified = 0;
    let remindersNotified = 0;

    // 1. Due/overdue tippy tickets → notifications for all staff
    // (Tickets are org-wide, not per-staff — notify all active staff)
    const dueTickets = await queryRows<{
      ticket_id: string;
      summary: string;
      followup_date: string;
      priority: string;
    }>(
      `SELECT ticket_id, LEFT(summary, 100) AS summary,
        followup_date::text, priority
       FROM ops.tippy_tickets
       WHERE status = 'open' AND followup_date IS NOT NULL
         AND followup_date <= CURRENT_DATE + INTERVAL '1 day'
       ORDER BY followup_date ASC LIMIT 50`
    );

    if (dueTickets.length > 0) {
      const staffIds = await queryRows<{ staff_id: string }>(
        `SELECT staff_id::text FROM ops.staff WHERE is_active = TRUE`
      );

      for (const ticket of dueTickets) {
        for (const staff of staffIds) {
          // Idempotent: skip if already notified today
          const result = await execute(
            `INSERT INTO ops.staff_notifications (staff_id, title, body, entity_type, entity_id, link_url, source, source_id)
             SELECT $1, $2, $3, 'tippy_ticket', $4, $5, 'tippy_ticket', $4
             WHERE NOT EXISTS (
               SELECT 1 FROM ops.staff_notifications
               WHERE source = 'tippy_ticket' AND source_id = $4 AND staff_id = $1
                 AND created_at >= CURRENT_DATE
             )`,
            [
              staff.staff_id,
              `Field ticket due: ${ticket.summary}`,
              `Priority: ${ticket.priority}. Follow-up date: ${ticket.followup_date}`,
              ticket.ticket_id,
              `/admin/field-intel`,
            ]
          );
          if (result.rowCount && result.rowCount > 0) ticketsNotified++;
        }
      }
    }

    // 2. Due staff reminders → personal notifications
    const dueReminders = await queryRows<{
      reminder_id: string;
      staff_id: string;
      title: string;
      due_at: string;
    }>(
      `SELECT reminder_id::text, staff_id::text, title, due_at::text
       FROM ops.staff_reminders
       WHERE status IN ('pending', 'due')
         AND due_at <= NOW() + INTERVAL '1 day'
         AND (last_notified_at IS NULL OR last_notified_at < CURRENT_DATE)
       ORDER BY due_at ASC LIMIT 100`
    );

    for (const reminder of dueReminders) {
      await execute(
        `INSERT INTO ops.staff_notifications (staff_id, title, body, entity_type, entity_id, link_url, source, source_id)
         SELECT $1, $2, $3, 'reminder', $4, '/me', 'reminder', $4
         WHERE NOT EXISTS (
           SELECT 1 FROM ops.staff_notifications
           WHERE source = 'reminder' AND source_id = $4 AND staff_id = $1
             AND created_at >= CURRENT_DATE
         )`,
        [
          reminder.staff_id,
          `Reminder due: ${reminder.title}`,
          `Due: ${reminder.due_at}`,
          reminder.reminder_id,
        ]
      );
      remindersNotified++;

      // Mark as notified
      await execute(
        `UPDATE ops.staff_reminders SET last_notified_at = NOW() WHERE reminder_id = $1`,
        [reminder.reminder_id]
      );
    }

    return apiSuccess({
      tickets_checked: dueTickets.length,
      tickets_notified: ticketsNotified,
      reminders_checked: dueReminders.length,
      reminders_notified: remindersNotified,
    });
  } catch (error) {
    console.error("[TIPPY-FOLLOWUPS] Error:", error);
    return apiError("Cron failed", 500);
  }
}
