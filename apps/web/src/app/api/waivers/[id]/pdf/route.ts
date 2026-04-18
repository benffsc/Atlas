import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { requireValidUUID, withErrorHandling } from "@/lib/api-validation";
import { apiNotFound } from "@/lib/api-response";

/**
 * GET /api/waivers/[id]/pdf — Serve waiver PDF binary
 *
 * Returns the raw PDF for a waiver_scan record.
 * Content-Type: application/pdf
 */
export const GET = withErrorHandling(async (
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  requireValidUUID(id, "waiver");

  const row = await queryOne<{ file_content: Buffer; original_filename: string }>(
    `SELECT fu.file_content, fu.original_filename
     FROM ops.waiver_scans ws
     JOIN ops.file_uploads fu ON fu.upload_id = ws.file_upload_id
     WHERE ws.waiver_id = $1`,
    [id]
  );

  if (!row?.file_content) {
    return apiNotFound("Waiver PDF", id);
  }

  const buf = Buffer.from(row.file_content);

  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": buf.length.toString(),
      "Content-Disposition": `inline; filename="${row.original_filename || "waiver.pdf"}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
});
