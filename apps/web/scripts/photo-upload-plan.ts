#!/usr/bin/env npx tsx
/**
 * Photo Upload Plan Generator
 *
 * Scans a folder of clinic day photos + looks up the master list for that
 * date and writes a human-editable JSON plan.
 *
 * The plan is a list of clinic lines, each with:
 *   - line_number, cat_name, owner, cat_id (resolved via ground-truth-first)
 *   - Ben's manual clinic_day_number when available (legacy_v1 source)
 *   - fallback to CDS-derived (master_list source) for single-cat clients
 *   - flagged as ambiguous for multi-cat clients
 *   - a default sequential assignment of photo files (length-based slice)
 *
 * Ben edits the plan.json to correct any assignments, then runs
 * photo-upload-execute.ts on it.
 *
 * Usage:
 *   set -a && source .env.production.local && set +a
 *   npx tsx scripts/photo-upload-plan.ts "/path/to/folder" 2026-04-01 [plan.json]
 */
export {};

import { queryRows } from "@/lib/db";
import * as fs from "fs";
import * as path from "path";

interface MasterLine {
  line_number: number;
  entry_id: string;
  appointment_id: string | null;
  cat_id: string | null;
  cat_name: string | null;
  owner_name: string | null;
  parsed_owner_name: string | null;
  parsed_cat_name: string | null;
  microchip_last4: string | null;
  clinic_day_number_source: string | null;
  waiver_scan_id: string | null;
  ambiguity_flag: string | null;
}

interface PlanEntry extends MasterLine {
  assigned_files: string[];
}

interface Plan {
  date: string;
  folder: string;
  photo_files: string[];
  total_photos: number;
  lines: PlanEntry[];
  unassigned_files: string[];
  warnings: string[];
}

