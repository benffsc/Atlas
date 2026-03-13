import { NextRequest } from "next/server";
import { queryRows, queryOne } from "@/lib/db";
import { getSession } from "@/lib/auth";
import {
  apiSuccess,
  apiBadRequest,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiServerError,
} from "@/lib/api-response";

interface TriageFlagRow {
  id: string;
  key: string;
  label: string;
  color: string;
  text_color: string;
  icon: string | null;
  description: string | null;
  condition_type: string;
  condition_config: unknown;
  entity_type: string;
  sort_order: number;
  active: boolean;
}

/**
 * GET /api/admin/triage-flags?entity_type=request
 * List all triage flags, optionally filtered by entity_type.
 */
export async function GET(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized();

  try {
    const entityType = request.nextUrl.searchParams.get("entity_type");

    const flags = entityType
      ? await queryRows<TriageFlagRow>(
          `SELECT id, key, label, color, text_color, icon, description,
                  condition_type, condition_config, entity_type, sort_order, active
           FROM ops.triage_flags
           WHERE entity_type = $1
           ORDER BY sort_order`,
          [entityType]
        )
      : await queryRows<TriageFlagRow>(
          `SELECT id, key, label, color, text_color, icon, description,
                  condition_type, condition_config, entity_type, sort_order, active
           FROM ops.triage_flags
           ORDER BY entity_type, sort_order`
        );

    return apiSuccess({ flags });
  } catch (error) {
    console.error("Failed to fetch triage flags:", error);
    return apiServerError("Failed to fetch triage flags");
  }
}

/**
 * PUT /api/admin/triage-flags
 * Update a triage flag. Admin only.
 * Body: { id, label?, color?, text_color?, icon?, description?, condition_config?, sort_order?, active? }
 */
export async function PUT(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized();
  if (session.auth_role !== "admin") return apiForbidden("Only admins can edit triage flags");

  try {
    const body = await request.json();
    const { id } = body;

    if (!id) return apiBadRequest("Missing 'id'");

    const existing = await queryOne<{ id: string }>(
      "SELECT id FROM ops.triage_flags WHERE id = $1",
      [id]
    );
    if (!existing) return apiNotFound("Triage flag", id);

    const updated = await queryOne<TriageFlagRow>(
      `UPDATE ops.triage_flags SET
        label = COALESCE($2, label),
        color = COALESCE($3, color),
        text_color = COALESCE($4, text_color),
        icon = COALESCE($5, icon),
        description = COALESCE($6, description),
        condition_config = COALESCE($7::jsonb, condition_config),
        sort_order = COALESCE($8, sort_order),
        active = COALESCE($9, active),
        updated_at = NOW()
      WHERE id = $1
      RETURNING id, key, label, color, text_color, icon, description,
                condition_type, condition_config, entity_type, sort_order, active`,
      [
        id,
        body.label ?? null,
        body.color ?? null,
        body.text_color ?? null,
        body.icon ?? null,
        body.description ?? null,
        body.condition_config ? JSON.stringify(body.condition_config) : null,
        body.sort_order ?? null,
        body.active ?? null,
      ]
    );

    return apiSuccess(updated);
  } catch (error) {
    console.error("Failed to update triage flag:", error);
    return apiServerError("Failed to update triage flag");
  }
}

/**
 * POST /api/admin/triage-flags
 * Create a new triage flag. Admin only.
 */
export async function POST(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized();
  if (session.auth_role !== "admin") return apiForbidden("Only admins can create triage flags");

  try {
    const body = await request.json();
    const { key, label, color, text_color, condition_type, condition_config, entity_type } = body;

    if (!key || !label || !color || !text_color || !condition_type) {
      return apiBadRequest("Required: key, label, color, text_color, condition_type");
    }

    const created = await queryOne<TriageFlagRow>(
      `INSERT INTO ops.triage_flags (key, label, color, text_color, icon, description,
                                      condition_type, condition_config, entity_type, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
       RETURNING id, key, label, color, text_color, icon, description,
                 condition_type, condition_config, entity_type, sort_order, active`,
      [
        key,
        label,
        color,
        text_color,
        body.icon ?? null,
        body.description ?? null,
        condition_type,
        JSON.stringify(condition_config || {}),
        entity_type || "request",
        body.sort_order ?? 0,
      ]
    );

    return apiSuccess(created);
  } catch (error) {
    if (error instanceof Error && error.message.includes("unique")) {
      return apiBadRequest("Triage flag key already exists");
    }
    console.error("Failed to create triage flag:", error);
    return apiServerError("Failed to create triage flag");
  }
}

/**
 * DELETE /api/admin/triage-flags?id=UUID
 * Delete a triage flag. Admin only.
 */
export async function DELETE(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized();
  if (session.auth_role !== "admin") return apiForbidden("Only admins can delete triage flags");

  try {
    const id = request.nextUrl.searchParams.get("id");
    if (!id) return apiBadRequest("Missing 'id' query parameter");

    const deleted = await queryOne<{ id: string }>(
      "DELETE FROM ops.triage_flags WHERE id = $1 RETURNING id",
      [id]
    );

    if (!deleted) return apiNotFound("Triage flag", id);
    return apiSuccess({ deleted: id });
  } catch (error) {
    console.error("Failed to delete triage flag:", error);
    return apiServerError("Failed to delete triage flag");
  }
}
