import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne, execute } from "@/lib/db";
import { syncFieldToAirtable, isAirtableSyncConfigured, CustomFieldForSync } from "@/lib/airtable-sync";

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

    return NextResponse.json({ fields });
  } catch (err) {
    console.error("Error fetching custom fields:", err);
    return NextResponse.json(
      { error: "Failed to fetch custom fields" },
      { status: 500 }
    );
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
      airtable_field_name,
    } = body;

    // Validate required fields
    if (!field_key || !field_label || !field_type) {
      return NextResponse.json(
        { error: "field_key, field_label, and field_type are required" },
        { status: 400 }
      );
    }

    // Validate field_key format (snake_case)
    if (!/^[a-z][a-z0-9_]*$/.test(field_key)) {
      return NextResponse.json(
        { error: "field_key must be lowercase snake_case (e.g., my_field_name)" },
        { status: 400 }
      );
    }

    // Validate field type
    const validTypes = ["text", "textarea", "number", "select", "multiselect", "checkbox", "date", "phone", "email"];
    if (!validTypes.includes(field_type)) {
      return NextResponse.json(
        { error: `Invalid field_type. Must be one of: ${validTypes.join(", ")}` },
        { status: 400 }
      );
    }

    // For select/multiselect, options are required
    if ((field_type === "select" || field_type === "multiselect") && (!options || options.length === 0)) {
      return NextResponse.json(
        { error: "Options are required for select/multiselect fields" },
        { status: 400 }
      );
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
        show_for_call_types,
        airtable_field_name
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
      airtable_field_name || field_label,
    ]);

    // Auto-sync to Airtable if configured
    let airtableSync: { success: boolean; error?: string } | null = null;
    if (result && isAirtableSyncConfigured()) {
      const fieldForSync: CustomFieldForSync = {
        field_id: result.field_id,
        field_key: result.field_key,
        field_label: result.field_label,
        field_type: result.field_type,
        options: result.options,
        airtable_field_name: result.airtable_field_name,
      };

      const syncResult = await syncFieldToAirtable(fieldForSync);
      airtableSync = {
        success: syncResult.success,
        error: syncResult.error === "already_exists" ? undefined : syncResult.error,
      };

      // Update synced timestamp if successful
      if (syncResult.success && syncResult.error !== "already_exists") {
        await execute(`
          UPDATE ops.intake_custom_fields
          SET airtable_synced_at = NOW()
          WHERE field_id = $1
        `, [result.field_id]);
      }
    }

    return NextResponse.json({
      field: result,
      airtable_sync: airtableSync,
    });
  } catch (err: unknown) {
    console.error("Error creating custom field:", err);

    // Check for unique constraint violation
    if (err instanceof Error && err.message?.includes("unique")) {
      return NextResponse.json(
        { error: "A field with this key already exists" },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: "Failed to create custom field" },
      { status: 500 }
    );
  }
}
