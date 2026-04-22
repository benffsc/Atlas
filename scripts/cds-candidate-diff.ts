#!/usr/bin/env npx tsx
/**
 * CDS Candidate Diff — Read-only comparison of new CDN candidate system
 * vs. current DB state and ground truth.
 *
 * ZERO WRITES. This script only reads from the database.
 *
 * Usage:
 *   npx tsx scripts/cds-candidate-diff.ts 2026-04-06        # Single date
 *   npx tsx scripts/cds-candidate-diff.ts --canary           # 4 canary dates
 *   npx tsx scripts/cds-candidate-diff.ts --all              # All ground truth dates
 */

import pg from "pg";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── DB connection ──────────────────────────────────────────────────────

const envPath = resolve(__dirname, "../apps/web/.env.local");
let dbUrl: string;
try {
  const envContent = readFileSync(envPath, "utf-8");
  dbUrl =
    envContent.match(/^DATABASE_URL='([^']+)'/m)?.[1] ??
    envContent.match(/^DATABASE_URL="([^"]+)"/m)?.[1] ??
    envContent.match(/^DATABASE_URL=(.+)$/m)?.[1] ??
    "";
} catch {
  console.error("Could not read apps/web/.env.local");
  process.exit(1);
}

if (!dbUrl) {
  console.error("DATABASE_URL not found in apps/web/.env.local");
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
});

// ── Types ──────────────────────────────────────────────────────────────

interface CDNCandidate {
  appointment_id: string;
  cdn: number;
  source: "waiver_chip" | "waiver_weight";
  waiver_id: string;
  confidence: number;
}

interface CurrentCDN {
  appointment_id: string;
  clinic_day_number: number;
  client_name: string | null;
  cat_name: string | null;
  source: string | null;
  is_manual: boolean;
}

interface MLEntry {
  entry_id: string;
  line_number: number;
  parsed_owner_name: string | null;
  parsed_cat_name: string | null;
  matched_appointment_id: string | null;
  match_confidence: string | null;
  is_foster: boolean;
}

interface CDSAppointment {
  appointment_id: string;
  client_name: string | null;
  cat_name: string | null;
}

interface DateSummary {
  date: string;
  candidates: { chip: number; weight: number };
  verified: number;
  rejected: number;
  committed_would_agree: number;
  committed_would_disagree: number;
  committed_new: number;
  gt_correct: number;
  gt_wrong: number;
  gt_missing: number;
}

// ── String similarity (same as cds.ts) ─────────────────────────────────

function trigrams(s: string): Set<string> {
  const padded = `  ${s} `;
  const result = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) {
    result.add(padded.substring(i, i + 3));
  }
  return result;
}

function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const triA = trigrams(a);
  const triB = trigrams(b);
  let intersection = 0;
  for (const tri of triA) if (triB.has(tri)) intersection++;
  const union = triA.size + triB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function normalize(name: string | null): string {
  if (!name) return "";
  return name.toLowerCase().replace(/[^a-z]/g, "");
}

// ── Data loaders (read-only) ───────────────────────────────────────────

async function loadCurrentCDNs(date: string): Promise<CurrentCDN[]> {
  const { rows } = await pool.query(
    `SELECT a.appointment_id::text, a.clinic_day_number,
            a.client_name, c.name AS cat_name,
            a.clinic_day_number_source AS source,
            COALESCE(a.manually_overridden_fields @> ARRAY['clinic_day_number'], false) AS is_manual
     FROM ops.appointments a
     LEFT JOIN sot.cats c ON c.cat_id = a.cat_id
     WHERE a.appointment_date = $1
       AND a.merged_into_appointment_id IS NULL
       AND a.clinic_day_number IS NOT NULL`,
    [date]
  );
  return rows;
}

async function loadEntries(date: string): Promise<MLEntry[]> {
  const { rows } = await pool.query(
    `SELECT e.entry_id::text, e.line_number, e.parsed_owner_name, e.parsed_cat_name,
            e.matched_appointment_id::text, e.match_confidence,
            COALESCE(e.is_foster, false) AS is_foster
     FROM ops.clinic_day_entries e
     JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
     WHERE cd.clinic_date = $1
     ORDER BY e.line_number`,
    [date]
  );
  return rows;
}

async function loadAppointments(date: string): Promise<CDSAppointment[]> {
  const { rows } = await pool.query(
    `SELECT a.appointment_id::text, a.client_name, c.name AS cat_name
     FROM ops.appointments a
     LEFT JOIN sot.cats c ON c.cat_id = a.cat_id
     WHERE a.appointment_date = $1
       AND a.merged_into_appointment_id IS NULL`,
    [date]
  );
  return rows;
}

