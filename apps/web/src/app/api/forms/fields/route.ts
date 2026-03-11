import { NextRequest } from "next/server";
import { queryRows } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";
import type {
  FormFieldDefinition,
  FieldCategory,
} from "@/lib/form-field-types";

const VALID_CATEGORIES: FieldCategory[] = [
  "contact",
  "location",
  "cat_info",
  "logistics",
  "trapping",
  "kitten",
  "medical",
  "staff",
  "referral",
];

/**
 * GET /api/forms/fields?category=contact
 *
 * Returns all field definitions, optionally filtered by category.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category");

  if (category && !VALID_CATEGORIES.includes(category as FieldCategory)) {
    return apiSuccess([]); // Empty for invalid category
  }

  try {
    const sql = category
      ? `SELECT id, field_key, label, print_label, field_type, options, validation,
                default_value, description, category, sort_order
         FROM ops.form_field_definitions
         WHERE category = $1
         ORDER BY sort_order`
      : `SELECT id, field_key, label, print_label, field_type, options, validation,
                default_value, description, category, sort_order
         FROM ops.form_field_definitions
         ORDER BY category, sort_order`;

    const params = category ? [category] : [];
    const fields = await queryRows<FormFieldDefinition>(sql, params);

    return apiSuccess(fields, {
      headers: { "Cache-Control": "public, s-maxage=300" },
    });
  } catch (error) {
    console.error("Failed to fetch form fields:", error);
    return apiServerError("Failed to fetch form fields");
  }
}
