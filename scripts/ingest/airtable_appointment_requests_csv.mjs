#!/usr/bin/env node
/**
 * airtable_appointment_requests_csv.mjs
 *
 * Ingests Airtable Appointment Requests CSV into ops.staged_records
 * Uses shared ingest libraries for RFC 4180 parsing and run tracking.
 *
 * Usage:
 *   set -a && source .env && set +a
 *   node scripts/ingest/airtable_appointment_requests_csv.mjs --csv /path/to/file.csv
 *   node scripts/ingest/airtable_appointment_requests_csv.mjs --csv /path/to/file.csv --dry-run
 */

import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { parseCsvFile } from './_lib/csv_rfc4180.mjs';
import {
  IngestRunner,
  findLatestCsv,
  detectBaseSuspectIssues,
  detectAddressSuspectIssues,
  colors,
} from './_lib/ingest_run.mjs';

const { Client } = pg;
const { green, red, yellow, cyan, reset, bold } = colors;

// Source identification
const SOURCE_SYSTEM = 'airtable';
const SOURCE_TABLE = 'appointment_requests';

// Default ingest path
const DEFAULT_INGEST_PATH = process.env.LOCAL_INGEST_PATH ||
  '/Users/benmisdiaz/Desktop/AI_Ingest';

// ID field candidates (in priority order)
const ID_FIELD_CANDIDATES = [
  'Record ID',
  'Airtable Record ID',
];

// ============================================
// Argument Parsing
// ============================================

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    csvPath: null,
    dryRun: false,
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--csv':
        options.csvPath = args[++i];
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
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
${bold}Usage:${reset}
  node scripts/ingest/airtable_appointment_requests_csv.mjs --csv /path/to/file.csv

${bold}Options:${reset}
  --csv <path>    Path to CSV file (required)
  --dry-run       Parse and validate only, don't write to DB
  --verbose, -v   Show detailed output
  --help, -h      Show this help

${bold}Environment:${reset}
  DATABASE_URL         Postgres connection string (required)
  LOCAL_INGEST_PATH    Default path for finding CSV files
