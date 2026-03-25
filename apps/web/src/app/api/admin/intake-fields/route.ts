import { NextRequest } from "next/server";
import { queryRows, queryOne } from "@/lib/db";
import { apiSuccess, apiBadRequest, apiConflict, apiServerError } from "@/lib/api-response";

interface CustomField {
  field_id: string;
  field_key: string;
  field_label: string;
  field_type: string;
  options: { value: string; label: string }[] | null;
  placeholder: string | null;
  help_text: string | null;
  is_required: boolean;
  is_beacon_critical: boolean;
  display_order: number;
  show_for_call_types: string[] | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// GET - List all custom fields
export async function GET() {
  try {
    const fields = await queryRows<CustomField>(`
      SELECT *
      FROM ops.intake_custom_fields
      WHERE is_active = TRUE
      ORDER BY display_order, created_at
    `);

    return apiSuccess({ fields });
  } catch (err) {
    console.error("Error fetching custom fields:", err);
    return apiServerError("Failed to fetch custom fields");
  }
}

// POST - Create a new custom field
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      field_key,
      field_label,
      field_type,
      options,
      placeholder,
      help_text,
      is_required,
      is_beacon_critical,
      display_order,
      show_for_call_types,
    } = body;

    // Validate required fields
    if (!field_key || !field_label || !field_type) {
      return apiBadRequest("field_key, field_label, and field_type are required");
    }

    // Validate field_key format (snake_case)
    if (!/^[a-z][a-z0-9_]*$/.test(field_key)) {
      return apiBadRequest("field_key must be lowercase snake_case (e.g., my_field_name)");
    }

    // Validate field type
    const validTypes = ["text", "textarea", "number", "select", "multiselect", "checkbox", "date", "phone", "email"];
    if (!validTypes.includes(field_type)) {
      return apiBadRequest(`Invalid field_type. Must be one of: ${validTypes.join(", ")}`);
    }

    // For select/multiselect, options are required
    if ((field_type === "select" || field_type === "multiselect") && (!options || options.length === 0)) {
      return apiBadRequest("Options are required for select/multiselect fields");
    }

    const result = await queryOne<CustomField>(`
      INSERT INTO ops.intake_custom_fields (
        field_key,
        field_label,
        field_type,
        options,
        placeholder,
        help_text,
        is_required,
        is_beacon_critical,
        display_order,
        show_for_call_types
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [
      field_key,
      field_label,
      field_type,
      options ? JSON.stringify(options) : null,
      placeholder || null,
      help_text || null,
      is_required || false,
      is_beacon_critical || false,
      display_order || 0,
      show_for_call_types || null,
    ]);

    return apiSuccess({ field: result });
  } catch (err: unknown) {
    console.error("Error creating custom field:", err);

    // Check for unique constraint violation
    if (err instanceof Error && err.message?.includes("unique")) {
      return apiConflict("A field with this key already exists");
    }

    return apiServerError("Failed to create custom field");
  }
}
