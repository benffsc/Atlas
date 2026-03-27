import { NextRequest } from "next/server";
import { queryOne, execute } from "@/lib/db";
import { requireValidUUID } from "@/lib/api-validation";
import { apiSuccess, apiBadRequest, apiNotFound, apiServerError } from "@/lib/api-response";

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
  airtable_field_name: string | null;
  airtable_synced_at: string | null;
  is_active: boolean;
}

// GET - Get a single field
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    requireValidUUID(id, "intake_field");
    const field = await queryOne<CustomField>(`
      SELECT * FROM ops.intake_custom_fields WHERE field_id = $1
    `, [id]);

    if (!field) {
      return apiNotFound("Field", id);
    }

    return apiSuccess({ field });
  } catch (err) {
    console.error("Error fetching field:", err);
    return apiServerError("Failed to fetch field");
  }
}

// PATCH - Update a field
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    requireValidUUID(id, "intake_field");
    const body = await request.json();
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    // Build dynamic update query
    const allowedFields = [
      "field_label",
      "field_type",
      "options",
      "placeholder",
      "help_text",
      "is_required",
      "is_beacon_critical",
      "display_order",
      "show_for_call_types",
      "airtable_field_name",
    ];

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updates.push(`${field} = $${paramIndex}`);
        // Handle JSON fields
        if (field === "options") {
          values.push(body[field] ? JSON.stringify(body[field]) : null);
        } else {
          values.push(body[field]);
        }
        paramIndex++;
      }
    }

    if (updates.length === 0) {
      return apiBadRequest("No valid fields to update");
    }

    values.push(id);
    const result = await queryOne<CustomField>(`
      UPDATE ops.intake_custom_fields
      SET ${updates.join(", ")}
      WHERE field_id = $${paramIndex}
      RETURNING *
    `, values);

    if (!result) {
      return apiNotFound("Field", id);
    }

    return apiSuccess({ field: result });
  } catch (err) {
    console.error("Error updating field:", err);
    return apiServerError("Failed to update field");
  }
}

// DELETE - Soft delete a field
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    requireValidUUID(id, "intake_field");
    const result = await queryOne<{ field_id: string }>(`
      UPDATE ops.intake_custom_fields
      SET is_active = FALSE
      WHERE field_id = $1
      RETURNING field_id
    `, [id]);

    if (!result) {
      return apiNotFound("Field", id);
    }

    return apiSuccess({ success: true, deleted: id });
  } catch (err) {
    console.error("Error deleting field:", err);
    return apiServerError("Failed to delete field");
  }
}
