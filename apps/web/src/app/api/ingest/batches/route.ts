import { NextRequest } from "next/server";
import { queryRows, queryOne } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";
import { parsePagination } from "@/lib/api-validation";

/**
 * GET /api/ingest/batches
 * FFS-746: Returns batch-level upload history grouped by batch_id.
 * Includes per-file breakdown, processing phase, errors, and retry status.
 */

interface BatchRow {
  batch_id: string;
  source_system: string;
  batch_status: string;
  files_count: number;
  files_completed: number;
  files_failed: number;
  total_rows: number;
  total_inserted: number;
  total_skipped: number;
  first_uploaded: string;
  last_processed: string | null;
  data_date_min: string | null;
  data_date_max: string | null;
  has_retry_available: boolean;
  max_retry_count: number;
  files: string; // JSONB array as string
}

interface CountRow {
  total: string;
}

export async function GET(request: NextRequest) {
  const { limit, offset } = parsePagination(request.nextUrl.searchParams);
  const status = request.nextUrl.searchParams.get("status"); // filter: all, completed, failed, processing

  try {
    const conditions: string[] = ["fu.batch_id IS NOT NULL"];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (status && status !== "all") {
      if (status === "failed") {
        conditions.push(`EXISTS (SELECT 1 FROM ops.file_uploads f2 WHERE f2.batch_id = fu.batch_id AND (f2.status = 'failed' OR f2.processing_phase = 'failed'))`);
      } else if (status === "completed") {
        conditions.push(`NOT EXISTS (SELECT 1 FROM ops.file_uploads f2 WHERE f2.batch_id = fu.batch_id AND f2.status != 'completed')`);
      } else if (status === "processing") {
        conditions.push(`EXISTS (SELECT 1 FROM ops.file_uploads f2 WHERE f2.batch_id = fu.batch_id AND f2.status IN ('processing', 'pending'))`);
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Get total count
    const countResult = await queryOne<CountRow>(`
      SELECT COUNT(DISTINCT fu.batch_id)::text as total
      FROM ops.file_uploads fu
      ${whereClause}
    `, params);

    // Get batch-level aggregation with per-file JSONB array
    const batches = await queryRows<BatchRow>(`
      WITH batch_files AS (
        SELECT
          fu.batch_id,
          fu.source_system,
          fu.upload_id,
          fu.source_table,
          fu.original_filename,
          fu.status,
          COALESCE(fu.processing_phase, fu.status) as processing_phase,
          fu.rows_total,
          fu.rows_inserted,
          fu.rows_updated,
          fu.rows_skipped,
          fu.error_message,
          fu.created_at,
          fu.processed_at,
          fu.data_date_min,
          fu.data_date_max,
          fu.post_processing_results,
          COALESCE(fu.retry_count, 0) as retry_count,
          fu.last_error,
          fu.failed_at_step,
          fu.processing_order
        FROM ops.file_uploads fu
        ${whereClause}
      )
      SELECT
        bf.batch_id,
        bf.source_system,
        CASE
          WHEN COUNT(*) FILTER (WHERE bf.status = 'failed' OR bf.processing_phase = 'failed') > 0 THEN 'failed'
          WHEN COUNT(*) FILTER (WHERE bf.status IN ('processing', 'pending')) > 0 THEN 'processing'
          WHEN COUNT(*) FILTER (WHERE bf.status = 'completed') = COUNT(*) THEN 'completed'
          ELSE 'partial'
        END as batch_status,
        COUNT(*)::int as files_count,
        COUNT(*) FILTER (WHERE bf.status = 'completed')::int as files_completed,
        COUNT(*) FILTER (WHERE bf.status = 'failed' OR bf.processing_phase = 'failed')::int as files_failed,
        COALESCE(SUM(bf.rows_total), 0)::int as total_rows,
        COALESCE(SUM(bf.rows_inserted), 0)::int as total_inserted,
        COALESCE(SUM(bf.rows_skipped), 0)::int as total_skipped,
        MIN(bf.created_at)::text as first_uploaded,
        MAX(bf.processed_at)::text as last_processed,
        MIN(bf.data_date_min)::text as data_date_min,
        MAX(bf.data_date_max)::text as data_date_max,
        BOOL_OR(
          (bf.status = 'failed' OR bf.processing_phase = 'failed')
          AND COALESCE(bf.retry_count, 0) < 3
        ) as has_retry_available,
        MAX(COALESCE(bf.retry_count, 0))::int as max_retry_count,
        jsonb_agg(
          jsonb_build_object(
            'upload_id', bf.upload_id,
            'source_table', bf.source_table,
            'filename', bf.original_filename,
            'status', bf.status,
            'processing_phase', bf.processing_phase,
            'rows_total', bf.rows_total,
            'rows_inserted', bf.rows_inserted,
            'rows_skipped', bf.rows_skipped,
            'error_message', bf.error_message,
            'last_error', bf.last_error,
            'failed_at_step', bf.failed_at_step,
            'retry_count', bf.retry_count,
            'processed_at', bf.processed_at,
            'post_processing_results', bf.post_processing_results
          ) ORDER BY COALESCE(bf.processing_order, 0)
        )::text as files
      FROM batch_files bf
      GROUP BY bf.batch_id, bf.source_system
      ORDER BY MIN(bf.created_at) DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `, [...params, limit, offset]);

    // Parse the JSONB files array
    const parsed = batches.map(b => ({
      ...b,
      files: JSON.parse(b.files),
    }));

    return apiSuccess({
      batches: parsed,
      total: parseInt(countResult?.total || "0"),
      limit,
      offset,
    });
  } catch (error) {
    console.error("Error fetching batches:", error);
    return apiServerError("Failed to fetch batches");
  }
}
