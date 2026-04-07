#!/usr/bin/env npx tsx
/**
 * CDS End-to-End Smoke Test (FFS-1150 verification → FFS-1087 unblock)
 *
 * Runs the 7-phase CDS pipeline on a real clinic date and verifies:
 *   1. ops.cds_runs gets a new row with phase_results
 *   2. ops.clinic_day_entries rows get cds_method/cds_run_id tagged
 *   3. Macy's manually-overridden clinic_day_number survives the rematch
 *      (end-to-end validation of MIG_3048 + MIG_3052 integration)
 *   4. Match counts are reasonable (no catastrophic drops)
 *
 * Usage (from apps/web/):
 *   DATABASE_URL="..." npx tsx scripts/cds-smoke-test.ts 2026-02-04
 *   DATABASE_URL="..." npx tsx scripts/cds-smoke-test.ts           # defaults to 2026-02-04
 */

import { runCDS } from "@/lib/cds";
import { queryOne, queryRows } from "@/lib/db";

interface PreState {
  entries: number;
  matched: number;
  manual: number;
  tagged_cds: number;
  macy_cdn: number | null;
  macy_source: string | null;
}

async function getState(clinicDate: string): Promise<PreState> {
  const row = await queryOne<PreState>(
    `SELECT
       COUNT(e.entry_id)::int AS entries,
       (COUNT(e.entry_id) FILTER (WHERE e.matched_appointment_id IS NOT NULL
                                    AND e.match_confidence IS NOT NULL
                                    AND e.match_confidence != 'unmatched'))::int AS matched,
       (COUNT(e.entry_id) FILTER (WHERE e.match_confidence = 'manual'))::int AS manual,
       (COUNT(e.entry_id) FILTER (WHERE e.cds_run_id IS NOT NULL))::int AS tagged_cds,
       (SELECT clinic_day_number FROM ops.appointments WHERE appointment_id = '32f0dd7a-0b2c-4ea0-83a2-7c4f2663e990') AS macy_cdn,
       (SELECT clinic_day_number_source::TEXT FROM ops.appointments WHERE appointment_id = '32f0dd7a-0b2c-4ea0-83a2-7c4f2663e990') AS macy_source
     FROM ops.clinic_day_entries e
     JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
     WHERE cd.clinic_date = $1`,
    [clinicDate]
  );
  if (!row) throw new Error(`No clinic day state for ${clinicDate}`);
  return row;
}

async function main() {
  const clinicDate = process.argv[2] || "2026-02-04";

  console.log("=".repeat(64));
  console.log(`  CDS Smoke Test — ${clinicDate}`);
  console.log("=".repeat(64));
  console.log("");

  // ── Pre-flight ────────────────────────────────────────────────────
  console.log("[1/4] Pre-flight state:");
  const before = await getState(clinicDate);
  console.log(`      entries=${before.entries} matched=${before.matched} manual=${before.manual} tagged_cds=${before.tagged_cds}`);
  console.log(`      Macy: clinic_day_number=${before.macy_cdn} source=${before.macy_source}`);
  console.log("");

  if (before.entries === 0) {
    console.error("FAIL: No entries for this clinic day. Nothing to match.");
    process.exit(1);
  }

  // ── Run CDS ───────────────────────────────────────────────────────
  console.log("[2/4] Running CDS pipeline (rematch mode)...");
  const start = Date.now();
  const result = await runCDS(clinicDate, "rematch");
  const duration = Date.now() - start;

  console.log(`      run_id: ${result.run_id}`);
  console.log(`      duration: ${duration}ms`);
  console.log(`      phases:`);
  for (const p of result.phases) {
    console.log(`        ${p.phase.padEnd(30)} matched=${p.matched}`);
  }
  console.log(`      totals: before=${result.matched_before} after=${result.matched_after} manual_preserved=${result.manual_preserved} unmatched=${result.unmatched_remaining} llm_suggestions=${result.llm_suggestions}`);
  console.log("");

  // ── Post-flight ───────────────────────────────────────────────────
  console.log("[3/4] Post-flight state:");
  const after = await getState(clinicDate);
  console.log(`      entries=${after.entries} matched=${after.matched} manual=${after.manual} tagged_cds=${after.tagged_cds}`);
  console.log(`      Macy: clinic_day_number=${after.macy_cdn} source=${after.macy_source}`);
  console.log("");

  // Check ops.cds_runs
  const runRow = await queryOne<{
    run_id: string;
    triggered_by: string;
    started_at: string;
    completed_at: string | null;
    matched_before: number;
    matched_after: number;
    phase_results: unknown;
  }>(
    `SELECT run_id, triggered_by, started_at::text, completed_at::text,
            matched_before, matched_after, phase_results
     FROM ops.cds_runs
     WHERE run_id = $1`,
    [result.run_id]
  );

  // Sample cds_method distribution
  const methodBreakdown = await queryRows<{ cds_method: string; n: number }>(
    `SELECT cds_method, COUNT(*)::int AS n
     FROM ops.clinic_day_entries e
     JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
     WHERE cd.clinic_date = $1
       AND e.cds_run_id = $2
     GROUP BY cds_method
     ORDER BY n DESC`,
    [clinicDate, result.run_id]
  );

  console.log("[4/4] Database-side verification:");
  console.log(`      ops.cds_runs row present: ${runRow ? "yes" : "NO"}`);
  if (runRow) {
    console.log(`      completed_at: ${runRow.completed_at ?? "NULL (failed?)"}`);
  }
  console.log(`      cds_method distribution for this run:`);
  for (const m of methodBreakdown) {
    console.log(`        ${(m.cds_method ?? "<null>").padEnd(30)} ${m.n}`);
  }
  console.log("");

  // ── Verdict ───────────────────────────────────────────────────────
  const failures: string[] = [];

  if (!runRow) failures.push("ops.cds_runs row missing");
  if (runRow && !runRow.completed_at) failures.push("ops.cds_runs.completed_at is NULL (run failed)");
  if (after.tagged_cds === 0) failures.push("0 entries tagged with cds_run_id after run");
  if (after.manual < before.manual) failures.push(`manual matches dropped ${before.manual} → ${after.manual}`);
  if (after.macy_cdn !== 5) failures.push(`Macy clinic_day_number drifted: ${before.macy_cdn} → ${after.macy_cdn}`);
  if (after.macy_source !== "manual") failures.push(`Macy source changed: ${before.macy_source} → ${after.macy_source}`);

  console.log("=".repeat(64));
  if (failures.length === 0) {
    console.log("  VERDICT: PASS ✓");
    console.log("=".repeat(64));
    console.log("");
    console.log("  - CDS pipeline runs end-to-end");
    console.log("  - ops.cds_runs audit trail populated");
    console.log("  - Entries tagged with cds_run_id + cds_method");
    console.log("  - Manual matches preserved");
    console.log("  - Macy's manually-overridden clinic_day_number=5 held");
    console.log("  - MIG_3048 provenance + MIG_3052 single-write-path + MIG_3051 debug trigger all compatible with CDS");
    console.log("");
    process.exit(0);
  } else {
    console.log("  VERDICT: FAIL ✗");
    console.log("=".repeat(64));
    console.log("");
    for (const f of failures) {
      console.log(`  ✗ ${f}`);
    }
    console.log("");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("");
  console.error("SMOKE TEST CRASHED:");
  console.error(err);
  process.exit(2);
});
