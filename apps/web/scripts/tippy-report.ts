#!/usr/bin/env npx tsx
/**
 * Tippy Test Results Report Generator
 *
 * Usage:
 *   npx tsx scripts/tippy-report.ts              # Today's results
 *   npx tsx scripts/tippy-report.ts 2026-03-14   # Specific date
 *   npx tsx scripts/tippy-report.ts --all         # All available dates
 *
 * FFS-551: Phase 0 — Test infrastructure & result archiving
 */

import * as fs from "fs";
import * as path from "path";

interface TippyLogEntry {
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

const ARCHIVE_DIR = path.join(__dirname, "..", "test-results", "tippy-archive");

function readLogs(date: string): TippyLogEntry[] {
  const filePath = path.join(ARCHIVE_DIR, `tippy-results-${date}.jsonl`);
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf-8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

function listDates(): string[] {
  if (!fs.existsSync(ARCHIVE_DIR)) return [];
  return fs
    .readdirSync(ARCHIVE_DIR)
    .filter((f) => f.startsWith("tippy-results-") && f.endsWith(".jsonl"))
    .map((f) => f.replace("tippy-results-", "").replace(".jsonl", ""))
    .sort();
}

function printReport(entries: TippyLogEntry[], date: string) {
  if (entries.length === 0) {
    console.log(`No Tippy results for ${date}`);
    return;
  }

  const passed = entries.filter((e) => e.passed).length;
  const failed = entries.length - passed;
  const avgTime = Math.round(
    entries.reduce((sum, e) => sum + e.response_time_ms, 0) / entries.length
  );

  console.log(`\n=== Tippy Test Results: ${date} ===`);
  console.log(`Total: ${entries.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log(`Avg Response Time: ${avgTime}ms\n`);

  // Group by test file
  const byFile = new Map<string, TippyLogEntry[]>();
  for (const e of entries) {
    const arr = byFile.get(e.test_file) || [];
    arr.push(e);
    byFile.set(e.test_file, arr);
  }

  for (const [file, fileEntries] of byFile) {
    const filePassed = fileEntries.filter((e) => e.passed).length;
    console.log(`  ${file}: ${filePassed}/${fileEntries.length}`);
  }

  if (failed > 0) {
    console.log(`\n--- Failed ---`);
    for (const entry of entries.filter((e) => !e.passed)) {
      console.log(`  Q: ${entry.question.substring(0, 80)}...`);
      console.log(`  Error: ${entry.error || `HTTP ${entry.http_status}`}`);
    }
  }

  // Show slowest queries
  const sorted = [...entries].sort(
    (a, b) => b.response_time_ms - a.response_time_ms
  );
  console.log(`\n--- Slowest (top 5) ---`);
  for (const entry of sorted.slice(0, 5)) {
    console.log(
      `  ${entry.response_time_ms}ms — ${entry.question.substring(0, 60)}...`
    );
  }
}

// Main
const arg = process.argv[2];

if (arg === "--all") {
  const dates = listDates();
  if (dates.length === 0) {
    console.log("No Tippy results found in test-results/tippy-archive/");
  } else {
    for (const date of dates) {
      printReport(readLogs(date), date);
    }
  }
} else {
  const date = arg || new Date().toISOString().split("T")[0];
  printReport(readLogs(date), date);
}
