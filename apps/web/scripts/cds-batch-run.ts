#!/usr/bin/env npx tsx
/**
 * Batch CDS runner — runs the CDS pipeline on every clinic date that
 * has master list entries but no cds_run_id yet (i.e., dates freshly
 * imported by the FFS-1088 SharePoint master list sync cron that ran
 * with skipCDS=true).
 *
 * Usage (from apps/web/):
 *   set -a && source .env.production.local && set +a
 *   npx tsx scripts/cds-batch-run.ts              # all pending dates
 *   npx tsx scripts/cds-batch-run.ts 2026-03-11   # single date
 */
export {};

import { runCDS } from "@/lib/cds";
import { queryRows } from "@/lib/db";

async function main() {
  const singleDate = process.argv[2];

  let dates: string[];
  if (singleDate) {
    dates = [singleDate];
  } else {
    // All dates with clinic_day_entries but no cds_runs row
    const rows = await queryRows<{ clinic_date: string }>(
      `SELECT cd.clinic_date::text AS clinic_date
       FROM ops.clinic_days cd
       JOIN ops.clinic_day_entries e ON e.clinic_day_id = cd.clinic_day_id
       WHERE NOT EXISTS (
         SELECT 1 FROM ops.cds_runs r WHERE r.clinic_date = cd.clinic_date
       )
       GROUP BY cd.clinic_date
       ORDER BY cd.clinic_date`
    );
    dates = rows.map((r) => r.clinic_date);
  }

  console.log(`Running CDS on ${dates.length} dates\n`);

  let totalMatched = 0;
  let totalUnmatched = 0;
  let ok = 0;
  let failed = 0;

  for (const date of dates) {
    const start = Date.now();
    try {
      const result = await runCDS(date, "import");
      const elapsed = Date.now() - start;
      totalMatched += result.matched_after;
      totalUnmatched += result.unmatched_remaining;
      ok++;
      const entries = result.matched_after + result.unmatched_remaining;
      const pct = entries > 0 ? Math.round((result.matched_after / entries) * 100) : 0;
      console.log(
        `  ${date}: ${result.matched_after}/${entries} matched (${pct}%) in ${elapsed}ms`
      );
    } catch (err) {
      failed++;
      console.log(`  ${date}: ERROR — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Dates processed: ${ok} ok, ${failed} failed`);
  console.log(`Total matched: ${totalMatched}`);
  console.log(`Total unmatched: ${totalUnmatched}`);
  if (totalMatched + totalUnmatched > 0) {
    const pct = Math.round((totalMatched / (totalMatched + totalUnmatched)) * 100);
    console.log(`Overall match rate: ${pct}%`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Crashed:", err);
  process.exit(2);
});