`);
}

// ============================================
// Source-Specific Suspect Detection
// ============================================

function detectSuspectIssues(row) {
  const issues = detectBaseSuspectIssues(row);

  // Get address field (check common field names)
  const address = row['Address'] || row['address'] ||
                  row['Requester Address'] || row['requester_address'] || '';

  // Add address-specific issues
  issues.push(...detectAddressSuspectIssues(address));

  return issues;
}

// ============================================
// Main Processing
// ============================================

async function main() {
  const options = parseArgs();
  const startTime = Date.now();

  console.log(`\n${bold}Airtable Appointment Requests Ingest${reset}`);
  console.log('═'.repeat(50));

  // Check DATABASE_URL
  if (!process.env.DATABASE_URL) {
    console.error(`${red}Error:${reset} DATABASE_URL not set`);
    console.log('Run: set -a && source .env && set +a');
    process.exit(1);
  }

  // Find CSV file
  let csvPath = options.csvPath ||
    findLatestCsv(DEFAULT_INGEST_PATH, 'airtable/appointment_requests');

  if (!csvPath) {
    console.error(`${red}Error:${reset} No CSV file specified and none found in default location`);
    console.log(`Expected: ${DEFAULT_INGEST_PATH}/airtable/appointment_requests/*.csv`);
    printUsage();
    process.exit(1);
  }

  if (!fs.existsSync(csvPath)) {
    console.error(`${red}Error:${reset} CSV file not found: ${csvPath}`);
    process.exit(1);
  }

  csvPath = path.resolve(csvPath);
  const sourceFile = path.basename(csvPath);

  console.log(`\n${cyan}Source:${reset} ${csvPath}`);
  console.log(`${cyan}Mode:${reset} ${options.dryRun ? 'DRY RUN (no DB writes)' : 'LIVE'}`);

  // Parse CSV
  console.log(`\n${bold}Parsing CSV (RFC 4180)...${reset}`);
  const { headers, rows } = parseCsvFile(csvPath);
  console.log(`  Columns: ${headers.length}`);
  console.log(`  Rows: ${rows.length}`);

  if (rows.length === 0) {
    console.log(`${yellow}Warning:${reset} No data rows to ingest`);
    process.exit(0);
  }

  // Stats
  const stats = {
    total: rows.length,
    inserted: 0,
    skipped: 0,
    linked: 0,
    suspect: 0,
    errors: 0,
    missingId: 0,
  };

  // Connect to database
  let client = null;
  let runner = null;

  if (!options.dryRun) {
    console.log(`\n${bold}Connecting to database...${reset}`);
    client = new Client({ connectionString: process.env.DATABASE_URL });
    try {
      await client.connect();
      console.log(`  ${green}✓${reset} Connected`);

      // Create runner
      runner = new IngestRunner(client, SOURCE_SYSTEM, SOURCE_TABLE, {
        idFieldCandidates: ID_FIELD_CANDIDATES,
        detectSuspect: detectSuspectIssues,
      });

      const runId = await runner.createRun(csvPath, rows.length);
      console.log(`  ${green}✓${reset} Created run: ${runId.substring(0, 8)}...`);
    } catch (e) {
      console.error(`  ${red}✗${reset} Connection failed: ${e.message}`);
      process.exit(1);
    }
  }

  // Ingest rows
  console.log(`\n${bold}Ingesting rows...${reset}`);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const csvRowNumber = i + 2; // 1-indexed, +1 for header

    if (options.dryRun) {
      const issues = detectSuspectIssues(row);
      if (options.verbose) {
        console.log(`  [dry-run] Row ${csvRowNumber}: issues=${issues.length}`);
      }
      stats.inserted++;
      stats.linked++;
      if (issues.length > 0) stats.suspect++;
      continue;
    }

    const result = await runner.processRow(row, csvRowNumber, sourceFile, options);

    if (result.error) {
      stats.errors++;
      console.error(`  ${red}!${reset} Row ${csvRowNumber} error: ${result.error}`);
    } else {
      if (result.wasInserted) {
        stats.inserted++;
        if (options.verbose) {
          console.log(`  ${green}+${reset} Row ${csvRowNumber}: inserted`);
        }
      } else {
        stats.skipped++;
        if (options.verbose) {
          console.log(`  ${yellow}=${reset} Row ${csvRowNumber}: exists`);
        }
      }
      stats.linked++;

      if (result.issues.length > 0) {
        stats.suspect++;
        if (options.verbose) {
          console.log(`    ${yellow}!${reset} Suspect: ${result.issues.map(i => i.type).join(', ')}`);
        }
      }

      if (!result.sourceRowId) {
        stats.missingId++;
      }
    }
  }

  // Complete run
  if (runner) {
    await runner.completeRun(stats);
    await client.end();
  }

  const durationMs = Date.now() - startTime;

  // Print summary
  console.log(`\n${bold}Summary${reset}`);
  console.log('─'.repeat(50));
  console.log(`  Total rows:       ${stats.total}`);
  console.log(`  ${green}Inserted:${reset}         ${stats.inserted}`);
  console.log(`  ${yellow}Skipped (dupe):${reset}   ${stats.skipped}`);
  console.log(`  Linked to run:    ${stats.linked}`);
  console.log(`  ${yellow}Suspect rows:${reset}     ${stats.suspect}`);
  console.log(`  Missing ID:       ${stats.missingId}`);
  if (stats.errors > 0) {
    console.log(`  ${red}Errors:${reset}           ${stats.errors}`);
  }
  console.log(`  Duration:         ${durationMs}ms`);

  // ID coverage
  const idCoverage = ((stats.total - stats.missingId) / stats.total * 100).toFixed(1);
  console.log(`\n${cyan}source_row_id coverage:${reset} ${idCoverage}%`);

  if (options.dryRun) {
    console.log(`\n${yellow}Dry run complete. Run without --dry-run to insert.${reset}`);
  }

  process.exit(stats.errors > 0 ? 1 : 0);
}

main().catch(e => {
  console.error(`${red}Fatal error:${reset}`, e.message);
  console.error(e.stack);
  process.exit(1);
});
