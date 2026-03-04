import { NextRequest } from "next/server";
import { query, queryOne, queryRows } from "@/lib/db";
import { apiSuccess, apiBadRequest, apiNotFound, apiServerError, apiConflict } from "@/lib/api-response";
import { isValidUUID } from "@/lib/validation";

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
 * The order is enforced by ops.get_batch_files_in_order() and validated here.
 * Appointments must exist before cats and owners can link to them!
 *
 * MIG_971: Added for batch upload processing
 * MIG_2402: Fixed processing order (appointment_info FIRST)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: batchId } = await params;

  if (!batchId) {
    return apiBadRequest("Batch ID is required");
  }

  if (!isValidUUID(batchId)) {
    return apiBadRequest("Invalid batch ID format");
  }

  try {
    // Check batch status
    const status = await queryOne<BatchStatus>(
      `SELECT batch_id, files_uploaded, is_complete, batch_status
       FROM ops.v_clinichq_batch_status
       WHERE batch_id = $1`,
      [batchId]
    );

    if (!status) {
      return apiNotFound("Batch not found");
    }

    if (!status.is_complete) {
      return apiBadRequest(
        `Batch incomplete (${status.files_uploaded} files). Upload all 3 files (cat_info, owner_info, appointment_info) before processing.`
      );
    }

    if (status.batch_status === "processing") {
      return apiConflict("Batch is already being processed");
    }

    if (status.batch_status === "completed") {
      return apiConflict("Batch has already been processed");
    }

    // Get files in correct processing order
    const files = await queryRows<BatchFile>(
      `SELECT * FROM ops.get_batch_files_in_order($1)`,
      [batchId]
    );

    if (files.length !== 3) {
      return apiBadRequest(`Expected 3 files, found ${files.length}`);
    }

    // VALIDATION: Verify processing order is correct (MIG_2402 fix)
    // appointment_info MUST be first - cats and owners link to appointments
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

    // Additional validation: If cat_info or owner_info need processing,
    // appointment_info must be completed (not just pending)
    const appointmentFile = files.find(f => f.source_table === 'appointment_info');
    const needsAppointments = files.filter(
      f => f.source_table !== 'appointment_info' && f.status === 'pending'
    );

    if (needsAppointments.length > 0 && appointmentFile?.status === 'failed') {
      return apiBadRequest(
        'Cannot process cat_info/owner_info: appointment_info failed. Fix appointment_info first.'
      );
    }

    // Process each file in order
    const results: Array<{
      source_table: string;
      upload_id: string;
      success: boolean;
      error?: string;
      details?: Record<string, unknown>;
    }> = [];

    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

    for (const file of files) {
      if (file.status !== "pending") {
        // Skip already processed files
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
        // Call the existing process endpoint with extended timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 180000); // 3 min per file

        const processResponse = await fetch(
          `${baseUrl}/api/ingest/process/${file.upload_id}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            signal: controller.signal,
          }
        );
        clearTimeout(timeoutId);

        // Handle non-JSON responses (e.g., HTML error pages from timeout)
        const contentType = processResponse.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) {
          const textBody = await processResponse.text();
          console.error(`[BATCH] Non-JSON response for ${file.source_table}:`, textBody.substring(0, 200));
          results.push({
            source_table: file.source_table,
            upload_id: file.upload_id,
            success: false,
            error: `Server error (non-JSON response, status ${processResponse.status})`,
          });
          continue;
        }

        const processResult = await processResponse.json();

        if (!processResponse.ok) {
          // Extract error from standardized response format
          const errorMsg = typeof processResult.error === 'object'
            ? processResult.error?.message
            : processResult.error || "Processing failed";
          results.push({
            source_table: file.source_table,
            upload_id: file.upload_id,
            success: false,
            error: errorMsg,
          });
          // Don't stop on failure - continue with other files
        } else {
          // Extract data from apiSuccess wrapper
          const data = processResult.data || processResult;
          results.push({
            source_table: file.source_table,
            upload_id: file.upload_id,
            success: true,
            details: data,
          });
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const isTimeout = errorMsg.includes('abort') || errorMsg.includes('timeout');
        results.push({
          source_table: file.source_table,
          upload_id: file.upload_id,
          success: false,
          error: isTimeout
            ? `Processing timed out for ${file.source_table}. File may be too large.`
            : `Fetch error: ${errorMsg}`,
        });
      }
    }

    // Determine overall batch status
    const allSuccess = results.every((r) => r.success);
    const anySuccess = results.some((r) => r.success);

    // Mark batch as ready (all files processed) - optional, for tracking
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

export const maxDuration = 300; // 5 minutes max (Vercel Pro limit) - processes files sequentially
