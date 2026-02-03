import { NextRequest, NextResponse } from "next/server";
import { query, queryRows } from "@/lib/db";

/**
 * Auto-Process Uploaded Files Cron Job
 *
 * Automatically processes pending file uploads that haven't been processed yet.
 * This ensures staged records get converted to SoT entities (cats, people, places)
 * and that request_cat_links and cat_vitals are created.
 *
 * Run every 5-10 minutes to ensure uploads are processed promptly.
 */

export const maxDuration = 120; // Allow up to 2 minutes for batch processing

const CRON_SECRET = process.env.CRON_SECRET;

interface PendingUpload {
  upload_id: string;
  original_filename: string;
  source_system: string;
  source_table: string;
  uploaded_at: string;
}

export async function GET(request: NextRequest) {
  // Verify this is from Vercel Cron or has valid secret
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-vercel-cron");

  if (!cronHeader && CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();
  const BATCH_LIMIT = 10; // Process up to 10 uploads per run

  try {
    // Auto-reset stuck uploads (processing > 5 minutes with no progress)
    const stuckReset = await query(`
      UPDATE trapper.file_uploads
      SET status = 'failed',
          error_message = 'Processing timed out after 5 minutes (auto-reset by cron)'
      WHERE status = 'processing'
        AND processed_at < NOW() - INTERVAL '5 minutes'
    `);
    if (stuckReset.rowCount && stuckReset.rowCount > 0) {
      console.log(`Auto-reset ${stuckReset.rowCount} stuck upload(s)`);
    }

    // Find pending uploads that need processing
    const pendingUploads = await queryRows<PendingUpload>(`
      SELECT upload_id, original_filename, source_system, source_table, uploaded_at
      FROM trapper.file_uploads
      WHERE status = 'pending'
        AND file_content IS NOT NULL
      ORDER BY uploaded_at ASC
      LIMIT $1
    `, [BATCH_LIMIT]);

    if (pendingUploads.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No pending uploads to process",
        processed: 0,
        duration_ms: Date.now() - startTime,
      });
    }

    let successCount = 0;
    let failCount = 0;
    const results: Array<{ upload_id: string; status: string; message: string }> = [];

    for (const upload of pendingUploads) {
      try {
        // Mark as processing
        await query(
          `UPDATE trapper.file_uploads SET status = 'processing' WHERE upload_id = $1`,
          [upload.upload_id]
        );

        // Call the internal processing endpoint
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

        const response = await fetch(`${baseUrl}/api/ingest/process/${upload.upload_id}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // Pass through cron auth
            ...(CRON_SECRET ? { Authorization: `Bearer ${CRON_SECRET}` } : {}),
          },
        });

        if (response.ok) {
          const result = await response.json();
          successCount++;
          results.push({
            upload_id: upload.upload_id,
            status: "completed",
            message: `Processed ${result.rows_processed || 0} rows`,
          });
        } else {
          const error = await response.text();
          failCount++;
          // Mark as failed
          await query(
            `UPDATE trapper.file_uploads
             SET status = 'failed', error_message = $2, processed_at = NOW()
             WHERE upload_id = $1`,
            [upload.upload_id, error.slice(0, 500)]
          );
          results.push({
            upload_id: upload.upload_id,
            status: "failed",
            message: error.slice(0, 200),
          });
        }
      } catch (err) {
        failCount++;
        const errorMsg = err instanceof Error ? err.message : String(err);
        // Mark as failed
        await query(
          `UPDATE trapper.file_uploads
           SET status = 'failed', error_message = $2, processed_at = NOW()
           WHERE upload_id = $1`,
          [upload.upload_id, errorMsg.slice(0, 500)]
        );
        results.push({
          upload_id: upload.upload_id,
          status: "failed",
          message: errorMsg.slice(0, 200),
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: `Processed ${successCount} uploads, ${failCount} failed`,
      total: pendingUploads.length,
      success_count: successCount,
      fail_count: failCount,
      results,
      duration_ms: Date.now() - startTime,
    });
  } catch (error) {
    console.error("Process uploads cron error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Processing failed",
        duration_ms: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}

/**
 * POST endpoint for manual trigger with specific upload IDs
 */
export async function POST(request: NextRequest) {
  // Verify auth
  const authHeader = request.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { upload_ids } = body as { upload_ids?: string[] };

    if (!upload_ids || upload_ids.length === 0) {
      // If no specific IDs, process all pending
      return GET(request);
    }

    // Process specific uploads
    let successCount = 0;
    let failCount = 0;

    for (const uploadId of upload_ids) {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

        const response = await fetch(`${baseUrl}/api/ingest/process/${uploadId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });

        if (response.ok) {
          successCount++;
        } else {
          failCount++;
        }
      } catch {
        failCount++;
      }
    }

    return NextResponse.json({
      success: true,
      message: `Processed ${successCount} of ${upload_ids.length} uploads`,
      success_count: successCount,
      fail_count: failCount,
    });
  } catch (error) {
    console.error("Process uploads POST error:", error);
    return NextResponse.json(
      { error: "Processing failed" },
      { status: 500 }
    );
  }
}
