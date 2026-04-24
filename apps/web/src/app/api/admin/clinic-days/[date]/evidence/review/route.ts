import { NextRequest } from "next/server";
import { queryOne, queryRows } from "@/lib/db";
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
 * GET /api/admin/clinic-days/[date]/evidence/review
 *
 * Returns chunks that need review (ambiguous/unmatched) with their
 * segment details, extracted waiver data, and photo URLs.
 *
 * POST /api/admin/clinic-days/[date]/evidence/review
 *
 * Staff action on a chunk: approve, override (pick different cat), or reject.
 * Manual assignments use matched_via='manual' and are never overwritten by AI.
 *
 * Linear: FFS-1092
 */

interface ReviewChunk {
  chunk_id: string;
  assignment_status: string;
  matched_cat_id: string | null;
  matched_cat_name: string | null;
  matched_via: string | null;
  confidence: number | null;
  waiver_data: Record<string, unknown> | null;
  segments: Array<{
    segment_id: string;
    segment_role: string;
    sequence_number: number;
    storage_path: string | null;
    original_filename: string | null;
  }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession(request);
    if (!session) return apiUnauthorized();

    const { date } = await params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return apiBadRequest("Invalid date format. Use YYYY-MM-DD.");
    }

    // Get all chunks for this date, ordered by sequence
    const chunks = await queryRows<{
      chunk_id: string;
      assignment_status: string;
      matched_cat_id: string | null;
      matched_cat_name: string | null;
      matched_via: string | null;
      confidence: number | null;
      waiver_data: Record<string, unknown> | null;
      min_seq: number;
    }>(`
      SELECT
        s.chunk_id::text,
        s.assignment_status,
        s.matched_cat_id::text,
        COALESCE(c.display_name, c.name) AS matched_cat_name,
        s.matched_via,
        s.confidence::float,
        s.extracted_data AS waiver_data,
        MIN(s2.sequence_number) AS min_seq
      FROM ops.evidence_stream_segments s
      LEFT JOIN sot.cats c ON c.cat_id = s.matched_cat_id
      LEFT JOIN ops.evidence_stream_segments s2
        ON s2.chunk_id = s.chunk_id
      WHERE s.clinic_date = $1::DATE
        AND s.segment_role = 'waiver_photo'
        AND s.chunk_id IS NOT NULL
      GROUP BY s.chunk_id, s.assignment_status, s.matched_cat_id,
               c.name, s.matched_via, s.confidence, s.extracted_data
      ORDER BY min_seq
    `, [date]);

    // Get segments for each chunk
    const result: ReviewChunk[] = [];
    for (const chunk of chunks) {
      const segments = await queryRows<{
        segment_id: string;
        segment_role: string;
        sequence_number: number;
        storage_path: string | null;
        original_filename: string | null;
      }>(`
        SELECT
          s.segment_id::text,
          s.segment_role,
          s.sequence_number,
          rm.storage_path,
          rm.original_filename
        FROM ops.evidence_stream_segments s
        LEFT JOIN ops.request_media rm
          ON rm.media_id = s.source_ref_id AND s.source_kind = 'request_media'
        WHERE s.chunk_id = $1::UUID
        ORDER BY s.sequence_number
      `, [chunk.chunk_id]);

      result.push({
        chunk_id: chunk.chunk_id,
        assignment_status: chunk.assignment_status,
        matched_cat_id: chunk.matched_cat_id,
        matched_cat_name: chunk.matched_cat_name,
        matched_via: chunk.matched_via,
        confidence: chunk.confidence,
        waiver_data: chunk.waiver_data,
        segments,
      });
    }

    // Also get orphan photos (no chunk)
    const orphans = await queryRows<{
      segment_id: string;
      segment_role: string;
      sequence_number: number;
      storage_path: string | null;
      original_filename: string | null;
    }>(`
      SELECT
        s.segment_id::text,
        s.segment_role,
        s.sequence_number,
        rm.storage_path,
        rm.original_filename
      FROM ops.evidence_stream_segments s
      LEFT JOIN ops.request_media rm
        ON rm.media_id = s.source_ref_id AND s.source_kind = 'request_media'
      WHERE s.clinic_date = $1::DATE
        AND s.source_kind = 'request_media'
        AND s.segment_role = 'cat_photo'
        AND s.chunk_id IS NULL
        AND s.assignment_status = 'ambiguous'
      ORDER BY s.sequence_number
    `, [date]);

    return apiSuccess({
      clinic_date: date,
      chunks: result,
      orphan_count: orphans.length,
      orphans,
    });
  } catch (error) {
    console.error("Evidence review GET error:", error);
    return apiServerError("Failed to fetch review data");
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession(request);
    if (!session) return apiUnauthorized();

    const { date } = await params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return apiBadRequest("Invalid date format. Use YYYY-MM-DD.");
    }

    const body = await request.json();
    const { chunk_id, action, cat_id } = body;

    if (!chunk_id || !action) {
      return apiBadRequest("chunk_id and action are required");
    }

    if (!["approve", "override", "reject"].includes(action)) {
      return apiBadRequest("action must be approve, override, or reject");
    }

    // Verify chunk exists and belongs to this date
    const chunk = await queryOne<{ chunk_id: string; matched_cat_id: string | null }>(`
      SELECT chunk_id::text, matched_cat_id::text
      FROM ops.evidence_stream_segments
      WHERE chunk_id = $1::UUID
        AND clinic_date = $2::DATE
        AND segment_role = 'waiver_photo'
      LIMIT 1
    `, [chunk_id, date]);

    if (!chunk) {
      return apiBadRequest("Chunk not found for this date");
    }

    switch (action) {
      case "approve": {
        // Confirm the AI match — upgrade to manual
        if (!chunk.matched_cat_id) {
          return apiBadRequest("Cannot approve — chunk has no match to approve");
        }
        await queryOne(`
          UPDATE ops.evidence_stream_segments
          SET matched_via = 'manual',
              assignment_status = 'assigned',
              notes = COALESCE(notes, '') || ' | Approved by ' || $2 || ' at ' || NOW()::text,
              updated_at = NOW()
          WHERE chunk_id = $1::UUID
        `, [chunk_id, session.display_name]);

        // Also update request_media — set cat_id so photos appear on cat profiles
        await queryOne(`
          UPDATE ops.request_media
          SET cat_id = $2::UUID, cat_identification_confidence = 'high'
          WHERE media_id IN (
            SELECT source_ref_id FROM ops.evidence_stream_segments
            WHERE chunk_id = $1::UUID AND source_kind = 'request_media' AND segment_role = 'cat_photo'
          )
        `, [chunk_id, chunk.matched_cat_id]);

        // Auto-set hero photo if this cat doesn't have one (FFS-1239)
        try {
          await queryOne(
            `SELECT * FROM ops.auto_set_hero_photos($1::UUID)`,
            [chunk.matched_cat_id]
          );
        } catch { /* non-fatal */ }

        return apiSuccess({ action: "approved", chunk_id });
      }

      case "override": {
        // Staff picks a different cat
        if (!cat_id) {
          return apiBadRequest("cat_id is required for override action");
        }

        // Verify cat exists
        const catExists = await queryOne<{ cat_id: string }>(`
          SELECT cat_id::text FROM sot.cats WHERE cat_id = $1::UUID
        `, [cat_id]);
        if (!catExists) {
          return apiBadRequest("Cat not found");
        }

        // Update all segments in the chunk — manual override
        await queryOne(`
          UPDATE ops.evidence_stream_segments
          SET matched_cat_id = $2::UUID,
              matched_via = 'manual',
              assignment_status = 'assigned',
              notes = COALESCE(notes, '') || ' | Override to ' || $2 || ' by ' || $3 || ' at ' || NOW()::text,
              updated_at = NOW()
          WHERE chunk_id = $1::UUID
        `, [chunk_id, cat_id, session.display_name]);

        // Update request_media
        await queryOne(`
          UPDATE ops.request_media
          SET cat_id = $1::UUID, cat_identification_confidence = 'high'
          WHERE media_id IN (
            SELECT source_ref_id FROM ops.evidence_stream_segments
            WHERE chunk_id = $2::UUID AND source_kind = 'request_media' AND segment_role = 'cat_photo'
          )
        `, [cat_id, chunk_id]);

        return apiSuccess({ action: "overridden", chunk_id, cat_id });
      }

      case "reject": {
        // Staff rejects this chunk — mark as rejected
        await queryOne(`
          UPDATE ops.evidence_stream_segments
          SET assignment_status = 'rejected',
              notes = COALESCE(notes, '') || ' | Rejected by ' || $2 || ' at ' || NOW()::text,
              updated_at = NOW()
          WHERE chunk_id = $1::UUID
        `, [chunk_id, session.display_name]);

        return apiSuccess({ action: "rejected", chunk_id });
      }
    }
  } catch (error) {
    console.error("Evidence review POST error:", error);
    return apiServerError("Failed to process review action");
  }
}
