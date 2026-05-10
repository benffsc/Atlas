import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { apiSuccess, apiError, apiBadRequest, apiNotFound, apiServerError } from "@/lib/api-response";
import { requireValidUUID } from "@/lib/api-validation";

/**
 * PATCH /api/admin/survey-templates/[id] — Update survey template (admin only)
 * DELETE /api/admin/survey-templates/[id] — Deactivate survey template (admin only)
 */

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession(request);
  if (!session) return apiError("Authentication required", 401);
  if (session.auth_role !== "admin") return apiError("Admin access required", 403);

  const { id } = await params;
  requireValidUUID(id, "survey_template");

  try {
    const body = await request.json();
    const { title, subtitle, thank_you_title, thank_you_message, questions, is_active } = body;

    const setClauses: string[] = [];
    const values: unknown[] = [id];
    let idx = 2;

    if (title !== undefined) { setClauses.push(`title = $${idx++}`); values.push(title); }
    if (subtitle !== undefined) { setClauses.push(`subtitle = $${idx++}`); values.push(subtitle); }
    if (thank_you_title !== undefined) { setClauses.push(`thank_you_title = $${idx++}`); values.push(thank_you_title); }
    if (thank_you_message !== undefined) { setClauses.push(`thank_you_message = $${idx++}`); values.push(thank_you_message); }
    if (questions !== undefined) { setClauses.push(`questions = $${idx++}::jsonb`); values.push(JSON.stringify(questions)); }
    if (is_active !== undefined) { setClauses.push(`is_active = $${idx++}`); values.push(is_active); }

    if (setClauses.length === 0) return apiBadRequest("No fields to update");

    setClauses.push("updated_at = NOW()");

    const updated = await queryOne(
      `UPDATE ops.survey_templates SET ${setClauses.join(", ")} WHERE template_id = $1 RETURNING *`,
      values
    );

    if (!updated) return apiNotFound("survey_template", id);

    return apiSuccess({ template: updated });
  } catch (error) {
    console.error("[SURVEY-TEMPLATES] Update error:", error);
    return apiServerError("Failed to update survey template");
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession(request);
  if (!session) return apiError("Authentication required", 401);
  if (session.auth_role !== "admin") return apiError("Admin access required", 403);

  const { id } = await params;
  requireValidUUID(id, "survey_template");

  try {
    const updated = await queryOne(
      `UPDATE ops.survey_templates SET is_active = false, updated_at = NOW() WHERE template_id = $1 RETURNING slug`,
      [id]
    );

    if (!updated) return apiNotFound("survey_template", id);

    return apiSuccess({ message: "Survey template deactivated" });
  } catch (error) {
    console.error("[SURVEY-TEMPLATES] Delete error:", error);
    return apiServerError("Failed to deactivate survey template");
  }
}
