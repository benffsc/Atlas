import { queryRows, execute } from "@/lib/db";
import {
  isAirtableSyncConfigured,
  getAirtableFields,
  syncFieldToAirtable,
  CustomFieldForSync,
} from "@/lib/airtable-sync";
import { apiSuccess, apiServerError } from "@/lib/api-response";

interface CustomField extends CustomFieldForSync {
  airtable_synced_at: string | null;
}

// POST - Sync custom fields to Airtable
export async function POST() {
  if (!isAirtableSyncConfigured()) {
    return apiServerError("AIRTABLE_PAT not configured");
  }

  try {
    // Get custom fields from database
    const customFields = await queryRows<CustomField>(`
      SELECT field_id, field_key, field_label, field_type, options,
             COALESCE(airtable_field_name, field_label) as airtable_field_name,
             airtable_synced_at
      FROM ops.intake_custom_fields
      WHERE is_active = TRUE
    `);

    if (customFields.length === 0) {
      return apiSuccess({
        message: "No custom fields to sync",
        synced: 0,
        skipped: 0,
        failed: 0,
      });
    }

    // Get existing Airtable fields once for all syncs
    const existingFields = await getAirtableFields();
    const existingFieldNames = new Set(existingFields.map(f => f.name.toLowerCase()));

    const results = {
      synced: [] as string[],
      skipped: [] as string[],
      failed: [] as { name: string; error: string }[],
    };

    // Process each custom field using shared sync function
    for (const field of customFields) {
      const syncResult = await syncFieldToAirtable(field, existingFieldNames);
      const airtableName = field.airtable_field_name || field.field_label;

      if (syncResult.success) {
        if (syncResult.error === "already_exists") {
          results.skipped.push(airtableName);
        } else {
          // Update synced timestamp in database
          await execute(`
            UPDATE ops.intake_custom_fields
            SET airtable_synced_at = NOW(), airtable_field_name = $1
            WHERE field_id = $2
          `, [airtableName, field.field_id]);

          results.synced.push(airtableName);
          // Add to existing names so we don't try to create again
          existingFieldNames.add(airtableName.toLowerCase());
        }
      } else {
        results.failed.push({
          name: airtableName,
          error: syncResult.error || "Unknown error",
        });
      }
    }

    return apiSuccess({
      message: `Synced ${results.synced.length} fields to Airtable`,
      synced: results.synced.length,
      skipped: results.skipped.length,
      failed: results.failed.length,
      details: results,
    });
  } catch (err) {
    console.error("Airtable sync error:", err);
    return apiServerError(err instanceof Error ? err.message : "Sync failed");
  }
}

// GET - Check sync status (what would be synced)
export async function GET() {
  if (!isAirtableSyncConfigured()) {
    return apiServerError("AIRTABLE_PAT not configured");
  }

  try {
    // Get custom fields
    const customFields = await queryRows<CustomField>(`
      SELECT field_id, field_key, field_label, field_type, options,
             COALESCE(airtable_field_name, field_label) as airtable_field_name,
             airtable_synced_at
      FROM ops.intake_custom_fields
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

    return apiSuccess({
      total_custom_fields: customFields.length,
      needs_sync: needsSync.length,
      already_synced: customFields.length - needsSync.length,
      airtable_total_fields: existingFields.length,
      fields: status,
    });
  } catch (err) {
    console.error("Error checking sync status:", err);
    return apiServerError(err instanceof Error ? err.message : "Failed to check status");
  }
}
