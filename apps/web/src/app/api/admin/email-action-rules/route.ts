/**
 * GET  /api/admin/email-action-rules — list enabled rules (any authenticated user)
 * POST /api/admin/email-action-rules — create rule (admin only)
 * PATCH /api/admin/email-action-rules — update rule (admin only)
 * DELETE /api/admin/email-action-rules — delete rule (admin only)
 *
 * Part of FFS-1181 extensible email infrastructure.
 * @see MIG_3078
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

const VALID_OPERATORS = ["eq", "neq", "in", "is_null", "is_not_null"] as const;

const VALID_CONDITION_FIELDS = [
  "service_area_status",
  "triage_category",
  "submission_status",
  "trapping_assistance_requested",
  "is_emergency",
  "ownership_status",
  "county",
] as const;

/** GET: list all enabled rules (any authenticated user needs this for the hook) */
export async function GET(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized();

  try {
    const showAll = request.nextUrl.searchParams.get("all") === "1";

    const rules = await queryRows(
      showAll
        ? `SELECT * FROM ops.email_action_rules ORDER BY priority DESC, display_name`
        : `SELECT * FROM ops.email_action_rules WHERE enabled = TRUE ORDER BY priority DESC, display_name`
    );
    return apiSuccess(rules);
  } catch (err) {
    console.error("email-action-rules list error:", err);
    return apiServerError("Failed to load email action rules");
  }
}

/** POST: create a new rule (admin only) */
export async function POST(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized();
  if (session.auth_role !== "admin") {
    return apiForbidden("Only admins can create email action rules");
  }

  try {
    const body = await request.json().catch(() => ({}));
    const {
      flow_slug,
      display_name,
      description,
      condition_field,
      condition_operator,
      condition_value,
      guard_email_not_sent,
      guard_not_suppressed,
      guard_has_email,
      suggestion_text,
      action_label,
      priority,
      enabled,
    } = body;

    if (!flow_slug || !display_name || !condition_field || !condition_operator || !suggestion_text) {
      return apiBadRequest("Missing required fields: flow_slug, display_name, condition_field, condition_operator, suggestion_text");
    }

    if (!VALID_OPERATORS.includes(condition_operator)) {
      return apiBadRequest(`Invalid operator. Must be one of: ${VALID_OPERATORS.join(", ")}`);
    }

    if (!VALID_CONDITION_FIELDS.includes(condition_field)) {
      return apiBadRequest(`Invalid condition_field. Must be one of: ${VALID_CONDITION_FIELDS.join(", ")}`);
    }

    // Verify flow exists
    const flow = await queryOne(`SELECT flow_slug FROM ops.email_flows WHERE flow_slug = $1`, [flow_slug]);
    if (!flow) {
      return apiBadRequest(`Email flow '${flow_slug}' does not exist`);
    }

    const row = await queryOne(
      `INSERT INTO ops.email_action_rules (
        flow_slug, display_name, description,
        condition_field, condition_operator, condition_value,
        guard_email_not_sent, guard_not_suppressed, guard_has_email,
        suggestion_text, action_label, priority, enabled
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING *`,
      [
        flow_slug,
        display_name,
        description ?? null,
        condition_field,
        condition_operator,
        condition_value ?? null,
        guard_email_not_sent ?? true,
        guard_not_suppressed ?? true,
        guard_has_email ?? true,
        suggestion_text,
        action_label ?? "Send Email",
        priority ?? 0,
        enabled ?? true,
      ]
    );

    return apiSuccess(row);
  } catch (err) {
    console.error("email-action-rules create error:", err);
    return apiServerError("Failed to create email action rule");
  }
}

/** PATCH: update an existing rule (admin only) */
export async function PATCH(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized();
  if (session.auth_role !== "admin") {
    return apiForbidden("Only admins can update email action rules");
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { rule_id, ...updates } = body;

    if (!rule_id) {
      return apiBadRequest("rule_id is required");
    }

    // Verify rule exists
    const existing = await queryOne(`SELECT * FROM ops.email_action_rules WHERE rule_id = $1`, [rule_id]);
    if (!existing) return apiNotFound("Rule not found");

    if (updates.condition_operator && !VALID_OPERATORS.includes(updates.condition_operator)) {
      return apiBadRequest(`Invalid operator. Must be one of: ${VALID_OPERATORS.join(", ")}`);
    }

    if (updates.condition_field && !VALID_CONDITION_FIELDS.includes(updates.condition_field)) {
      return apiBadRequest(`Invalid condition_field. Must be one of: ${VALID_CONDITION_FIELDS.join(", ")}`);
    }

    // Build dynamic SET clause from allowed fields
    const allowedFields = [
      "display_name", "description", "flow_slug",
      "condition_field", "condition_operator", "condition_value",
      "guard_email_not_sent", "guard_not_suppressed", "guard_has_email",
      "suggestion_text", "action_label", "priority", "enabled",
    ];

    const setClauses: string[] = ["updated_at = NOW()"];
    const values: unknown[] = [];
    let paramIdx = 1;

    for (const field of allowedFields) {
      if (field in updates) {
        setClauses.push(`${field} = $${paramIdx}`);
        values.push(updates[field]);
        paramIdx++;
      }
    }

    values.push(rule_id);

    const row = await queryOne(
      `UPDATE ops.email_action_rules SET ${setClauses.join(", ")} WHERE rule_id = $${paramIdx} RETURNING *`,
      values
    );

    return apiSuccess(row);
  } catch (err) {
    console.error("email-action-rules update error:", err);
    return apiServerError("Failed to update email action rule");
  }
}

/** DELETE: remove a rule (admin only) */
export async function DELETE(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized();
  if (session.auth_role !== "admin") {
    return apiForbidden("Only admins can delete email action rules");
  }

  try {
    const { searchParams } = request.nextUrl;
    const ruleId = searchParams.get("rule_id");

    if (!ruleId) {
      return apiBadRequest("rule_id query parameter is required");
    }

    const row = await queryOne(
      `DELETE FROM ops.email_action_rules WHERE rule_id = $1 RETURNING rule_id`,
      [ruleId]
    );

    if (!row) return apiNotFound("Rule not found");

    return apiSuccess({ deleted: true, rule_id: ruleId });
  } catch (err) {
    console.error("email-action-rules delete error:", err);
    return apiServerError("Failed to delete email action rule");
  }
}
