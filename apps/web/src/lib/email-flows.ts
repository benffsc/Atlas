/**
 * Email Flows — per-flow config helpers.
 *
 * Part of FFS-1181 Follow-Up Phase 3. Reads ops.email_flows rows and
 * provides typed accessors for per-flow safety gates.
 *
 * Precedence:
 *   1. Per-flow DB row (ops.email_flows) wins when present
 *   2. Falls through to global keys (email.global.dry_run /
 *      email.test_recipient_override) via lib/email-config.ts
 *
 * See MIG_3066 for the table schema and seed data.
 */

import { queryOne } from "./db";
import {
  isDryRunEnabled as isGlobalDryRunEnabled,
  getTestRecipientOverride as getGlobalTestRecipientOverride,
} from "./email-config";

export interface EmailFlow {
  flow_slug: string;
  display_name: string;
  description: string | null;
  template_key: string | null;
  enabled: boolean;
  dry_run: boolean;
  test_recipient_override: string | null;
  suppression_scope: "global" | "per_flow" | "per_flow_per_recipient";
  suppression_days: number;
  send_via: "resend" | "outlook";
  outlook_account_email: string | null;
}

/** Fetch the row for a flow, or null if it doesn't exist. */
export async function getFlow(flowSlug: string): Promise<EmailFlow | null> {
  return queryOne<EmailFlow>(
    `SELECT flow_slug, display_name, description, template_key,
            enabled, dry_run, test_recipient_override,
            suppression_scope, suppression_days,
            send_via, outlook_account_email
       FROM ops.email_flows
      WHERE flow_slug = $1`,
    [flowSlug]
  );
}

/**
 * Returns TRUE if the flow is enabled. Absence of a row → FALSE
 * (ship-dark default).
 */
export async function isFlowEnabled(flowSlug: string): Promise<boolean> {
  const flow = await getFlow(flowSlug);
  return flow?.enabled ?? false;
}

/**
 * Returns TRUE if any dry-run layer is active for this flow:
 *
 *   - per-flow dry_run column is TRUE, OR
 *   - global email.global.dry_run is TRUE (env or DB)
 *
 * This is defense-in-depth: flipping the per-flow knob off never
 * bypasses the global kill switch.
 */
export async function isFlowDryRun(flowSlug: string): Promise<boolean> {
  const flow = await getFlow(flowSlug);
  if (flow?.dry_run) return true;
  return isGlobalDryRunEnabled();
}

/**
 * Returns the effective test recipient override for this flow.
 *
 * Precedence:
 *   1. Per-flow row's test_recipient_override (if non-empty)
 *   2. Global email.test_recipient_override (env or DB)
 *   3. null (no override)
 */
export async function getFlowTestRecipient(
  flowSlug: string
): Promise<string | null> {
  const flow = await getFlow(flowSlug);
  const perFlow = flow?.test_recipient_override?.trim();
  if (perFlow) return perFlow;
  return getGlobalTestRecipientOverride();
}

/**
 * Update per-flow config. Admin-only — callers must enforce auth.
 * Returns the updated row, or null if the slug doesn't exist.
 */
export async function updateFlow(
  flowSlug: string,
  patch: Partial<
    Pick<EmailFlow, "enabled" | "dry_run" | "test_recipient_override">
  >,
  updatedBy?: string
): Promise<EmailFlow | null> {
  // Build SET clause dynamically — only update fields present in patch
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (patch.enabled !== undefined) {
    sets.push(`enabled = $${idx++}`);
    values.push(patch.enabled);
  }
  if (patch.dry_run !== undefined) {
    sets.push(`dry_run = $${idx++}`);
    values.push(patch.dry_run);
  }
  if (patch.test_recipient_override !== undefined) {
    sets.push(`test_recipient_override = $${idx++}`);
    values.push(patch.test_recipient_override);
  }
  if (sets.length === 0) return getFlow(flowSlug);

  sets.push(`updated_by = $${idx++}`);
  values.push(updatedBy ?? null);

  values.push(flowSlug);

  return queryOne<EmailFlow>(
    `UPDATE ops.email_flows
        SET ${sets.join(", ")}
      WHERE flow_slug = $${idx}
      RETURNING flow_slug, display_name, description, template_key,
                enabled, dry_run, test_recipient_override,
                suppression_scope, suppression_days,
            send_via, outlook_account_email`,
    values
  );
}

/** List all flows ordered by display_name. */
export async function listFlows(): Promise<EmailFlow[]> {
  const { queryRows } = await import("./db");
  return queryRows<EmailFlow>(
    `SELECT flow_slug, display_name, description, template_key,
            enabled, dry_run, test_recipient_override,
            suppression_scope, suppression_days,
            send_via, outlook_account_email
       FROM ops.email_flows
      ORDER BY display_name`
  );
}
