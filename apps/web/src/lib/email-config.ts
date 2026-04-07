/**
 * Email Pipeline Config (FFS-1188 / Phase 5)
 *
 * Typed getters for the three layers of email safety defense:
 *
 *   1. EMAIL_DRY_RUN env var               OR  email.global.dry_run        DB key
 *   2. EMAIL_TEST_RECIPIENT_OVERRIDE env var OR email.test_recipient_override DB key
 *   3. EMAIL_OUT_OF_AREA_LIVE env var      OR  email.out_of_area.live       DB key
 *
 * Env vars take precedence when explicitly set. They require a Vercel
 * redeploy to flip and protect against accidental DB state changes.
 *
 * isOutOfAreaLive() requires BOTH layers to be true (and is the
 * authoritative gate for the out-of-service-area cron + send route).
 */

import { getServerConfig } from "@/lib/server-config";

/**
 * Returns TRUE if the global dry-run flag is on.
 *
 * In dry-run mode, sendTemplateEmail() and sendTemplatedOutlookEmail()
 * render the template, log it to ops.sent_emails with status='dry_run',
 * and return success without calling Resend or Microsoft Graph.
 */
export async function isDryRunEnabled(): Promise<boolean> {
  // Env var explicit "false" can disable, explicit "true" enables.
  // Otherwise fall through to DB.
  const env = process.env.EMAIL_DRY_RUN;
  if (env === "true") return true;
  if (env === "false") return false;

  return getServerConfig<boolean>("email.global.dry_run", true);
}

/**
 * Returns the test recipient override email address, or null if none.
 *
 * When non-null AND dry-run is OFF, every send is rerouted to this
 * address. The original recipient is preserved in the subject line
 * as [TEST → original@email] by lib/email.ts.
 */
export async function getTestRecipientOverride(): Promise<string | null> {
  const env = process.env.EMAIL_TEST_RECIPIENT_OVERRIDE;
  if (env !== undefined) {
    return env.trim() || null;
  }
  const v = await getServerConfig<string>("email.test_recipient_override", "");
  return v && v.trim() ? v.trim() : null;
}

/**
 * Returns TRUE if BOTH the env var and DB key for out-of-area live
 * are explicitly enabled. Used internally by lib/email-safety.ts.
 *
 * NOTE: this function returns the *combined* state. The env var alone
 * is not sufficient — the DB toggle must also be flipped via the
 * admin UI (or directly in ops.app_config).
 */
export async function isOutOfAreaLive(): Promise<boolean> {
  const envLive = process.env.EMAIL_OUT_OF_AREA_LIVE === "true";
  if (!envLive) return false;
  return getServerConfig<boolean>("email.out_of_area.live", false);
}

/**
 * Compute the current pipeline mode for UI display in
 * /admin/email-settings and the intake confirm modal.
 */
export type PipelineMode = "dry_run" | "test_override" | "live" | "unknown";

export async function getPipelineMode(): Promise<{
  mode: PipelineMode;
  global_dry_run: boolean;
  test_recipient_override: string | null;
  out_of_area_live: boolean;
}> {
  const [dry, override, live] = await Promise.all([
    isDryRunEnabled(),
    getTestRecipientOverride(),
    isOutOfAreaLive(),
  ]);

  let mode: PipelineMode;
  if (dry) {
    mode = "dry_run";
  } else if (override) {
    mode = "test_override";
  } else {
    mode = "live";
  }

  return {
    mode,
    global_dry_run: dry,
    test_recipient_override: override,
    out_of_area_live: live,
  };
}
