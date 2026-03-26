#!/usr/bin/env npx tsx
/**
 * FFS-804: Tippy LLM-as-Judge Quality Scoring
 *
 * Reads VCR cassettes, scores each with Haiku, outputs a quality report.
 *
 * Usage:
 *   npx tsx scripts/eval/tippy-judge.ts                     # Score all cassettes
 *   npx tsx scripts/eval/tippy-judge.ts --threshold 3.0     # CI gate mode
 *   npx tsx scripts/eval/tippy-judge.ts --filter domain:voicemail_triage
 *   npx tsx scripts/eval/tippy-judge.ts --concurrency 5
 */
import Anthropic from "@anthropic-ai/sdk";
import { loadCassettes } from "./lib/cassette-loader";
import { judgeCassette } from "./lib/judge-client";
import { getWeightsForDomain, computeOverallScore } from "./lib/rubrics";
import { buildReport, writeReport, printSummary } from "./lib/report-writer";
import type { QuestionResult } from "./lib/types";

// Parse CLI args
const args = process.argv.slice(2);
function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

const threshold = parseFloat(getArg("threshold") || "3.0");
const concurrency = parseInt(getArg("concurrency") || "5", 10);
const filterArg = getArg("filter");
const filterDomain = filterArg?.startsWith("domain:") ? filterArg.slice(7) : undefined;

async function main() {
  // Load cassettes
  const cassettes = loadCassettes(filterDomain);

  if (cassettes.length === 0) {
    console.log("No cassettes found in e2e/cassettes/. Run the VCR tests first to generate cassettes.");
    console.log("  npx playwright test e2e/tippy-domain-coverage.spec.ts");
    process.exit(0);
  }

  console.log(`Found ${cassettes.length} cassette(s)${filterDomain ? ` (domain: ${filterDomain})` : ""}`);
  console.log(`Threshold: ${threshold}, Concurrency: ${concurrency}\n`);

  // Check for API key
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("Error: ANTHROPIC_API_KEY environment variable is required");
    process.exit(1);
  }

  const client = new Anthropic({ apiKey });
  const results: QuestionResult[] = [];

  // Process cassettes with concurrency limit
  const chunks: typeof cassettes[] = [];
  for (let i = 0; i < cassettes.length; i += concurrency) {
    chunks.push(cassettes.slice(i, i + concurrency));
  }

  for (const chunk of chunks) {
    const chunkResults = await Promise.all(
      chunk.map(async (cassette) => {
        try {
          process.stdout.write(`  Judging: ${cassette.question_id}...`);
          const verdict = await judgeCassette(
            client,
            cassette.question,
            cassette.final_answer,
            cassette.tool_calls_used,
            cassette.domain
          );

          // Compute overall score using domain-specific weights
          const weights = getWeightsForDomain(cassette.domain);
          const dimensionScores: Record<string, number> = {};
          for (const [key, dim] of Object.entries(verdict.dimensions)) {
            dimensionScores[key] = dim.score;
          }
          verdict.overall_score = computeOverallScore(dimensionScores, weights);

          console.log(` ${verdict.overall_score.toFixed(2)}`);

          return {
            question_id: cassette.question_id,
            domain: cassette.domain,
            question: cassette.question,
            answer: cassette.final_answer,
            tool_calls: cassette.tool_calls_used,
            verdict,
            cassette_file: cassette.file,
          } satisfies QuestionResult;
        } catch (e) {
          console.log(` ERROR: ${e}`);
          return null;
        }
      })
    );

    results.push(...chunkResults.filter((r): r is QuestionResult => r !== null));
  }

  // Build and output report
  const report = buildReport(results, threshold, "claude-sonnet-4-20250514");
  const reportPath = writeReport(report);
  printSummary(report);
  console.log(`Full report: ${reportPath}`);

  // Exit with non-zero if below threshold (CI gate)
  if (!report.pass) {
    console.log(`\nFAIL: Average score ${report.average_score.toFixed(2)} < threshold ${threshold}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
