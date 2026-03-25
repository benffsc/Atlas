import { NextRequest } from "next/server";
import { query, queryOne, queryRows } from "@/lib/db";
import { apiSuccess, apiBadRequest, apiNotFound, apiServerError, apiConflict } from "@/lib/api-response";
import { isValidUUID } from "@/lib/validation";
import { processUpload } from "@/app/api/ingest/process/[id]/route";

interface BatchStatus {
  batch_id: string;
  files_uploaded: number;
  is_complete: boolean;
  batch_status: string;
}

interface BatchFile {
  upload_id: string;
  source_table: string;
  status: string;
  original_filename: string;
  processing_order: number;
}

/**
 * POST /api/ingest/batch/[id]/process
 * Processes all 3 ClinicHQ files in the correct order:
 *
 * CRITICAL: Processing order was fixed in MIG_2402. Order MUST be:
 * 1. appointment_info - Creates appointment records FIRST (anchor records)
 * 2. cat_info - Creates cats, links them to EXISTING appointments
 * 3. owner_info - Creates people/places, links them to EXISTING appointments
 *
 * Phase 3d (FFS-736): Calls processUpload() directly instead of HTTP self-fetch.
 * Eliminates the nested timeout cascade that caused 180s per-file timeouts.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: batchId } = await params;

  if (!batchId) return apiBadRequest("Batch ID is required");
  if (!isValidUUID(batchId)) return apiBadRequest("Invalid batch ID format");

  try {
    // Check batch status
    const status = await queryOne<BatchStatus>(
      `SELECT batch_id, files_uploaded, is_complete, batch_status
       FROM ops.v_clinichq_batch_status
       WHERE batch_id = $1`,
      [batchId]
    );

    if (!status) return apiNotFound("Batch not found");

    if (!status.is_complete) {
      return apiBadRequest(
        `Batch incomplete (${status.files_uploaded} files). Upload all 3 files (cat_info, owner_info, appointment_info) before processing.`
      );
    }

    if (status.batch_status === "processing") return apiConflict("Batch is already being processed");
    if (status.batch_status === "completed") return apiConflict("Batch has already been processed");

    // Get files in correct processing order
    const files = await queryRows<BatchFile>(
      `SELECT * FROM ops.get_batch_files_in_order($1)`,
      [batchId]
    );

    if (files.length !== 3) {
      return apiBadRequest(`Expected 3 files, found ${files.length}`);
    }

    // VALIDATION: appointment_info MUST be first (MIG_2402 fix)
    const expectedOrder = ['appointment_info', 'cat_info', 'owner_info'];
    const actualOrder = files.map(f => f.source_table);

    if (actualOrder[0] !== 'appointment_info') {
      console.error('[BATCH] CRITICAL: Processing order incorrect!', { expectedOrder, actualOrder });
      return apiServerError(
        `Processing order error: appointment_info must be processed first (got: ${actualOrder.join(' → ')}). ` +
        `Run MIG_2402__fix_batch_processing_order.sql to fix ops.get_batch_files_in_order().`
      );
    }

    console.error(`[BATCH] Processing order validated: ${actualOrder.join(' → ')}`);

    // If cat_info/owner_info need processing, appointment_info must not be failed
    const appointmentFile = files.find(f => f.source_table === 'appointment_info');
    const needsAppointments = files.filter(
      f => f.source_table !== 'appointment_info' && f.status === 'pending'
    );

    if (needsAppointments.length > 0 && appointmentFile?.status === 'failed') {
      return apiBadRequest(
        'Cannot process cat_info/owner_info: appointment_info failed. Fix appointment_info first.'
      );
    }

    // Process each file in order via direct function call (Phase 3d)
    const results: Array<{
      source_table: string;
      upload_id: string;
      success: boolean;
      error?: string;
      details?: Record<string, unknown>;
    }> = [];

    for (const file of files) {
      if (file.status !== "pending") {
        results.push({
          source_table: file.source_table,
          upload_id: file.upload_id,
          success: true,
          details: { skipped: true, reason: `Already ${file.status}` },
        });
        continue;
      }

      console.error(`[BATCH] Processing ${file.source_table} (${file.upload_id})...`);

      try {
        const processResult = await processUpload(file.upload_id);
        results.push({
          source_table: file.source_table,
          upload_id: file.upload_id,
          success: true,
          details: processResult as unknown as Record<string, unknown>,
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        results.push({
          source_table: file.source_table,
          upload_id: file.upload_id,
          success: false,
          error: errorMsg,
        });
        // Don't stop on failure — continue with other files
      }
    }

    // Determine overall batch status
    const allSuccess = results.every((r) => r.success);
    const anySuccess = results.some((r) => r.success);

    // Mark batch as ready (all files processed)
    await query(
      `UPDATE ops.file_uploads SET batch_ready = TRUE WHERE batch_id = $1`,
      [batchId]
    );

    return apiSuccess({
      batch_id: batchId,
      success: allSuccess,
      partial_success: anySuccess && !allSuccess,
      files_processed: results.filter((r) => r.success).length,
      files_failed: results.filter((r) => !r.success).length,
      results,
      message: allSuccess
        ? "All 3 files processed successfully"
        : anySuccess
        ? "Some files processed with errors"
        : "All files failed to process",
    });
  } catch (error) {
    console.error("Batch process error:", error);
    return apiServerError("Failed to process batch");
  }
}

export const maxDuration = 300; // 5 minutes max (Vercel Pro limit)
