/**
 * Tippy Test Result Logger
 *
 * Persists Tippy @real-api test results to JSONL files for reference.
 * Results are saved to test-results/tippy-archive/ and can be queried
 * to review past Tippy performance without re-running expensive tests.
 *
 * Usage in tests:
 *   import { createTippyLogger } from './tippy-result-logger';
 *   const logger = createTippyLogger('tippy-accuracy');
 *   const result = await logger.askAndLog(page, 'How many cats at 123 Main?');
 *
 * FFS-551: Phase 0 — Test infrastructure & result archiving
 */

import * as fs from "fs";
import * as path from "path";
import type { Page } from "@playwright/test";

export interface TippyLogEntry {
  timestamp: string;
  test_file: string;
  test_name?: string;
  question: string;
  response_text: string;
  response_time_ms: number;
  passed: boolean;
  error?: string;
  conversation_id?: string;
  http_status: number;
}

const ARCHIVE_DIR = path.join(
  __dirname,
  "..",
  "..",
  "test-results",
  "tippy-archive"
);

function ensureArchiveDir() {
  if (!fs.existsSync(ARCHIVE_DIR)) {
    fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  }
}

function getLogFilePath(): string {
  const date = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  return path.join(ARCHIVE_DIR, `tippy-results-${date}.jsonl`);
}

function appendEntry(entry: TippyLogEntry) {
  ensureArchiveDir();
  const filePath = getLogFilePath();
  const line = JSON.stringify(entry) + "\n";
  fs.appendFileSync(filePath, line, "utf-8");
}

/**
 * Create a Tippy logger scoped to a test file.
 * Wraps askTippy calls with timing and result persistence.
 */
export function createTippyLogger(testFile: string) {
  return {
    /**
     * Ask Tippy a question and log the result to the archive.
     * Uses page.request.post() for authenticated requests.
     */
    async askAndLog(
      page: Page,
      question: string,
      options?: {
        testName?: string;
        conversationId?: string;
        history?: Array<{ role: "user" | "assistant"; content: string }>;
      }
    ): Promise<{
      ok: boolean;
      responseText: string;
      conversationId?: string;
      responseTimeMs: number;
    }> {
      const startTime = Date.now();
      let entry: TippyLogEntry;

      try {
        const response = await page.request.post("/api/tippy/chat", {
          data: {
            message: question,
            ...(options?.conversationId && {
              conversationId: options.conversationId,
            }),
            ...(options?.history && { history: options.history }),
          },
        });

        const responseTimeMs = Date.now() - startTime;
        const status = response.status();
        const data = await response.json().catch(() => ({}));

        const responseText =
          data.message || data.response || data.content || JSON.stringify(data);

        entry = {
          timestamp: new Date().toISOString(),
          test_file: testFile,
          test_name: options?.testName,
          question,
          response_text: responseText,
          response_time_ms: responseTimeMs,
          passed: response.ok(),
          conversation_id: data.conversationId,
          http_status: status,
        };

        appendEntry(entry);

        return {
          ok: response.ok(),
          responseText,
          conversationId: data.conversationId,
          responseTimeMs,
        };
      } catch (err) {
        const responseTimeMs = Date.now() - startTime;
        entry = {
          timestamp: new Date().toISOString(),
          test_file: testFile,
          test_name: options?.testName,
          question,
          response_text: "",
          response_time_ms: responseTimeMs,
          passed: false,
          error: err instanceof Error ? err.message : String(err),
          http_status: 0,
        };

        appendEntry(entry);

        return {
          ok: false,
          responseText: "",
          responseTimeMs,
        };
      }
    },
  };
}

/**
 * Read all Tippy log entries for a given date (YYYY-MM-DD).
 * Useful for generating reports.
 */
export function readTippyLogs(date?: string): TippyLogEntry[] {
  ensureArchiveDir();
  const targetDate = date || new Date().toISOString().split("T")[0];
  const filePath = path.join(ARCHIVE_DIR, `tippy-results-${targetDate}.jsonl`);

  if (!fs.existsSync(filePath)) {
    return [];
  }

  const content = fs.readFileSync(filePath, "utf-8");
  return content
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

/**
 * Generate a summary report from Tippy log entries.
 */
export function generateTippyReport(entries: TippyLogEntry[]): string {
  if (entries.length === 0) return "No Tippy test results found.";

  const passed = entries.filter((e) => e.passed).length;
  const failed = entries.length - passed;
  const avgTime = Math.round(
    entries.reduce((sum, e) => sum + e.response_time_ms, 0) / entries.length
  );
  const byFile = entries.reduce(
    (acc, e) => {
      acc[e.test_file] = (acc[e.test_file] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  let report = `# Tippy Test Results Summary\n\n`;
  report += `**Date:** ${entries[0]?.timestamp.split("T")[0]}\n`;
  report += `**Total:** ${entries.length} | **Passed:** ${passed} | **Failed:** ${failed}\n`;
  report += `**Avg Response Time:** ${avgTime}ms\n\n`;
  report += `## By Test File\n`;
  for (const [file, count] of Object.entries(byFile)) {
    const filePassed = entries.filter(
      (e) => e.test_file === file && e.passed
    ).length;
    report += `- ${file}: ${filePassed}/${count} passed\n`;
  }

  if (failed > 0) {
    report += `\n## Failed Questions\n`;
    for (const entry of entries.filter((e) => !e.passed)) {
      report += `- **${entry.question}**\n`;
      report += `  Error: ${entry.error || "Non-200 response"}\n`;
    }
  }

  return report;
}
