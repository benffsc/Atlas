import { NextRequest } from "next/server";
import { queryRows, queryOne, execute } from "@/lib/db";
import { apiSuccess, apiError } from "@/lib/api-response";

/**
 * Equipment Overdue Check Cron
 *
 * Runs daily at 8 AM. Checks for equipment items past their due date and
 * writes alerts to ops.alert_queue so staff sees them in the admin
 * dashboard and the daily alert digest email.
 *
 * Also handles auto-escalation (FFS-1338):
 * - Re-surfaces stale follow-ups: if someone was "connected_will_return" or
 *   "connected_needs_time" but days_since_last_contact > 14, logs an
 *   auto_escalated system contact attempt so staff sees them again.
 * - Auto-logs a system contact attempt for items crossing the 30-day critical
 *   threshold, so staff can see when escalation happened.
 *
 * Uses the existing equipment.overdue_days_warning (14) and
 * equipment.overdue_days_critical (30) config thresholds from ops.app_config.
 *
 * FFS-1205 (Layer 1.4 of the Equipment Overhaul epic FFS-1201).
 * FFS-1338 (Auto-escalation for overdue equipment).
 *
 * Vercel Cron: Add to vercel.json:
 *   { "path": "/api/cron/equipment-overdue", "schedule": "0 16 * * *" }
 *   (0 16 UTC = 8 AM PST / 9 AM PDT)
 */

const CRON_SECRET = process.env.CRON_SECRET;

interface OverdueItem {
  equipment_id: string;
  barcode: string | null;
  display_name: string;
  custodian_name: string | null;
  custodian_phone: string | null;
  due_date: string;
  days_overdue: number;
}

interface ThresholdConfig {
  warning_days: number;
  critical_days: number;
}

/** Row from ops.v_equipment_overdue_queue for escalation checks */
interface EscalationCandidate {
  person_id: string | null;
  holder_name: string;
  equipment_ids: string[];
  trap_barcodes: string[];
  trap_count: number;
  max_days_overdue: number;
  urgency_tier: "critical" | "warning" | "new" | "on_time";
  days_since_last_contact: number | null;
  contact_attempt_count: number;
  last_contact_outcome: string | null;
}

/** Stale follow-up re-contact threshold (days) */
const STALE_FOLLOWUP_DAYS = 14;

