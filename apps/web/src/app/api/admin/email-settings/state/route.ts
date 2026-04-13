/**
 * GET /api/admin/email-settings/state
 *
 * Returns the current pipeline mode (dry_run / test_override / live)
 * plus the prerequisite test-send count for the Go-Live button.
 *
 * Used by:
 *   - /admin/email-settings page (Pipeline Mode card)
 *   - SendOutOfServiceConfirmModal (banner indicator)
 *
 * FFS-1188 (Phase 5)
 */

import { NextRequest } from "next/server";
import { apiSuccess, apiServerError } from "@/lib/api-response";
import { getPipelineMode } from "@/lib/email-config";
import { getOutOfAreaLiveState } from "@/lib/email-safety";
import { queryOne } from "@/lib/db";
import { requireAuth, AuthError } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    await requireAuth(request);

    const [pipeline, gateState] = await Promise.all([
      getPipelineMode(),
      getOutOfAreaLiveState(),
    ]);

    // Prerequisite for Go Live: at least one successful test send to ben@
    // for the out_of_service_area template.
    const TEST_RECIPIENT = process.env.EMAIL_TEST_RECIPIENT_OVERRIDE
      || "ben@forgottenfelines.com";
    const testSendRow = await queryOne<{
      sent_count: number;
      latest_sent_at: string | null;
    }>(
      `SELECT COUNT(*)::INT AS sent_count,
              MAX(sent_at)::TEXT AS latest_sent_at
         FROM ops.sent_emails
        WHERE template_key = 'out_of_service_area'
          AND recipient_email = $1
          AND status = 'sent'`,
      [TEST_RECIPIENT]
    );

    return apiSuccess({
      ...pipeline,
      env_dry_run: process.env.EMAIL_DRY_RUN === "true"
        ? true
        : process.env.EMAIL_DRY_RUN === "false"
          ? false
          : null,
      env_out_of_area_live: gateState.envLive,
      env_out_of_area_blocked: gateState.envBlocked,
      gate_env_live: gateState.envLive,
      gate_db_live: gateState.dbLive,
      gate_combined_live: gateState.live,
      go_live_prerequisite: {
        required_recipient: TEST_RECIPIENT,
        test_sends: testSendRow?.sent_count ?? 0,
        latest_test_send_at: testSendRow?.latest_sent_at ?? null,
        ready_for_go_live: (testSendRow?.sent_count ?? 0) >= 1,
      },
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return apiServerError(err.message);
    }
    console.error("email-settings/state error:", err);
    return apiServerError(
      err instanceof Error ? err.message : "Failed to load email pipeline state"
    );
  }
}
