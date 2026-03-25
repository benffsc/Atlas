#!/usr/bin/env node
/**
 * airtable_trappers_csv.mjs - Ingests Airtable trappers CSV
 */
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { parseCsvFile } from './_lib/csv_rfc4180.mjs';
import { IngestRunner, detectBaseSuspectIssues, detectAddressSuspectIssues, colors } from './_lib/ingest_run.mjs';

const { Client } = pg;
const { green, red, yellow, cyan, reset, bold } = colors;

const SOURCE_SYSTEM = 'airtable';
const SOURCE_TABLE = 'trappers';
const DEFAULT_INGEST_PATH = process.env.LOCAL_INGEST_PATH || '/Users/benmisdiaz/Desktop/AI_Ingest';
const DEFAULT_DATE = '2026-01-09';
const ID_FIELD_CANDIDATES = ['Record ID', 'Airtable Record ID', 'record_id', 'ID'];

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { csvPath: null, date: DEFAULT_DATE, dryRun: false, verbose: false };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--csv': options.csvPath = args[++i]; break;
      case '--date': options.date = args[++i]; break;
      case '--dry-run': options.dryRun = true; break;
      case '--verbose': case '-v': options.verbose = true; break;
    }
  }
  return options;
}

function findFile(dir) {
  if (!fs.existsSync(dir)) return null;
  for (const f of fs.readdirSync(dir)) {
    if (/^trappers.*\.csv$/i.test(f)) return path.join(dir, f);
  }
  return null;
}

function detectSuspectIssues(row) {
  const issues = detectBaseSuspectIssues(row);
  const address = row['Address'] || row['Street Address'] || '';
  issues.push(...detectAddressSuspectIssues(address));
  return issues;
}

async function main() {
  const options = parseArgs();
  console.log(`\n${bold}Airtable Trappers Ingest${reset}`);
  if (!process.env.DATABASE_URL) { console.error(`${red}Error:${reset} DATABASE_URL not set`); process.exit(1); }

  let csvPath = options.csvPath || findFile(path.join(DEFAULT_INGEST_PATH, 'airtable', 'trappers'));
  if (!csvPath || !fs.existsSync(csvPath)) {
    console.log(`${yellow}SKIP:${reset} No trappers CSV found`);
    process.exit(0);
  }

  const { headers, rows } = parseCsvFile(csvPath);
  console.log(`  ${cyan}Source:${reset} ${csvPath}, Rows: ${rows.length}`);
  if (rows.length === 0) { process.exit(0); }

  const stats = { total: rows.length, inserted: 0, skipped: 0, linked: 0, errors: 0 };
  if (options.dryRun) { stats.inserted = stats.linked = rows.length; }
  else {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    const runner = new IngestRunner(client, SOURCE_SYSTEM, SOURCE_TABLE, { idFieldCandidates: ID_FIELD_CANDIDATES, detectSuspect: detectSuspectIssues });
    await runner.createRun(csvPath, rows.length);
    for (let i = 0; i < rows.length; i++) {
      const result = await runner.processRow(rows[i], i + 2, path.basename(csvPath), options);
      if (result.error) stats.errors++; else { if (result.wasInserted) stats.inserted++; else stats.skipped++; stats.linked++; }
    }
    await runner.completeRun(stats);
    await client.end();
  }
  console.log(`  ${bold}Summary:${reset} ${stats.inserted} inserted, ${stats.skipped} skipped`);
  process.exit(stats.errors > 0 ? 1 : 0);
}
main().catch(e => { console.error(`${red}Fatal:${reset}`, e.message); process.exit(1); });
