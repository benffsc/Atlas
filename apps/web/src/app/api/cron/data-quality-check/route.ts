import { NextRequest } from "next/server";
import { queryOne, query, queryRows, execute } from "@/lib/db";
import { apiSuccess, apiServerError, apiError } from "@/lib/api-response";
import { getServerConfig } from "@/lib/server-config";
import { sendSlackAlerts } from "@/lib/slack";

// Data Quality Check Cron Job
//
// Runs every 6 hours to monitor data quality metrics.
// Alerts when thresholds are exceeded:
// - Cats without places > 5%
// - Pending reviews > 100
// - Geocoding queue > 100
// - Invalid people created in 24h > 10
// - ClinicHQ export broken (services_per_appt < 8)
//
// Phase 1A: Now writes to ops.alert_queue and sends Slack notifications.
//
// Vercel Cron: "0 */6 * * *" (every 6 hours)

export const maxDuration = 60;

const CRON_SECRET = process.env.CRON_SECRET;

interface DataQualityMetrics {
  total_cats: number;
  cats_with_places: number;
  cat_place_coverage_pct: number;
  pending_reviews: number;
  geocoding_queue: number;
  invalid_people_24h: number;
  total_people: number;
  valid_people: number;
  invalid_people: number;
  orgs_as_people: number;
  total_appointments: number;
  appointments_with_person: number;
  appointments_with_trapper: number;
  // ClinicHQ export health (DATA_GAP_037)
  export_services_per_appt: number | null;
  export_health_status: string | null;
  export_microchips: number | null;
  export_ear_tips: number | null;
  // Regression monitoring (FFS-141)
  duplicate_place_groups: number;
  unpropagated_matches: number;
  mislinked_appointments: number;
}

interface Alert {
  level: "warning" | "critical";
  metric: string;
  current: number;
  threshold: number;
  message: string;
}

