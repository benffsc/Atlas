// @real-api — Uses Tippy to proactively find data quality issues
/**
 * Tippy Data Gap Hunter
 *
 * Asks Tippy investigative questions that surface data quality issues,
 * identity resolution problems, and coverage gaps. Saves full responses
 * to a report file for review.
 */

import { test } from "@playwright/test";
import * as fs from "fs";
import { askTippyStreaming, type TippyStreamingResult } from "./helpers/auth-api";

const INVESTIGATION_QUESTIONS = [
  // Identity resolution gaps
  "Are there any phone numbers shared by more than 3 different people in our system? Show me the top 10 with the most people sharing them.",
  "Are there any email addresses shared by more than 2 different people? Show the email, person count, and names.",
  "Find clinic accounts classified as 'resident' that have more than 15 cats. These might be misclassified trappers or caretakers. Show account name, cat count, and number of distinct places.",

  // Stale/orphaned data
  "How many cats have no place link at all? And how many of those have appointments — meaning we should be able to link them?",
  "Are there people in the system with no email AND no phone (no identifiers at all)? How many, and what's their source system?",
  "Find places that have cats but no person linked — orphaned colonies with no known caretaker.",

  // Data consistency
  "Are there any cats marked as 'intact' that also have appointment records showing spay/neuter procedures? That would be a data conflict.",
  "Find requests where estimated_cat_count is more than 3x the actual cats linked to that place. The estimate might be stale or the linking might be incomplete.",
  "Are there any appointments from the last 90 days where the place_id is NULL — meaning we couldn't figure out where the cat lives?",

  // Coverage analysis
  "Which cities in Sonoma County have fewer than 50 cats in our system? These might be coverage gaps where we haven't done outreach.",
  "Find zip codes where we have places but zero requests have ever been filed. These are areas we know about but haven't actively worked.",
];

interface Result {
  question: string;
  content: string;
  durationMs: number;
  toolsUsed: string[];
  error: string | null;
}

const allResults: Result[] = [];

test.describe("Tippy Data Gap Hunt @real-api", () => {
  test.setTimeout(180_000);

  for (let i = 0; i < INVESTIGATION_QUESTIONS.length; i++) {
    const question = INVESTIGATION_QUESTIONS[i];
    const shortQ = question.slice(0, 50);

    test(`${i + 1}. "${shortQ}..."`, async ({ page }) => {
      const result = await askTippyStreaming(page, question);
      allResults.push({ question, ...result });
      console.log(`[GAP HUNT ${i + 1}] ${shortQ}... → ${result.durationMs}ms, ${result.content.length} chars, tools: [${result.toolsUsed.join(", ")}]`);
    });
  }
});

test.afterAll(() => {
  const lines: string[] = [
    "# Tippy Data Gap Hunt Results",
    `\nRun: ${new Date().toISOString()}\n`,
  ];

  for (const r of allResults) {
    lines.push(`---\n`);
    lines.push(`## Q: ${r.question}\n`);
    lines.push(`**Time:** ${(r.durationMs / 1000).toFixed(1)}s | **Tools:** ${r.toolsUsed.join(", ") || "none"}\n`);
    if (r.error) {
      lines.push(`**ERROR:** ${r.error}\n`);
    } else {
      lines.push(r.content + "\n");
    }
  }

  const report = lines.join("\n");
  try {
    fs.mkdirSync("test-results", { recursive: true });
    fs.writeFileSync("test-results/tippy-data-gap-hunt.md", report);
    console.log("\nReport saved to test-results/tippy-data-gap-hunt.md");
  } catch { /* */ }
});