async function loadChipCandidates(date: string): Promise<CDNCandidate[]> {
  const { rows } = await pool.query(
    `SELECT w.waiver_id::text, w.matched_appointment_id::text AS appointment_id,
            w.ocr_clinic_number AS cdn
     FROM ops.waiver_scans w
     WHERE w.parsed_date = $1
       AND w.ocr_status = 'extracted'
       AND w.ocr_clinic_number IS NOT NULL
       AND w.matched_appointment_id IS NOT NULL`,
    [date]
  );
  return rows.map((r: any) => ({
    appointment_id: r.appointment_id,
    cdn: r.cdn,
    source: "waiver_chip" as const,
    waiver_id: r.waiver_id,
    confidence: 0.95,
  }));
}

async function loadWeightCandidates(date: string): Promise<CDNCandidate[]> {
  try {
    const { rows } = await pool.query(
      `SELECT waiver_id::text, appointment_id::text, cdn, score
       FROM ops.bridge_waivers_by_weight_candidates($1)`,
      [date]
    );
    return rows.map((r: any) => ({
      appointment_id: r.appointment_id,
      cdn: r.cdn,
      source: "waiver_weight" as const,
      waiver_id: r.waiver_id,
      confidence: parseFloat(r.score),
    }));
  } catch {
    return []; // function may not exist
  }
}

