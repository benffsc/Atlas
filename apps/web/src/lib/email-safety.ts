/**
 * Email Safety Gate — Out-of-Service-Area Pipeline
 *
 * FFS-1181 / FFS-1182
 *
 * ─────────────────────────────────────────────────────────────────────
 * How the safety gates work
 * ─────────────────────────────────────────────────────────────────────
 *
 *   1. ENV: `EMAIL_OUT_OF_AREA_LIVE` (optional developer override)
 *      - If set to `"false"` → hard-blocks, no DB config can override
 *      - If set to `"true"`  → defers to DB config
 *      - If absent (default) → defers to DB config
 *      Developers can set this on Vercel as a kill switch, but staff
 *      never need to touch it. The normal operating mode is "absent".
 *
 *   2. DB: ops.email_flows.out_of_service_area.enabled
 *      - Admin-toggleable via /admin/email-settings UI
 *      - Seeded `false` by default (safe)
 *      - This is the primary control staff use to go live
 *
 *   3. Additional safety layers (evaluated AFTER go-live):
 *      - email.global.dry_run  → render + log, don't send
 *      - test_recipient_override → redirect to test address
 *      - Per-flow dry_run → per-flow render-only mode
 *
 * ─────────────────────────────────────────────────────────────────────
 * Where this is enforced
 * ─────────────────────────────────────────────────────────────────────
 * - `/api/cron/send-emails` GET/POST           — blocks the daily cron
 * - `/api/emails/send-out-of-county` POST      — blocks manual sends
 * - `sendOutOfCountyEmail()` in lib/email.ts   — blocks direct calls
 * - `sendOutOfServiceAreaEmail()` in lib/email.ts — blocks new pipeline
 */

import { getServerConfig } from "@/lib/server-config";
import { getFlow } from "@/lib/email-flows";

export class OutOfAreaPipelineDisabledError extends Error {
  constructor(message: string, public readonly reason: "env" | "db") {
    super(message);
    this.name = "OutOfAreaPipelineDisabledError";
  }
}

/**
 * Throws if the out-of-service-area email pipeline is not enabled.
 *
 * Layer 1: ENV var — if explicitly set to "false", hard-blocks.
 *          If absent or "true", defers to DB.
 * Layer 2: DB config — ops.email_flows.enabled (admin UI toggle).
 *
 * Callers should catch this error and return HTTP 503.
 */
export async function assertOutOfAreaLive(): Promise<void> {
  // Layer 1: env var — only blocks if explicitly set to "false".
  // If absent (the normal case), fall through to DB config.
  const envVal = process.env.EMAIL_OUT_OF_AREA_LIVE;
  if (envVal === "false") {
    throw new OutOfAreaPipelineDisabledError(
      "Out-of-service-area email pipeline is hard-blocked by env var " +
        "EMAIL_OUT_OF_AREA_LIVE=false. A developer must remove or " +
        "change this env var on the hosting platform.",
      "env"
    );
  }

  // Layer 2: DB config — prefer ops.email_flows.enabled (MIG_3066) and
  // fall through to the legacy email.out_of_area.live key for rows
  // that don't exist yet.
  const flow = await getFlow("out_of_service_area");
  const dbLive = flow
    ? flow.enabled
    : await getServerConfig<boolean>("email.out_of_area.live", false);

  if (!dbLive) {
    throw new OutOfAreaPipelineDisabledError(
      "Out-of-service-area email pipeline is disabled. " +
        "Enable it in Admin → Email Settings → Email Flows.",
      "db"
    );
  }
}

/**
 * Non-throwing variant — returns the current state for UI display.
 */
export async function getOutOfAreaLiveState(): Promise<{
  envLive: boolean;
  envBlocked: boolean;
  dbLive: boolean;
  live: boolean;
}> {
  const envVal = process.env.EMAIL_OUT_OF_AREA_LIVE;
  const envBlocked = envVal === "false";
  const envLive = !envBlocked;
  const flow = await getFlow("out_of_service_area");
  const dbLive = flow
    ? flow.enabled
    : await getServerConfig<boolean>("email.out_of_area.live", false);
  return { envLive, envBlocked, dbLive, live: envLive && dbLive };
}
