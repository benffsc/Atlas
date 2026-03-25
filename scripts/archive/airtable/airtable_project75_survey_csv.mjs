#!/usr/bin/env node
/**
 * airtable_project75_survey_csv.mjs
 *
 * Ingests Project 75 (after-clinic survey) CSV into ops.staged_records.
 * Uses shared ingest libraries for RFC 4180 parsing and run tracking.
 *
 * Usage:
 *   set -a && source .env && set +a
 *   node scripts/ingest/airtable_project75_survey_csv.mjs --csv /path/to/file.csv
 *   node scripts/ingest/airtable_project75_survey_csv.mjs --csv /path/to/file.csv --dry-run
 *
 * Environment:
 *   DATABASE_URL         Postgres connection string (required)
 *   LOCAL_INGEST_PATH    Default path for finding CSV files
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
// NOTE: Per CLAUDE.md, source_system MUST be exactly 'airtable', 'clinichq', or 'web_intake'
const SOURCE_SYSTEM = 'airtable';
const SOURCE_TABLE = 'project75_survey';

// Default ingest path
const DEFAULT_INGEST_PATH = process.env.LOCAL_INGEST_PATH ||
  '/Users/benmisdiaz/Desktop/AI_Ingest';

// ID field candidates (in priority order)
const ID_FIELD_CANDIDATES = [
  'Record ID',
  'Airtable Record ID',
  'record_id',
  'id',
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
${bold}Airtable Project 75 Survey Ingest${reset}
Ingests Project 75 after-clinic survey CSV into Atlas staging.

${bold}Usage:${reset}
  node scripts/ingest/airtable_project75_survey_csv.mjs --csv /path/to/file.csv

${bold}Options:${reset}
  --csv <path>    Path to CSV file (required, or auto-detect from default location)
  --dry-run       Parse and validate only, don't write to DB
  --verbose, -v   Show detailed output
  --help, -h      Show this help

${bold}Environment:${reset}
  DATABASE_URL         Postgres connection string (required)
  LOCAL_INGEST_PATH    Default path for finding CSV files

${bold}Default CSV Location:${reset}
  \${LOCAL_INGEST_PATH}/airtable_project75/project75_survey/*.csv

${bold}Source Identification:${reset}
  source_system = '${SOURCE_SYSTEM}'
  source_table  = '${SOURCE_TABLE}'

${bold}Example:${reset}
  set -a && source .env && set +a
  node scripts/ingest/airtable_project75_survey_csv.mjs \\
    --csv ~/Desktop/AI_Ingest/airtable_project75/project75_survey/export.csv
`);
}

// ============================================
// Source-Specific Suspect Detection
// ============================================

function detectSuspectIssues(row) {
  const issues = detectBaseSuspectIssues(row);

  // Get address field (check common field names for surveys)
  const address = row['Address'] || row['address'] ||
                  row['Street Address'] || row['street_address'] ||
                  row['Location'] || row['location'] || '';

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

  console.log(`\n${bold}Airtable Project 75 Survey Ingest${reset}`);
  console.log('═'.repeat(50));

  // Check DATABASE_URL
  if (!process.env.DATABASE_URL) {
    console.error(`${red}Error:${reset} DATABASE_URL not set`);
    console.log('Run: set -a && source .env && set +a');
    process.exit(1);
  }

  // Find CSV file
  let csvPath = options.csvPath ||
    findLatestCsv(DEFAULT_INGEST_PATH, 'airtable_project75/project75_survey');

  if (!csvPath) {
    console.error(`${red}Error:${reset} No CSV file specified and none found in default location`);
    console.log(`\n${yellow}To use this script:${reset}`);
    console.log(`  1. Export Project 75 survey data from Airtable`);
    console.log(`  2. Save to: ${DEFAULT_INGEST_PATH}/airtable_project75/project75_survey/`);
    console.log(`  3. Or specify path: --csv /path/to/export.csv`);
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

  if (options.verbose) {
    console.log(`\n${bold}Headers:${reset}`);
    headers.slice(0, 10).forEach((h, i) => console.log(`  ${i + 1}. ${h}`));
    if (headers.length > 10) {
      console.log(`  ... and ${headers.length - 10} more`);
    }
  }

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
  } else {
    console.log(`\n${bold}Verify:${reset}`);
    console.log(`  psql "$DATABASE_URL" -c "SELECT * FROM ops.v_ingest_run_summary WHERE source_system = '${SOURCE_SYSTEM}' ORDER BY started_at DESC LIMIT 1;"`);
  }

  process.exit(stats.errors > 0 ? 1 : 0);
}

main().catch(e => {
  console.error(`${red}Fatal error:${reset}`, e.message);
  console.error(e.stack);
  process.exit(1);
});
