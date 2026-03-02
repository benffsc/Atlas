import { queryOne, queryRows } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";

/**
 * Ingest Health Check Endpoint
 *
 * Returns detailed status of the ingest infrastructure including:
 * - Schema validation (columns, indexes, functions)
 * - Processing order validation
 * - Recent batch status
 * - Last successful ingest timestamp
 *
 * This endpoint validates that MIG_2400-2404 fixes are in place.
 */

interface ColumnCheck {
  table_name: string;
  column_name: string;
  exists: boolean;
}

interface IndexCheck {
  index_name: string;
  exists: boolean;
}

interface FunctionCheck {
  function_name: string;
  exists: boolean;
}

interface RecentBatch {
  batch_id: string;
  files_uploaded: number;
  batch_status: string;
  batch_started: string;
}

export async function GET() {
  const startTime = Date.now();

  try {
    // 1. Check required columns exist (MIG_2400, 2401, 2404)
    const columnChecks = await queryRows<ColumnCheck>(`
      SELECT
        t.table_name,
        t.col AS column_name,
        EXISTS (
          SELECT 1 FROM information_schema.columns c
          WHERE c.table_schema = t.schema_name
            AND c.table_name = t.table_name
            AND c.column_name = t.col
        ) AS exists
      FROM (
        VALUES
          ('ops', 'file_uploads', 'batch_id'),
          ('ops', 'file_uploads', 'batch_ready'),
          ('ops', 'file_uploads', 'processing_order'),
          ('ops', 'file_uploads', 'file_hash'),
          ('ops', 'appointments', 'client_name'),
          ('ops', 'appointments', 'owner_account_id'),
          ('ops', 'cat_test_results', 'evidence_source'),
          ('ops', 'cat_test_results', 'extraction_confidence'),
          ('ops', 'cat_test_results', 'raw_text'),
          ('ops', 'cat_test_results', 'updated_at')
      ) AS t(schema_name, table_name, col)
    `);

    // 2. Check required indexes exist (MIG_2404)
    const indexChecks = await queryRows<IndexCheck>(`
      SELECT
        t.idx AS index_name,
        EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname = 'ops' AND indexname = t.idx
        ) AS exists
      FROM (
        VALUES
          ('cat_test_results_unique_test'),
          ('idx_ops_file_uploads_batch')
      ) AS t(idx)
    `);

    // 3. Check required functions exist (MIG_2400)
    const functionChecks = await queryRows<FunctionCheck>(`
      SELECT
        t.func AS function_name,
        EXISTS (
          SELECT 1 FROM pg_proc p
          JOIN pg_namespace n ON p.pronamespace = n.oid
          WHERE n.nspname = 'ops' AND p.proname = t.func
        ) AS exists
      FROM (
        VALUES
          ('get_batch_files_in_order')
      ) AS t(func)
    `);

    // 4. Check views exist (MIG_2400)
    const viewExists = await queryOne<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.views
        WHERE table_schema = 'ops' AND table_name = 'v_clinichq_batch_status'
      ) AS exists
    `);

    // 5. Validate processing order (MIG_2402)
    const processingOrder = await queryOne<{ order_correct: boolean; actual_order: string }>(`
      SELECT
        (
          SELECT source_table FROM (
            SELECT 'appointment_info' AS source_table,
                   CASE 'appointment_info'
                     WHEN 'appointment_info' THEN 1
                     WHEN 'cat_info' THEN 2
                     WHEN 'owner_info' THEN 3
                     ELSE 99
                   END AS processing_order
          ) t ORDER BY processing_order LIMIT 1
        ) = 'appointment_info' AS order_correct,
        'appointment_info → cat_info → owner_info' AS actual_order
    `);

    // 6. Get recent batches
    const recentBatches = await queryRows<RecentBatch>(`
      SELECT
        batch_id::text,
        files_uploaded,
        batch_status,
        batch_started::text
      FROM ops.v_clinichq_batch_status
      ORDER BY batch_started DESC NULLS LAST
      LIMIT 5
    `);

    // 7. Get last successful batch
    const lastSuccess = await queryOne<{ batch_id: string; completed_at: string }>(`
      SELECT
        batch_id::text,
        last_upload::text AS completed_at
      FROM ops.v_clinichq_batch_status
      WHERE batch_status = 'completed'
      ORDER BY last_upload DESC
      LIMIT 1
    `);

    // Calculate overall health
    const missingColumns = columnChecks.filter(c => !c.exists);
    const missingIndexes = indexChecks.filter(i => !i.exists);
    const missingFunctions = functionChecks.filter(f => !f.exists);
    const viewOk = viewExists?.exists ?? false;
    const orderOk = processingOrder?.order_correct ?? false;

    const schemaValid =
      missingColumns.length === 0 &&
      missingIndexes.length === 0 &&
      missingFunctions.length === 0 &&
      viewOk &&
      orderOk;

    const status = schemaValid ? 'healthy' : 'unhealthy';

    const responseTimeMs = Date.now() - startTime;

    return apiSuccess({
      status,
      health: {
        schema_valid: schemaValid,
        columns_ok: missingColumns.length === 0,
        indexes_ok: missingIndexes.length === 0,
        functions_ok: missingFunctions.length === 0,
        view_ok: viewOk,
        processing_order_ok: orderOk,
      },
      missing_columns: missingColumns.map(c => `${c.table_name}.${c.column_name}`),
      missing_indexes: missingIndexes.map(i => i.index_name),
      missing_functions: missingFunctions.map(f => f.function_name),
      processing_order: processingOrder?.actual_order || 'unknown',
      last_successful_batch: lastSuccess ? {
        batch_id: lastSuccess.batch_id,
        completed_at: lastSuccess.completed_at,
      } : null,
      recent_batches: recentBatches,
      fixes_required: !schemaValid ? {
        columns: missingColumns.length > 0
          ? 'Run MIG_2400, MIG_2401, or MIG_2404 depending on table'
          : null,
        indexes: missingIndexes.length > 0
          ? 'Run MIG_2404__fix_cat_test_results_columns.sql'
          : null,
        functions: missingFunctions.length > 0
          ? 'Run MIG_2400__fix_clinichq_batch_upload.sql'
          : null,
        view: !viewOk
          ? 'Run MIG_2400__fix_clinichq_batch_upload.sql'
          : null,
        order: !orderOk
          ? 'Run MIG_2402__fix_batch_processing_order.sql'
          : null,
      } : null,
      response_time_ms: responseTimeMs,
    });
  } catch (error) {
    console.error("Ingest health check error:", error);
    return apiServerError("Failed to check ingest health");
  }
}
