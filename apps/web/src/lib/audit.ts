import { query } from "./db";

/**
 * Centralized audit logging for entity changes.
 * Uses the ops.entity_edits table via log_field_edit() function.
 */

export type EntityType = "person" | "cat" | "place" | "request" | "intake_submission";

export interface FieldChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface AuditContext {
  editedBy?: string;
  editedByName?: string;
  editSource?: "web_ui" | "api" | "migration" | "script" | "system" | "import";
  reason?: string;
}

/**
 * Log a single field change to the entity_edits table.
 */
export async function logFieldEdit(
  entityType: EntityType,
  entityId: string,
  fieldName: string,
  oldValue: unknown,
  newValue: unknown,
  context: AuditContext = {}
): Promise<string | null> {
  const {
    editedBy = "web_user",
    editedByName = null,
    editSource = "web_ui",
    reason = null,
  } = context;

  try {
    const result = await query<{ log_field_edit: string }>(
      `SELECT ops.log_field_edit($1, $2::uuid, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9) as log_field_edit`,
      [
        entityType,
        entityId,
        fieldName,
        JSON.stringify(oldValue),
        JSON.stringify(newValue),
        reason,
        editedBy,
        editedByName,
        editSource,
      ]
    );
    return result.rows[0]?.log_field_edit || null;
  } catch (err) {
    console.error("Audit log error:", err);
    // Don't throw - audit logging shouldn't break the main operation
    return null;
  }
}

/**
 * Log multiple field changes in a batch.
 * Logs each change individually but continues even if some fail.
 */
export async function logFieldEdits(
  entityType: EntityType,
  entityId: string,
  changes: FieldChange[],
  context: AuditContext = {}
): Promise<string[]> {
  const editIds: string[] = [];

  for (const change of changes) {
    const editId = await logFieldEdit(
      entityType,
      entityId,
      change.field,
      change.oldValue,
      change.newValue,
      context
    );
    if (editId) {
      editIds.push(editId);
    }
  }

  return editIds;
}

/**
 * Helper to compare values and create change records only for actual changes.
 * Returns an array of FieldChange objects for fields that actually changed.
 */
export function detectChanges<T extends Record<string, unknown>>(
  currentValues: T,
  newValues: Partial<T>,
  fieldsToCheck: (keyof T)[]
): FieldChange[] {
  const changes: FieldChange[] = [];

  for (const field of fieldsToCheck) {
    const newVal = newValues[field];
    if (newVal === undefined) continue; // Field not being updated

    const oldVal = currentValues[field];

    // Compare values (handle null vs undefined)
    const oldNorm = oldVal === undefined ? null : oldVal;
    const newNorm = newVal === undefined ? null : newVal;

    if (JSON.stringify(oldNorm) !== JSON.stringify(newNorm)) {
      changes.push({
        field: String(field),
        oldValue: oldNorm,
        newValue: newNorm,
      });
    }
  }

  return changes;
}
