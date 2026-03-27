import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireValidUUID } from "@/lib/api-validation";
import {
  apiSuccess,
  apiBadRequest,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiServerError,
} from "@/lib/api-response";
import { FIELD_TYPES } from "@/lib/form-field-types";

interface FieldDefRow {
  id: string;
  field_key: string;
  label: string;
  print_label: string | null;
  field_type: string;
  options: string[] | null;
  validation: unknown;
  description: string | null;
  category: string;
  sort_order: number;
}

/**
 * GET /api/admin/forms/fields/[id]
 * Get a single field definition by ID.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized();

  const { id } = await params;
  requireValidUUID(id, "field");

  try {
    const field = await queryOne<FieldDefRow>(
      `SELECT id, field_key, label, print_label, field_type, options, validation, description, category, sort_order
       FROM ops.form_field_definitions WHERE id = $1`,
      [id]
    );
    if (!field) return apiNotFound("Field definition", id);
    return apiSuccess(field);
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") {
      return apiBadRequest(error.message);
    }
    console.error("Failed to fetch field definition:", error);
    return apiServerError("Failed to fetch field definition");
  }
}

/**
 * PUT /api/admin/forms/fields/[id]
 * Update a field definition. Admin only.
 * Body: { label?, print_label?, options?, description?, field_type? }
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized();
  if (session.auth_role !== "admin") return apiForbidden("Only admins can edit field definitions");

  const { id } = await params;
  requireValidUUID(id, "field");

  try {
    const body = await request.json();
    const { label, print_label, options, description, field_type } = body;

    // Validate field_type if provided
    if (field_type && !FIELD_TYPES.includes(field_type as (typeof FIELD_TYPES)[number])) {
      return apiBadRequest(`Invalid field_type: ${field_type}`);
    }

    // Validate options is array of strings if provided
    if (options !== undefined && options !== null) {
      if (!Array.isArray(options) || !options.every((o: unknown) => typeof o === "string")) {
        return apiBadRequest("options must be an array of strings");
      }
    }

    // Verify field exists
    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM ops.form_field_definitions WHERE id = $1`,
      [id]
    );
    if (!existing) return apiNotFound("Field definition", id);

    const updated = await queryOne<FieldDefRow>(
      `UPDATE ops.form_field_definitions SET
         label = COALESCE($2, label),
         print_label = CASE WHEN $3::boolean THEN $4 ELSE print_label END,
         field_type = COALESCE($5, field_type),
         options = CASE WHEN $6::boolean THEN $7::jsonb ELSE options END,
         description = CASE WHEN $8::boolean THEN $9 ELSE description END
       WHERE id = $1
       RETURNING id, field_key, label, print_label, field_type, options, validation, description, category, sort_order`,
      [
        id,
        label ?? null,
        print_label !== undefined,
        print_label ?? null,
        field_type ?? null,
        options !== undefined,
        options ? JSON.stringify(options) : null,
        description !== undefined,
        description ?? null,
      ]
    );

    return apiSuccess(updated);
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") {
      return apiBadRequest(error.message);
    }
    console.error("Failed to update field definition:", error);
    return apiServerError("Failed to update field definition");
  }
}
