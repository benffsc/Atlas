/**
 * CDS v3 Benchmark — compare v3 output against ground truth (manual CDN assignments)
 *
 * Usage:
 *   npx tsx scripts/cds-v3-benchmark.ts                    # All ground truth dates
 *   npx tsx scripts/cds-v3-benchmark.ts 2026-04-27         # Single date (verbose)
 *   npx tsx scripts/cds-v3-benchmark.ts --canary            # 4 canary dates
 *
 * This is READ-ONLY — it doesn't write any matches. It simulates the v3 pipeline
 * and compares assignments against ground truth.
 */

import * as dotenv from "dotenv";
dotenv.config({ path: "apps/web/.env.local" });

import { queryRows, queryOne } from "../apps/web/src/lib/db";
import {
  buildScoreMatrix,
  solveAssignment,
  SIGNAL_WEIGHTS,
  type CDSEntry,
  type CDSAppointment,
  type CDSWaiver,
  type CDSConfig,
} from "../apps/web/src/lib/cds-v3";

const CANARY_DATES = ["2026-04-06", "2026-04-08", "2026-04-16", "2025-12-10"];

async function loadGroundTruth(clinicDate: string) {
  return queryRows<{
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
}

async function loadEntries(clinicDate: string): Promise<CDSEntry[]> {
  return queryRows<CDSEntry>(
    `SELECT e.entry_id, e.line_number, e.parsed_owner_name, e.parsed_cat_name,
            e.parsed_cat_color, COALESCE(e.female_count, 0) AS female_count,
            COALESCE(e.male_count, 0) AS male_count, e.weight_lbs,
            e.sx_end_time, COALESCE(e.is_foster, false) AS is_foster,
            COALESCE(e.is_recheck, false) AS is_recheck,
            e.notes, e.raw_client_name,
            NULL AS matched_appointment_id, NULL AS match_confidence,
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

async function benchmarkDate(clinicDate: string, verbose: boolean) {
  const groundTruth = await loadGroundTruth(clinicDate);
  if (groundTruth.length === 0) {
    if (verbose) console.log(`  ${clinicDate}: No ground truth — skipping`);
    return null;
  }

  const entries = await loadEntries(clinicDate);
  const appointments = await loadAppointments(clinicDate);
  const waivers = await loadWaivers(clinicDate);

  // Build ground truth map: line_number → appointment_id
  const truthMap = new Map<number, string>();
  for (const gt of groundTruth) {
    truthMap.set(gt.clinic_day_number, gt.appointment_id);
  }

  // Simulate v3: exclude cancelled, build matrix, solve
  const cancelled = entries.filter((e) => e.cancellation_reason != null);
  const matchable = entries.filter(
    (e) => e.cancellation_reason == null
  );

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

  // Build v3 map: line_number → appointment_id
  const v3Map = new Map<string, string>(); // entry_id → appt_id
  for (const a of assignments) {
    v3Map.set(a.entry_id, a.appointment_id);
  }

  // Compare against ground truth
  let agree = 0;
  let disagree = 0;
  let gtOnly = 0;
  let v3Only = 0;
  const disagreements: Array<{
    line: number;
    gt_appt: string;
    v3_appt: string | null;
    gt_client: string;
    v3_score: number;
  }> = [];

  for (const [lineNum, gtApptId] of truthMap) {
    const entry = matchable.find((e) => e.line_number === lineNum);
    if (!entry) {
      // Entry is cancelled — ground truth exists but entry excluded
      gtOnly++;
      continue;
    }

    const v3ApptId = v3Map.get(entry.entry_id);
    if (v3ApptId === gtApptId) {
      agree++;
    } else if (v3ApptId) {
      disagree++;
      const gtAppt = groundTruth.find((g) => g.clinic_day_number === lineNum);
      const v3Pair = matrix.find(
        (p) => p.entry_id === entry.entry_id && p.appointment_id === v3ApptId
      );
      disagreements.push({
        line: lineNum,
        gt_appt: gtApptId,
        v3_appt: v3ApptId,
        gt_client: gtAppt?.client_name || "?",
        v3_score: v3Pair?.score ?? 0,
      });
    } else {
      gtOnly++;
    }
  }

  // V3-only: entries matched by v3 but not in ground truth
  for (const a of assignments) {
    const entry = matchable.find((e) => e.entry_id === a.entry_id);
    if (entry && !truthMap.has(entry.line_number)) {
      v3Only++;
    }
  }

  const accuracy =
    groundTruth.length > 0
      ? ((agree / groundTruth.length) * 100).toFixed(1)
      : "N/A";

  if (verbose) {
    console.log(
      `\n  ${clinicDate}: ${agree}/${groundTruth.length} agree (${accuracy}%) | ${disagree} disagree | ${gtOnly} gt-only | ${v3Only} v3-only | ${cancelled.length} cancelled | ${matchable.length} matchable → ${assignments.length} assigned`
    );
    for (const d of disagreements) {
      console.log(
        `    DISAGREE #${d.line}: GT=${d.gt_appt.slice(0, 8)} V3=${(d.v3_appt || "none").slice(0, 8)} (score=${d.v3_score.toFixed(3)}) gt_client="${d.gt_client}"`
      );
    }

    // Show unassigned entries
    const unassigned = matchable.filter(
      (e) => !v3Map.has(e.entry_id) && truthMap.has(e.line_number)
    );
    for (const u of unassigned) {
      const bestPair = matrix
        .filter((p) => p.entry_id === u.entry_id)
        .sort((a, b) => b.score - a.score)[0];
      console.log(
        `    UNASSIGNED #${u.line_number}: "${u.parsed_owner_name}" best_score=${bestPair?.score.toFixed(3) ?? "none"}`
      );
    }
  }

  return {
    date: clinicDate,
    ground_truth: groundTruth.length,
    agree,
    disagree,
    gt_only: gtOnly,
    v3_only: v3Only,
    accuracy: parseFloat(accuracy),
    entries: entries.length,
    matched: assignments.length,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const isCanary = args.includes("--canary");
  const singleDate = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));

  let dates: string[];
  let verbose: boolean;

  if (singleDate) {
    dates = [singleDate];
    verbose = true;
  } else if (isCanary) {
    dates = CANARY_DATES;
    verbose = true;
  } else {
    // All ground truth dates
    const rows = await queryRows<{ clinic_date: string }>(
      `SELECT DISTINCT a.appointment_date::text AS clinic_date
       FROM ops.appointments a
       WHERE a.manually_overridden_fields @> ARRAY['clinic_day_number']
         AND a.merged_into_appointment_id IS NULL
       ORDER BY clinic_date`
    );
    dates = rows.map((r) => r.clinic_date);
    verbose = false;
  }

  console.log(`CDS v3 Benchmark — ${dates.length} dates`);
  console.log("=".repeat(60));

  const results = [];
  for (const date of dates) {
    const r = await benchmarkDate(date, verbose);
    if (r) results.push(r);
  }

  // Summary
  const totalGT = results.reduce((s, r) => s + r.ground_truth, 0);
  const totalAgree = results.reduce((s, r) => s + r.agree, 0);
  const totalDisagree = results.reduce((s, r) => s + r.disagree, 0);
  const totalGTOnly = results.reduce((s, r) => s + r.gt_only, 0);

  console.log("\n" + "=".repeat(60));
  console.log(
    `TOTAL: ${totalAgree}/${totalGT} agree (${((totalAgree / totalGT) * 100).toFixed(1)}%) | ${totalDisagree} disagree | ${totalGTOnly} gt-only`
  );

  if (!verbose) {
    // Show per-date summary
    for (const r of results) {
      const status =
        r.disagree === 0 && r.gt_only === 0
          ? "✓"
          : r.disagree > 0
            ? "✗"
            : "△";
      console.log(
        `  ${status} ${r.date}: ${r.agree}/${r.ground_truth} (${r.accuracy}%) ${r.disagree > 0 ? `${r.disagree} disagree` : ""} ${r.gt_only > 0 ? `${r.gt_only} gt-only` : ""}`
      );
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
