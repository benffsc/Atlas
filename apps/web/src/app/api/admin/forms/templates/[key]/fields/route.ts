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

const VALID_TEMPLATE_KEYS = ["help_request", "tnr_call_sheet", "trapper_sheet"];
const VALID_WIDTHS = ["sm", "md", "lg", "xl"];

interface FieldUpdate {
  /** form_template_fields.id */
  id: string;
  sort_order?: number;
  is_required?: boolean;
  override_label?: string | null;
  section_name?: string;
  field_width?: string;
}

interface FieldRow {
  id: string;
  sort_order: number;
  is_required: boolean;
  section_name: string;
  field_width: string;
  override_label: string | null;
  field_key: string;
  label: string;
  field_type: string;
  category: string;
  options: string[] | null;
  description: string | null;
}

/**
 * GET /api/admin/forms/templates/[key]/fields
 * Returns all template fields with their definitions (admin view with IDs).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized();

  const { key } = await params;
  if (!VALID_TEMPLATE_KEYS.includes(key)) {
    return apiBadRequest(`Invalid template key: ${key}`);
  }

  try {
    const template = await queryOne<{ id: string; name: string }>(
      `SELECT id, name FROM ops.form_templates WHERE template_key = $1 AND is_active = TRUE`,
      [key]
    );
    if (!template) return apiNotFound("Form template", key);

    const fields = await queryRows<FieldRow>(
      `SELECT
         tf.id,
         tf.sort_order,
         tf.is_required,
         tf.section_name,
         tf.field_width,
         tf.override_label,
         fd.field_key,
         fd.label,
         fd.field_type,
         fd.category,
         fd.options,
         fd.description
       FROM ops.form_template_fields tf
       JOIN ops.form_field_definitions fd ON fd.id = tf.field_definition_id
       WHERE tf.template_id = $1
       ORDER BY tf.sort_order`,
      [template.id]
    );

    return apiSuccess({ template_key: key, template_name: template.name, fields });
  } catch (error) {
    console.error("Failed to fetch template fields:", error);
    return apiServerError("Failed to fetch template fields");
  }
}

/**
 * PUT /api/admin/forms/templates/[key]/fields
 * Bulk update template fields. Admin only.
 * Body: { fields: FieldUpdate[] }
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized();
  if (session.auth_role !== "admin") return apiForbidden("Only admins can edit template fields");

  const { key } = await params;
  if (!VALID_TEMPLATE_KEYS.includes(key)) {
    return apiBadRequest(`Invalid template key: ${key}`);
  }

  try {
    const body = await request.json();
    const { fields } = body as { fields: FieldUpdate[] };

    if (!Array.isArray(fields) || fields.length === 0) {
      return apiBadRequest("fields array is required");
    }

    // Verify template exists
    const template = await queryOne<{ id: string }>(
      `SELECT id FROM ops.form_templates WHERE template_key = $1 AND is_active = TRUE`,
      [key]
    );
    if (!template) return apiNotFound("Form template", key);

    // Validate field_width values
    for (const f of fields) {
      if (f.field_width && !VALID_WIDTHS.includes(f.field_width)) {
        return apiBadRequest(`Invalid field_width: ${f.field_width}. Valid: ${VALID_WIDTHS.join(", ")}`);
      }
    }

    // Update each field
    const results = [];
    for (const f of fields) {
      const updated = await queryOne<{ id: string }>(
        `UPDATE ops.form_template_fields SET
           sort_order = COALESCE($2, sort_order),
           is_required = COALESCE($3, is_required),
           override_label = CASE WHEN $4::boolean THEN $5 ELSE override_label END,
           section_name = COALESCE($6, section_name),
           field_width = COALESCE($7, field_width)
         WHERE id = $1 AND template_id = $8
         RETURNING id`,
        [
          f.id,
          f.sort_order ?? null,
          f.is_required ?? null,
          f.override_label !== undefined, // flag: was override_label provided?
          f.override_label ?? null,
          f.section_name ?? null,
          f.field_width ?? null,
          template.id,
        ]
      );
      if (updated) results.push(updated.id);
    }

    return apiSuccess({ updated: results.length, field_ids: results });
  } catch (error) {
    console.error("Failed to update template fields:", error);
    return apiServerError("Failed to update template fields");
  }
}
