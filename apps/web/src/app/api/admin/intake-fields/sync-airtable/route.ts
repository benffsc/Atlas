import { NextRequest, NextResponse } from "next/server";
import { queryRows, execute } from "@/lib/db";

const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_ATLAS_SYNC_BASE_ID || "appwFuRddph1krmcd";
const AIRTABLE_TABLE_ID = process.env.AIRTABLE_PUBLIC_INTAKE_TABLE_ID || "tblGQDVELZBhnxvUm";

interface CustomField {
  field_id: string;
  field_key: string;
  field_label: string;
  field_type: string;
  options: { value: string; label: string }[] | null;
  airtable_field_name: string | null;
  airtable_synced_at: string | null;
}

interface AirtableField {
  id: string;
  name: string;
  type: string;
}

// Map our field types to Airtable field types
function mapFieldTypeToAirtable(fieldType: string): { type: string; options?: Record<string, unknown> } {
  switch (fieldType) {
    case "text":
      return { type: "singleLineText" };
    case "textarea":
      return { type: "multilineText" };
    case "number":
      return { type: "number", options: { precision: 0 } };
    case "checkbox":
      return { type: "checkbox", options: { color: "yellowBright", icon: "check" } };
    case "date":
      return { type: "date", options: { dateFormat: { name: "local" } } };
    case "phone":
      return { type: "phoneNumber" };
    case "email":
      return { type: "email" };
    case "select":
    case "multiselect":
      return { type: "singleSelect" }; // Will add options separately
    default:
      return { type: "singleLineText" };
  }
}

// Get current fields from Airtable
async function getAirtableFields(): Promise<AirtableField[]> {
  const url = `https://api.airtable.com/v0/meta/bases/${AIRTABLE_BASE_ID}/tables`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${AIRTABLE_PAT}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Airtable metadata: ${response.status}`);
  }

  const data = await response.json();
  const table = data.tables.find((t: { id: string }) => t.id === AIRTABLE_TABLE_ID);

  if (!table) {
    throw new Error(`Table ${AIRTABLE_TABLE_ID} not found`);
  }

  return table.fields;
}

// Add a field to Airtable
async function addAirtableField(fieldSpec: Record<string, unknown>): Promise<AirtableField> {
  const url = `https://api.airtable.com/v0/meta/bases/${AIRTABLE_BASE_ID}/tables/${AIRTABLE_TABLE_ID}/fields`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${AIRTABLE_PAT}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(fieldSpec),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to create field: ${response.status} - ${text}`);
  }

  return await response.json();
}

// POST - Sync custom fields to Airtable
export async function POST(request: NextRequest) {
  if (!AIRTABLE_PAT) {
    return NextResponse.json(
      { error: "AIRTABLE_PAT not configured" },
      { status: 500 }
    );
  }

  try {
    // Get custom fields from database
    const customFields = await queryRows<CustomField>(`
      SELECT field_id, field_key, field_label, field_type, options,
             COALESCE(airtable_field_name, field_label) as airtable_field_name,
             airtable_synced_at
      FROM trapper.intake_custom_fields
      WHERE is_active = TRUE
    `);

    if (customFields.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No custom fields to sync",
        synced: 0,
        skipped: 0,
        failed: 0,
      });
    }

    // Get existing Airtable fields
    const existingFields = await getAirtableFields();
    const existingFieldNames = new Set(existingFields.map(f => f.name.toLowerCase()));

    const results = {
      synced: [] as string[],
      skipped: [] as string[],
      failed: [] as { name: string; error: string }[],
    };

    // Process each custom field
    for (const field of customFields) {
      const airtableName = field.airtable_field_name || field.field_label;

      // Skip if already exists
      if (existingFieldNames.has(airtableName.toLowerCase())) {
        results.skipped.push(airtableName);
        continue;
      }

      try {
        // Build Airtable field spec
        const { type, options: typeOptions } = mapFieldTypeToAirtable(field.field_type);
        const fieldSpec: Record<string, unknown> = {
          name: airtableName,
          type,
        };

        // Add type-specific options
        if (typeOptions) {
          fieldSpec.options = typeOptions;
        }

        // Add choices for select fields
        if ((field.field_type === "select" || field.field_type === "multiselect") && field.options) {
          fieldSpec.options = {
            choices: field.options.map(opt => ({ name: opt.value })),
          };
        }

        // Create field in Airtable
        await addAirtableField(fieldSpec);

        // Update synced timestamp in database
        await execute(`
          UPDATE trapper.intake_custom_fields
          SET airtable_synced_at = NOW(), airtable_field_name = $1
          WHERE field_id = $2
        `, [airtableName, field.field_id]);

        results.synced.push(airtableName);
      } catch (err) {
        results.failed.push({
          name: airtableName,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: `Synced ${results.synced.length} fields to Airtable`,
      synced: results.synced.length,
      skipped: results.skipped.length,
      failed: results.failed.length,
      details: results,
    });
  } catch (err) {
    console.error("Airtable sync error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500 }
    );
  }
}

// GET - Check sync status (what would be synced)
export async function GET() {
  if (!AIRTABLE_PAT) {
    return NextResponse.json(
      { error: "AIRTABLE_PAT not configured" },
      { status: 500 }
    );
  }

  try {
    // Get custom fields
    const customFields = await queryRows<CustomField>(`
      SELECT field_id, field_key, field_label, field_type,
             COALESCE(airtable_field_name, field_label) as airtable_field_name,
             airtable_synced_at
      FROM trapper.intake_custom_fields
      WHERE is_active = TRUE
    `);

    // Get existing Airtable fields
    const existingFields = await getAirtableFields();
    const existingFieldNames = new Set(existingFields.map(f => f.name.toLowerCase()));

    const status = customFields.map(field => {
      const airtableName = field.airtable_field_name || field.field_label;
      const existsInAirtable = existingFieldNames.has(airtableName.toLowerCase());

      return {
        field_id: field.field_id,
        field_key: field.field_key,
        field_label: field.field_label,
        airtable_field_name: airtableName,
        exists_in_airtable: existsInAirtable,
        last_synced: field.airtable_synced_at,
        needs_sync: !existsInAirtable,
      };
    });

    const needsSync = status.filter(s => s.needs_sync);

    return NextResponse.json({
      total_custom_fields: customFields.length,
      needs_sync: needsSync.length,
      already_synced: customFields.length - needsSync.length,
      airtable_total_fields: existingFields.length,
      fields: status,
    });
  } catch (err) {
    console.error("Error checking sync status:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to check status" },
      { status: 500 }
    );
  }
}
