/**
 * FFS-804: Report writer — outputs JSON and console summary
 */
import * as fs from "fs";
import * as path from "path";
import type { JudgeReport, QuestionResult } from "./types";

const OUTPUT_DIR = path.resolve(__dirname, "../../../e2e/judge-results");

export function writeReport(report: JudgeReport): string {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const filename = `judge-${report.timestamp.replace(/[:.]/g, "-")}.json`;
  const filepath = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(report, null, 2));
  return filepath;
}

export function printSummary(report: JudgeReport): void {
  console.log("\n=== Tippy Quality Report ===\n");
  console.log(`Model judged: ${report.model_judged}`);
  console.log(`Judge model:  ${report.judge_model}`);
  console.log(`Questions:    ${report.total_questions}`);
  console.log(`Threshold:    ${report.threshold}`);
  console.log(`Overall:      ${report.average_score.toFixed(2)} ${report.pass ? "PASS" : "FAIL"}`);

  console.log("\n--- By Dimension ---");
  for (const [dim, stats] of Object.entries(report.by_dimension)) {
    console.log(`  ${dim.padEnd(15)} avg=${stats.avg.toFixed(2)}  min=${stats.min}  max=${stats.max}`);
  }

  console.log("\n--- By Domain ---");
  for (const [domain, stats] of Object.entries(report.by_domain)) {
    console.log(`  ${domain.padEnd(20)} n=${stats.count}  avg=${stats.avg_score.toFixed(2)}`);
  }

  if (report.flags.length > 0) {
    console.log("\n--- Flags ---");
    report.flags.forEach(f => console.log(`  ⚠️  ${f}`));
  }

  // Show lowest-scoring questions
  const sorted = [...report.results].sort((a, b) => a.verdict.overall_score - b.verdict.overall_score);
  const worst = sorted.slice(0, 3);
  if (worst.length > 0) {
    console.log("\n--- Lowest Scoring ---");
    worst.forEach(r => {
      console.log(`  ${r.verdict.overall_score.toFixed(2)} | ${r.domain} | ${r.question.slice(0, 60)}...`);
    });
  }

  console.log("");
}

export function buildReport(
  results: QuestionResult[],
  threshold: number,
  modelJudged: string
): JudgeReport {
  const byDomain: Record<string, { count: number; total: number }> = {};
  const dimensionScores: Record<string, number[]> = {
    accuracy: [], helpfulness: [], completeness: [], communication: [], safety: [],
  };
  const allFlags: string[] = [];

  for (const r of results) {
    // By domain
    if (!byDomain[r.domain]) byDomain[r.domain] = { count: 0, total: 0 };
    byDomain[r.domain].count++;
    byDomain[r.domain].total += r.verdict.overall_score;

    // By dimension
    for (const [key, dim] of Object.entries(r.verdict.dimensions)) {
      dimensionScores[key]?.push(dim.score);
    }

    // Flags
    for (const flag of r.verdict.flags) {
      allFlags.push(`${r.question_id}: ${flag}`);
    }
  }

  const avgScore = results.length > 0
    ? results.reduce((s, r) => s + r.verdict.overall_score, 0) / results.length
    : 0;

  return {
    timestamp: new Date().toISOString(),
    model_judged: modelJudged,
    judge_model: "claude-haiku-4-5-20251001",
    total_questions: results.length,
    average_score: Math.round(avgScore * 100) / 100,
    by_domain: Object.fromEntries(
      Object.entries(byDomain).map(([k, v]) => [k, { count: v.count, avg_score: Math.round((v.total / v.count) * 100) / 100 }])
    ),
    by_dimension: Object.fromEntries(
      Object.entries(dimensionScores).map(([k, scores]) => [k, {
        avg: scores.length > 0 ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100 : 0,
        min: scores.length > 0 ? Math.min(...scores) : 0,
        max: scores.length > 0 ? Math.max(...scores) : 0,
      }])
    ),
    results,
    flags: allFlags,
    pass: avgScore >= threshold,
    threshold,
  };
}
