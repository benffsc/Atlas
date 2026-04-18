import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { getSession } from "@/lib/auth";
import {
  apiSuccess,
  apiBadRequest,
  apiUnauthorized,
  apiServerError,
} from "@/lib/api-response";
import { getLatestCDSRun } from "@/lib/cds";
import { loadCancelledEntries } from "@/lib/cds-metrics";

interface RouteParams {
  params: Promise<{ date: string }>;
}

/**
 * GET /api/admin/clinic-days/[date]/status
 *
 * Returns data completeness for a clinic day — what's present vs missing.
 * Powers the Clinic Day Hub status dashboard.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession(request);
    if (!session) {
      return apiUnauthorized();
    }

    const { date } = await params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return apiBadRequest("Invalid date format. Use YYYY-MM-DD.");
    }

    // Gather all data lanes in parallel
    const [masterList, clinichq, photos, waivers, matching, groundTruth] = await Promise.all([
      // Master list entries
      queryOne<{
        has_entries: boolean;
        entry_count: number;
        with_weight: number;
        with_cat_name: number;
        with_trapper: number;
        clinic_day_id: string | null;
      }>(
        `SELECT
           EXISTS(SELECT 1 FROM ops.clinic_day_entries e
                  JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
                  WHERE cd.clinic_date = $1) AS has_entries,
           COALESCE((SELECT COUNT(*)::int FROM ops.clinic_day_entries e
                     JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
                     WHERE cd.clinic_date = $1), 0) AS entry_count,
           COALESCE((SELECT COUNT(*)::int FROM ops.clinic_day_entries e
                     JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
                     WHERE cd.clinic_date = $1 AND e.weight_lbs IS NOT NULL), 0) AS with_weight,
           COALESCE((SELECT COUNT(*)::int FROM ops.clinic_day_entries e
                     JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
                     WHERE cd.clinic_date = $1 AND e.parsed_cat_name IS NOT NULL), 0) AS with_cat_name,
           COALESCE((SELECT COUNT(*)::int FROM ops.clinic_day_entries e
                     JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
                     WHERE cd.clinic_date = $1 AND e.trapper_person_id IS NOT NULL), 0) AS with_trapper,
           (SELECT cd.clinic_day_id FROM ops.clinic_days cd WHERE cd.clinic_date = $1) AS clinic_day_id`,
        [date]
      ),

      // ClinicHQ appointments
      queryOne<{
        has_appointments: boolean;
        appointment_count: number;
        with_cat: number;
        with_microchip: number;
        with_owner: number;
      }>(
        `SELECT
           EXISTS(SELECT 1 FROM ops.appointments WHERE appointment_date = $1
                  AND merged_into_appointment_id IS NULL) AS has_appointments,
           COALESCE((SELECT COUNT(*)::int FROM ops.appointments
                     WHERE appointment_date = $1 AND merged_into_appointment_id IS NULL), 0) AS appointment_count,
           COALESCE((SELECT COUNT(*)::int FROM ops.appointments
                     WHERE appointment_date = $1 AND cat_id IS NOT NULL
                     AND merged_into_appointment_id IS NULL), 0) AS with_cat,
           COALESCE((SELECT COUNT(*)::int FROM ops.appointments a
                     JOIN sot.cat_identifiers ci ON ci.cat_id = a.cat_id AND ci.id_type = 'microchip'
                     WHERE a.appointment_date = $1 AND a.merged_into_appointment_id IS NULL), 0) AS with_microchip,
           COALESCE((SELECT COUNT(*)::int FROM ops.appointments
                     WHERE appointment_date = $1 AND person_id IS NOT NULL
                     AND merged_into_appointment_id IS NULL), 0) AS with_owner`,
        [date]
      ),

      // Photos linked to cats from this day
      queryOne<{
        photo_count: number;
        cats_with_photos: number;
      }>(
        `SELECT
           COALESCE((
             SELECT COUNT(DISTINCT rm.media_id)::int
             FROM ops.request_media rm
             JOIN ops.appointments a ON a.cat_id = rm.cat_id
             WHERE a.appointment_date = $1
               AND a.merged_into_appointment_id IS NULL
               AND rm.media_type = 'cat_photo'
           ), 0) AS photo_count,
           COALESCE((
             SELECT COUNT(DISTINCT rm.cat_id)::int
             FROM ops.request_media rm
             JOIN ops.appointments a ON a.cat_id = rm.cat_id
             WHERE a.appointment_date = $1
               AND a.merged_into_appointment_id IS NULL
               AND rm.media_type = 'cat_photo'
           ), 0) AS cats_with_photos`,
        [date]
      ),

      // Waiver scans
      queryOne<{
        waiver_count: number;
        matched_waivers: number;
      }>(
        `SELECT
           COALESCE((SELECT COUNT(*)::int FROM ops.waiver_scans
                     WHERE parsed_date = $1), 0) AS waiver_count,
           COALESCE((SELECT COUNT(*)::int FROM ops.waiver_scans
                     WHERE parsed_date = $1 AND matched_appointment_id IS NOT NULL), 0) AS matched_waivers`,
        [date]
      ),

      // Matching coverage
      queryOne<{
        matched_high: number;
        matched_medium: number;
        matched_low: number;
        matched_manual: number;
        unmatched: number;
      }>(
        `SELECT
           COALESCE(COUNT(*) FILTER (WHERE e.match_confidence = 'high'), 0)::int AS matched_high,
           COALESCE(COUNT(*) FILTER (WHERE e.match_confidence = 'medium'), 0)::int AS matched_medium,
           COALESCE(COUNT(*) FILTER (WHERE e.match_confidence = 'low'), 0)::int AS matched_low,
           COALESCE(COUNT(*) FILTER (WHERE e.match_confidence = 'manual'), 0)::int AS matched_manual,
           COALESCE(COUNT(*) FILTER (WHERE e.match_confidence IS NULL OR e.match_confidence = 'unmatched'), 0)::int AS unmatched
         FROM ops.clinic_day_entries e
         JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
         WHERE cd.clinic_date = $1`,
        [date]
      ),

      // Ground truth: how many ClinicHQ appointments are matched vs orphaned
      queryOne<{
        appointments_matched: number;
        orphaned_appointments: number;
      }>(
        `SELECT
           COALESCE((
             SELECT COUNT(DISTINCT e.matched_appointment_id)::int
             FROM ops.clinic_day_entries e
             JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
             WHERE cd.clinic_date = $1 AND e.matched_appointment_id IS NOT NULL
           ), 0) AS appointments_matched,
           COALESCE((
             SELECT COUNT(*)::int FROM ops.appointments a
             WHERE a.appointment_date = $1
               AND a.merged_into_appointment_id IS NULL
               AND NOT EXISTS (
                 SELECT 1 FROM ops.clinic_day_entries e
                 JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
                 WHERE cd.clinic_date = $1 AND e.matched_appointment_id = a.appointment_id
               )
           ), 0) AS orphaned_appointments`,
        [date]
      ),
    ]);

    const entryCount = masterList?.entry_count ?? 0;
    const apptCount = clinichq?.appointment_count ?? 0;
    const matchedTotal =
      (matching?.matched_high ?? 0) +
      (matching?.matched_medium ?? 0) +
      (matching?.matched_low ?? 0) +
      (matching?.matched_manual ?? 0);

    // CDS run info + method breakdown + pending suggestions + cancelled entries
    const [cdsRun, cdsMethods, cdsSuggestions, cancelledEntries] = await Promise.all([
      getLatestCDSRun(date),
      queryOne<{
        sql_owner_name: number;
        sql_cat_name: number;
        sql_sex: number;
        sql_cardinality: number;
        waiver_bridge: number;
        weight_disambiguation: number;
        composite: number;
        constraint_propagation: number;
        cds_suggestion: number;
        manual: number;
      }>(
        `SELECT
           COUNT(*) FILTER (WHERE e.cds_method = 'sql_owner_name')::int AS sql_owner_name,
           COUNT(*) FILTER (WHERE e.cds_method = 'sql_cat_name')::int AS sql_cat_name,
           COUNT(*) FILTER (WHERE e.cds_method = 'sql_sex')::int AS sql_sex,
           COUNT(*) FILTER (WHERE e.cds_method = 'sql_cardinality')::int AS sql_cardinality,
           COUNT(*) FILTER (WHERE e.cds_method = 'waiver_bridge')::int AS waiver_bridge,
           COUNT(*) FILTER (WHERE e.cds_method = 'weight_disambiguation')::int AS weight_disambiguation,
           COUNT(*) FILTER (WHERE e.cds_method = 'composite')::int AS composite,
           COUNT(*) FILTER (WHERE e.cds_method = 'constraint_propagation')::int AS constraint_propagation,
           COUNT(*) FILTER (WHERE e.cds_method = 'cds_suggestion')::int AS cds_suggestion,
           COUNT(*) FILTER (WHERE e.cds_method = 'manual')::int AS manual
         FROM ops.clinic_day_entries e
         JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
         WHERE cd.clinic_date = $1
           AND e.matched_appointment_id IS NOT NULL`,
        [date]
      ),
      queryOne<{ count: number }>(
        `SELECT COUNT(*)::int AS count
         FROM ops.clinic_day_entries e
         JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
         WHERE cd.clinic_date = $1
           AND e.cds_method = 'cds_suggestion'`,
        [date]
      ),
      loadCancelledEntries(date),
    ]);

    return apiSuccess({
      date,
      clinic_day_id: masterList?.clinic_day_id ?? null,
      master_list: {
        status: masterList?.has_entries ? "imported" : "missing",
        entry_count: entryCount,
        with_weight: masterList?.with_weight ?? 0,
        with_cat_name: masterList?.with_cat_name ?? 0,
        with_trapper: masterList?.with_trapper ?? 0,
      },
      clinichq: {
        status: clinichq?.has_appointments ? "available" : "pending",
        appointment_count: apptCount,
        with_cat: clinichq?.with_cat ?? 0,
        with_microchip: clinichq?.with_microchip ?? 0,
        with_owner: clinichq?.with_owner ?? 0,
      },
      photos: {
        count: photos?.photo_count ?? 0,
        cats_with_photos: photos?.cats_with_photos ?? 0,
      },
      waivers: {
        count: waivers?.waiver_count ?? 0,
        matched: waivers?.matched_waivers ?? 0,
      },
      matching: {
        total_entries: entryCount,
        matched: matchedTotal,
        unmatched: matching?.unmatched ?? 0,
        by_confidence: {
          high: matching?.matched_high ?? 0,
          medium: matching?.matched_medium ?? 0,
          low: matching?.matched_low ?? 0,
          manual: matching?.matched_manual ?? 0,
        },
        coverage_pct: entryCount > 0
          ? Math.round((matchedTotal / entryCount) * 100)
          : 0,
      },
      // Overall readiness
      readiness: {
        has_master_list: masterList?.has_entries ?? false,
        has_clinichq: clinichq?.has_appointments ?? false,
        has_photos: (photos?.photo_count ?? 0) > 0,
        has_waivers: (waivers?.waiver_count ?? 0) > 0,
        can_rematch: (masterList?.has_entries ?? false) && (clinichq?.has_appointments ?? false),
      },
      // Ground truth: master list is the physical record
      ground_truth: {
        master_list_is_authority: entryCount > 0,
        authoritative_count: entryCount,
        appointments_matched: groundTruth?.appointments_matched ?? 0,
        orphaned_appointments: groundTruth?.orphaned_appointments ?? 0,
        discrepancy: apptCount - entryCount,
        likely_duplicates: apptCount > entryCount && entryCount > 0,
      },
      // CDS (Cat Determining System) pipeline status
      cds: {
        latest_run: cdsRun
          ? {
              run_id: cdsRun.run_id,
              triggered_by: cdsRun.triggered_by,
              started_at: cdsRun.started_at,
              completed_at: cdsRun.completed_at,
              matched_before: cdsRun.matched_before,
              matched_after: cdsRun.matched_after,
              has_waivers: cdsRun.has_waivers,
              has_weights: cdsRun.has_weights,
            }
          : null,
        pending_suggestions: cdsSuggestions?.count ?? 0,
        method_breakdown: cdsMethods ?? {},
        cancelled_entries: cancelledEntries,
      },
    });
  } catch (error) {
    console.error("Clinic day status error:", error);
    return apiServerError("Failed to fetch clinic day status");
  }
}