export async function GET(request: NextRequest) {
  // Auth: Vercel cron header or CRON_SECRET
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-vercel-cron");

  if (!cronHeader && CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return apiError("Unauthorized", 401);
  }

  try {
    // Read thresholds from config (fallback to sensible defaults)
    const warningConfig = await queryOne<{ value: string }>(
      `SELECT value#>>'{}' AS value FROM ops.app_config WHERE key = 'equipment.overdue_days_warning'`,
    );
    const criticalConfig = await queryOne<{ value: string }>(
      `SELECT value#>>'{}' AS value FROM ops.app_config WHERE key = 'equipment.overdue_days_critical'`,
    );

    const thresholds: ThresholdConfig = {
      warning_days: warningConfig ? parseInt(warningConfig.value, 10) || 14 : 14,
      critical_days: criticalConfig ? parseInt(criticalConfig.value, 10) || 30 : 30,
    };

    // =========================================================================
    // Phase 1: Existing overdue alerts (unchanged)
    // =========================================================================

    const overdueItems = await queryRows<OverdueItem>(
      `SELECT
         e.equipment_id,
         e.barcode,
         COALESCE(e.equipment_name, e.barcode, e.equipment_type) AS display_name,
         COALESCE(p.display_name, e.current_holder_name) AS custodian_name,
         sot.get_phone(e.current_custodian_id) AS custodian_phone,
         ev.due_date::text,
         (CURRENT_DATE - ev.due_date)::int AS days_overdue
       FROM ops.equipment_events ev
       JOIN ops.equipment e ON e.equipment_id = ev.equipment_id
       LEFT JOIN sot.people p ON p.person_id = e.current_custodian_id
       WHERE ev.event_type = 'check_out'
         AND ev.due_date < CURRENT_DATE
         AND e.custody_status = 'checked_out'
         AND e.retired_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM ops.equipment_events ev2
           WHERE ev2.equipment_id = ev.equipment_id
             AND ev2.event_type = 'check_in'
             AND ev2.created_at > ev.created_at
         )
       ORDER BY ev.due_date ASC`,
    );

    let alertsCreated = 0;
    let warningCount = 0;
    let criticalCount = 0;

    for (const item of overdueItems) {
      const level =
        item.days_overdue >= thresholds.critical_days ? "critical" : "warning";

      if (level === "critical") criticalCount++;
      else warningCount++;

      // Check if we already have an unresolved alert for this item today
      // (avoid duplicate alerts from manual cron triggers)
      const existing = await queryOne<{ alert_id: string }>(
        `SELECT alert_id FROM ops.alert_queue
         WHERE source = 'equipment_overdue'
           AND metric = $1
           AND status IN ('new', 'notified')
           AND created_at > CURRENT_DATE`,
        [item.equipment_id],
      );

      if (existing) continue; // Already alerted today

      const contactInfo = [item.custodian_name, item.custodian_phone]
        .filter(Boolean)
        .join(" — ");

      await execute(
        `INSERT INTO ops.alert_queue (
           level, source, metric, message,
           current_value, threshold_value, details
         ) VALUES ($1, 'equipment_overdue', $2, $3, $4, $5, $6)`,
        [
          level,
          item.equipment_id,
          `${item.display_name} (${item.barcode || "no barcode"}) is ${item.days_overdue} days overdue. ${contactInfo || "No contact info."}`,
          item.days_overdue,
          level === "critical"
            ? thresholds.critical_days
            : thresholds.warning_days,
          JSON.stringify({
            equipment_id: item.equipment_id,
            barcode: item.barcode,
            display_name: item.display_name,
            custodian_name: item.custodian_name,
            custodian_phone: item.custodian_phone,
            due_date: item.due_date,
            days_overdue: item.days_overdue,
          }),
        ],
      );
      alertsCreated++;
    }

    // =========================================================================
    // Phase 2: Auto-escalation (FFS-1338)
    // =========================================================================
    // Query the overdue queue view for:
    // a) Stale follow-ups: previously contacted (connected_will_return or
    //    connected_needs_time) but days_since_last_contact > 14
    // b) Critical threshold crossers: items at 30+ days overdue that haven't
    //    already been auto-escalated today

    let escalationsLogged = 0;

    // 2a: Stale follow-ups — re-surface people who said they'd return but haven't
    const staleFollowups = await queryRows<EscalationCandidate>(
      `SELECT
         person_id, holder_name, equipment_ids, trap_barcodes,
         trap_count, max_days_overdue, urgency_tier,
         days_since_last_contact, contact_attempt_count,
         last_contact_outcome
       FROM ops.v_equipment_overdue_queue
       WHERE days_since_last_contact > $1
         AND contact_attempt_count > 0
         AND last_contact_outcome IN ('connected_will_return', 'connected_needs_time')`,
      [STALE_FOLLOWUP_DAYS],
    );

    for (const row of staleFollowups) {
      // Check if we already auto-escalated this person today
      const alreadyEscalated = await queryOne<{ attempt_id: string }>(
        `SELECT attempt_id FROM ops.equipment_contact_attempts
         WHERE COALESCE(person_id::text, holder_name) = $1
           AND method = 'system'
           AND outcome = 'auto_escalated'
           AND attempted_at > CURRENT_DATE`,
        [row.person_id ?? row.holder_name],
      );

      if (alreadyEscalated) continue;

      const barcodeList = row.trap_barcodes?.length
        ? row.trap_barcodes.join(", ")
        : `${row.trap_count} item(s)`;

      await execute(
        `INSERT INTO ops.equipment_contact_attempts
           (person_id, holder_name, method, outcome, notes, staff_name, equipment_ids)
         VALUES ($1, $2, 'system', 'auto_escalated', $3, 'System (cron)', $4)`,
        [
          row.person_id ?? null,
          row.holder_name,
          `Auto-escalation: last contact was ${row.days_since_last_contact} days ago (outcome: ${row.last_contact_outcome}). ${row.trap_count} trap(s) still out [${barcodeList}], ${row.max_days_overdue} days overdue. Re-contact recommended.`,
          row.equipment_ids,
        ],
      );
      escalationsLogged++;
    }

    // 2b: Critical threshold crossers — log when items first hit 30 days
    // Only for items that have been contacted before but not yet escalated
    const criticalCrossers = await queryRows<EscalationCandidate>(
      `SELECT
         person_id, holder_name, equipment_ids, trap_barcodes,
         trap_count, max_days_overdue, urgency_tier,
         days_since_last_contact, contact_attempt_count,
         last_contact_outcome
       FROM ops.v_equipment_overdue_queue
       WHERE urgency_tier = 'critical'
         AND contact_attempt_count > 0
         AND last_contact_outcome NOT IN ('connected_will_return', 'connected_needs_time')`,
    );

    for (const row of criticalCrossers) {
      // Skip if already handled in stale follow-ups above, or already escalated today
      const alreadyEscalated = await queryOne<{ attempt_id: string }>(
        `SELECT attempt_id FROM ops.equipment_contact_attempts
         WHERE COALESCE(person_id::text, holder_name) = $1
           AND method = 'system'
           AND outcome = 'auto_escalated'
           AND attempted_at > CURRENT_DATE`,
        [row.person_id ?? row.holder_name],
      );

      if (alreadyEscalated) continue;

      const barcodeList = row.trap_barcodes?.length
        ? row.trap_barcodes.join(", ")
        : `${row.trap_count} item(s)`;

      await execute(
        `INSERT INTO ops.equipment_contact_attempts
           (person_id, holder_name, method, outcome, notes, staff_name, equipment_ids)
         VALUES ($1, $2, 'system', 'auto_escalated', $3, 'System (cron)', $4)`,
        [
          row.person_id ?? null,
          row.holder_name,
          `Auto-escalation: crossed ${thresholds.critical_days}-day critical threshold. ${row.trap_count} trap(s) [${barcodeList}] now ${row.max_days_overdue} days overdue. Prior contact outcome: ${row.last_contact_outcome ?? "unknown"}. Escalated follow-up needed.`,
          row.equipment_ids,
        ],
      );
      escalationsLogged++;
    }

    const message = overdueItems.length === 0
      ? "No overdue equipment"
      : `${overdueItems.length} overdue items found, ${alertsCreated} new alerts created, ${escalationsLogged} auto-escalations logged`;

    return apiSuccess({
      message,
      overdue_count: overdueItems.length,
      warning_count: warningCount,
      critical_count: criticalCount,
      alerts_created: alertsCreated,
      escalations_logged: escalationsLogged,
      thresholds,
    });
  } catch (err) {
    console.error("[equipment-overdue] Error:", err);
    return apiError(
      err instanceof Error ? err.message : "Equipment overdue check failed",
      500,
    );
  }
}
