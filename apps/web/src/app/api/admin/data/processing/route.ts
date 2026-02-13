import { NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";

/**
 * Processing Status API for Data Hub
 *
 * Returns ingest, entity linking, and job queue status for the unified Data Hub page.
 * Consolidates status from all data sources: ClinicHQ, ShelterLuv, Airtable, VolunteerHub, PetLink
 */

interface SourceStatus {
  last_sync: string | null;
  records_24h: number;
  total_records: number;
  status: "active" | "ok" | "warning" | "stale" | "never";
  sync_type: "file_upload" | "api_cron" | "api_manual";
  description: string;
}

interface ProcessingStats {
  sources: Record<string, SourceStatus>;
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
    // Initialize sources
    const sources: Record<string, SourceStatus> = {
      clinichq: {
        last_sync: null,
        records_24h: 0,
        total_records: 0,
        status: "ok",
        sync_type: "file_upload",
        description: "Cat & appointment data from clinic exports",
      },
      shelterluv: {
        last_sync: null,
        records_24h: 0,
        total_records: 0,
        status: "never",
        sync_type: "api_cron",
        description: "Cats, outcomes, medical records",
      },
      airtable: {
        last_sync: null,
        records_24h: 0,
        total_records: 0,
        status: "ok",
        sync_type: "api_cron",
        description: "Legacy requests & Project 75",
      },
      volunteerhub: {
        last_sync: null,
        records_24h: 0,
        total_records: 0,
        status: "never",
        sync_type: "api_cron",
        description: "Volunteers, trappers, fosters",
      },
      petlink: {
        last_sync: null,
        records_24h: 0,
        total_records: 0,
        status: "ok",
        sync_type: "file_upload",
        description: "Microchip registry data",
      },
    };

    // Get ClinicHQ status from file_uploads
    const clinichqStatus = await queryOne<{
      last_sync: string | null;
      records_24h: number;
      total_records: number;
    }>(`
      SELECT
        MAX(processed_at) as last_sync,
        COALESCE(SUM(rows_inserted) FILTER (WHERE processed_at > NOW() - INTERVAL '24 hours'), 0)::int as records_24h,
        COALESCE(SUM(rows_total), 0)::int as total_records
      FROM ops.file_uploads
      WHERE source_system = 'clinichq' AND status = 'completed'
    `);

    if (clinichqStatus) {
      sources.clinichq.last_sync = clinichqStatus.last_sync;
      sources.clinichq.records_24h = clinichqStatus.records_24h;
      sources.clinichq.total_records = clinichqStatus.total_records;
      if (clinichqStatus.last_sync) {
        const hoursSince = (Date.now() - new Date(clinichqStatus.last_sync).getTime()) / (1000 * 60 * 60);
        sources.clinichq.status = hoursSince <= 168 ? "ok" : "stale"; // 7 days
      }
    }

    // Get ShelterLuv status
    const shelterluvStatus = await queryRows<{
      sync_type: string;
      last_sync_at: string | null;
      sync_health: string;
    }>(`
      SELECT sync_type, last_sync_at, sync_health
      FROM ops.v_shelterluv_sync_status
      ORDER BY sync_type
    `).catch(() => []);

    if (shelterluvStatus.length > 0) {
      // Use most recent sync across all types
      const mostRecent = shelterluvStatus.reduce((a, b) =>
        (a.last_sync_at || "") > (b.last_sync_at || "") ? a : b
      );
      sources.shelterluv.last_sync = mostRecent.last_sync_at;
      sources.shelterluv.status = mostRecent.sync_health === "recent" ? "active" : "stale";
    }

    // Get ShelterLuv record count
    const shelterluvCount = await queryOne<{ count: number }>(`
      SELECT COUNT(*)::int as count FROM source.shelterluv_animals
    `).catch(() => null);
    if (shelterluvCount) {
      sources.shelterluv.total_records = shelterluvCount.count;
    }

    // Get VolunteerHub status
    const volunteerhubStatus = await queryOne<{
      last_sync: string | null;
      total_count: number;
    }>(`
      SELECT
        MAX(last_api_sync_at) as last_sync,
        COUNT(*)::int as total_count
      FROM source.volunteerhub_volunteers
    `).catch(() => null);

    if (volunteerhubStatus) {
      sources.volunteerhub.last_sync = volunteerhubStatus.last_sync;
      sources.volunteerhub.total_records = volunteerhubStatus.total_count;
      if (volunteerhubStatus.last_sync) {
        const hoursSince = (Date.now() - new Date(volunteerhubStatus.last_sync).getTime()) / (1000 * 60 * 60);
        sources.volunteerhub.status = hoursSince <= 48 ? "active" : "stale";
      }
    }

    // Get Airtable status from requests
    const airtableStatus = await queryOne<{
      last_sync: string | null;
      total_count: number;
    }>(`
      SELECT
        MAX(source_created_at) as last_sync,
        COUNT(*)::int as total_count
      FROM ops.requests
      WHERE source_system = 'airtable'
    `).catch(() => null);

    if (airtableStatus) {
      sources.airtable.last_sync = airtableStatus.last_sync;
      sources.airtable.total_records = airtableStatus.total_count;
      sources.airtable.status = "ok"; // Legacy, no active sync
    }

    // Get PetLink status from file_uploads
    const petlinkStatus = await queryOne<{
      last_sync: string | null;
      total_records: number;
    }>(`
      SELECT
        MAX(processed_at) as last_sync,
        COALESCE(SUM(rows_total), 0)::int as total_records
      FROM ops.file_uploads
      WHERE source_system = 'petlink' AND status = 'completed'
    `).catch(() => null);

    if (petlinkStatus) {
      sources.petlink.last_sync = petlinkStatus.last_sync;
      sources.petlink.total_records = petlinkStatus.total_records;
      if (petlinkStatus.last_sync) {
        sources.petlink.status = "ok";
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
        (SELECT COUNT(*) FROM ops.appointments WHERE inferred_place_id IS NOT NULL)::int as appointments_with_place,
        (SELECT COUNT(DISTINCT cat_id) FROM sot.cat_place_relationships)::int as cats_with_place,
        (SELECT COUNT(*) FROM ops.appointments WHERE inferred_place_source IS NOT NULL)::int as places_inferred,
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
      sources,
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

/**
 * POST: Trigger background job processing
 */
export async function POST() {
  try {
    // Trigger processing of pending jobs
    const result = await queryOne<{ processed: number }>(`
      WITH pending AS (
        SELECT job_id
        FROM trapper.processing_jobs
        WHERE status = 'queued'
        ORDER BY created_at
        LIMIT 10
      ),
      updated AS (
        UPDATE trapper.processing_jobs
        SET status = 'processing', started_at = NOW()
        WHERE job_id IN (SELECT job_id FROM pending)
        RETURNING job_id
      )
      SELECT COUNT(*)::int as processed FROM updated
    `);

    return NextResponse.json({
      success: true,
      jobs_started: result?.processed || 0,
      message: `Started processing ${result?.processed || 0} pending jobs`,
    });
  } catch (error) {
    console.error("Error starting jobs:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
