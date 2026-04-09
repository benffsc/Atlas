/**
 * GET  /api/admin/email-settings/suppressions
 * POST /api/admin/email-settings/suppressions       (manual add)
 * DELETE /api/admin/email-settings/suppressions?id=  (manual remove)
 *
 * Part of FFS-1181 Follow-Up Phase 5. Admin-only CRUD for
 * ops.email_suppressions.
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

export async function GET(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized();
  if (session.auth_role !== "admin") {
    return apiForbidden("Only admins can view suppressions");
  }

  try {
    const { searchParams } = new URL(request.url);
    const scope = searchParams.get("scope");
    const reason = searchParams.get("reason");
    const flowSlug = searchParams.get("flow_slug");

    const where: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (scope) {
      where.push(`scope = $${idx++}`);
      values.push(scope);
    }
    if (reason) {
      where.push(`reason = $${idx++}`);
      values.push(reason);
    }
    if (flowSlug) {
      where.push(`flow_slug = $${idx++}`);
      values.push(flowSlug);
    }

    const rows = await queryRows(
      `SELECT suppression_id, email_norm, scope, flow_slug, reason,
              source, created_at, expires_at, created_by, notes
         FROM ops.email_suppressions
        ${where.length ? "WHERE " + where.join(" AND ") : ""}
        ORDER BY created_at DESC
        LIMIT 500`,
      values
    );

    return apiSuccess({ rows });
  } catch (err) {
    console.error("suppressions GET error:", err);
    return apiServerError("Failed to load suppressions");
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized();
  if (session.auth_role !== "admin") {
    return apiForbidden("Only admins can add suppressions");
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { email, scope, flow_slug, reason, notes, expires_days } = body as {
      email?: string;
      scope?: string;
      flow_slug?: string | null;
      reason?: string;
      notes?: string;
      expires_days?: number;
    };

    if (!email || typeof email !== "string") {
      return apiBadRequest("email is required");
    }
    if (!scope || !["global", "per_flow", "per_flow_per_recipient"].includes(scope)) {
      return apiBadRequest("scope must be global/per_flow/per_flow_per_recipient");
    }
    if (scope !== "global" && !flow_slug) {
      return apiBadRequest("flow_slug is required when scope is not global");
    }
    if (!reason) {
      return apiBadRequest("reason is required");
    }

    const row = await queryOne<{ suppression_id: string }>(
      `INSERT INTO ops.email_suppressions (
         email_norm, scope, flow_slug, reason, source,
         notes, created_by, expires_at
       ) VALUES (
         $1, $2, $3, $4, 'manual',
         $5, $6,
         CASE WHEN $7::INT IS NOT NULL
              THEN NOW() + ($7 || ' days')::INTERVAL
              ELSE NULL END
       )
       ON CONFLICT (email_norm, scope, COALESCE(flow_slug, '')) DO UPDATE
         SET reason = EXCLUDED.reason,
             source = 'manual',
             notes = COALESCE(EXCLUDED.notes, ops.email_suppressions.notes),
             created_at = NOW()
       RETURNING suppression_id`,
      [
        email,
        scope,
        scope === "global" ? null : flow_slug ?? null,
        reason,
        notes ?? null,
        session.staff_id,
        expires_days ?? null,
      ]
    );

    return apiSuccess({ suppression_id: row?.suppression_id });
  } catch (err) {
    console.error("suppressions POST error:", err);
    return apiServerError("Failed to add suppression");
  }
}

export async function DELETE(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized();
  if (session.auth_role !== "admin") {
    return apiForbidden("Only admins can remove suppressions");
  }

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return apiBadRequest("id is required");

    const row = await queryOne<{ email_norm: string; scope: string }>(
      `DELETE FROM ops.email_suppressions
        WHERE suppression_id = $1
        RETURNING email_norm, scope`,
      [id]
    );
    if (!row) return apiNotFound("Suppression");

    // Audit log
    try {
      await queryOne(
        `INSERT INTO ops.entity_edits
           (entity_type, entity_id, field_name, old_value, new_value, changed_by, edit_source)
         VALUES ('email_suppression', NULL, 'deleted', $1, NULL, $2, 'admin_suppression_delete')`,
        [
          JSON.stringify({ email: row.email_norm, scope: row.scope }),
          session.staff_id,
        ]
      );
    } catch (err) {
      console.warn("Failed to write audit row for suppression delete:", err);
    }

    return apiSuccess({ removed: row });
  } catch (err) {
    console.error("suppressions DELETE error:", err);
    return apiServerError("Failed to remove suppression");
  }
}
