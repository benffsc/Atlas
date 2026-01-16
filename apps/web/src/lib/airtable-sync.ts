/**
 * Airtable field sync utilities
 *
 * Used by:
 * - /api/admin/intake-fields (auto-sync on field creation)
 * - /api/admin/intake-fields/sync-airtable (manual bulk sync)
 */

const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_ATLAS_SYNC_BASE_ID || "appwFuRddph1krmcd";
const AIRTABLE_TABLE_ID = process.env.AIRTABLE_PUBLIC_INTAKE_TABLE_ID || "tblGQDVELZBhnxvUm";

interface AirtableField {
  id: string;
  name: string;
  type: string;
}

export interface CustomFieldForSync {
  field_id: string;
  field_key: string;
  field_label: string;
  field_type: string;
  options: { value: string; label: string }[] | null;
  airtable_field_name: string | null;
}

export interface SyncResult {
  success: boolean;
  fieldName: string;
  error?: string;
}

/**
 * Check if Airtable sync is configured
 */
export function isAirtableSyncConfigured(): boolean {
  return !!AIRTABLE_PAT;
}

/**
 * Map our field types to Airtable field types
 */
export function mapFieldTypeToAirtable(fieldType: string): { type: string; options?: Record<string, unknown> } {
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

/**
 * Get current fields from Airtable table
 */
export async function getAirtableFields(): Promise<AirtableField[]> {
  if (!AIRTABLE_PAT) {
    throw new Error("AIRTABLE_PAT not configured");
  }

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

/**
 * Add a field to Airtable
 */
export async function addAirtableField(fieldSpec: Record<string, unknown>): Promise<AirtableField> {
  if (!AIRTABLE_PAT) {
    throw new Error("AIRTABLE_PAT not configured");
  }

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

/**
 * Sync a single custom field to Airtable
 * Returns result indicating success/failure
 *
 * Note: Does NOT update the database - caller must handle updating airtable_synced_at
 */
export async function syncFieldToAirtable(
  field: CustomFieldForSync,
  existingFieldNames?: Set<string>
): Promise<SyncResult> {
  const airtableName = field.airtable_field_name || field.field_label;

  // If we don't have existing fields list, fetch it
  if (!existingFieldNames) {
    try {
      const existingFields = await getAirtableFields();
      existingFieldNames = new Set(existingFields.map(f => f.name.toLowerCase()));
    } catch (err) {
      return {
        success: false,
        fieldName: airtableName,
        error: err instanceof Error ? err.message : "Failed to fetch existing fields",
      };
    }
  }

  // Skip if already exists
  if (existingFieldNames.has(airtableName.toLowerCase())) {
    return {
      success: true,
      fieldName: airtableName,
      error: "already_exists", // Not an error, just indicates it was skipped
    };
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

    return {
      success: true,
      fieldName: airtableName,
    };
  } catch (err) {
    return {
      success: false,
      fieldName: airtableName,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
