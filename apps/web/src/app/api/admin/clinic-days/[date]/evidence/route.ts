import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { getSession } from "@/lib/auth";
import {
  apiSuccess,
  apiBadRequest,
  apiUnauthorized,
  apiServerError,
} from "@/lib/api-response";

interface RouteParams {
  params: Promise<{ date: string }>;
}

/**
 * GET /api/admin/clinic-days/[date]/evidence
 *
 * Returns evidence pool summary for the clinic day hub:
 * - Role breakdown (cat/waiver/barcode/discard/pending counts)
 * - Chunk stats (total/assigned/ambiguous/unmatched)
 * - Audit alert counts (critical/warning)
 *
 * Linear: FFS-1222
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession(request);
    if (!session) return apiUnauthorized();

    const { date } = await params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return apiBadRequest("Invalid date format. Use YYYY-MM-DD.");
    }

    // All queries in parallel
    const [roles, chunks, audits, totals] = await Promise.all([
      // Role breakdown
      queryOne<{
        cat_photo: number;
        waiver_photo: number;
        microchip_barcode: number;
        discard: number;
        pending: number;
        unknown: number;
        total: number;
      }>(`
        SELECT
          COUNT(*) FILTER (WHERE segment_role = 'cat_photo')::int AS cat_photo,
          COUNT(*) FILTER (WHERE segment_role = 'waiver_photo')::int AS waiver_photo,
          COUNT(*) FILTER (WHERE segment_role = 'microchip_barcode')::int AS microchip_barcode,
          COUNT(*) FILTER (WHERE segment_role = 'discard')::int AS discard,
          COUNT(*) FILTER (WHERE segment_role IS NULL)::int AS pending,
          COUNT(*) FILTER (WHERE segment_role = 'unknown')::int AS unknown,
          COUNT(*)::int AS total
        FROM ops.evidence_stream_segments
        WHERE clinic_date = $1::DATE
          AND source_kind = 'request_media'
      `, [date]),

      // Chunk stats
      queryOne<{
        total_chunks: number;
        assigned: number;
        ambiguous: number;
        unmatched: number;
      }>(`
        SELECT
          COUNT(DISTINCT chunk_id)::int AS total_chunks,
          COUNT(DISTINCT chunk_id) FILTER (
            WHERE assignment_status = 'assigned'
          )::int AS assigned,
          COUNT(DISTINCT chunk_id) FILTER (
            WHERE assignment_status = 'ambiguous'
          )::int AS ambiguous,
          COUNT(DISTINCT chunk_id) FILTER (
            WHERE assignment_status = 'chunked' AND matched_cat_id IS NULL
          )::int AS unmatched
        FROM ops.evidence_stream_segments
        WHERE clinic_date = $1::DATE
          AND chunk_id IS NOT NULL
      `, [date]),

      // Audit alerts (unresolved)
      queryOne<{
        critical: number;
        warning: number;
        info: number;
      }>(`
        SELECT
          COUNT(*) FILTER (WHERE severity = 'critical')::int AS critical,
          COUNT(*) FILTER (WHERE severity = 'warning')::int AS warning,
          COUNT(*) FILTER (WHERE severity = 'info')::int AS info
        FROM ops.evidence_audit_results
        WHERE clinic_date = $1::DATE
          AND resolved_at IS NULL
      `, [date]),

      // Overall segment count (including waiver_scan source kind)
      queryOne<{
        photo_segments: number;
        waiver_segments: number;
      }>(`
        SELECT
          COUNT(*) FILTER (WHERE source_kind = 'request_media')::int AS photo_segments,
          COUNT(*) FILTER (WHERE source_kind = 'waiver_scan')::int AS waiver_segments
        FROM ops.evidence_stream_segments
        WHERE clinic_date = $1::DATE
      `, [date]),
    ]);

    const hasEvidence = (totals?.photo_segments ?? 0) > 0;

    return apiSuccess({
      clinic_date: date,
      has_evidence: hasEvidence,
      roles: roles ?? {
        cat_photo: 0, waiver_photo: 0, microchip_barcode: 0,
        discard: 0, pending: 0, unknown: 0, total: 0,
      },
      chunks: chunks ?? {
        total_chunks: 0, assigned: 0, ambiguous: 0, unmatched: 0,
      },
      audits: audits ?? { critical: 0, warning: 0, info: 0 },
      source_breakdown: {
        photo_segments: totals?.photo_segments ?? 0,
        waiver_segments: totals?.waiver_segments ?? 0,
      },
    });
  } catch (error) {
    console.error("Evidence summary error:", error);
    return apiServerError("Failed to fetch evidence summary");
  }
}
