import { NextRequest } from "next/server";
import { queryOne, queryRows, execute } from "@/lib/db";
import { getSession } from "@/lib/auth";
import {
  apiSuccess,
  apiError,
  apiNotFound,
  apiBadRequest,
  apiServerError,
} from "@/lib/api-response";
import { requireValidUUID } from "@/lib/api-validation";

import type { SyncConfig } from "@/lib/airtable-sync-engine";

interface SyncRunRow {
  run_id: string;
  trigger_type: string;
  started_at: string;
  completed_at: string | null;
  records_found: number;
  records_synced: number;
  records_errored: number;
  duration_ms: number | null;
  error_summary: string | null;
}

const VALID_PIPELINES = ["person_onboarding", "data_import", "custom"];

/** GET /api/admin/airtable-syncs/[id] — Get config with recent runs */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession(request);
    if (!session) return apiError("Authentication required", 401);

    const { id } = await params;
    requireValidUUID(id, "sync_config");

    const config = await queryOne<SyncConfig>(
      `SELECT * FROM ops.airtable_sync_configs WHERE config_id = $1`,
      [id]
    );

    if (!config) return apiNotFound("Sync config", id);

    const recentRuns = await queryRows<SyncRunRow>(
      `SELECT run_id, trigger_type, started_at, completed_at,
              records_found, records_synced, records_errored,
              duration_ms, error_summary
       FROM ops.airtable_sync_runs
       WHERE config_id = $1
       ORDER BY started_at DESC
       LIMIT 10`,
      [id]
    );

    return apiSuccess({ config, recent_runs: recentRuns });
  } catch (error) {
    console.error("[ADMIN] Error fetching sync config:", error);
    return apiServerError("Failed to fetch sync config");
  }
}

/** PATCH /api/admin/airtable-syncs/[id] — Update config */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession(request);
    if (!session) return apiError("Authentication required", 401);

    const { id } = await params;
    requireValidUUID(id, "sync_config");

    const body = await request.json();

    // Build dynamic SET clause
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    const allowedFields: Record<string, (v: unknown) => unknown> = {
      description: (v) => v,
      airtable_base_id: (v) => v,
      airtable_table_name: (v) => v,
      filter_formula: (v) => v,
      page_size: (v) => v,
      field_mappings: (v) => JSON.stringify(v),
      pipeline_config: (v) => JSON.stringify(v),
      writeback_config: (v) => JSON.stringify(v),
      schedule_cron: (v) => v,
      is_active: (v) => v,
      is_legacy: (v) => v,
      max_records_per_run: (v) => v,
      max_duration_seconds: (v) => v,
    };

    for (const [field, transform] of Object.entries(allowedFields)) {
      if (field in body) {
        updates.push(`${field} = $${paramIdx++}`);
        values.push(transform(body[field]));
      }
    }

    // Validate pipeline if being changed
    if ("pipeline" in body) {
      if (!VALID_PIPELINES.includes(body.pipeline)) {
        return apiBadRequest(`pipeline must be one of: ${VALID_PIPELINES.join(", ")}`);
      }
      updates.push(`pipeline = $${paramIdx++}`);
      values.push(body.pipeline);
    }

    if (updates.length === 0) {
      return apiBadRequest("No fields to update");
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);

    const result = await queryOne<{ config_id: string }>(
      `UPDATE ops.airtable_sync_configs
       SET ${updates.join(", ")}
       WHERE config_id = $${paramIdx}
       RETURNING config_id`,
      values
    );

    if (!result) return apiNotFound("Sync config", id);

    return apiSuccess({ config_id: result.config_id, updated: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return apiBadRequest("A sync config with that name already exists");
    }
    console.error("[ADMIN] Error updating sync config:", error);
    return apiServerError("Failed to update sync config");
  }
}

/** DELETE /api/admin/airtable-syncs/[id] — Soft delete (deactivate) */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession(request);
    if (!session) return apiError("Authentication required", 401);

    const { id } = await params;
    requireValidUUID(id, "sync_config");

    const result = await queryOne<{ config_id: string }>(
      `UPDATE ops.airtable_sync_configs
       SET is_active = FALSE, updated_at = NOW()
       WHERE config_id = $1
       RETURNING config_id`,
      [id]
    );

    if (!result) return apiNotFound("Sync config", id);

    return apiSuccess({ config_id: result.config_id, deactivated: true });
  } catch (error) {
    console.error("[ADMIN] Error deactivating sync config:", error);
    return apiServerError("Failed to deactivate sync config");
  }
}
