import { NextRequest } from "next/server";
import { queryOne, queryRows } from "@/lib/db";
import {
  apiSuccess,
  apiBadRequest,
  apiNotFound,
  apiServerError,
  apiUnauthorized,
} from "@/lib/api-response";
import { requireValidUUID } from "@/lib/api-validation";
import { getSession } from "@/lib/auth";
import type {
  TemplateKey,
  SubmissionSource,
  FormSubmission,
  FieldType,
} from "@/lib/form-field-types";

const VALID_TEMPLATE_KEYS: TemplateKey[] = [
  "help_request",
  "tnr_call_sheet",
  "trapper_sheet",
];

const VALID_SOURCES: SubmissionSource[] = [
  "atlas_ui",
  "paper_entry",
  "web_intake",
  "import",
];

const VALID_ENTITY_TYPES = ["request", "cat", "place"];

/**
 * GET /api/forms/submissions?entity_id=...&entity_type=request
 *
 * Returns submissions for an entity.
 */
export async function GET(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized("Authentication required");

  const { searchParams } = new URL(request.url);
  const entityId = searchParams.get("entity_id");
  const entityType = searchParams.get("entity_type");

  if (!entityId || !entityType) {
    return apiBadRequest("entity_id and entity_type are required");
  }

  try {
    requireValidUUID(entityId, "entity");
  } catch {
    return apiBadRequest("Invalid entity_id format");
  }

  if (!VALID_ENTITY_TYPES.includes(entityType)) {
    return apiBadRequest(
      `Invalid entity_type. Valid types: ${VALID_ENTITY_TYPES.join(", ")}`
    );
  }

  try {
    const submissions = await queryRows<FormSubmission>(
      `SELECT id, template_key, schema_version, entity_type, entity_id,
              data, submitted_by, submitted_at, source, paper_scan_url, notes
       FROM ops.form_submissions
       WHERE entity_type = $1 AND entity_id = $2
       ORDER BY submitted_at DESC`,
      [entityType, entityId]
    );

    return apiSuccess(submissions);
  } catch (error) {
    console.error("Failed to fetch form submissions:", error);
    return apiServerError("Failed to fetch form submissions");
  }
}

/**
 * POST /api/forms/submissions
 *
 * Create a new form submission.
 *
 * Body: {
 *   template_key: "help_request" | "tnr_call_sheet" | "trapper_sheet",
 *   entity_type: "request" | "cat" | "place",
 *   entity_id: UUID,
 *   data: { [field_key]: value },
 *   source?: "atlas_ui" | "paper_entry" | "web_intake" | "import",
 *   paper_scan_url?: string,
 *   notes?: string
 * }
 */
