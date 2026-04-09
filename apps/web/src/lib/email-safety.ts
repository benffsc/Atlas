/**
 * Email Safety Gate — Out-of-Service-Area Pipeline
 *
 * FFS-1181 / FFS-1182
 *
 * ─────────────────────────────────────────────────────────────────────
 * Why this exists
 * ─────────────────────────────────────────────────────────────────────
 * The legacy `out_of_county` pipeline in Atlas is *silently broken*:
 *   - The view `ops.v_pending_out_of_county_emails` selects columns
 *     (`submitter_email`, `submitter_name`, `address`) that don't
 *     match what `sendOutOfCountyEmail()` in `lib/email.ts` expects
 *     (`email`, `first_name`, `detected_county`).
 *   - The `out_of_county = TRUE` flag that the view needs is never
 *     set anywhere in the codebase.
 *   - Net result: the daily cron at /api/cron/send-emails runs and
 *     finds 0 rows every day.
 *
 * Any well-intentioned schema fix (e.g. renaming a column) could
 * re-activate the pipe overnight and silently send real emails to
 * real people. This module is the hard-stop that prevents that.
 *
 * ─────────────────────────────────────────────────────────────────────
 * Two flags must BOTH be true to send
 * ─────────────────────────────────────────────────────────────────────
 *   1. ENV: `EMAIL_OUT_OF_AREA_LIVE=true`
 *      - Requires a Vercel redeploy to flip
 *      - Guards against DB state accidentally re-activating the pipe
 *   2. DB:  `email.out_of_area.live=true`  in ops.app_config
 *      - Admin-toggleable kill switch without redeploy
 *      - Seeded `false` by default (MIG_3061)
 *
 * If either is false, `assertOutOfAreaLive()` throws and the caller
 * must return HTTP 503 to the client.
 *
 * ─────────────────────────────────────────────────────────────────────
 * Where this is enforced
 * ─────────────────────────────────────────────────────────────────────
 * - `/api/cron/send-emails` GET/POST           — blocks the daily cron
 * - `/api/emails/send-out-of-county` POST      — blocks manual sends
 * - `sendOutOfCountyEmail()` in lib/email.ts   — blocks direct calls
 *
 * ─────────────────────────────────────────────────────────────────────
 * When this gets disabled
 * ─────────────────────────────────────────────────────────────────────
 * Never automatically. Ben manually walks through the Go-Live runbook
 * (`docs/RUNBOOKS/out_of_service_area_email_golive.md`) and flips both
 * flags. See FFS-1190 for the runbook.
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
 * Throws if the out-of-service-area email pipeline is not explicitly
 * enabled at BOTH the env var and DB config layers.
 *
 * Callers should catch this error and return HTTP 503.
 */
export async function assertOutOfAreaLive(): Promise<void> {
  // Layer 1: env var (requires redeploy to flip)
  const envLive = process.env.EMAIL_OUT_OF_AREA_LIVE === "true";
  if (!envLive) {
    throw new OutOfAreaPipelineDisabledError(
      "Out-of-service-area email pipeline is disabled until Go Live " +
        "(env var EMAIL_OUT_OF_AREA_LIVE is not 'true'). " +
        "See docs/RUNBOOKS/out_of_service_area_email_golive.md.",
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
      "Out-of-service-area email pipeline is disabled until Go Live " +
        "(ops.email_flows.out_of_service_area.enabled is not true). " +
        "See docs/RUNBOOKS/out_of_service_area_email_golive.md.",
      "db"
    );
  }
}

/**
 * Non-throwing variant — returns the current state for UI display.
 */
export async function getOutOfAreaLiveState(): Promise<{
  envLive: boolean;
  dbLive: boolean;
  live: boolean;
}> {
  const envLive = process.env.EMAIL_OUT_OF_AREA_LIVE === "true";
  const flow = await getFlow("out_of_service_area");
  const dbLive = flow
    ? flow.enabled
    : await getServerConfig<boolean>("email.out_of_area.live", false);
  return { envLive, dbLive, live: envLive && dbLive };
}
