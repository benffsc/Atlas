import { queryRows } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";

interface TemplateListRow {
  template_key: string;
  name: string;
  description: string | null;
  entity_type: string;
  schema_version: number;
  is_active: boolean;
  field_count: number;
}

/**
 * GET /api/forms/templates
 *
 * Returns all active form templates with field counts.
 */
export async function GET() {
  try {
    const templates = await queryRows<TemplateListRow>(
      `SELECT
         t.template_key,
         t.name,
         t.description,
         t.entity_type,
         t.schema_version,
         t.is_active,
         (SELECT count(*) FROM ops.form_template_fields tf WHERE tf.template_id = t.id)::int as field_count
       FROM ops.form_templates t
       WHERE t.is_active = TRUE
       ORDER BY t.name`,
      []
    );

    return apiSuccess(templates, {
      headers: { "Cache-Control": "public, s-maxage=300" },
    });
  } catch (error) {
    console.error("Failed to fetch form templates:", error);
    return apiServerError("Failed to fetch form templates");
  }
}
