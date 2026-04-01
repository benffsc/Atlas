import { queryOne, queryRows } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";
import { getServerConfig } from "@/lib/server-config";

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
    // Read staleness thresholds from config (MIG_3016 seeds)
    const [clinichqStaleHours, volunteerhubStaleHours, shelterluvStaleHours, stagedBacklogWarning] =
      await Promise.all([
        getServerConfig("sync.clinichq_stale_hours", 48),
        getServerConfig("sync.volunteerhub_stale_hours", 48),
        getServerConfig("sync.shelterluv_stale_hours", 24),
        getServerConfig("sync.staged_backlog_warning", 500),
      ]);

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
        sources.clinichq.status = hoursSince <= clinichqStaleHours ? "ok" : "stale";
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
        sources.volunteerhub.status = hoursSince <= volunteerhubStaleHours ? "active" : "stale";
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
        -- V2: Uses sot.cat_place instead of sot.cat_place_relationships
        (SELECT COUNT(DISTINCT cat_id) FROM sot.cat_place)::int as cats_with_place,
        (SELECT COUNT(*) FROM ops.appointments WHERE inferred_place_source IS NOT NULL)::int as places_inferred,
        (
          SELECT MAX(completed_at)
          FROM ops.processing_jobs
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
      FROM ops.processing_jobs
    `);

    // Get staged records backlog per source
    const stagedBacklog = await queryRows<{
      source_system: string;
      source_table: string;
      pending: number;
    }>(`
      SELECT source_system, source_table, COUNT(*)::int as pending
      FROM ops.staged_records
      WHERE NOT is_processed
      GROUP BY source_system, source_table
      ORDER BY pending DESC
    `).catch(() => []);

    const totalStagedPending = stagedBacklog.reduce((sum, r) => sum + r.pending, 0);

    // Build staleness alerts for frontend banners
    const stalenessAlerts: Array<{
      source: string;
      level: "warning" | "critical";
      message: string;
      hours_stale: number;
    }> = [];

    for (const [key, source] of Object.entries(sources)) {
      if (source.status === "stale" && source.last_sync) {
        const hoursSince = Math.round(
          (Date.now() - new Date(source.last_sync).getTime()) / (1000 * 60 * 60)
        );
        const daysSince = Math.round(hoursSince / 24);
        const thresholdHours =
          key === "clinichq" ? clinichqStaleHours
          : key === "volunteerhub" ? volunteerhubStaleHours
          : key === "shelterluv" ? shelterluvStaleHours
          : 168;

        // Critical if 3x the stale threshold
        const level = hoursSince > thresholdHours * 3 ? "critical" : "warning";
        const label = key === "clinichq" ? "ClinicHQ" : key === "volunteerhub" ? "VolunteerHub" : key === "shelterluv" ? "ShelterLuv" : key;
        stalenessAlerts.push({
          source: key,
          level,
          message: `${label} last synced ${daysSince} day${daysSince !== 1 ? "s" : ""} ago`,
          hours_stale: hoursSince,
        });
      } else if (source.status === "never" && key !== "petlink" && key !== "airtable") {
        stalenessAlerts.push({
          source: key,
          level: "critical",
          message: `${key === "shelterluv" ? "ShelterLuv" : key === "volunteerhub" ? "VolunteerHub" : key} has never synced`,
          hours_stale: -1,
        });
      }
    }

    if (totalStagedPending > stagedBacklogWarning) {
      stalenessAlerts.push({
        source: "staged_records",
        level: totalStagedPending > stagedBacklogWarning * 3 ? "critical" : "warning",
        message: `${totalStagedPending.toLocaleString()} unprocessed staged records waiting`,
        hours_stale: 0,
      });
    }

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

    return apiSuccess({
      ...stats,
      staged_backlog: stagedBacklog,
      staleness_alerts: stalenessAlerts,
    });
  } catch (error) {
    console.error("Error fetching processing stats:", error);
    return apiServerError(error instanceof Error ? error.message : "Unknown error");
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
        FROM ops.processing_jobs
        WHERE status = 'queued'
        ORDER BY created_at
        LIMIT 10
      ),
      updated AS (
        UPDATE ops.processing_jobs
        SET status = 'processing', started_at = NOW()
        WHERE job_id IN (SELECT job_id FROM pending)
        RETURNING job_id
      )
      SELECT COUNT(*)::int as processed FROM updated
    `);

    return apiSuccess({
      success: true,
      jobs_started: result?.processed || 0,
      message: `Started processing ${result?.processed || 0} pending jobs`,
    });
  } catch (error) {
    console.error("Error starting jobs:", error);
    return apiServerError(error instanceof Error ? error.message : "Unknown error");
  }
}