async function main() {
  const [folderArg, dateArg, planPathArg] = process.argv.slice(2);
  if (!folderArg || !dateArg) {
    console.error("Usage: photo-upload-plan.ts <folder> <YYYY-MM-DD> [plan.json]");
    process.exit(1);
  }

  const folder = path.resolve(folderArg);
  const date = dateArg;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error("Invalid date format — use YYYY-MM-DD");
    process.exit(1);
  }

  const planPath = planPathArg || `plan_${date}.json`;

  // Scan folder for image files, sort by filename (iPhone IMG_NNNN order)
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    console.error(`Not a directory: ${folder}`);
    process.exit(1);
  }
  const files = fs.readdirSync(folder)
    .filter((f) => /\.(jpe?g|png|heic|webp|tiff?)$/i.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  console.log(`Folder: ${folder}`);
  console.log(`Date:   ${date}`);
  console.log(`Photos: ${files.length}`);

  // Fetch master list lines for the date, ground-truth-first.
  // Priority for resolving the appointment/cat:
  //   1. ops.appointments.clinic_day_number directly matches e.line_number
  //      AND source = 'legacy_v1' (Ben's manual work, reliable)
  //   2. Otherwise fall back to e.appointment_id (CDS-derived cache)
  const lines = await queryRows<MasterLine>(
    `
    WITH ml AS (
      SELECT e.entry_id, e.line_number, e.parsed_owner_name, e.parsed_cat_name
      FROM ops.clinic_day_entries e
      JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
      WHERE cd.clinic_date = $1::DATE
      ORDER BY e.line_number
    ),
    appts_on_date AS (
      SELECT a.appointment_id, a.cat_id, a.client_name, a.clinic_day_number, a.clinic_day_number_source
      FROM ops.appointments a
      WHERE a.appointment_date = $1::DATE
        AND a.merged_into_appointment_id IS NULL
    ),
    -- Multi-cat client flag: more than one appointment with same clinic_day_number source
    multi_cat_clients AS (
      SELECT lower(trim(client_name)) AS key
      FROM appts_on_date
      WHERE client_name IS NOT NULL
      GROUP BY 1
      HAVING COUNT(*) > 1
    )
    SELECT
      ml.line_number,
      ml.entry_id::text,
      -- Ground-truth-first: appointment whose clinic_day_number = this line AND source=legacy_v1
      COALESCE(
        (SELECT a.appointment_id::text FROM appts_on_date a
         WHERE a.clinic_day_number = ml.line_number AND a.clinic_day_number_source = 'legacy_v1' LIMIT 1),
        -- Fallback to CDS-derived
        (SELECT a.appointment_id::text FROM appts_on_date a
         WHERE a.clinic_day_number = ml.line_number LIMIT 1),
        -- Last resort: via clinic_day_entries.appointment_id
        (SELECT e2.appointment_id::text FROM ops.clinic_day_entries e2 WHERE e2.entry_id = ml.entry_id)
      ) AS appointment_id,
      (SELECT a.cat_id::text FROM appts_on_date a
       WHERE a.clinic_day_number = ml.line_number
       ORDER BY (a.clinic_day_number_source = 'legacy_v1') DESC
       LIMIT 1) AS cat_id,
      (SELECT c.name FROM sot.cats c
       WHERE c.cat_id = (SELECT a.cat_id FROM appts_on_date a
                         WHERE a.clinic_day_number = ml.line_number
                         ORDER BY (a.clinic_day_number_source = 'legacy_v1') DESC
                         LIMIT 1)) AS cat_name,
      (SELECT a.client_name FROM appts_on_date a
       WHERE a.clinic_day_number = ml.line_number LIMIT 1) AS owner_name,
      ml.parsed_owner_name,
      ml.parsed_cat_name,
      (SELECT RIGHT(ci.id_value, 4) FROM sot.cat_identifiers ci
       WHERE ci.cat_id = (SELECT a.cat_id FROM appts_on_date a
                          WHERE a.clinic_day_number = ml.line_number
                          ORDER BY (a.clinic_day_number_source = 'legacy_v1') DESC
                          LIMIT 1)
         AND ci.id_type = 'microchip' LIMIT 1) AS microchip_last4,
      (SELECT a.clinic_day_number_source FROM appts_on_date a
       WHERE a.clinic_day_number = ml.line_number LIMIT 1) AS clinic_day_number_source,
      (SELECT w.waiver_id::text FROM ops.waiver_scans w
       WHERE w.parsed_date = $1::DATE
         AND w.matched_appointment_id = (
           SELECT a.appointment_id FROM appts_on_date a
           WHERE a.clinic_day_number = ml.line_number
           ORDER BY (a.clinic_day_number_source = 'legacy_v1') DESC
           LIMIT 1)
       LIMIT 1) AS waiver_scan_id,
      CASE
        WHEN (SELECT COUNT(*) FROM appts_on_date a WHERE a.clinic_day_number = ml.line_number) > 1
          THEN 'duplicate_appointment_at_line'
        WHEN (SELECT lower(trim(a.client_name)) FROM appts_on_date a
              WHERE a.clinic_day_number = ml.line_number LIMIT 1) IN (SELECT key FROM multi_cat_clients)
          THEN 'multi_cat_client'
        WHEN (SELECT COUNT(*) FROM appts_on_date a WHERE a.clinic_day_number = ml.line_number) = 0
          THEN 'no_appointment_at_line'
        ELSE NULL
      END AS ambiguity_flag
    FROM ml
    ORDER BY ml.line_number
    `,
    [date]
  );

  console.log(`Lines:  ${lines.length}`);

  if (lines.length === 0) {
    console.error(`\nERROR: No master list entries for ${date}. Import master list first.`);
    process.exit(1);
  }

  // Default assignment: slice photos sequentially across lines.
  // Simple floor(total/lines) per line + remainder to last line.
  const photosPerLine = Math.floor(files.length / lines.length);
  const remainder = files.length % lines.length;
  const warnings: string[] = [];

  const planLines: PlanEntry[] = [];
  let fileIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    const count = photosPerLine + (i < remainder ? 1 : 0);
    const assigned = files.slice(fileIdx, fileIdx + count);
    fileIdx += count;
    planLines.push({ ...lines[i], assigned_files: assigned });

    if (lines[i].ambiguity_flag) {
      warnings.push(`Line ${lines[i].line_number}: ${lines[i].ambiguity_flag} (${lines[i].owner_name || lines[i].parsed_owner_name || "?"})`);
    }
    if (!lines[i].cat_id) {
      warnings.push(`Line ${lines[i].line_number}: no cat_id resolved — photos will upload unlinked`);
    }
  }

  const plan: Plan = {
    date,
    folder,
    photo_files: files,
    total_photos: files.length,
    lines: planLines,
    unassigned_files: files.slice(fileIdx),
    warnings,
  };

  fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));

  console.log(`\nPlan written to: ${planPath}`);
  console.log(`\n── Summary ──`);
  console.log(`  Photos assigned: ${fileIdx} of ${files.length}`);
  console.log(`  Lines with cat_id: ${planLines.filter(l => l.cat_id).length} / ${planLines.length}`);
  console.log(`  Lines with Ben's manual number: ${planLines.filter(l => l.clinic_day_number_source === 'legacy_v1').length}`);
  console.log(`  Lines with matching waiver scan: ${planLines.filter(l => l.waiver_scan_id).length}`);
  if (warnings.length > 0) {
    console.log(`\n── Warnings (${warnings.length}) ──`);
    warnings.slice(0, 20).forEach(w => console.log(`  ⚠ ${w}`));
    if (warnings.length > 20) console.log(`  ... (${warnings.length - 20} more)`);
  }
  console.log(`\nNext step: review ${planPath}, adjust assigned_files per line, then:`);
  console.log(`  npx tsx scripts/photo-upload-execute.ts ${planPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
