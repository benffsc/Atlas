import { NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";

/**
 * Processing Status API for Data Hub
 *
 * Returns ingest, entity linking, and job queue status for the unified Data Hub page.
 */

interface ProcessingStats {
  ingest: Record<string, {
    last_sync: string | null;
    records_24h: number;
    status: string;
  }>;
  entity_linking: {
    appointments_linked: number;
    cats_linked: number;
    places_inferred: number;
    last_run: string | null;
  };
  jobs: {
    pending: number;
    running: number;
    completed_24h: number;
    failed_24h: number;
  };
}

export async function GET() {
  try {
    // Get ingest status by source system
    const ingestStats = await queryRows<{
      source_system: string;
      last_completed: string | null;
      completed_24h: number;
      failed_24h: number;
      queued: number;
      processing: number;
    }>(`
      SELECT
        source_system,
        MAX(completed_at) FILTER (WHERE status = 'completed') as last_completed,
        COUNT(*) FILTER (WHERE status = 'completed' AND completed_at > NOW() - INTERVAL '24 hours')::int as completed_24h,
        COUNT(*) FILTER (WHERE status = 'failed' AND completed_at > NOW() - INTERVAL '24 hours')::int as failed_24h,
        COUNT(*) FILTER (WHERE status = 'queued')::int as queued,
        COUNT(*) FILTER (WHERE status = 'processing')::int as processing
      FROM trapper.processing_jobs
      WHERE source_system IN ('clinichq', 'airtable', 'web_intake')
      GROUP BY source_system
    `);

    // Build ingest status map
    const ingestMap: ProcessingStats["ingest"] = {
      clinichq: { last_sync: null, records_24h: 0, status: "ok" },
      airtable: { last_sync: null, records_24h: 0, status: "ok" },
      web_intake: { last_sync: null, records_24h: 0, status: "ok" },
    };

    for (const row of ingestStats) {
      if (row.source_system in ingestMap) {
        const hasIssues = row.failed_24h > row.completed_24h * 0.1; // >10% failure rate
        ingestMap[row.source_system] = {
          last_sync: row.last_completed,
          records_24h: row.completed_24h,
          status: hasIssues ? "warning" : row.queued > 100 ? "backlog" : "ok",
        };
      }
    }

    // Get entity linking stats
    const entityStats = await queryOne<{
      appointments_with_place: number;
      cats_with_place: number;
      places_inferred: number;
      last_linking_run: string | null;
    }>(`
      SELECT
        (SELECT COUNT(*) FROM trapper.sot_appointments WHERE inferred_place_id IS NOT NULL)::int as appointments_with_place,
        (SELECT COUNT(DISTINCT cat_id) FROM trapper.cat_place_relationships)::int as cats_with_place,
        (SELECT COUNT(*) FROM trapper.sot_appointments WHERE inferred_place_source IS NOT NULL)::int as places_inferred,
        (
          SELECT MAX(completed_at)
          FROM trapper.processing_jobs
          WHERE source_table = 'entity_linking' AND status = 'completed'
        ) as last_linking_run
    `);

    // Get job queue totals
    const jobStats = await queryOne<{
      pending: number;
      running: number;
      completed_24h: number;
      failed_24h: number;
    }>(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'queued')::int as pending,
        COUNT(*) FILTER (WHERE status IN ('processing', 'linking'))::int as running,
        COUNT(*) FILTER (WHERE status = 'completed' AND completed_at > NOW() - INTERVAL '24 hours')::int as completed_24h,
        COUNT(*) FILTER (WHERE status = 'failed' AND completed_at > NOW() - INTERVAL '24 hours')::int as failed_24h
      FROM trapper.processing_jobs
    `);

    const stats: ProcessingStats = {
      ingest: ingestMap,
      entity_linking: {
        appointments_linked: entityStats?.appointments_with_place || 0,
        cats_linked: entityStats?.cats_with_place || 0,
        places_inferred: entityStats?.places_inferred || 0,
        last_run: entityStats?.last_linking_run || null,
      },
      jobs: {
        pending: jobStats?.pending || 0,
        running: jobStats?.running || 0,
        completed_24h: jobStats?.completed_24h || 0,
        failed_24h: jobStats?.failed_24h || 0,
      },
    };

    return NextResponse.json(stats);
  } catch (error) {
    console.error("Error fetching processing stats:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