export async function POST(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized("Authentication required");

  let body;
  try {
    body = await request.json();
  } catch {
    return apiBadRequest("Invalid JSON body");
  }

  const {
    template_key,
    entity_type,
    entity_id,
    data,
    source = "atlas_ui",
    paper_scan_url,
    notes,
  } = body;

  // Validation
  if (!template_key || !VALID_TEMPLATE_KEYS.includes(template_key)) {
    return apiBadRequest(
      `Invalid template_key. Valid keys: ${VALID_TEMPLATE_KEYS.join(", ")}`
    );
  }

  if (!entity_type || !VALID_ENTITY_TYPES.includes(entity_type)) {
    return apiBadRequest(
      `Invalid entity_type. Valid types: ${VALID_ENTITY_TYPES.join(", ")}`
    );
  }

  try {
    requireValidUUID(entity_id, "entity");
  } catch {
    return apiBadRequest("Invalid entity_id format");
  }

  if (!data || typeof data !== "object") {
    return apiBadRequest("data must be an object");
  }

  if (!VALID_SOURCES.includes(source)) {
    return apiBadRequest(
      `Invalid source. Valid sources: ${VALID_SOURCES.join(", ")}`
    );
  }

  try {
    // Get template + its valid field keys
    const template = await queryOne<{ schema_version: number }>(
      `SELECT schema_version FROM ops.form_templates WHERE template_key = $1`,
      [template_key]
    );

    const schemaVersion = template?.schema_version ?? 1;

    // Validate submitted data keys against template fields
    const dataKeys = Object.keys(data);
    if (dataKeys.length > 0) {
      const validFields = await queryRows<{
        field_key: string;
        field_type: FieldType;
        options: string[] | null;
      }>(
        `SELECT fd.field_key, fd.field_type, fd.options
         FROM ops.form_template_fields tf
         JOIN ops.form_field_definitions fd ON fd.id = tf.field_definition_id
         WHERE tf.template_id = (
           SELECT id FROM ops.form_templates WHERE template_key = $1
         )`,
        [template_key]
      );

      const fieldMap = new Map(validFields.map((f) => [f.field_key, f]));
      const errors: string[] = [];

      for (const key of dataKeys) {
        const fieldDef = fieldMap.get(key);
        if (!fieldDef) {
          errors.push(`Unknown field "${key}" for template "${template_key}"`);
          continue;
        }

        const val = data[key];
        if (val === null || val === undefined || val === "") continue;

        // Basic type checks
        switch (fieldDef.field_type) {
          case "boolean":
            if (typeof val !== "boolean" && val !== "true" && val !== "false") {
              errors.push(`Field "${key}" expects boolean, got ${typeof val}`);
            }
            break;
          case "number":
            if (typeof val !== "number" && isNaN(Number(val))) {
              errors.push(`Field "${key}" expects number, got "${val}"`);
            }
            break;
          case "select":
            if (
              fieldDef.options &&
              typeof val === "string" &&
              !fieldDef.options.includes(val)
            ) {
              errors.push(
                `Field "${key}" value "${val}" not in options: ${fieldDef.options.join(", ")}`
              );
            }
            break;
          case "multi_select":
            if (Array.isArray(val) && fieldDef.options) {
              const invalid = val.filter(
                (v: string) => !fieldDef.options!.includes(v)
              );
              if (invalid.length > 0) {
                errors.push(
                  `Field "${key}" has invalid options: ${invalid.join(", ")}`
                );
              }
            }
            break;
        }
      }

      if (errors.length > 0) {
        return apiBadRequest(errors.join("; "));
      }
    }

    const result = await queryOne<FormSubmission>(
      `INSERT INTO ops.form_submissions
        (template_key, schema_version, entity_type, entity_id, data, source, paper_scan_url, notes, submitted_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, template_key, schema_version, entity_type, entity_id,
                 data, submitted_by, submitted_at, source, paper_scan_url, notes`,
      [
        template_key,
        schemaVersion,
        entity_type,
        entity_id,
        JSON.stringify(data),
        source,
        paper_scan_url || null,
        notes || null,
        session.staff_id,
      ]
    );

    return apiSuccess(result, { status: 201 });
  } catch (error) {
    console.error("Failed to create form submission:", error);
    return apiServerError("Failed to create form submission");
  }
}

/**
 * PATCH /api/forms/submissions
 *
 * Update paper_scan_url on an existing submission.
 *
 * Body: { id: UUID, paper_scan_url: string }
 */
export async function PATCH(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized("Authentication required");

  let body;
  try {
    body = await request.json();
  } catch {
    return apiBadRequest("Invalid JSON body");
  }

  const { id, paper_scan_url } = body;

  if (!id) {
    return apiBadRequest("id is required");
  }

  try {
    requireValidUUID(id, "submission");
  } catch {
    return apiBadRequest("Invalid submission id format");
  }

  if (!paper_scan_url || typeof paper_scan_url !== "string") {
    return apiBadRequest("paper_scan_url is required and must be a string");
  }

  try {
    const result = await queryOne<FormSubmission>(
      `UPDATE ops.form_submissions
       SET paper_scan_url = $1
       WHERE id = $2
       RETURNING id, template_key, schema_version, entity_type, entity_id,
                 data, submitted_by, submitted_at, source, paper_scan_url, notes`,
      [paper_scan_url, id]
    );

    if (!result) {
      return apiNotFound("Submission not found");
    }

    return apiSuccess(result);
  } catch (error) {
    console.error("Failed to update submission:", error);
    return apiServerError("Failed to update submission");
  }
}
