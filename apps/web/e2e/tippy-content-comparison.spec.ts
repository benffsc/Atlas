// @real-api - Captures full response text for demo vs real comparison
/**
 * Captures the actual Tippy response text for each curated question
 * in both demo and real mode, saves to a readable markdown file.
 */

import { test } from "@playwright/test";
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
  mode: string;
  content: string;
  durationMs: number;
  toolsUsed: string[];
  error: string | null;
}

async function askTippy(page: Page, question: string): Promise<Omit<Result, "question" | "mode">> {
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
      content = payload?.message || "";
      if (content.includes("doesn't have access")) { error = content; content = ""; }
    } catch { /* */ }
    return { content, durationMs, toolsUsed, error };
  }

  for (const part of body.split("\n\n")) {
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

const allResults: Result[] = [];

test.describe("Content Comparison @real-api", () => {
  test.setTimeout(180_000);

  // Run all questions sequentially: demo first, then real, for each question
  for (let i = 0; i < CURATED_QUESTIONS.length; i++) {
    const question = CURATED_QUESTIONS[i];
    const shortQ = question.slice(0, 40);

    test(`${i + 1}. "${shortQ}..." (demo then real)`, async ({ page }) => {
      // Demo mode (normal)
      const demo = await askTippy(page, question);
      allResults.push({ question, mode: "demo", ...demo });
      console.log(`[DEMO] ${shortQ}... → ${demo.durationMs}ms, ${demo.content.length} chars`);

      // Real mode (instruct to skip demo tools)
      const realQ = question + "\n\n[IMPORTANT: Do NOT use any tool whose name starts with 'demo_'. Use real tools only: analyze_place_situation, comprehensive_place_lookup, query_region_stats, query_cats_altered_in_area, run_sql, etc.]";
      const real = await askTippy(page, realQ);
      allResults.push({ question, mode: "real", ...real });
      console.log(`[REAL] ${shortQ}... → ${real.durationMs}ms, ${real.content.length} chars`);
    });
  }
});

test.afterAll(() => {
  const lines: string[] = [
    "# Tippy Content Comparison: Demo Tools vs Real Tools",
    `\nRun: ${new Date().toISOString()}\n`,
  ];

  for (const question of CURATED_QUESTIONS) {
    const demo = allResults.find(r => r.question === question && r.mode === "demo");
    const real = allResults.find(r => r.question === question && r.mode === "real");
    if (!demo || !real) continue;

    lines.push(`---\n`);
    lines.push(`## Q: ${question}\n`);
    lines.push(`### DEMO (${(demo.durationMs / 1000).toFixed(1)}s, tools: ${demo.toolsUsed.join(", ") || "none"})\n`);
    lines.push(demo.error ? `**ERROR:** ${demo.error}\n` : demo.content + "\n");
    lines.push(`### REAL (${(real.durationMs / 1000).toFixed(1)}s, tools: ${real.toolsUsed.join(", ") || "none"})\n`);
    lines.push(real.error ? `**ERROR:** ${real.error}\n` : real.content + "\n");
  }

  const report = lines.join("\n");
  try {
    fs.mkdirSync("test-results", { recursive: true });
    fs.writeFileSync("test-results/tippy-content-comparison.md", report);
    console.log("\nReport saved to test-results/tippy-content-comparison.md");
  } catch { /* */ }
});
