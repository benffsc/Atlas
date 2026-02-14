import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";

/**
 * AI Extraction Progress Tracker API
 * Returns status of all AI extraction/classification jobs
 *
 * View in UI: /admin/ai-extraction
 * Backlog view: SELECT * FROM ops.v_extraction_backlog_summary
 * Queue appointments: SELECT ops.queue_appointment_extraction(10000)
 */

export async function GET() {
  try {
    // Get backlog summary from the view (like geocoding)
    const backlog = await query(`
      SELECT * FROM ops.v_extraction_backlog_summary
      ORDER BY pending_count DESC
    `);

    // Google Maps classification progress
    const googleMaps = await queryOne<{
      total: number;
      classified: number;
      unclassified: number;
    }>(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE ai_classification IS NOT NULL) as classified,
        COUNT(*) FILTER (WHERE ai_classification IS NULL) as unclassified
      FROM source.google_map_entries
    `);

    // Google Maps classification distribution
    const googleMapsDistribution = await query(`
      SELECT
        ai_classification->>'primary_meaning' as meaning,
        COUNT(*) as count
      FROM source.google_map_entries
      WHERE ai_classification IS NOT NULL
      GROUP BY 1
      ORDER BY count DESC
    `);

    // Request notes backlog
    const requests = await queryOne<{
      total: number;
      with_notes: number;
    }>(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE
          (summary IS NOT NULL AND LENGTH(summary) > 20)
          OR (notes IS NOT NULL AND LENGTH(notes) > 20)
          OR (internal_notes IS NOT NULL AND LENGTH(internal_notes) > 20)
        ) as with_notes
      FROM ops.requests
    `);

    // Clinic appointments backlog
    const clinic = await queryOne<{
      total: number;
      with_notes: number;
    }>(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE medical_notes IS NOT NULL AND LENGTH(medical_notes) > 20) as with_notes
      FROM ops.appointments
    `);

    // Intake submissions backlog
    const intake = await queryOne<{
      total: number;
      with_notes: number;
    }>(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE
          (situation_description IS NOT NULL AND LENGTH(situation_description) > 20)
          OR (medical_description IS NOT NULL AND LENGTH(medical_description) > 20)
        ) as with_notes
      FROM ops.intake_submissions
    `);

    // Entity attributes summary
    const attributes = await query(`
      SELECT
        entity_type,
        attribute_key,
        COUNT(*) as count,
        AVG(confidence) as avg_confidence
      FROM sot.entity_attributes
      WHERE source_type = 'ai_extracted'
        AND superseded_at IS NULL
      GROUP BY entity_type, attribute_key
      ORDER BY entity_type, count DESC
    `);

    // Attributes by entity type
    const attributesByType = await query(`
      SELECT
        entity_type,
        COUNT(*) as count,
        COUNT(DISTINCT entity_id) as unique_entities
      FROM sot.entity_attributes
      WHERE source_type = 'ai_extracted'
        AND superseded_at IS NULL
      GROUP BY entity_type
      ORDER BY count DESC
    `);

    // Extraction queue status
    const queue = await queryOne<{
      pending: number;
      processing: number;
      completed_24h: number;
      errors_24h: number;
    }>(`
      SELECT
        COUNT(*) FILTER (WHERE completed_at IS NULL AND processing_started_at IS NULL) as pending,
        COUNT(*) FILTER (WHERE completed_at IS NULL AND processing_started_at IS NOT NULL) as processing,
        COUNT(*) FILTER (WHERE completed_at > NOW() - INTERVAL '24 hours' AND error_message IS NULL) as completed_24h,
        COUNT(*) FILTER (WHERE completed_at > NOW() - INTERVAL '24 hours' AND error_message IS NOT NULL) as errors_24h
      FROM ops.extraction_queue
    `);

    // Recent extraction jobs
    const recentJobs = await query(`
      SELECT
        source_system,
        entity_type,
        records_processed,
        attributes_extracted,
        cost_estimate_usd,
        model_used,
        completed_at
      FROM trapper.attribute_extraction_jobs
      ORDER BY completed_at DESC
      LIMIT 10
    `);

    // Calculate overall progress
    const totalBacklog = (googleMaps?.unclassified || 0) +
      (requests?.with_notes || 0) +
      (clinic?.with_notes || 0) +
      (intake?.with_notes || 0);

    const totalClassified = googleMaps?.classified || 0;
    const totalAttributes = attributesByType.rows.reduce((sum, r) => sum + parseInt(r.count), 0);

    return NextResponse.json({
      status: "ok",
      generated_at: new Date().toISOString(),
      summary: {
        total_backlog: totalBacklog,
        total_classified: totalClassified,
        total_attributes: totalAttributes,
        queue_pending: queue?.pending || 0,
        queue_processing: queue?.processing || 0,
      },
      sources: {
        google_maps: {
          total: googleMaps?.total || 0,
          classified: googleMaps?.classified || 0,
          pending: googleMaps?.unclassified || 0,
          progress_pct: googleMaps?.total
            ? Math.round((googleMaps.classified / googleMaps.total) * 100)
            : 0,
          distribution: googleMapsDistribution.rows,
        },
        requests: {
          total: requests?.total || 0,
          with_notes: requests?.with_notes || 0,
        },
        clinic: {
          total: clinic?.total || 0,
          with_notes: clinic?.with_notes || 0,
        },
        intake: {
          total: intake?.total || 0,
          with_notes: intake?.with_notes || 0,
        },
      },
      attributes: {
        by_type: attributesByType.rows,
        details: attributes.rows,
      },
      queue: queue || { pending: 0, processing: 0, completed_24h: 0, errors_24h: 0 },
      recent_jobs: recentJobs.rows,
    });
  } catch (error) {
    console.error("AI extraction status error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
