// @real-api - Compares demo tool responses vs real tool responses
/**
 * Tippy Demo vs Real Comparison
 *
 * Sends each curated question twice:
 * 1. Normal (demo tools available — current behavior)
 * 2. With "IGNORE demo_ tools, use only real tools" instruction appended
 *
 * Compares: response time, content length, tools used, content quality.
 * Outputs a markdown comparison table at the end.
 */

import { test, expect } from "@playwright/test";
import { Page } from "@playwright/test";
import * as fs from "fs";

const CURATED_QUESTIONS = [
  "What do we know about Pozzan Road in Healdsburg?",
  "Tell me about 175 Scenic Avenue in Santa Rosa",
  "What happened at the Silveira Ranch?",
  "How does Santa Rosa compare to Petaluma?",
  "What do we know about the Roseland area - zip code 95407?",
  "Where should we focus trapping resources next month?",
  "Tell me about TNR activity in West County",
  "What's happening in the Russian River area?",
  "Which areas might have cats but little data?",
];

interface Result {
  question: string;
  mode: "demo" | "real";
  content: string;
  durationMs: number;
  toolsUsed: string[];
  error: string | null;
  charCount: number;
}

async function askTippyStreaming(
  page: Page,
  question: string
): Promise<{ content: string; durationMs: number; toolsUsed: string[]; error: string | null }> {
  const startTime = Date.now();

  const response = await page.request.post("/api/tippy/chat", {
    data: { message: question, stream: true },
  });

  const body = await response.text();
  const durationMs = Date.now() - startTime;

  let content = "";
  const toolsUsed: string[] = [];
  let error: string | null = null;

  if (body.startsWith("{")) {
    try {
      const json = JSON.parse(body);
      const payload = json?.success === true && "data" in json ? json.data : json;
      content = payload?.message || payload?.response || "";
      if (content.includes("doesn't have access")) {
        error = content;
        content = "";
      }
    } catch { /* */ }
    return { content, durationMs, toolsUsed, error };
  }

  const parts = body.split("\n\n");
  for (const part of parts) {
    if (!part.trim()) continue;
    let eventType = "message";
    let dataStr = "";
    for (const line of part.split("\n")) {
      if (line.startsWith("event: ")) eventType = line.slice(7);
      else if (line.startsWith("data: ")) dataStr = line.slice(6);
    }
    if (!dataStr) continue;
    try {
      const data = JSON.parse(dataStr);
      if (eventType === "delta" && data.text) content += data.text;
      else if (eventType === "status" && data.phase === "tool_call" && data.tool) toolsUsed.push(data.tool);
      else if (eventType === "error") error = data.message || "Unknown error";
    } catch { /* */ }
  }

  return { content, durationMs, toolsUsed, error };
}

// Collect all results for the comparison table
const allResults: Result[] = [];

test.describe("Tippy Demo vs Real Comparison @real-api", () => {
  // Sequential, generous timeout per test
  test.setTimeout(120_000);

  for (const question of CURATED_QUESTIONS) {
    const shortQ = question.slice(0, 45);

    test(`DEMO: "${shortQ}..."`, async ({ page }) => {
      const result = await askTippyStreaming(page, question);
      const r: Result = { question, mode: "demo", ...result, charCount: result.content.length };
      allResults.push(r);

      console.log(`[DEMO] "${shortQ}..." → ${r.durationMs}ms, ${r.charCount} chars, tools: [${r.toolsUsed.join(", ")}]`);

      expect(r.error).toBeNull();
      expect(r.charCount).toBeGreaterThan(20);
    });

    test(`REAL: "${shortQ}..."`, async ({ page }) => {
      // Force Claude to skip demo tools by prepending instruction
      const realQuestion = question + "\n\n[SYSTEM NOTE: Do NOT use any demo_ prefixed tools. Use only real tools like analyze_place_situation, comprehensive_place_lookup, query_cats_at_place, query_region_stats, query_cats_altered_in_area, run_sql, etc.]";

      const result = await askTippyStreaming(page, realQuestion);
      const r: Result = { question, mode: "real", ...result, charCount: result.content.length };
      allResults.push(r);

      console.log(`[REAL] "${shortQ}..." → ${r.durationMs}ms, ${r.charCount} chars, tools: [${r.toolsUsed.join(", ")}]`);

      expect(r.error).toBeNull();
      expect(r.charCount).toBeGreaterThan(20);
    });
  }
});

