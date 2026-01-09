#!/usr/bin/env node
/**
 * clinichq_appointment_info_xlsx.mjs
 *
 * Ingests ClinicHQ appointment_info XLSX into trapper.staged_records.
 * Uses batched inserts for handling large files (100K+ rows).
 *
 * Usage:
 *   set -a && source .env && set +a
 *   node scripts/ingest/clinichq_appointment_info_xlsx.mjs --xlsx /path/to/file.xlsx
 *   node scripts/ingest/clinichq_appointment_info_xlsx.mjs --date 2026-01-09
 */

import fs from 'fs';
import path from 'path';
import { parseXlsxFile } from './_lib/xlsx_reader.mjs';
import { BatchIngestRunner, colors } from './_lib/batch_ingest.mjs';

const { green, red, yellow, cyan, reset, bold } = colors;

// Source identification
const SOURCE_SYSTEM = 'clinichq';
const SOURCE_TABLE = 'appointment_info';

// Default paths
const DEFAULT_INGEST_PATH = process.env.LOCAL_INGEST_PATH ||
  '/Users/benmisdiaz/Desktop/AI_Ingest';
const DEFAULT_DATE = '2026-01-09';

// ID field candidates for this source
const ID_FIELD_CANDIDATES = [
  'Appointment ID',
  'appointment_id',
  'Number',
  'ID',
  'id',
];

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    xlsxPath: null,
    date: DEFAULT_DATE,
    dryRun: false,
    verbose: false,
    batchSize: 500,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--xlsx':
        options.xlsxPath = args[++i];
        break;
      case '--date':
        options.date = args[++i];
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      case '--batch-size':
        options.batchSize = parseInt(args[++i], 10);
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
    }
  }

  return options;
}

function printUsage() {
  console.log(`
${bold}ClinicHQ Appointment Info Ingest${reset}
Ingests ClinicHQ appointment_info.xlsx into Atlas staging.
Uses batched inserts for handling large files.

${bold}Usage:${reset}
  node scripts/ingest/clinichq_appointment_info_xlsx.mjs --xlsx /path/to/file.xlsx
  node scripts/ingest/clinichq_appointment_info_xlsx.mjs --date 2026-01-09

${bold}Options:${reset}
  --xlsx <path>       Path to XLSX file
  --date <date>       Date folder to use (default: ${DEFAULT_DATE})
  --dry-run           Parse only, don't write to DB
  --batch-size <n>    Rows per batch (default: 500)
  --verbose, -v       Show detailed output
  --help, -h          Show this help

${bold}Environment:${reset}
  DATABASE_URL         Postgres connection string (required)
  LOCAL_INGEST_PATH    Base ingest folder
`);
}

