import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";

// Wrap a promise with a timeout that rejects if it takes too long
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label}: timed out after ${ms}ms (row likely locked)`)), ms)
    ),
  ]);
}

/**
 * DELETE /api/ingest/uploads/[id]
 * Soft-delete an upload (sets status='deleted', hidden from UI).
 * Allowed for completed, failed, expired, or processing stuck > 1 hour.
 * Does NOT delete staged_records — data is preserved.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: "Upload ID required" }, { status: 400 });
  }

  try {
    const result = await withTimeout(
      queryOne<{ upload_id: string }>(
        `UPDATE trapper.file_uploads
         SET status = 'deleted',
             error_message = COALESCE(error_message, '') || ' [Removed by staff]'
         WHERE upload_id = $1
           AND (
             status IN ('completed', 'failed', 'expired')
             OR (status = 'processing'
                 AND uploaded_at < NOW() - INTERVAL '1 hour')
           )
         RETURNING upload_id`,
        [id]
      ),
      5000,
      "Delete upload"
    );

    if (!result) {
      return NextResponse.json(
        { error: "Upload not found or cannot be deleted (still actively processing)" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, upload_id: result.upload_id });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "";
    if (msg.includes("timed out") || msg.includes("lock") || msg.includes("canceling statement")) {
      console.error("Timeout/lock deleting upload — row is likely locked by zombie transaction:", id);
      return NextResponse.json(
        { error: "Upload row is locked by a stuck transaction. Wait a few minutes and try again, or restart the server." },
        { status: 409 }
      );
    }
    console.error("Error deleting upload:", error);
    return NextResponse.json(
      { error: "Failed to delete upload" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/ingest/uploads/[id]
 * Reset a stuck "processing" upload back to "failed" so it can be retried or deleted.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: "Upload ID required" }, { status: 400 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const action = (body as { action?: string }).action;

    if (action === "reset") {
      const result = await withTimeout(
        queryOne<{ upload_id: string; status: string }>(
          `UPDATE trapper.file_uploads
           SET status = 'failed',
               error_message = 'Manually reset: was stuck in processing'
           WHERE upload_id = $1
             AND status = 'processing'
           RETURNING upload_id, status`,
          [id]
        ),
        5000,
        "Reset upload"
      );

      if (!result) {
        return NextResponse.json(
          { error: "Upload not found or not in processing status" },
          { status: 404 }
        );
      }

      return NextResponse.json({
        success: true,
        upload_id: result.upload_id,
        status: result.status,
      });
    }

    return NextResponse.json(
      { error: "Unknown action. Supported: reset" },
      { status: 400 }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "";
    if (msg.includes("timed out") || msg.includes("lock") || msg.includes("canceling statement")) {
      console.error("Timeout/lock resetting upload — row is likely locked:", id);
      return NextResponse.json(
        { error: "Upload row is locked by a stuck transaction. Wait a few minutes and try again, or restart the server." },
        { status: 409 }
      );
    }
    console.error("Error updating upload:", error);
    return NextResponse.json(
      { error: "Failed to update upload" },
      { status: 500 }
    );
  }
}