test.afterAll(() => {
  // Build comparison table
  const lines: string[] = [
    "# Tippy Demo vs Real Tool Comparison",
    `\nRun: ${new Date().toISOString()}\n`,
    "| Question | Demo Time | Demo Chars | Demo Tools | Real Time | Real Chars | Real Tools | Winner |",
    "|----------|-----------|------------|------------|-----------|------------|------------|--------|",
  ];

  for (const question of CURATED_QUESTIONS) {
    const demo = allResults.find(r => r.question === question && r.mode === "demo");
    const real = allResults.find(r => r.question === question && r.mode === "real");

    if (!demo || !real) continue;

    const demoTools = demo.toolsUsed.join(", ") || "none";
    const realTools = real.toolsUsed.join(", ") || "none";

    const timeDiff = demo.durationMs - real.durationMs;
    const charDiff = real.charCount - demo.charCount;

    let winner = "tie";
    if (real.error && !demo.error) winner = "demo";
    else if (demo.error && !real.error) winner = "real";
    else if (real.charCount > demo.charCount * 1.2 && real.durationMs < demo.durationMs * 1.5) winner = "real";
    else if (demo.durationMs < real.durationMs * 0.7) winner = "demo (faster)";
    else if (real.charCount > demo.charCount * 1.3) winner = "real (richer)";
    else winner = "comparable";

    const shortQ = question.slice(0, 35);
    lines.push(
      `| ${shortQ}... | ${(demo.durationMs / 1000).toFixed(1)}s | ${demo.charCount} | ${demoTools} | ${(real.durationMs / 1000).toFixed(1)}s | ${real.charCount} | ${realTools} | ${winner} |`
    );
  }

  // Summary
  const demos = allResults.filter(r => r.mode === "demo" && !r.error);
  const reals = allResults.filter(r => r.mode === "real" && !r.error);

  const avgDemoTime = demos.length ? Math.round(demos.reduce((s, r) => s + r.durationMs, 0) / demos.length) : 0;
  const avgRealTime = reals.length ? Math.round(reals.reduce((s, r) => s + r.durationMs, 0) / reals.length) : 0;
  const avgDemoChars = demos.length ? Math.round(demos.reduce((s, r) => s + r.charCount, 0) / demos.length) : 0;
  const avgRealChars = reals.length ? Math.round(reals.reduce((s, r) => s + r.charCount, 0) / reals.length) : 0;
  const demoFails = allResults.filter(r => r.mode === "demo" && r.error).length;
  const realFails = allResults.filter(r => r.mode === "real" && r.error).length;

  lines.push("");
  lines.push("## Summary");
  lines.push(`| Metric | Demo | Real |`);
  lines.push(`|--------|------|------|`);
  lines.push(`| Avg response time | ${(avgDemoTime / 1000).toFixed(1)}s | ${(avgRealTime / 1000).toFixed(1)}s |`);
  lines.push(`| Avg content length | ${avgDemoChars} chars | ${avgRealChars} chars |`);
  lines.push(`| Failures | ${demoFails}/9 | ${realFails}/9 |`);
  lines.push(`| Uses live data | No (canned) | Yes |`);

  const report = lines.join("\n");
  console.log("\n" + report);

  // Save to file
  const reportPath = "test-results/tippy-demo-vs-real.md";
  try {
    fs.mkdirSync("test-results", { recursive: true });
    fs.writeFileSync(reportPath, report);
    console.log(`\nReport saved to ${reportPath}`);
  } catch { /* */ }
});
