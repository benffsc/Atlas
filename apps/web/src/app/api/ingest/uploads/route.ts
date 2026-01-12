import { NextRequest, NextResponse } from "next/server";
import { queryRows } from "@/lib/db";

interface FileUploadRow {
  upload_id: string;
  original_filename: string;
  stored_filename: string;
  file_size_bytes: number;
  source_system: string;
  source_table: string;
  status: string;
  uploaded_at: string;
  processed_at: string | null;
  rows_total: number | null;
  rows_inserted: number | null;
  rows_updated: number | null;
  rows_skipped: number | null;
  error_message: string | null;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 100);
  const offset = parseInt(searchParams.get("offset") || "0", 10);
  const status = searchParams.get("status");

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (status) {
    conditions.push(`status = $${paramIndex}`);
    params.push(status);
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  try {
    const sql = `
      SELECT
        upload_id,
        original_filename,
        stored_filename,
        file_size_bytes,
        source_system,
        source_table,
        status,
        uploaded_at,
        processed_at,
        rows_total,
        rows_inserted,
        rows_updated,
        rows_skipped,
        error_message
      FROM trapper.file_uploads
      ${whereClause}
      ORDER BY uploaded_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    params.push(limit, offset);

    const uploads = await queryRows<FileUploadRow>(sql, params);

    return NextResponse.json({ uploads });
  } catch (error) {
    console.error("Error fetching uploads:", error);
    return NextResponse.json(
      { error: "Failed to fetch uploads" },
      { status: 500 }
    );
  }
}
