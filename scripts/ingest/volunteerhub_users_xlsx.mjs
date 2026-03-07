#!/usr/bin/env node
/**
 * volunteerhub_users_xlsx.mjs
 *
 * Ingests VolunteerHub users XLSX into ops.staged_records.
 */

import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { parseXlsxFile } from './_lib/xlsx_reader.mjs';
import { IngestRunner, detectBaseSuspectIssues, detectAddressSuspectIssues, colors } from './_lib/ingest_run.mjs';

const { Client } = pg;
const { green, red, yellow, cyan, reset, bold } = colors;

const SOURCE_SYSTEM = 'volunteerhub';
const SOURCE_TABLE = 'users';
const DEFAULT_INGEST_PATH = process.env.LOCAL_INGEST_PATH || '/Users/benmisdiaz/Desktop/AI_Ingest';
const DEFAULT_DATE = '2026-01-09';
const ID_FIELD_CANDIDATES = ['User ID', 'Volunteer ID', 'user_id', 'Email', 'ID'];

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { xlsxPath: null, date: DEFAULT_DATE, dryRun: false, verbose: false };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--xlsx': options.xlsxPath = args[++i]; break;
      case '--date': options.date = args[++i]; break;
      case '--dry-run': options.dryRun = true; break;
      case '--verbose': case '-v': options.verbose = true; break;
      case '--help': case '-h':
        console.log(`Usage: node ${path.basename(process.argv[1])} --xlsx <path> | --date <date>`);
        process.exit(0);
    }
  }
  return options;
}

function findFile(dateDir) {
  if (!fs.existsSync(dateDir)) return null;
  const files = fs.readdirSync(dateDir);
  for (const f of files) {
    if (/^volunteerhub.*\.xlsx$/i.test(f)) {
      return path.join(dateDir, f);
    }
  }
  return null;
}

function detectSuspectIssues(row) {
  const issues = detectBaseSuspectIssues(row);
  const address = row['Address'] || row['Street Address'] || row['address'] || '';
  issues.push(...detectAddressSuspectIssues(address));
  return issues;
}

async function main() {
  const options = parseArgs();
  const startTime = Date.now();

  console.log(`\n${bold}VolunteerHub Users Ingest${reset}`);
  console.log('═'.repeat(50));

  if (!process.env.DATABASE_URL) {
    console.error(`${red}Error:${reset} DATABASE_URL not set`);
    process.exit(1);
  }

  let xlsxPath = options.xlsxPath;
  if (!xlsxPath) {
    const dateDir = path.join(DEFAULT_INGEST_PATH, 'volunteerhub', options.date);
    xlsxPath = findFile(dateDir);
  }
  if (!xlsxPath || !fs.existsSync(xlsxPath)) {
    console.log(`${yellow}SKIP:${reset} No VolunteerHub users file found for ${options.date}`);
    process.exit(0);
  }
  xlsxPath = path.resolve(xlsxPath);

  console.log(`${cyan}Source:${reset} ${xlsxPath}`);
  const { headers, rows, sheetName } = parseXlsxFile(xlsxPath);
  console.log(`  Sheet: ${sheetName}, Columns: ${headers.length}, Rows: ${rows.length}`);

  if (rows.length === 0) { console.log(`${yellow}Warning:${reset} No data rows`); process.exit(0); }

  const stats = { total: rows.length, inserted: 0, skipped: 0, linked: 0, suspect: 0, errors: 0, missingId: 0 };
  let client = null, runner = null;

  if (!options.dryRun) {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    runner = new IngestRunner(client, SOURCE_SYSTEM, SOURCE_TABLE, {
      idFieldCandidates: ID_FIELD_CANDIDATES,
      detectSuspect: detectSuspectIssues,
    });
    await runner.createRun(xlsxPath, rows.length);
  }

  for (let i = 0; i < rows.length; i++) {
    if (options.dryRun) { stats.inserted++; stats.linked++; continue; }
    const result = await runner.processRow(rows[i], i + 2, path.basename(xlsxPath), options);
    if (result.error) stats.errors++;
    else {
      if (result.wasInserted) stats.inserted++; else stats.skipped++;
      stats.linked++;
      if (result.issues.length > 0) stats.suspect++;
      if (!result.sourceRowId) stats.missingId++;
    }
  }

  if (runner) { await runner.completeRun(stats); await client.end(); }
  console.log(`\n${bold}Summary:${reset} ${stats.inserted} inserted, ${stats.skipped} skipped (${Date.now() - startTime}ms)`);
  process.exit(stats.errors > 0 ? 1 : 0);
}

main().catch(e => { console.error(`${red}Fatal:${reset}`, e.message); process.exit(1); });