async function main() {
  const options = parseArgs();
  const startTime = Date.now();

  console.log(`\n${bold}ClinicHQ Appointment Info Ingest${reset}`);
  console.log('═'.repeat(50));

  if (!process.env.DATABASE_URL) {
    console.error(`${red}Error:${reset} DATABASE_URL not set`);
    process.exit(1);
  }

  // Find XLSX file
  let xlsxPath = options.xlsxPath;
  if (!xlsxPath) {
    xlsxPath = path.join(DEFAULT_INGEST_PATH, 'clinichq', options.date, 'appointment_info.xlsx');
  }

  if (!fs.existsSync(xlsxPath)) {
    console.error(`${red}Error:${reset} File not found: ${xlsxPath}`);
    console.log(`${yellow}SKIP:${reset} No appointment_info.xlsx for ${options.date}`);
    process.exit(0);  // Graceful skip
  }

  xlsxPath = path.resolve(xlsxPath);
  const sourceFile = path.basename(xlsxPath);

  console.log(`\n${cyan}Source:${reset} ${xlsxPath}`);
  console.log(`${cyan}Mode:${reset} ${options.dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`${cyan}Batch Size:${reset} ${options.batchSize}`);

  // Parse XLSX - this loads entire file into memory
  // For files over 500K rows, consider streaming approach
  console.log(`\n${bold}Parsing XLSX...${reset}`);
  const parseStart = Date.now();
  const { headers, rows, sheetName } = parseXlsxFile(xlsxPath);
  const parseTime = Date.now() - parseStart;

  console.log(`  Sheet: ${sheetName}`);
  console.log(`  Columns: ${headers.length}`);
  console.log(`  Rows: ${rows.length.toLocaleString()}`);
  console.log(`  Parse time: ${(parseTime / 1000).toFixed(1)}s`);

  if (options.verbose) {
    console.log(`\n${bold}Headers (first 10):${reset}`);
    headers.slice(0, 10).forEach((h, i) => console.log(`  ${i + 1}. ${h}`));
    if (headers.length > 10) console.log(`  ... and ${headers.length - 10} more`);
  }

  if (rows.length === 0) {
    console.log(`${yellow}Warning:${reset} No data rows`);
    process.exit(0);
  }

  if (options.dryRun) {
    console.log(`\n${bold}Dry run complete.${reset}`);
    console.log(`  Would ingest ${rows.length.toLocaleString()} rows in ~${Math.ceil(rows.length / options.batchSize)} batches`);
    process.exit(0);
  }

  // Initialize runner
  const runner = new BatchIngestRunner({
    sourceSystem: SOURCE_SYSTEM,
    sourceTable: SOURCE_TABLE,
    batchSize: options.batchSize,
    idFieldCandidates: ID_FIELD_CANDIDATES,
  });

  try {
    console.log(`\n${bold}Connecting to database...${reset}`);
    await runner.connect();
    console.log(`  ${green}✓${reset} Connected (pool)`);

    const runId = await runner.createRun(xlsxPath, rows.length);
    console.log(`  ${green}✓${reset} Created run: ${runId.substring(0, 8)}...`);

    console.log(`\n${bold}Ingesting ${rows.length.toLocaleString()} rows in batches of ${options.batchSize}...${reset}`);

    const totalBatches = Math.ceil(rows.length / options.batchSize);
    let lastLogTime = Date.now();

    const stats = await runner.processBatches(rows, sourceFile, (batchNum, total, currentStats) => {
      const now = Date.now();
      // Log progress every 5 seconds or on last batch
      if (now - lastLogTime > 5000 || batchNum === total) {
        const pct = ((batchNum / total) * 100).toFixed(1);
        const elapsed = ((now - startTime) / 1000).toFixed(0);
        const rowsProcessed = Math.min(batchNum * options.batchSize, rows.length);
        const rate = Math.round(rowsProcessed / (elapsed || 1));
        console.log(`  [${pct}%] Batch ${batchNum}/${total} | ${rowsProcessed.toLocaleString()} rows | ${elapsed}s | ~${rate} rows/s`);
        lastLogTime = now;
      }
    });

    await runner.completeRun();

    const durationMs = Date.now() - startTime;

    console.log(`\n${bold}Summary${reset}`);
    console.log('─'.repeat(50));
    console.log(`  Total rows:       ${stats.total.toLocaleString()}`);
    console.log(`  ${green}Inserted:${reset}         ${stats.inserted.toLocaleString()}`);
    console.log(`  ${yellow}Skipped (dupe):${reset}   ${stats.skipped.toLocaleString()}`);
    console.log(`  Linked to run:    ${stats.linked.toLocaleString()}`);
    console.log(`  Batches:          ${stats.batches}`);
    if (stats.errors > 0) console.log(`  ${red}Errors:${reset}           ${stats.errors}`);
    console.log(`  Duration:         ${(durationMs / 1000).toFixed(1)}s`);
    console.log(`  Rate:             ${Math.round(stats.total / (durationMs / 1000))} rows/s`);

    await runner.disconnect();
    process.exit(stats.errors > 0 ? 1 : 0);

  } catch (e) {
    console.error(`\n${red}Error:${reset} ${e.message}`);
    if (runner.runId) {
      await runner.failRun(e.message);
    }
    await runner.disconnect();
    process.exit(1);
  }
}

main().catch(e => {
  console.error(`${red}Fatal error:${reset}`, e.message);
  process.exit(1);
});
