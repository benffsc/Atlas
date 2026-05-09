import { NextRequest } from "next/server";
import { queryRows } from "@/lib/db";
import { apiSuccess, apiError } from "@/lib/api-response";
import {
  buildScoreMatrix,
  solveAssignment,
  type CDSEntry,
  type CDSAppointment,
  type CDSWaiver,
  type CDSConfig,
} from "@/lib/cds-v3";

/**
 * CDS v3 Benchmark API — compare v3 against ground truth
 *
 * GET /api/admin/cds/v3-benchmark?date=2026-04-27   — single date (verbose)
 * GET /api/admin/cds/v3-benchmark?mode=canary       — 4 canary dates
 * GET /api/admin/cds/v3-benchmark?mode=all          — all ground truth dates
 */

export const maxDuration = 300;

const CANARY_DATES = ["2026-04-06", "2026-04-08", "2026-04-16", "2025-12-10"];

async function loadEntries(clinicDate: string): Promise<CDSEntry[]> {
  return queryRows<CDSEntry>(
    `SELECT e.entry_id, e.line_number, e.parsed_owner_name, e.parsed_cat_name,
            e.parsed_cat_color, COALESCE(e.female_count, 0) AS female_count,
            COALESCE(e.male_count, 0) AS male_count, e.weight_lbs,
            e.sx_end_time, COALESCE(e.is_foster, false) AS is_foster,
            COALESCE(e.is_recheck, false) AS is_recheck,
            e.notes, e.raw_client_name,
            NULL::uuid AS matched_appointment_id, NULL AS match_confidence,
            NULL AS cds_method, e.cancellation_reason
     FROM ops.clinic_day_entries e
     JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
     WHERE cd.clinic_date = $1
     ORDER BY e.line_number`,
    [clinicDate]
  );
}

async function loadAppointments(clinicDate: string): Promise<CDSAppointment[]> {
  return queryRows<CDSAppointment>(
    `SELECT a.appointment_id, a.appointment_number, a.client_name,
            oa.display_name AS account_owner_name,
            c.name AS cat_name, c.cat_id, c.sex AS cat_sex,
            COALESCE(cv.weight_lbs, c.weight_lbs) AS cat_weight,
            c.microchip, c.color AS cat_color, c.breed AS cat_breed,
            a.appointment_date::text, a.surgery_start_time::text,
            a.clinic_day_number,
            COALESCE(
              (SELECT array_agg(DISTINCT sl.name)
               FROM sot.cat_identifiers ci
               JOIN sot.cats sl ON sl.cat_id = ci.cat_id AND sl.merged_into_cat_id IS NULL
               WHERE ci.cat_id = a.cat_id AND sl.name != c.name AND sl.name IS NOT NULL
              ), ARRAY[]::text[]
            ) AS shelterluv_names
     FROM ops.appointments a
     LEFT JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
     LEFT JOIN ops.clinic_accounts oa ON oa.account_id = a.owner_account_id
     LEFT JOIN LATERAL (
       SELECT weight_lbs FROM ops.cat_vitals
       WHERE cat_id = a.cat_id ORDER BY recorded_at DESC LIMIT 1
     ) cv ON true
     WHERE a.appointment_date = $1
       AND a.merged_into_appointment_id IS NULL
     ORDER BY a.appointment_number NULLS LAST`,
    [clinicDate]
  );
}

async function loadWaivers(clinicDate: string): Promise<CDSWaiver[]> {
  return queryRows<CDSWaiver>(
    `SELECT waiver_id, parsed_last_name, parsed_last4_chip,
            parsed_date::text, matched_appointment_id,
            ocr_clinic_number, ocr_microchip, ocr_status,
            ocr_weight_lbs
     FROM ops.waiver_scans
     WHERE parsed_date = $1::date`,
    [clinicDate]
  );
}

