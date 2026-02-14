import { NextRequest, NextResponse } from "next/server";
import { queryOne, execute } from "@/lib/db";

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
    const field = await queryOne<CustomField>(`
      SELECT * FROM ops.intake_custom_fields WHERE field_id = $1
    `, [id]);

    if (!field) {
      return NextResponse.json({ error: "Field not found" }, { status: 404 });
    }

    return NextResponse.json({ field });
  } catch (err) {
    console.error("Error fetching field:", err);
    return NextResponse.json(
      { error: "Failed to fetch field" },
      { status: 500 }
    );
  }
}

// PATCH - Update a field
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
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
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    values.push(id);
    const result = await queryOne<CustomField>(`
      UPDATE ops.intake_custom_fields
      SET ${updates.join(", ")}
      WHERE field_id = $${paramIndex}
      RETURNING *
    `, values);

    if (!result) {
      return NextResponse.json({ error: "Field not found" }, { status: 404 });
    }

    return NextResponse.json({ field: result });
  } catch (err) {
    console.error("Error updating field:", err);
    return NextResponse.json(
      { error: "Failed to update field" },
      { status: 500 }
    );
  }
}

// DELETE - Soft delete a field
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const result = await queryOne<{ field_id: string }>(`
      UPDATE ops.intake_custom_fields
      SET is_active = FALSE
      WHERE field_id = $1
      RETURNING field_id
    `, [id]);

    if (!result) {
      return NextResponse.json({ error: "Field not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, deleted: id });
  } catch (err) {
    console.error("Error deleting field:", err);
    return NextResponse.json(
      { error: "Failed to delete field" },
      { status: 500 }
    );
  }
}
