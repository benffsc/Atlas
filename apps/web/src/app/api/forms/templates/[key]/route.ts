import { NextRequest } from "next/server";
import { queryOne, queryRows } from "@/lib/db";
import {
  apiSuccess,
  apiNotFound,
  apiBadRequest,
  apiServerError,
} from "@/lib/api-response";
import type {
  TemplateKey,
  ResolvedTemplate,
  ResolvedTemplateField,
  TemplateSection,
  FieldKey,
  FieldType,
  FieldCategory,
  FieldWidth,
  FieldValidation,
  PrintLayout,
  FormEntityType,
} from "@/lib/form-field-types";

const VALID_KEYS: TemplateKey[] = [
  "help_request",
  "tnr_call_sheet",
  "trapper_sheet",
];

interface TemplateRow {
  template_key: TemplateKey;
  name: string;
  description: string | null;
  entity_type: FormEntityType;
  schema_version: number;
  print_layout: PrintLayout | null;
}

interface TemplateFieldRow {
  sort_order: number;
  is_required: boolean;
  section_name: string;
  field_width: FieldWidth;
  override_label: string | null;
  field_key: FieldKey;
  label: string;
  print_label: string | null;
  field_type: FieldType;
  options: string[] | null;
  validation: FieldValidation | null;
  description: string | null;
  category: FieldCategory;
}

/**
 * GET /api/forms/templates/[key]
 *
 * Returns a fully resolved template with all fields grouped by section.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key } = await params;

  if (!VALID_KEYS.includes(key as TemplateKey)) {
    return apiBadRequest(
      `Invalid template key. Valid keys: ${VALID_KEYS.join(", ")}`
    );
  }

  try {
    const template = await queryOne<TemplateRow>(
      `SELECT template_key, name, description, entity_type, schema_version, print_layout
       FROM ops.form_templates
       WHERE template_key = $1 AND is_active = TRUE`,
      [key]
    );

    if (!template) {
      return apiNotFound("Form template", key);
    }

    const fields = await queryRows<TemplateFieldRow>(
      `SELECT
         tf.sort_order,
         tf.is_required,
         tf.section_name,
         tf.field_width,
         tf.override_label,
         fd.field_key,
         fd.label,
         fd.print_label,
         fd.field_type,
         fd.options,
         fd.validation,
         fd.description,
         fd.category
       FROM ops.form_template_fields tf
       JOIN ops.form_field_definitions fd ON fd.id = tf.field_definition_id
       WHERE tf.template_id = (
         SELECT id FROM ops.form_templates WHERE template_key = $1
       )
       ORDER BY tf.sort_order`,
      [key]
    );

    // Group fields by section
    const sectionMap = new Map<string, ResolvedTemplateField[]>();
    const sectionOrder: string[] = [];

    for (const row of fields) {
      if (!sectionMap.has(row.section_name)) {
        sectionMap.set(row.section_name, []);
        sectionOrder.push(row.section_name);
      }
      sectionMap.get(row.section_name)!.push({
        sort_order: row.sort_order,
        is_required: row.is_required,
        section_name: row.section_name,
        field_width: row.field_width,
        override_label: row.override_label,
        field_key: row.field_key,
        label: row.override_label || row.label,
        print_label: row.print_label,
        field_type: row.field_type,
        options: row.options,
        validation: row.validation,
        description: row.description,
        category: row.category,
      });
    }

    const sections: TemplateSection[] = sectionOrder.map((name) => ({
      name,
      fields: sectionMap.get(name)!,
    }));

    const resolved: ResolvedTemplate = {
      template_key: template.template_key,
      name: template.name,
      description: template.description,
      entity_type: template.entity_type,
      schema_version: template.schema_version,
      print_layout: template.print_layout,
      sections,
    };

    return apiSuccess(resolved, {
      headers: { "Cache-Control": "public, s-maxage=300" },
    });
  } catch (error) {
    console.error("Failed to fetch form template:", error);
    return apiServerError("Failed to fetch form template");
  }
}
