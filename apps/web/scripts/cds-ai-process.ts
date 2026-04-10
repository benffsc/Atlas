#!/usr/bin/env npx tsx
/**
 * CDS-AI Processor — CLI wrapper
 *
 * Thin wrapper around the shared CDS-AI library.
 * Use for manual runs; production uses the cron route.
 *
 * Usage:
 *   set -a && source .env.production.local && set +a
 *   npx tsx scripts/cds-ai-process.ts 2026-04-01
 *   npx tsx scripts/cds-ai-process.ts 2026-04-01 --apply
 *   npx tsx scripts/cds-ai-process.ts 2026-04-01 --classify-only
 *
 * Linear: FFS-1089 (classify+chunk), FFS-1090 (match), FFS-1219 (shared lib)
 */
export {};

import { runCdsAi } from "@/lib/cds-ai";
import * as fs from "fs";

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const classifyOnly = args.includes("--classify-only");
  const dateArg = args.find((a) => !a.startsWith("--"));

  if (!dateArg || !/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) {
    console.error("Usage: cds-ai-process.ts <YYYY-MM-DD> [--apply] [--classify-only]");
    process.exit(1);
  }

  const result = await runCdsAi(dateArg, {
    apply,
    classifyOnly,
    log: console.log,
  });

  // Summary
  console.log(`\n── Summary ──`);
  console.log(`  Date: ${result.date}`);
  console.log(`  Photos classified: ${result.classified}`);
  console.log(`  Chunks formed: ${result.chunks_formed}`);
  console.log(`  Orphan photos: ${result.orphan_photos}`);
  console.log(`  Matched: ${result.matched}`);
  console.log(`  Unmatched: ${result.unmatched}`);
  console.log(`  SharePoint: ${result.agreements} agree, ${result.disagreements} disagree`);
  console.log(`  Elapsed: ${(result.elapsed_ms / 1000).toFixed(1)}s`);

  if (result.disagreements > 0) {
    console.log(`\n── Disagreements ──`);
    result.match_results
      .filter((r) => r.agreement === "DISAGREE")
      .forEach((r) => {
        console.log(`  #${r.clinic_number}: CDS-AI=${r.cat_id?.substring(0, 8)} SP=${r.sharepoint_cat_id?.substring(0, 8)}`);
      });
  }

  // Write results to /tmp
  const resultPath = `/tmp/cds-ai_${dateArg}.results.json`;
  fs.writeFileSync(resultPath, JSON.stringify({
    date: result.date,
    matchResults: result.match_results,
    summary: {
      matched: result.matched,
      unmatched: result.unmatched,
      agreements: result.agreements,
      disagreements: result.disagreements,
    },
  }, null, 2));
  console.log(`\nResults: ${resultPath}`);

  process.exit(0);
}

main().catch((err) => {
  console.error("Crashed:", err);
  process.exit(1);
});
