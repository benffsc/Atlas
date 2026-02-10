import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";

interface BatchStatus {
  batch_id: string;
  files_uploaded: number;
  has_cat_info: number;
  has_owner_info: number;
  has_appointment_info: number;
  is_complete: boolean;
  batch_started: string | null;
  last_upload: string | null;
  batch_status: string;
  files: Array<{
    upload_id: string;
    source_table: string;
    status: string;
    original_filename: string;
    uploaded_at: string;
  }>;
}

/**
 * GET /api/ingest/batch/[id]
 * Returns the status of a ClinicHQ batch upload
 *
 * MIG_971: Added for batch upload tracking
 */
export async function GET(
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
    const status = await queryOne<BatchStatus>(
      `SELECT * FROM trapper.v_clinichq_batch_status WHERE batch_id = $1`,
      [batchId]
    );

    if (!status) {
      return NextResponse.json(
        { error: "Batch not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      batch_id: batchId,
      status: status.batch_status,
      files_uploaded: status.files_uploaded,
      has_cat_info: status.has_cat_info > 0,
      has_owner_info: status.has_owner_info > 0,
      has_appointment_info: status.has_appointment_info > 0,
      is_complete: status.is_complete,
      batch_started: status.batch_started,
      last_upload: status.last_upload,
      files: status.files,
      // Helpful message for UI
      missing_files: [
        status.has_cat_info === 0 ? "cat_info" : null,
        status.has_owner_info === 0 ? "owner_info" : null,
        status.has_appointment_info === 0 ? "appointment_info" : null,
      ].filter(Boolean),
    });
  } catch (error) {
    console.error("Batch status error:", error);
    return NextResponse.json(
      { error: "Failed to get batch status" },
      { status: 500 }
    );
  }
}