export async function GET(request: NextRequest) {
  // Verify this is from Vercel Cron or has valid secret
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-vercel-cron");

  if (!cronHeader && CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return apiError("Unauthorized", 401);
  }

  const startTime = Date.now();

  try {
    // Get comprehensive data quality metrics
    const metrics = await queryOne<DataQualityMetrics>(`
      SELECT
        -- Cat-place coverage (CRITICAL for Beacon)
        -- V2: Uses sot.cat_place instead of sot.cat_place_relationships
        (SELECT COUNT(*) FROM sot.cats WHERE merged_into_cat_id IS NULL) as total_cats,
        (SELECT COUNT(DISTINCT cpr.cat_id)
         FROM sot.cat_place cpr
         JOIN sot.cats c ON c.cat_id = cpr.cat_id
         WHERE c.merged_into_cat_id IS NULL) as cats_with_places,
        ROUND(100.0 *
          (SELECT COUNT(DISTINCT cpr.cat_id)
           FROM sot.cat_place cpr
           JOIN sot.cats c ON c.cat_id = cpr.cat_id
           WHERE c.merged_into_cat_id IS NULL) /
          NULLIF((SELECT COUNT(*) FROM sot.cats WHERE merged_into_cat_id IS NULL), 0), 1
        ) as cat_place_coverage_pct,

        -- Data Engine review queue
        (SELECT COUNT(*) FROM sot.data_engine_match_decisions
         WHERE review_status = 'pending') as pending_reviews,

        -- Geocoding queue
        (SELECT COUNT(*) FROM sot.places
         WHERE merged_into_place_id IS NULL AND latitude IS NULL) as geocoding_queue,

        -- Invalid people created in last 24 hours
        (SELECT COUNT(*) FROM sot.people
         WHERE merged_into_person_id IS NULL
         AND created_at > NOW() - INTERVAL '24 hours'
         AND NOT sot.is_valid_person_name(display_name)) as invalid_people_24h,

        -- People quality breakdown
        (SELECT COUNT(*) FROM sot.people WHERE merged_into_person_id IS NULL) as total_people,
        (SELECT COUNT(*) FROM sot.people
         WHERE merged_into_person_id IS NULL
         AND sot.is_valid_person_name(display_name)) as valid_people,
        (SELECT COUNT(*) FROM sot.people
         WHERE merged_into_person_id IS NULL
         AND NOT sot.is_valid_person_name(display_name)) as invalid_people,
        (SELECT COUNT(*) FROM sot.people
         WHERE merged_into_person_id IS NULL
         AND sot.is_organization_name(display_name)) as orgs_as_people,

        -- Appointment linking
        (SELECT COUNT(*) FROM ops.appointments) as total_appointments,
        (SELECT COUNT(*) FROM ops.appointments WHERE person_id IS NOT NULL) as appointments_with_person,
        (SELECT COUNT(*) FROM ops.appointments WHERE trapper_person_id IS NOT NULL) as appointments_with_trapper,

        -- ClinicHQ export health (DATA_GAP_037)
        -- Uses ops.v_clinichq_export_health view created in MIG_2410
        (SELECT services_per_appt FROM ops.v_clinichq_export_health
         WHERE week >= CURRENT_DATE - INTERVAL '14 days'
         ORDER BY week DESC LIMIT 1) as export_services_per_appt,
        (SELECT health_status FROM ops.v_clinichq_export_health
         WHERE week >= CURRENT_DATE - INTERVAL '14 days'
         ORDER BY week DESC LIMIT 1) as export_health_status,
        (SELECT microchips FROM ops.v_clinichq_export_health
         WHERE week >= CURRENT_DATE - INTERVAL '14 days'
         ORDER BY week DESC LIMIT 1) as export_microchips,
        (SELECT ear_tips FROM ops.v_clinichq_export_health
         WHERE week >= CURRENT_DATE - INTERVAL '14 days'
         ORDER BY week DESC LIMIT 1) as export_ear_tips,

        -- Regression monitoring (FFS-141)
        (SELECT COUNT(*)::int FROM (
          SELECT normalized_address
          FROM sot.places
          WHERE merged_into_place_id IS NULL
            AND normalized_address IS NOT NULL
          GROUP BY normalized_address
          HAVING COUNT(*) > 1
        ) dupes) as duplicate_place_groups,
        (SELECT COUNT(*)::int FROM ops.clinic_day_entries
         WHERE matched_appointment_id IS NOT NULL
           AND appointment_id IS NULL) as unpropagated_matches,
        (SELECT COUNT(*)::int FROM ops.appointments a
         JOIN sot.places p ON p.place_id = a.inferred_place_id
         WHERE a.inferred_place_id IS NOT NULL
           AND a.owner_address IS NOT NULL
           AND p.normalized_address IS NOT NULL
           AND p.merged_into_place_id IS NULL
           AND sot.normalize_address(a.owner_address) != p.normalized_address
        ) as mislinked_appointments
    `);

    if (!metrics) {
      throw new Error("Failed to fetch data quality metrics");
    }

    // Fetch configurable thresholds from ops.app_config (FFS-640)
    const [
      catPlaceCoverageWarning,
      catPlaceCoverageCritical,
      pendingReviewsWarning,
      geocodingQueueWarning,
      invalidPeople24hWarning,
      orgsAsPeopleWarning,
      clinichqMinServicesPerAppt,
      mislinkedApptsWarning,
      duplicatePlacesWarning,
      unpropagatedMatchesWarning,
      slackEnabled,
      dedupHours,
    ] = await Promise.all([
      getServerConfig("dq.cat_place_coverage_warning_pct", 95),
      getServerConfig("dq.cat_place_coverage_critical_pct", 90),
      getServerConfig("dq.pending_reviews_warning", 100),
      getServerConfig("dq.geocoding_queue_warning", 100),
      getServerConfig("dq.invalid_people_24h_warning", 10),
      getServerConfig("dq.orgs_as_people_warning", 200),
      getServerConfig("dq.clinichq_export_min_services_per_appt", 8),
      getServerConfig("dq.mislinked_appointments_warning", 50),
      getServerConfig("dq.duplicate_places_warning", 0),
      getServerConfig("dq.unpropagated_matches_warning", 0),
      getServerConfig("alerts.slack_enabled", true),
      getServerConfig("alerts.dedup_hours", 6),
    ]);

    // Check thresholds and generate alerts
    const alerts: Alert[] = [];

    // Critical: Cats without places
    if (metrics.cat_place_coverage_pct < catPlaceCoverageWarning) {
      alerts.push({
        level: metrics.cat_place_coverage_pct < catPlaceCoverageCritical ? "critical" : "warning",
        metric: "cat_place_coverage",
        current: metrics.cat_place_coverage_pct,
        threshold: catPlaceCoverageWarning,
        message: `Cat-place coverage is ${metrics.cat_place_coverage_pct}% (target: ${catPlaceCoverageWarning}%+). ${metrics.total_cats - metrics.cats_with_places} cats need place links.`,
      });
    }

    // Warning: Pending reviews
    if (metrics.pending_reviews > pendingReviewsWarning) {
      alerts.push({
        level: metrics.pending_reviews > pendingReviewsWarning * 5 ? "critical" : "warning",
        metric: "pending_reviews",
        current: metrics.pending_reviews,
        threshold: pendingReviewsWarning,
        message: `${metrics.pending_reviews} identity matches pending human review.`,
      });
    }

    // Warning: Geocoding queue
    if (metrics.geocoding_queue > geocodingQueueWarning) {
      alerts.push({
        level: metrics.geocoding_queue > geocodingQueueWarning * 5 ? "critical" : "warning",
        metric: "geocoding_queue",
        current: metrics.geocoding_queue,
        threshold: geocodingQueueWarning,
        message: `${metrics.geocoding_queue} places waiting for geocoding.`,
      });
    }

    // Warning: Invalid people created in 24h
    if (metrics.invalid_people_24h > invalidPeople24hWarning) {
      alerts.push({
        level: metrics.invalid_people_24h > invalidPeople24hWarning * 5 ? "critical" : "warning",
        metric: "invalid_people_24h",
        current: metrics.invalid_people_24h,
        threshold: invalidPeople24hWarning,
        message: `${metrics.invalid_people_24h} invalid people created in last 24 hours. Check data ingestion.`,
      });
    }

    // Warning: Organizations as people
    if (metrics.orgs_as_people > orgsAsPeopleWarning) {
      alerts.push({
        level: "warning",
        metric: "orgs_as_people",
        current: metrics.orgs_as_people,
        threshold: orgsAsPeopleWarning,
        message: `${metrics.orgs_as_people} organizations stored as people. Run conversion.`,
      });
    }

    // Critical: ClinicHQ export broken (DATA_GAP_037)
    if (metrics.export_health_status === "CRITICAL") {
      alerts.push({
        level: "critical",
        metric: "clinichq_export_health",
        current: metrics.export_services_per_appt || 0,
        threshold: clinichqMinServicesPerAppt,
        message: `ClinicHQ export is BROKEN: ${metrics.export_services_per_appt} services/appt (expected ~10). Missing microchips: ${metrics.export_microchips === 0 ? "YES" : "no"}, ear tips: ${metrics.export_ear_tips || 0}. Check ClinicHQ export settings immediately.`,
      });
    }

    // Critical: Duplicate places (FFS-141)
    if (metrics.duplicate_place_groups > duplicatePlacesWarning) {
      alerts.push({
        level: "critical",
        metric: "duplicate_place_groups",
        current: metrics.duplicate_place_groups,
        threshold: duplicatePlacesWarning,
        message: `${metrics.duplicate_place_groups} normalized addresses have multiple active places. Unique index should prevent this — investigate.`,
      });
    }

    // Warning: Unpropagated matches (FFS-141)
    if (metrics.unpropagated_matches > unpropagatedMatchesWarning) {
      alerts.push({
        level: "warning",
        metric: "unpropagated_matches",
        current: metrics.unpropagated_matches,
        threshold: unpropagatedMatchesWarning,
        message: `${metrics.unpropagated_matches} clinic day entries matched but not propagated. Match propagation may not be running.`,
      });
    }

    // Warning: Mislinked appointments (FFS-141)
    if (metrics.mislinked_appointments > mislinkedApptsWarning) {
      alerts.push({
        level: metrics.mislinked_appointments > mislinkedApptsWarning * 4 ? "critical" : "warning",
        metric: "mislinked_appointments",
        current: metrics.mislinked_appointments,
        threshold: mislinkedApptsWarning,
        message: `${metrics.mislinked_appointments} appointments where owner_address doesn't match inferred place.`,
      });
    }

    const hasAlerts = alerts.length > 0;
    const hasCritical = alerts.some((a) => a.level === "critical");

    // Phase 1A: Write alerts to ops.alert_queue for persistence + notification
    let alertsQueued = 0;
    try {
      for (const alert of alerts) {
        await queryOne(
          `SELECT ops.write_alert($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            alert.level,
            "data_quality_check",
            alert.metric,
            alert.message,
            alert.current,
            alert.threshold,
            JSON.stringify({ checked_at: new Date().toISOString() }),
            dedupHours,
          ]
        );
        alertsQueued++;
      }
    } catch (alertError) {
      // Non-fatal — alert queue may not exist yet (pre-MIG_2999)
      console.warn("Alert queue write failed (MIG_2999 not applied?):", alertError instanceof Error ? alertError.message : "Unknown");
    }

    // Phase 1A: Send Slack notifications for pending alerts
    let slackSent = false;
    if (slackEnabled && hasAlerts) {
      try {
        // Get all pending alerts from queue (includes any from anomaly detection below)
        const pendingAlerts = await queryRows<{
          alert_id: string;
          level: string;
          metric: string;
          message: string;
          current_value: number | null;
          threshold_value: number | null;
        }>("SELECT * FROM ops.get_pending_slack_alerts()");

        if (pendingAlerts.length > 0) {
          slackSent = await sendSlackAlerts(
            pendingAlerts.map((a) => ({
              level: a.level as "warning" | "critical",
              metric: a.metric,
              message: a.message,
              current_value: a.current_value,
              threshold_value: a.threshold_value,
            }))
          );

          if (slackSent) {
            await queryOne(
              `SELECT ops.mark_alerts_slack_notified($1)`,
              [pendingAlerts.map((a) => a.alert_id)]
            );
          }
        }
      } catch (slackError) {
        // Non-fatal
        console.warn("Slack notification failed:", slackError instanceof Error ? slackError.message : "Unknown");
      }
    }

    // Take daily snapshot using MIG_2515 function (if available)
    let snapshotTaken = false;
    try {
      await query("SELECT ops.snapshot_data_quality_metrics()");
      snapshotTaken = true;
    } catch {
      // MIG_2515 may not be applied yet - ignore
    }

    // FFS-867: Run operational anomaly detection and store new anomalies
    let anomaliesDetected = 0;
    try {
      const anomalies = await queryRows<{
        anomaly_type: string;
        entity_type: string;
        entity_id: string;
        severity: string;
        description: string;
        evidence: Record<string, unknown>;
      }>("SELECT * FROM ops.detect_operational_anomalies()");

      for (const a of anomalies) {
        // Deduplicate: skip if same anomaly_type + entity_id already exists within 7 days
        const existing = await queryOne<{ anomaly_id: string }>(
          `SELECT anomaly_id FROM ops.tippy_anomaly_log
           WHERE anomaly_type = $1 AND entity_id = $2
             AND created_at > NOW() - INTERVAL '7 days'
           LIMIT 1`,
          [a.anomaly_type, a.entity_id]
        );
        if (!existing) {
          await execute(
            `INSERT INTO ops.tippy_anomaly_log
             (anomaly_id, anomaly_type, entity_type, entity_id, severity, description, evidence)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)`,
            [a.anomaly_type, a.entity_type, a.entity_id, a.severity, a.description, JSON.stringify(a.evidence)]
          );
          anomaliesDetected++;

          // Also write critical/high anomalies to alert queue
          if (a.severity === "critical" || a.severity === "high") {
            try {
              await queryOne(
                `SELECT ops.write_alert($1, $2, $3, $4, $5, $6, $7)`,
                [
                  a.severity === "critical" ? "critical" : "warning",
                  "anomaly_detection",
                  a.anomaly_type,
                  a.description,
                  null,
                  null,
                  JSON.stringify(a.evidence),
                ]
              );
            } catch {
              // Non-fatal
            }
          }
        }
      }
    } catch (error) {
      console.error("Operational anomaly detection failed:", error);
      // Non-fatal — don't block the cron response
    }

    return apiSuccess({
      status: hasCritical ? "critical" : hasAlerts ? "warning" : "healthy",
      checked_at: new Date().toISOString(),
      metrics: {
        cat_place_coverage_pct: metrics.cat_place_coverage_pct,
        cats_without_places: metrics.total_cats - metrics.cats_with_places,
        pending_reviews: metrics.pending_reviews,
        geocoding_queue: metrics.geocoding_queue,
        invalid_people_24h: metrics.invalid_people_24h,
        invalid_people_total: metrics.invalid_people,
        orgs_as_people: metrics.orgs_as_people,
        appointment_person_pct: Math.round(
          (100 * metrics.appointments_with_person) / metrics.total_appointments
        ),
        appointment_trapper_pct: Math.round(
          (100 * metrics.appointments_with_trapper) / metrics.total_appointments
        ),
        // ClinicHQ export health (DATA_GAP_037)
        export_services_per_appt: metrics.export_services_per_appt,
        export_health_status: metrics.export_health_status,
        export_microchips: metrics.export_microchips,
        export_ear_tips: metrics.export_ear_tips,
        // Regression monitoring (FFS-141)
        duplicate_place_groups: metrics.duplicate_place_groups,
        unpropagated_matches: metrics.unpropagated_matches,
        mislinked_appointments: metrics.mislinked_appointments,
      },
      alerts,
      alert_count: alerts.length,
      alerts_queued: alertsQueued,
      slack_notified: slackSent,
      anomalies_detected: anomaliesDetected,
      snapshot_taken: snapshotTaken,
      duration_ms: Date.now() - startTime,
    });
  } catch (error) {
    console.error("Data quality check error:", error);
    return apiServerError(error instanceof Error ? error.message : "Data quality check failed");
  }
}

// POST endpoint for manual triggers
export async function POST(request: NextRequest) {
  return GET(request);
}