async function benchmarkDate(clinicDate: string) {
  const groundTruth = await queryRows<{
    appointment_id: string;
    clinic_day_number: number;
    client_name: string;
  }>(
    `SELECT a.appointment_id, a.clinic_day_number, a.client_name
     FROM ops.appointments a
     WHERE a.appointment_date = $1
       AND a.merged_into_appointment_id IS NULL
       AND a.clinic_day_number IS NOT NULL
       AND a.manually_overridden_fields @> ARRAY['clinic_day_number']`,
    [clinicDate]
  );

  if (groundTruth.length === 0) return null;

  const entries = await loadEntries(clinicDate);
  const appointments = await loadAppointments(clinicDate);
  const waivers = await loadWaivers(clinicDate);

  const truthMap = new Map<number, string>();
  for (const gt of groundTruth) {
    truthMap.set(gt.clinic_day_number, gt.appointment_id);
  }

  const matchable = entries.filter((e) => e.cancellation_reason == null);

  const config: CDSConfig = {
    min_match_threshold: 0.25,
    min_cross_client_threshold: 0.30,
    weight_gap_min: 1.0,
    waiver_bridge_threshold: 0.90,
    llm_enabled: false,
    llm_max_calls: 0,
    llm_min_confidence: 0.70,
  };

  const matrix = buildScoreMatrix(matchable, appointments, waivers, entries);
  const assignments = solveAssignment(matrix, matchable, appointments, config);

  const v3Map = new Map<string, string>();
  for (const a of assignments) v3Map.set(a.entry_id, a.appointment_id);

  let agree = 0;
  let disagree = 0;
  let gtOnly = 0;
  const disagreements: unknown[] = [];

  for (const [lineNum, gtApptId] of truthMap) {
    const entry = matchable.find((e) => e.line_number === lineNum);
    if (!entry) { gtOnly++; continue; }

    const v3ApptId = v3Map.get(entry.entry_id);
    if (v3ApptId === gtApptId) {
      agree++;
    } else if (v3ApptId) {
      disagree++;
      const v3Pair = matrix.find(
        (p) => p.entry_id === entry.entry_id && p.appointment_id === v3ApptId
      );
      const gtPair = matrix.find(
        (p) => p.entry_id === entry.entry_id && p.appointment_id === gtApptId
      );
      disagreements.push({
        line: lineNum,
        owner: entry.parsed_owner_name,
        v3_score: v3Pair?.score ?? 0,
        gt_score: gtPair?.score ?? 0,
        v3_signals: v3Pair?.signals,
        gt_signals: gtPair?.signals,
      });
    } else {
      gtOnly++;
    }
  }

  return {
    date: clinicDate,
    ground_truth: groundTruth.length,
    agree,
    disagree,
    gt_only: gtOnly,
    accuracy: groundTruth.length > 0 ? +(agree / groundTruth.length * 100).toFixed(1) : 0,
    entries: entries.length,
    matchable: matchable.length,
    assigned: assignments.length,
    disagreements,
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const singleDate = searchParams.get("date");
  const mode = searchParams.get("mode") || "canary";

  let dates: string[];

  if (singleDate) {
    dates = [singleDate];
  } else if (mode === "canary") {
    dates = CANARY_DATES;
  } else {
    const rows = await queryRows<{ clinic_date: string }>(
      `SELECT DISTINCT a.appointment_date::text AS clinic_date
       FROM ops.appointments a
       WHERE a.manually_overridden_fields @> ARRAY['clinic_day_number']
         AND a.merged_into_appointment_id IS NULL
       ORDER BY clinic_date`
    );
    dates = rows.map((r) => r.clinic_date);
  }

  const results = [];
  for (const date of dates) {
    const r = await benchmarkDate(date);
    if (r) results.push(r);
  }

  const totalGT = results.reduce((s, r) => s + r.ground_truth, 0);
  const totalAgree = results.reduce((s, r) => s + r.agree, 0);
  const totalDisagree = results.reduce((s, r) => s + r.disagree, 0);
  const totalGTOnly = results.reduce((s, r) => s + r.gt_only, 0);

  return apiSuccess({
    summary: {
      dates: results.length,
      total_ground_truth: totalGT,
      total_agree: totalAgree,
      total_disagree: totalDisagree,
      total_gt_only: totalGTOnly,
      accuracy: totalGT > 0 ? +(totalAgree / totalGT * 100).toFixed(1) : 0,
    },
    results,
  });
}
