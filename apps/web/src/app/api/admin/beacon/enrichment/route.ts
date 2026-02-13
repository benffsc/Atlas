import { NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";

/**
 * Beacon Data Enrichment Pipeline Status
 *
 * Shows the status of all data enrichment sources:
 * - AI-parsed data (Google Maps, requests, P75)
 * - Cron-parsed data (birth events, mortality, colony estimates)
 * - Manual entries
 *
 * Used by the admin dashboard to show data coverage.
 */

interface SourceStats {
  source: string;
  count: number;
  last_updated: string | null;
}

export async function GET() {
  try {
    // Colony estimates by source
    const colonyBySource = await queryRows<SourceStats>(`
      SELECT
        COALESCE(source_system, source_type, 'unknown') AS source,
        COUNT(*)::INT AS count,
        MAX(created_at)::TEXT AS last_updated
      FROM sot.place_colony_estimates
      GROUP BY COALESCE(source_system, source_type, 'unknown')
      ORDER BY count DESC
    `);

    // Birth events by source
    const birthsBySource = await queryRows<SourceStats>(`
      SELECT
        COALESCE(source_system, 'unknown') AS source,
        COUNT(*)::INT AS count,
        MAX(created_at)::TEXT AS last_updated
      FROM sot.cat_birth_events
      GROUP BY source_system
      ORDER BY count DESC
    `);

    // Mortality events by source
    const mortalityBySource = await queryRows<SourceStats>(`
      SELECT
        COALESCE(source_system, 'unknown') AS source,
        COUNT(*)::INT AS count,
        MAX(created_at)::TEXT AS last_updated
      FROM sot.cat_mortality_events
      GROUP BY source_system
      ORDER BY count DESC
    `);

    // Google Maps processing status
    const googleMapsStatus = await queryOne<{
      total: number;
      paraphrased: number;
      quantitative_parsed: number;
      with_place: number;
    }>(`
      SELECT
        COUNT(*)::INT AS total,
        COUNT(*) FILTER (WHERE ai_processed_at IS NOT NULL)::INT AS paraphrased,
        COUNT(*) FILTER (WHERE ai_quantitative_parsed_at IS NOT NULL)::INT AS quantitative_parsed,
        COUNT(*) FILTER (WHERE place_id IS NOT NULL)::INT AS with_place
      FROM source.google_map_entries
    `);

    // Recent cron runs
    const recentRuns = await queryRows<{
      source_system: string;
      run_type: string;
      completed_at: string;
      records_created: number;
      status: string;
    }>(`
      SELECT
        source_system,
        run_type,
        completed_at::TEXT,
        records_created,
        status
      FROM ops.ingest_runs
      WHERE source_system IN ('beacon_cron', 'notes_parser_cron', 'parse_quantitative')
      ORDER BY completed_at DESC
      LIMIT 10
    `);

    // Totals summary
    const totals = await queryOne<{
      colony_estimates: number;
      birth_events: number;
      mortality_events: number;
      places_with_ecology: number;
    }>(`
      SELECT
        (SELECT COUNT(*)::INT FROM sot.place_colony_estimates) AS colony_estimates,
        (SELECT COUNT(*)::INT FROM sot.cat_birth_events) AS birth_events,
        (SELECT COUNT(*)::INT FROM sot.cat_mortality_events) AS mortality_events,
        (SELECT COUNT(DISTINCT place_id)::INT FROM sot.place_colony_estimates) AS places_with_ecology
    `);

    // AI-parsed specifically
    const aiParsed = await queryOne<{
      colony_from_ai: number;
      google_maps_parsed: number;
      requests_parsed: number;
    }>(`
      SELECT
        (SELECT COUNT(*)::INT FROM sot.place_colony_estimates WHERE source_type = 'ai_parsed') AS colony_from_ai,
        (SELECT COUNT(*)::INT FROM sot.place_colony_estimates WHERE source_system = 'google_maps_kml') AS google_maps_parsed,
        (SELECT COUNT(*)::INT FROM sot.place_colony_estimates WHERE source_system = 'requests') AS requests_parsed
    `);

    return NextResponse.json({
      totals: {
        colony_estimates: totals?.colony_estimates || 0,
        birth_events: totals?.birth_events || 0,
        mortality_events: totals?.mortality_events || 0,
        places_with_ecology: totals?.places_with_ecology || 0,
      },
      ai_parsed: {
        colony_from_ai: aiParsed?.colony_from_ai || 0,
        google_maps_parsed: aiParsed?.google_maps_parsed || 0,
        requests_parsed: aiParsed?.requests_parsed || 0,
      },
      google_maps: googleMapsStatus || {
        total: 0,
        paraphrased: 0,
        quantitative_parsed: 0,
        with_place: 0,
      },
      by_source: {
        colony_estimates: colonyBySource,
        birth_events: birthsBySource,
        mortality_events: mortalityBySource,
      },
      recent_runs: recentRuns,
    });
  } catch (error) {
    console.error("Enrichment status error:", error);
    return NextResponse.json(
      { error: "Failed to fetch enrichment status" },
      { status: 500 }
    );
  }
}
