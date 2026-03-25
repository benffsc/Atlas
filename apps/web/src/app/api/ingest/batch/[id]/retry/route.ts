import { NextRequest } from "next/server";
import { query, queryOne, queryRows } from "@/lib/db";
import { apiSuccess, apiBadRequest, apiNotFound, apiServerError } from "@/lib/api-response";
import { isValidUUID } from "@/lib/validation";

/**
 * POST /api/ingest/batch/[id]/retry
 * FFS-740: Re-runs post-processing for failed files in a batch.
 * Resets failed files to 'staged' status and triggers re-processing.
 */

interface FailedFile {
  upload_id: string;
  source_table: string;
  processing_phase: string;
  retry_count: number;
  last_error: string | null;
  failed_at_step: string | null;
}

const MAX_RETRIES = 3;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: batchId } = await params;

  if (!batchId || !isValidUUID(batchId)) {
    return apiBadRequest("Valid batch ID is required");
  }

  try {
    // Find failed files in this batch
    const failedFiles = await queryRows<FailedFile>(`
      SELECT upload_id, source_table, processing_phase, retry_count,
             last_error, failed_at_step
      FROM ops.file_uploads
      WHERE batch_id = $1
        AND (status = 'failed' OR processing_phase = 'failed')
    `, [batchId]);

    if (failedFiles.length === 0) {
      return apiNotFound("No failed files found in this batch");
    }

    // Check retry limits
    const retriable = failedFiles.filter(f => f.retry_count < MAX_RETRIES);
    const exhausted = failedFiles.filter(f => f.retry_count >= MAX_RETRIES);

    if (retriable.length === 0) {
      return apiBadRequest(
        `All ${failedFiles.length} failed file(s) have exceeded the retry limit (${MAX_RETRIES}). ` +
        `Manual investigation required.`
      );
    }

    // Reset retriable files to 'staged' for re-processing
    const resetResult = await query(`
      UPDATE ops.file_uploads
      SET
        status = 'pending',
        processing_phase = CASE
          WHEN processing_phase IN ('post_processing', 'failed') THEN 'staged'
          ELSE 'pending'
        END,
        retry_count = retry_count + 1,
        error_message = NULL,
        last_error = 'Manual retry initiated at ' || NOW()::text,
        failed_at_step = NULL
      WHERE upload_id = ANY($1::uuid[])
        AND retry_count < $2
      RETURNING upload_id, source_table, retry_count
    `, [retriable.map(f => f.upload_id), MAX_RETRIES]);

    // Process each reset file by calling the process endpoint directly
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

    const results: Array<{
      upload_id: string;
      source_table: string;
      success: boolean;
      retry_number: number;
      error?: string;
    }> = [];

    for (const file of resetResult.rows) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 180000);

        const response = await fetch(
          `${baseUrl}/api/ingest/process/${file.upload_id}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
          }
        );
        clearTimeout(timeoutId);

        if (response.ok) {
          results.push({
            upload_id: file.upload_id,
            source_table: file.source_table,
            success: true,
            retry_number: file.retry_count,
          });
        } else {
          const error = await response.text();
          results.push({
            upload_id: file.upload_id,
            source_table: file.source_table,
            success: false,
            retry_number: file.retry_count,
            error: error.slice(0, 200),
          });
        }
      } catch (err) {
        results.push({
          upload_id: file.upload_id,
          source_table: file.source_table,
          success: false,
          retry_number: file.retry_count,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return apiSuccess({
      batch_id: batchId,
      retried: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      exhausted: exhausted.length,
      results,
      message: exhausted.length > 0
        ? `${exhausted.length} file(s) exceeded retry limit and need manual investigation`
        : undefined,
    });
  } catch (error) {
    console.error("Batch retry error:", error);
    return apiServerError("Failed to retry batch");
  }
}

export const maxDuration = 300;
