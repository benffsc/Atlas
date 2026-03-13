import { NextRequest } from "next/server";
import { queryOne, queryRows } from "@/lib/db";
import { getSession } from "@/lib/auth";
import {
  apiSuccess,
  apiError,
  apiBadRequest,
  apiServerError,
} from "@/lib/api-response";

interface SyncConfigRow {
  config_id: string;
  name: string;
  description: string | null;
  airtable_base_id: string;
  airtable_table_name: string;
  pipeline: string;
  schedule_cron: string | null;
  is_active: boolean;
  is_legacy: boolean;
  max_records_per_run: number;
  max_duration_seconds: number;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_count: number;
  created_at: string;
  updated_at: string;
  recent_runs: number;
  recent_errors: number;
}

const VALID_PIPELINES = ["person_onboarding", "data_import", "custom"];

/** GET /api/admin/airtable-syncs — List all sync configs with last run stats */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session) return apiError("Authentication required", 401);

    const configs = await queryRows<SyncConfigRow>(
      `SELECT
         c.*,
         COALESCE(rs.recent_runs, 0)::int AS recent_runs,
         COALESCE(rs.recent_errors, 0)::int AS recent_errors
       FROM ops.airtable_sync_configs c
       LEFT JOIN LATERAL (
         SELECT
           COUNT(*)::int AS recent_runs,
           SUM(records_errored)::int AS recent_errors
         FROM ops.airtable_sync_runs r
         WHERE r.config_id = c.config_id
           AND r.started_at > NOW() - INTERVAL '7 days'
       ) rs ON TRUE
       ORDER BY c.name`
    );

    return apiSuccess({ configs });
  } catch (error) {
    console.error("[ADMIN] Error listing sync configs:", error);
    return apiServerError("Failed to list sync configs");
  }
}

/** POST /api/admin/airtable-syncs — Create new sync config */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session) return apiError("Authentication required", 401);

    const body = await request.json();

    // Validate required fields
    const { name, airtable_base_id, airtable_table_name, pipeline, field_mappings, writeback_config } = body;

    if (!name || typeof name !== "string") {
      return apiBadRequest("name is required (string)");
    }
    if (!airtable_base_id || typeof airtable_base_id !== "string") {
      return apiBadRequest("airtable_base_id is required (string)");
    }
    if (!airtable_table_name || typeof airtable_table_name !== "string") {
      return apiBadRequest("airtable_table_name is required (string)");
    }
    if (!pipeline || !VALID_PIPELINES.includes(pipeline)) {
      return apiBadRequest(`pipeline must be one of: ${VALID_PIPELINES.join(", ")}`);
    }
    if (!field_mappings || typeof field_mappings !== "object") {
      return apiBadRequest("field_mappings is required (object)");
    }
    if (!writeback_config || typeof writeback_config !== "object") {
      return apiBadRequest("writeback_config is required (object)");
    }

    const result = await queryOne<{ config_id: string }>(
      `INSERT INTO ops.airtable_sync_configs (
         name, description,
         airtable_base_id, airtable_table_name,
         filter_formula, page_size,
         field_mappings, pipeline, pipeline_config,
         writeback_config,
         schedule_cron, is_active, is_legacy,
         max_records_per_run, max_duration_seconds
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
       )
       RETURNING config_id`,
      [
        name,
        body.description || null,
        airtable_base_id,
        airtable_table_name,
        body.filter_formula || "OR({Sync Status}='pending', {Sync Status}='error', {Sync Status}=BLANK())",
        body.page_size || 100,
        JSON.stringify(field_mappings),
        pipeline,
        JSON.stringify(body.pipeline_config || {}),
        JSON.stringify(writeback_config),
        body.schedule_cron || null,
        body.is_active !== false,
        body.is_legacy || false,
        body.max_records_per_run || 100,
        body.max_duration_seconds || 60,
      ]
    );

    if (!result) {
      return apiServerError("Failed to create sync config");
    }

    return apiSuccess({ config_id: result.config_id, created: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return apiBadRequest(`A sync config with that name already exists`);
    }
    console.error("[ADMIN] Error creating sync config:", error);
    return apiServerError("Failed to create sync config");
  }
}
