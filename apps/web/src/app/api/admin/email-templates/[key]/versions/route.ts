/**
 * GET  /api/admin/email-templates/[key]/versions
 * POST /api/admin/email-templates/[key]/versions    (rollback)
 *
 * Part of FFS-1181 Follow-Up Phase 6.
 *
 * GET: lists version history for a template, newest first.
 * POST body: { action: "rollback", version_number: number }
 *   → Copies the historical version's subject/body into the live
 *     template row. The UPDATE fires trg_version_email_template which
 *     snapshots the (now-outgoing) state as a new version — so rollback
 *     never loses history.
 */

import { NextRequest } from "next/server";
import {
  apiSuccess,
  apiBadRequest,
  apiForbidden,
  apiServerError,
  apiUnauthorized,
  apiNotFound,
} from "@/lib/api-response";
import { getSession } from "@/lib/auth";
import { queryRows, queryOne } from "@/lib/db";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized();
  if (session.auth_role !== "admin" && session.auth_role !== "staff") {
    return apiForbidden("Only staff can view template history");
  }

  try {
    const { key } = await params;
    const rows = await queryRows(
      `SELECT version_id, template_key, version_number,
              subject, LENGTH(body_html) AS body_html_length,
              change_summary, created_at, created_by, is_active
         FROM ops.email_template_versions
        WHERE template_key = $1
        ORDER BY version_number DESC
        LIMIT 50`,
      [key]
    );
    return apiSuccess({ rows });
  } catch (err) {
    console.error("template versions GET error:", err);
    return apiServerError("Failed to load template history");
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized();
  if (session.auth_role !== "admin") {
    return apiForbidden("Only admins can roll back templates");
  }

  try {
    const { key } = await params;
    const body = await request.json().catch(() => ({}));
    const action = body?.action as string | undefined;
    const versionNumber = body?.version_number as number | undefined;

    if (action !== "rollback") {
      return apiBadRequest("action must be 'rollback'");
    }
    if (!versionNumber || !Number.isFinite(versionNumber)) {
      return apiBadRequest("version_number is required");
    }

    const historic = await queryOne<{
      subject: string;
      body_html: string;
      body_text: string | null;
      placeholders: string[] | null;
    }>(
      `SELECT subject, body_html, body_text, placeholders
         FROM ops.email_template_versions
        WHERE template_key = $1 AND version_number = $2`,
      [key, versionNumber]
    );

    if (!historic) {
      return apiNotFound("template_version", `${key}@${versionNumber}`);
    }

    // The UPDATE fires trg_version_email_template which snapshots the
    // pre-rollback state as a new version_number.
    const updated = await queryOne<{ template_key: string }>(
      `UPDATE ops.email_templates
          SET subject = $1,
              body_html = $2,
              body_text = $3,
              placeholders = $4,
              updated_at = NOW()
        WHERE template_key = $5
        RETURNING template_key`,
      [
        historic.subject,
        historic.body_html,
        historic.body_text,
        historic.placeholders,
        key,
      ]
    );

    if (!updated) return apiNotFound("template", key);

    // Audit log
    try {
      await queryOne(
        `INSERT INTO ops.entity_edits
           (entity_type, entity_id, field_name, old_value, new_value, changed_by, edit_source)
         VALUES ('email_template', NULL, 'rollback', $1, $2, $3, 'admin_template_rollback')`,
        [
          JSON.stringify({ template_key: key }),
          JSON.stringify({ rolled_back_to: versionNumber }),
          session.staff_id,
        ]
      );
    } catch (err) {
      console.warn("Failed to write audit row for template rollback:", err);
    }

    return apiSuccess({
      template_key: key,
      rolled_back_to: versionNumber,
    });
  } catch (err) {
    console.error("template rollback error:", err);
    return apiServerError("Failed to roll back template");
  }
}
