/**
 * POST /api/admin/email-settings/dry-run
 *
 * Body: { enabled: boolean }
 *
 * Toggles the email.global.dry_run DB flag and writes an audit row to
 * ops.entity_edits. Admin only.
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

export async function POST(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized();
  if (session.auth_role !== "admin") {
    return apiForbidden("Only admins can toggle dry-run");
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { enabled } = body as { enabled?: boolean };
    if (typeof enabled !== "boolean") {
      return apiBadRequest("'enabled' must be a boolean");
    }

    const previous = await queryOne<{ value: unknown }>(
      `SELECT value FROM ops.app_config WHERE key = 'email.global.dry_run'`
    );

    await queryOne(
      `UPDATE ops.app_config
          SET value = $1::jsonb,
              updated_by = $2,
              updated_at = NOW()
        WHERE key = 'email.global.dry_run'
        RETURNING key`,
      [JSON.stringify(enabled), session.staff_id]
    );

    // Audit log — best effort
    try {
      await queryOne(
        `INSERT INTO ops.entity_edits
           (entity_type, entity_id, field_name, old_value, new_value, changed_by, edit_source)
         VALUES ('email_pipeline', NULL, 'global_dry_run', $1, $2, $3, 'admin_email_settings')`,
        [
          JSON.stringify(previous?.value ?? null),
          JSON.stringify(enabled),
          session.staff_id,
        ]
      );
    } catch (err) {
      console.warn("Failed to write audit row for dry-run toggle:", err);
    }

    return apiSuccess({
      key: "email.global.dry_run",
      enabled,
      changed_by: session.staff_id,
    });
  } catch (err) {
    console.error("dry-run toggle error:", err);
    return apiServerError("Failed to toggle dry-run mode");
  }
}
