/**
 * CDS v3 benchmark as a vitest test — verifies ground truth accuracy.
 * Run: npx vitest run src/__tests__/lib/cds-v3-benchmark.test.ts
 */
import { describe, it, expect } from "vitest";
import { queryRows } from "@/lib/db";
import {
  buildScoreMatrix,
  solveAssignment,
  type CDSEntry,
  type CDSAppointment,
  type CDSWaiver,
  type CDSConfig,
} from "@/lib/cds-v3";

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

describe("CDS v3 benchmark", () => {
  it("matches all ground truth entries", async () => {
    const dates = await queryRows<{ clinic_date: string }>(
      `SELECT DISTINCT a.appointment_date::text AS clinic_date
       FROM ops.appointments a
       WHERE a.manually_overridden_fields @> ARRAY['clinic_day_number']
         AND a.merged_into_appointment_id IS NULL
       ORDER BY clinic_date`
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

    let totalGT = 0;
    let totalAgree = 0;
    let totalDisagree = 0;
    const allDisagreements: Array<{ date: string; line: number; owner: string | null }> = [];

    for (const { clinic_date } of dates) {
      const groundTruth = await queryRows<{
        appointment_id: string;
        clinic_day_number: number;
      }>(
        `SELECT a.appointment_id, a.clinic_day_number
         FROM ops.appointments a
         WHERE a.appointment_date = $1
           AND a.merged_into_appointment_id IS NULL
           AND a.clinic_day_number IS NOT NULL
           AND a.manually_overridden_fields @> ARRAY['clinic_day_number']`,
        [clinic_date]
      );

      if (groundTruth.length === 0) continue;

      const entries = await loadEntries(clinic_date);
      const appointments = await loadAppointments(clinic_date);
      const waivers = await loadWaivers(clinic_date);

      const truthMap = new Map<number, string>();
      for (const gt of groundTruth) truthMap.set(gt.clinic_day_number, gt.appointment_id);

      const matchable = entries.filter((e) => e.cancellation_reason == null);
      const matrix = buildScoreMatrix(matchable, appointments, waivers, entries);
      const assignments = solveAssignment(matrix, matchable, appointments, config);

      const v3Map = new Map<string, string>();
      for (const a of assignments) v3Map.set(a.entry_id, a.appointment_id);

      for (const [lineNum, gtApptId] of truthMap) {
        totalGT++;
        const entry = matchable.find((e) => e.line_number === lineNum);
        if (!entry) continue;

        const v3ApptId = v3Map.get(entry.entry_id);
        if (v3ApptId === gtApptId) {
          totalAgree++;
        } else {
          totalDisagree++;
          allDisagreements.push({ date: clinic_date, line: lineNum, owner: entry.parsed_owner_name });
        }
      }
    }

    const gtOnly = totalGT - totalAgree - totalDisagree;
    console.log(`\nBenchmark: ${totalAgree}/${totalGT} agree, ${totalDisagree} disagree, ${gtOnly} gt-only (cancelled/missing entries)`);
    if (allDisagreements.length > 0) {
      console.log("Disagreements:", JSON.stringify(allDisagreements, null, 2));
    }

    // Zero disagreements = perfect accuracy on all matchable entries
    // gt-only entries are cancelled/classified entries not in matchable set
    expect(totalDisagree).toBe(0);
  }, 120000);
});
