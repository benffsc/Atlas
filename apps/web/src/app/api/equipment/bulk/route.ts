import { queryOne } from "@/lib/db";
import { apiSuccess } from "@/lib/api-response";
import { withErrorHandling, ApiError } from "@/lib/api-validation";
import { NextRequest } from "next/server";

interface BulkItem {
  barcode?: string;
  equipment_name?: string;
  equipment_type_key: string;
  serial_number?: string;
  manufacturer?: string;
  model?: string;
  condition_status?: string;
  notes?: string;
}

/**
 * POST /api/equipment/bulk
 * Bulk import equipment items (e.g., 100+ Tomahawk transfer cages)
 */
export const POST = withErrorHandling(async (request: NextRequest) => {
  const body = await request.json();
  const { items, barcode_prefix, start_number } = body as {
    items?: BulkItem[];
    barcode_prefix?: string;
    start_number?: number;
  };

  // Mode 1: Explicit item list
  if (items && Array.isArray(items)) {
    if (items.length > 500) {
      throw new ApiError("Maximum 500 items per bulk import", 400);
    }

    let created = 0;
    let skipped = 0;
    const errors: Array<{ index: number; error: string }> = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      try {
        if (!item.equipment_type_key) {
          errors.push({ index: i, error: "equipment_type_key is required" });
          skipped++;
          continue;
        }

        // Check barcode uniqueness
        if (item.barcode) {
          const existing = await queryOne<{ equipment_id: string }>(
            `SELECT equipment_id FROM ops.equipment WHERE barcode = $1`,
            [item.barcode]
          );
          if (existing) {
            errors.push({ index: i, error: `Barcode "${item.barcode}" already exists` });
            skipped++;
            continue;
          }
        }

        await queryOne(
          `INSERT INTO ops.equipment (
             equipment_name, equipment_type, equipment_type_key, barcode,
             serial_number, manufacturer, model,
             custody_status, condition_status, notes,
             source_system, created_at, updated_at
           ) VALUES (
             $1, (SELECT display_name FROM ops.equipment_types WHERE type_key = $2), $2, $3,
             $4, $5, $6,
             'available', COALESCE($7, 'new'), $8,
             'atlas_ui', NOW(), NOW()
           )`,
          [
            item.equipment_name || null, item.equipment_type_key, item.barcode || null,
            item.serial_number || null, item.manufacturer || null, item.model || null,
            item.condition_status, item.notes || null,
          ]
        );
        created++;
      } catch (err) {
        errors.push({ index: i, error: err instanceof Error ? err.message : "Unknown error" });
        skipped++;
      }
    }

    return apiSuccess({ created, skipped, errors: errors.length > 0 ? errors : undefined });
  }

  // Mode 2: Generate numbered items with prefix
  if (barcode_prefix && start_number !== undefined) {
    const count = (body.count as number) || 1;
    const typeKey = body.equipment_type_key as string;

    if (!typeKey) throw new ApiError("equipment_type_key is required", 400);
    if (count > 500) throw new ApiError("Maximum 500 items per bulk import", 400);

    let created = 0;
    const errors: Array<{ number: number; error: string }> = [];

    for (let i = 0; i < count; i++) {
      const num = start_number + i;
      const barcode = `${barcode_prefix}-${String(num).padStart(4, "0")}`;
      const name = `${barcode_prefix} ${String(num).padStart(4, "0")}`;

      try {
        const existing = await queryOne<{ equipment_id: string }>(
          `SELECT equipment_id FROM ops.equipment WHERE barcode = $1`,
          [barcode]
        );
        if (existing) {
          errors.push({ number: num, error: `Barcode "${barcode}" already exists` });
          continue;
        }

        await queryOne(
          `INSERT INTO ops.equipment (
             equipment_name, equipment_type, equipment_type_key, barcode,
             manufacturer, custody_status, condition_status,
             source_system, created_at, updated_at
           ) VALUES (
             $1, (SELECT display_name FROM ops.equipment_types WHERE type_key = $2), $2, $3,
             $4, 'available', 'new',
             'atlas_ui', NOW(), NOW()
           )`,
          [name, typeKey, barcode, body.manufacturer || null]
        );
        created++;
      } catch (err) {
        errors.push({ number: num, error: err instanceof Error ? err.message : "Unknown error" });
      }
    }

    return apiSuccess({ created, total_requested: count, errors: errors.length > 0 ? errors : undefined });
  }

  throw new ApiError("Provide either 'items' array or 'barcode_prefix' + 'start_number' + 'count'", 400);
});