async function loadGroundTruthDates(): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT DISTINCT a.appointment_date::text AS clinic_date
     FROM ops.appointments a
     WHERE a.merged_into_appointment_id IS NULL
       AND a.clinic_day_number IS NOT NULL
       AND a.manually_overridden_fields @> ARRAY['clinic_day_number']
     ORDER BY clinic_date`
  );
  return rows.map((r: any) => r.clinic_date);
}

// ── Validation (mirrors cds.ts validateCDNCandidates — read-only) ──────

interface ValidationResult {
  verified: CDNCandidate[];
  rejected: Array<CDNCandidate & { reason: string }>;
}

function validateCandidates(
  candidates: CDNCandidate[],
  entries: MLEntry[],
  appointments: CDSAppointment[]
): ValidationResult {
  const verified: CDNCandidate[] = [];
  const rejected: Array<CDNCandidate & { reason: string }> = [];

  if (candidates.length === 0) return { verified, rejected };

  const entryByLine = new Map<number, MLEntry>();
  for (const e of entries) entryByLine.set(e.line_number, e);

  const apptById = new Map<string, CDSAppointment>();
  for (const a of appointments) apptById.set(a.appointment_id, a);

  // Resolve bidirectional: multiple candidates → same CDN
  const byCdn = new Map<number, CDNCandidate[]>();
  for (const c of candidates) {
    const g = byCdn.get(c.cdn) || [];
    g.push(c);
    byCdn.set(c.cdn, g);
  }

  const afterCdnDedup: CDNCandidate[] = [];
  for (const [, group] of byCdn) {
    group.sort((a, b) => b.confidence - a.confidence);
    afterCdnDedup.push(group[0]);
    for (let i = 1; i < group.length; i++) {
      rejected.push({ ...group[i], reason: "bidirectional_cdn_conflict" });
    }
  }

  // Multiple CDNs → same appointment
  const byAppt = new Map<string, CDNCandidate[]>();
  for (const c of afterCdnDedup) {
    const g = byAppt.get(c.appointment_id) || [];
    g.push(c);
    byAppt.set(c.appointment_id, g);
  }

  const deduped: CDNCandidate[] = [];
  for (const [, group] of byAppt) {
    group.sort((a, b) => b.confidence - a.confidence);
    deduped.push(group[0]);
    for (let i = 1; i < group.length; i++) {
      rejected.push({ ...group[i], reason: "multiple_cdns_same_appointment" });
    }
  }

  // Validate each against ML
  for (const candidate of deduped) {
    const entry = entryByLine.get(candidate.cdn);
    const appt = apptById.get(candidate.appointment_id);

    if (!entry) {
      rejected.push({ ...candidate, reason: "cdn_out_of_range" });
      continue;
    }
    if (!appt) {
      rejected.push({ ...candidate, reason: "appointment_not_found" });
      continue;
    }

    const mlOwner = normalize(entry.parsed_owner_name);
    const apptClient = normalize(appt.client_name);

    if (mlOwner && apptClient) {
      const sim = stringSimilarity(mlOwner, apptClient);
      if (sim < 0.3) {
        const isFoster =
          entry.is_foster ||
          mlOwner.includes("foster") ||
          apptClient.includes("foster");

        if (isFoster) {
          const mlCat = normalize(entry.parsed_cat_name);
          const apptCat = normalize(appt.cat_name);
          if (mlCat && apptCat && stringSimilarity(mlCat, apptCat) < 0.3) {
            rejected.push({ ...candidate, reason: "foster_cat_name_mismatch" });
            continue;
          }
        } else {
          const mlFirst = (entry.parsed_owner_name || "")
            .split(" ")[0]
            ?.toLowerCase()
            .replace(/[^a-z]/g, "") || "";
          if (mlFirst.length >= 2 && apptClient.includes(mlFirst)) {
            // First name match — allow
          } else {
            rejected.push({ ...candidate, reason: "ml_owner_mismatch" });
            continue;
          }
        }
      }
    }

    verified.push(candidate);
  }

  return { verified, rejected };
}

// ── Comparison logic ───────────────────────────────────────────────────

async function runDiffForDate(date: string, verbose: boolean): Promise<DateSummary> {
  const [currentCdns, entries, appointments, chipCandidates, weightCandidates] =
    await Promise.all([
      loadCurrentCDNs(date),
      loadEntries(date),
      loadAppointments(date),
      loadChipCandidates(date),
      loadWeightCandidates(date),
    ]);

  const allCandidates = [...chipCandidates, ...weightCandidates];
  const { verified, rejected } = validateCandidates(
    allCandidates,
    entries,
    appointments
  );

  // Build lookups
  const currentByAppt = new Map<string, CurrentCDN>();
  const currentByCdn = new Map<number, CurrentCDN>();
  for (const c of currentCdns) {
    currentByAppt.set(c.appointment_id, c);
    currentByCdn.set(c.clinic_day_number, c);
  }

  // Ground truth: manual CDN assignments
  const groundTruth = currentCdns.filter((c) => c.is_manual);
  const gtByAppt = new Map<string, number>();
  const gtByCdn = new Map<number, string>();
  for (const gt of groundTruth) {
    gtByAppt.set(gt.appointment_id, gt.clinic_day_number);
    gtByCdn.set(gt.clinic_day_number, gt.appointment_id);
  }

  const entryByLine = new Map<number, MLEntry>();
  for (const e of entries) entryByLine.set(e.line_number, e);

  const apptById = new Map<string, CDSAppointment>();
  for (const a of appointments) apptById.set(a.appointment_id, a);

  // Compare verified candidates against current state + ground truth
  let agreeCount = 0;
  let disagreeCount = 0;
  let newCount = 0;
  let gtCorrect = 0;
  let gtWrong = 0;
  let gtMissing = 0;

  const rows: Array<{
    cdn: number;
    client: string;
    mlOwner: string;
    source: string;
    status: string;
    gtStatus: string;
  }> = [];

  for (const v of verified) {
    const current = currentByAppt.get(v.appointment_id);
    const entry = entryByLine.get(v.cdn);
    const appt = apptById.get(v.appointment_id);

    let status: string;
    if (current && current.clinic_day_number === v.cdn) {
      status = "AGREE";
      agreeCount++;
    } else if (current && current.clinic_day_number !== v.cdn) {
      status = `DIFF (cur=${current.clinic_day_number})`;
      disagreeCount++;
    } else {
      status = "NEW";
      newCount++;
    }

    // Ground truth check
    const gtCdn = gtByAppt.get(v.appointment_id);
    const gtApptForLine = gtByCdn.get(v.cdn);
    let gtStatus: string;
    if (gtCdn === v.cdn) {
      gtStatus = "GT:correct";
      gtCorrect++;
    } else if (gtCdn !== undefined) {
      gtStatus = `GT:WRONG (gt=${gtCdn})`;
      gtWrong++;
    } else if (gtApptForLine && gtApptForLine !== v.appointment_id) {
      gtStatus = "GT:WRONG (line claimed)";
      gtWrong++;
    } else {
      gtStatus = "no GT";
      gtMissing++;
    }

    rows.push({
      cdn: v.cdn,
      client: (appt?.client_name || "?").substring(0, 22),
      mlOwner: (entry?.parsed_owner_name || "?").substring(0, 22),
      source: v.source,
      status,
      gtStatus,
    });
  }

  if (verbose) {
    console.log("");
    console.log(
      `${"═".repeat(78)}\n  CDS Candidate Diff — ${date}  (read-only, no writes)\n${"═".repeat(78)}`
    );

    // Summary table
    console.log("");
    console.log("  Candidates:");
    console.log(
      `    waiver_chip:   ${chipCandidates.length} total → ${verified.filter((v) => v.source === "waiver_chip").length} verified`
    );
    console.log(
      `    waiver_weight: ${weightCandidates.length} total → ${verified.filter((v) => v.source === "waiver_weight").length} verified`
    );
    console.log(
      `    TOTAL:         ${allCandidates.length} total → ${verified.length} verified, ${rejected.length} rejected`
    );

    // Verified candidates table
    if (rows.length > 0) {
      console.log("");
      console.log("  Verified Candidates vs Current State:");
      console.log(
        `    ${"CDN".padEnd(4)} ${"Appt Client".padEnd(23)} ${"ML Owner".padEnd(23)} ${"Source".padEnd(14)} ${"Status".padEnd(16)} GT`
      );
      console.log(`    ${"─".repeat(4)} ${"─".repeat(23)} ${"─".repeat(23)} ${"─".repeat(14)} ${"─".repeat(16)} ${"─".repeat(16)}`);
      for (const r of rows.sort((a, b) => a.cdn - b.cdn)) {
        const statusMark =
          r.status === "AGREE"
            ? "✓"
            : r.status === "NEW"
              ? "★"
              : "✗";
        const gtMark =
          r.gtStatus === "GT:correct"
            ? "✓"
            : r.gtStatus === "no GT"
              ? "·"
              : "✗";
        console.log(
          `    ${String(r.cdn).padEnd(4)} ${r.client.padEnd(23)} ${r.mlOwner.padEnd(23)} ${r.source.padEnd(14)} ${statusMark} ${r.status.padEnd(14)} ${gtMark} ${r.gtStatus}`
        );
      }
    }

    // Rejected candidates
    if (rejected.length > 0) {
      console.log("");
      console.log("  Rejected Candidates:");
      console.log(
        `    ${"CDN".padEnd(4)} ${"Appt Client".padEnd(23)} ${"ML Owner".padEnd(23)} ${"Source".padEnd(14)} Reason`
      );
      console.log(`    ${"─".repeat(4)} ${"─".repeat(23)} ${"─".repeat(23)} ${"─".repeat(14)} ${"─".repeat(30)}`);
      for (const r of rejected.sort((a, b) => a.cdn - b.cdn)) {
        const appt = apptById.get(r.appointment_id);
        const entry = entryByLine.get(r.cdn);
        console.log(
          `    ${String(r.cdn).padEnd(4)} ${(appt?.client_name || "?").substring(0, 22).padEnd(23)} ${(entry?.parsed_owner_name || "?").substring(0, 22).padEnd(23)} ${r.source.padEnd(14)} ${r.reason}`
        );
      }
    }

    // Ground truth summary
    console.log("");
    console.log("  Ground Truth Check:");
    console.log(`    ✓ Correct:     ${gtCorrect}`);
    console.log(`    ✗ Wrong:       ${gtWrong}`);
    console.log(`    · No GT:       ${gtMissing}`);
    console.log(
      `    Accuracy:      ${gtCorrect + gtWrong > 0 ? ((gtCorrect / (gtCorrect + gtWrong)) * 100).toFixed(1) : "N/A"}%`
    );

    // Current vs proposed summary
    console.log("");
    console.log("  Current State Comparison:");
    console.log(`    ✓ Agree (same CDN already set):  ${agreeCount}`);
    console.log(`    ✗ Disagree (different CDN):       ${disagreeCount}`);
    console.log(`    ★ New (no CDN currently set):     ${newCount}`);

    // Context
    console.log("");
    console.log(
      `  Context: ${entries.length} ML entries, ${appointments.length} appointments, ${currentCdns.length} current CDNs, ${groundTruth.length} ground truth`
    );
  }

  return {
    date,
    candidates: {
      chip: chipCandidates.length,
      weight: weightCandidates.length,
    },
    verified: verified.length,
    rejected: rejected.length,
    committed_would_agree: agreeCount,
    committed_would_disagree: disagreeCount,
    committed_new: newCount,
    gt_correct: gtCorrect,
    gt_wrong: gtWrong,
    gt_missing: gtMissing,
  };
}

// ── Aggregate summary for multi-date runs ──────────────────────────────

function printAggregate(summaries: DateSummary[]) {
  console.log("");
  console.log(`${"═".repeat(78)}`);
  console.log(`  AGGREGATE SUMMARY — ${summaries.length} dates`);
  console.log(`${"═".repeat(78)}`);

  const totals = summaries.reduce(
    (acc, s) => ({
      chip: acc.chip + s.candidates.chip,
      weight: acc.weight + s.candidates.weight,
      verified: acc.verified + s.verified,
      rejected: acc.rejected + s.rejected,
      agree: acc.agree + s.committed_would_agree,
      disagree: acc.disagree + s.committed_would_disagree,
      new_: acc.new_ + s.committed_new,
      gt_correct: acc.gt_correct + s.gt_correct,
      gt_wrong: acc.gt_wrong + s.gt_wrong,
      gt_missing: acc.gt_missing + s.gt_missing,
    }),
    {
      chip: 0, weight: 0, verified: 0, rejected: 0,
      agree: 0, disagree: 0, new_: 0,
      gt_correct: 0, gt_wrong: 0, gt_missing: 0,
    }
  );

  console.log("");
  console.log(`  Candidates: ${totals.chip + totals.weight} total (${totals.chip} chip, ${totals.weight} weight)`);
  console.log(`  Verified:   ${totals.verified}  |  Rejected: ${totals.rejected}`);
  console.log("");
  console.log(`  vs Current State:`);
  console.log(`    ✓ Agree:    ${totals.agree}`);
  console.log(`    ✗ Disagree: ${totals.disagree}`);
  console.log(`    ★ New:      ${totals.new_}`);
  console.log("");
  console.log(`  vs Ground Truth:`);
  console.log(`    ✓ Correct:  ${totals.gt_correct}`);
  console.log(`    ✗ Wrong:    ${totals.gt_wrong}`);
  console.log(`    · No GT:    ${totals.gt_missing}`);

  const gtTotal = totals.gt_correct + totals.gt_wrong;
  console.log(
    `    Accuracy:   ${gtTotal > 0 ? ((totals.gt_correct / gtTotal) * 100).toFixed(1) : "N/A"}% (${totals.gt_correct}/${gtTotal})`
  );

  // Per-date breakdown if there are disagreements
  const problemDates = summaries.filter(
    (s) => s.committed_would_disagree > 0 || s.gt_wrong > 0
  );
  if (problemDates.length > 0) {
    console.log("");
    console.log("  ⚠ Dates with disagreements:");
    for (const d of problemDates) {
      console.log(
        `    ${d.date}: ${d.committed_would_disagree} state disagree, ${d.gt_wrong} GT wrong`
      );
    }
  } else {
    console.log("");
    console.log("  ✓ No disagreements with current state or ground truth!");
  }
}

// ── Main ───────────────────────────────────────────────────────────────

const CANARY_DATES = ["2026-04-06", "2026-04-08", "2026-04-16", "2025-12-10"];

async function main() {
  const arg = process.argv[2];

  if (!arg) {
    console.log("Usage:");
    console.log("  npx tsx scripts/cds-candidate-diff.ts 2026-04-06   # Single date (verbose)");
    console.log("  npx tsx scripts/cds-candidate-diff.ts --canary      # 4 canary dates");
    console.log("  npx tsx scripts/cds-candidate-diff.ts --all         # All ground truth dates");
    process.exit(0);
  }

  try {
    if (arg === "--all") {
      console.log("Loading ground truth dates...");
      const dates = await loadGroundTruthDates();
      console.log(`Found ${dates.length} dates with ground truth.`);

      const summaries: DateSummary[] = [];
      for (const date of dates) {
        process.stdout.write(`  ${date}...`);
        const summary = await runDiffForDate(date, false);
        const mark =
          summary.gt_wrong > 0
            ? " ✗ GT wrong!"
            : summary.committed_would_disagree > 0
              ? " ⚠ state disagree"
              : " ✓";
        console.log(mark);
        summaries.push(summary);
      }

      printAggregate(summaries);
    } else if (arg === "--canary") {
      const summaries: DateSummary[] = [];
      for (const date of CANARY_DATES) {
        const summary = await runDiffForDate(date, true);
        summaries.push(summary);
      }
      if (CANARY_DATES.length > 1) {
        printAggregate(summaries);
      }
    } else {
      // Single date — verbose
      await runDiffForDate(arg, true);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
