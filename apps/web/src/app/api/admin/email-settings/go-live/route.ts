/**
 * POST /api/admin/email-settings/go-live
 *
 * Body: { enabled: boolean }
 *
 * Toggles the email.out_of_area.live DB flag (the Go Live kill switch).
 * Admin only.
 *
 * Gating: when enabling, requires at least one prior successful test
 * send to ben@forgottenfelines.com (or whatever is configured as the
 * test recipient). This forces Ben to verify deliverability end-to-end
 * before flipping production.
 *
 * NOTE: this only flips the DB layer. The env var
 * EMAIL_OUT_OF_AREA_LIVE must ALSO be set to 'true' in Vercel for the
 * pipeline to actually run. assertOutOfAreaLive() requires both.
 *
 * FFS-1188 (Phase 5)
 */

import { NextRequest } from "next/server";
import {
  apiSuccess,
  apiBadRequest,
  apiForbidden,
  apiServerError,
  apiUnauthorized,
} from "@/lib/api-response";
import { getSession } from "@/lib/auth";
import { queryOne } from "@/lib/db";

const TEST_RECIPIENT_DEFAULT = "ben@forgottenfelines.com";

export async function POST(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized();
  if (session.auth_role !== "admin") {
    return apiForbidden("Only admins can flip Go Live");
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { enabled } = body as { enabled?: boolean };
    if (typeof enabled !== "boolean") {
      return apiBadRequest("'enabled' must be a boolean");
    }

    // Gate: when enabling, require a successful prior test send
    if (enabled) {
      const testRecipient =
        process.env.EMAIL_TEST_RECIPIENT_OVERRIDE || TEST_RECIPIENT_DEFAULT;

      const row = await queryOne<{ sent_count: number }>(
        `SELECT COUNT(*)::INT AS sent_count
           FROM ops.sent_emails
          WHERE template_key = 'out_of_service_area'
            AND recipient_email = $1
            AND status = 'sent'`,
        [testRecipient]
      );
      if ((row?.sent_count ?? 0) < 1) {
        return apiBadRequest(
          `Cannot enable Go Live until at least one successful test send to ${testRecipient} is recorded. ` +
            `Run a test send via /api/admin/email-settings/test-send first.`,
          { test_recipient: testRecipient }
        );
      }
    }

    const previous = await queryOne<{ value: unknown }>(
      `SELECT value FROM ops.app_config WHERE key = 'email.out_of_area.live'`
    );

    await queryOne(
      `UPDATE ops.app_config
          SET value = $1::jsonb,
              updated_by = $2,
              updated_at = NOW()
        WHERE key = 'email.out_of_area.live'
        RETURNING key`,
      [JSON.stringify(enabled), session.staff_id]
    );

    // Audit log — best effort
    try {
      await queryOne(
        `INSERT INTO ops.entity_edits
           (entity_type, entity_id, field_name, old_value, new_value, changed_by, edit_source)
         VALUES ('email_pipeline', NULL, 'out_of_area_live', $1, $2, $3, 'admin_go_live_toggle')`,
        [
          JSON.stringify(previous?.value ?? null),
          JSON.stringify(enabled),
          session.staff_id,
        ]
      );
    } catch (err) {
      console.warn("Failed to write audit row for go-live toggle:", err);
    }

    return apiSuccess({
      key: "email.out_of_area.live",
      enabled,
      changed_by: session.staff_id,
      reminder: enabled
        ? "DB flag enabled. EMAIL_OUT_OF_AREA_LIVE env var must ALSO be set to 'true' in Vercel for the pipeline to run."
        : "Pipeline disabled at the DB layer.",
    });
  } catch (err) {
    console.error("go-live toggle error:", err);
    return apiServerError("Failed to toggle Go Live");
  }
}
