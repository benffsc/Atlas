import { NextRequest } from "next/server";
import { query } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";
import { parsePagination } from "@/lib/api-validation";

/**
 * GET /api/admin/waivers
 *
 * List waiver scans with status filters and stats.
 * Query params: ?status=pending&limit=50&offset=0
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const { limit, offset } = parsePagination(searchParams);
    const status = searchParams.get("status"); // ocr_status or review_status filter
    const tab = searchParams.get("tab"); // 'upload', 'review', 'stats'

    // Stats are always returned
    const statsResult = await query<{
      total_waivers: number;
      parsed_count: number;
      matched_count: number;
      ocr_pending: number;
      ocr_extracted: number;
      ocr_failed: number;
      review_pending: number;
      review_approved: number;
      review_rejected: number;
      enriched_count: number;
    }>(
      `SELECT
         COUNT(*)::int AS total_waivers,
         COUNT(*) FILTER (WHERE parsed_last4_chip IS NOT NULL)::int AS parsed_count,
         COUNT(*) FILTER (WHERE matched_appointment_id IS NOT NULL)::int AS matched_count,
         COUNT(*) FILTER (WHERE ocr_status = 'pending')::int AS ocr_pending,
         COUNT(*) FILTER (WHERE ocr_status = 'extracted')::int AS ocr_extracted,
         COUNT(*) FILTER (WHERE ocr_status = 'failed')::int AS ocr_failed,
         COUNT(*) FILTER (WHERE review_status = 'pending' AND ocr_status = 'extracted')::int AS review_pending,
         COUNT(*) FILTER (WHERE review_status = 'approved')::int AS review_approved,
         COUNT(*) FILTER (WHERE review_status = 'rejected')::int AS review_rejected,
         COUNT(*) FILTER (WHERE enrichment_status = 'applied')::int AS enriched_count
       FROM ops.waiver_scans`
    );

    const stats = statsResult.rows[0] || {
      total_waivers: 0, parsed_count: 0, matched_count: 0,
      ocr_pending: 0, ocr_extracted: 0, ocr_failed: 0,
      review_pending: 0, review_approved: 0, review_rejected: 0,
      enriched_count: 0,
    };

    // Build waiver list query with optional filters
    let whereClause = "WHERE 1=1";
    const params: unknown[] = [];
    let paramIdx = 1;

    if (status) {
      whereClause += ` AND (ws.ocr_status = $${paramIdx} OR ws.review_status = $${paramIdx})`;
      params.push(status);
      paramIdx++;
    }

    if (tab === "review") {
      whereClause += ` AND ws.ocr_status = 'extracted' AND ws.review_status = 'pending'`;
    }

    // Count total matching
    const countResult = await query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM ops.waiver_scans ws ${whereClause}`,
      params
    );
    const total = countResult.rows[0]?.count || 0;

    // Fetch waiver list
    const waiversResult = await query<{
      waiver_id: string;
      file_upload_id: string | null;
      original_filename: string | null;
      parsed_last_name: string | null;
      parsed_description: string | null;
      parsed_last4_chip: string | null;
      parsed_date: string | null;
      matched_appointment_id: string | null;
      matched_cat_id: string | null;
      match_method: string | null;
      match_confidence: number | null;
      cat_name: string | null;
      microchip: string | null;
      client_name: string | null;
      ocr_status: string;
      review_status: string;
      enrichment_status: string;
      created_at: string;
    }>(
      `SELECT
         ws.waiver_id,
         ws.file_upload_id,
         fu.original_filename,
         ws.parsed_last_name,
         ws.parsed_description,
         ws.parsed_last4_chip,
         ws.parsed_date::text,
         ws.matched_appointment_id,
         ws.matched_cat_id,
         ws.match_method,
         ws.match_confidence,
         COALESCE(c.display_name, c.name) AS cat_name,
         c.microchip,
         a.client_name,
         ws.ocr_status,
         ws.review_status,
         ws.enrichment_status,
         ws.created_at::text
       FROM ops.waiver_scans ws
       LEFT JOIN ops.file_uploads fu ON fu.upload_id = ws.file_upload_id
       LEFT JOIN sot.cats c ON c.cat_id = ws.matched_cat_id AND c.merged_into_cat_id IS NULL
       LEFT JOIN ops.appointments a ON a.appointment_id = ws.matched_appointment_id
       ${whereClause}
       ORDER BY ws.created_at DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset]
    );

    return apiSuccess(
      { waivers: waiversResult.rows, stats },
      { total, limit, offset }
    );
  } catch (error) {
    console.error("[ADMIN-WAIVERS] Error:", error);
    return apiServerError(
      error instanceof Error ? error.message : "Failed to fetch waivers"
    );
  }
}
