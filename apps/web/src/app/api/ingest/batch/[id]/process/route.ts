import { NextRequest, NextResponse } from "next/server";
import { query, queryOne, queryRows } from "@/lib/db";

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
 * 1. cat_info - Creates cats, updates sex
 * 2. owner_info - Creates people/places, links appointments
 * 3. appointment_info - Creates procedures, links cats to places/requests
 *
 * Entity linking runs after each file (idempotent), but the key benefit is
 * processing in the correct order so dependencies are satisfied.
 *
 * MIG_971: Added for batch upload processing
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: batchId } = await params;

  if (!batchId) {
    return NextResponse.json(
      { error: "Batch ID is required" },
      { status: 400 }
    );
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
      return NextResponse.json(
        { error: "Batch not found" },
        { status: 404 }
      );
    }

    if (!status.is_complete) {
      return NextResponse.json(
        {
          error: "Batch incomplete",
          files_uploaded: status.files_uploaded,
          message: "Upload all 3 files (cat_info, owner_info, appointment_info) before processing"
        },
        { status: 400 }
      );
    }

    if (status.batch_status === "processing") {
      return NextResponse.json(
        { error: "Batch is already being processed" },
        { status: 409 }
      );
    }

    if (status.batch_status === "completed") {
      return NextResponse.json(
        { error: "Batch has already been processed" },
        { status: 409 }
      );
    }

    // Get files in correct processing order
    const files = await queryRows<BatchFile>(
      `SELECT * FROM trapper.get_batch_files_in_order($1)`,
      [batchId]
    );

    if (files.length !== 3) {
      return NextResponse.json(
        { error: `Expected 3 files, found ${files.length}` },
        { status: 400 }
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

      console.log(`[BATCH] Processing ${file.source_table} (${file.upload_id})...`);

      try {
        // Call the existing process endpoint
        const processResponse = await fetch(
          `${baseUrl}/api/ingest/process/${file.upload_id}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
          }
        );

        const processResult = await processResponse.json();

        if (!processResponse.ok) {
          results.push({
            source_table: file.source_table,
            upload_id: file.upload_id,
            success: false,
            error: processResult.error || "Processing failed",
          });
          // Don't stop on failure - continue with other files
        } else {
          results.push({
            source_table: file.source_table,
            upload_id: file.upload_id,
            success: true,
            details: processResult,
          });
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        results.push({
          source_table: file.source_table,
          upload_id: file.upload_id,
          success: false,
          error: `Fetch error: ${errorMsg}`,
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

    return NextResponse.json({
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
    return NextResponse.json(
      { error: "Failed to process batch" },
      { status: 500 }
    );
  }
}

export const maxDuration = 300; // 5 minutes for processing all 3 files
