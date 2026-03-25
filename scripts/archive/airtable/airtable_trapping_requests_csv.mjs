#!/usr/bin/env node
/**
 * airtable_trapping_requests_csv.mjs
 *
 * Ingests Airtable Trapping Requests CSV into ops.staged_records
 * with ingest run tracking and suspect row detection.
 *
 * Features:
 * - Robust RFC 4180 CSV parser (handles embedded newlines, quoted fields)
 * - Ingest run tracking with file SHA256
 * - Suspect row detection (attachment URLs, HTML, column drift)
 * - Idempotent: re-running links to existing rows without duplicating
 *
 * Usage:
 *   set -a && source .env && set +a
 *   node scripts/ingest/airtable_trapping_requests_csv.mjs --csv /path/to/file.csv
 *   node scripts/ingest/airtable_trapping_requests_csv.mjs --csv /path/to/file.csv --dry-run
 *
 * Environment:
 *   DATABASE_URL         Postgres connection string (required)
 *   LOCAL_INGEST_PATH    Default path for finding CSV files
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import pg from 'pg';

const { Client } = pg;

// Source identification
const SOURCE_SYSTEM = 'airtable';
const SOURCE_TABLE = 'trapping_requests';

// Default ingest path
const DEFAULT_INGEST_PATH = process.env.LOCAL_INGEST_PATH ||
  '/Users/benmisdiaz/Desktop/AI_Ingest';

// Colors for output
const green = '\x1b[32m';
const red = '\x1b[31m';
const yellow = '\x1b[33m';
const cyan = '\x1b[36m';
const reset = '\x1b[0m';
const bold = '\x1b[1m';

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
  node scripts/ingest/airtable_trapping_requests_csv.mjs --csv /path/to/file.csv

${bold}Options:${reset}
  --csv <path>    Path to CSV file (required)
  --dry-run       Parse and validate only, don't write to DB
  --verbose, -v   Show detailed output
  --help, -h      Show this help

${bold}Environment:${reset}
  DATABASE_URL         Postgres connection string (required)
  LOCAL_INGEST_PATH    Default path for finding CSV files

${bold}Features:${reset}
  - Ingest run tracking with file SHA256
  - Suspect row detection (attachment URLs, HTML, column drift)
  - Idempotent: links existing rows without duplicating

${bold}Example:${reset}
  set -a && source .env && set +a
  node scripts/ingest/airtable_trapping_requests_csv.mjs \\
    --csv ~/Desktop/AI_Ingest/airtable/trapping_requests/export.csv
`);
}

// ============================================
// File Utilities
// ============================================

function findLatestCsv() {
  const searchDir = path.join(DEFAULT_INGEST_PATH, 'airtable', 'trapping_requests');

  if (!fs.existsSync(searchDir)) {
    return null;
  }

  const files = fs.readdirSync(searchDir)
    .filter(f => f.endsWith('.csv'))
    .map(f => ({
      name: f,
      path: path.join(searchDir, f),
      mtime: fs.statSync(path.join(searchDir, f)).mtime,
    }))
    .sort((a, b) => b.mtime - a.mtime);

  return files.length > 0 ? files[0].path : null;
}

function computeFileSha256(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

// ============================================
// RFC 4180 Compliant CSV Parser
// Handles: quoted fields, embedded newlines, escaped quotes
// ============================================

function parseCsvRfc4180(content) {
  const rows = [];
  let currentRow = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;

  while (i < content.length) {
    const char = content[i];
    const nextChar = content[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // Escaped quote ("") -> single quote
          currentField += '"';
          i += 2;
        } else {
          // End of quoted field
          inQuotes = false;
          i++;
        }
      } else {
        // Any character inside quotes (including newlines)
        currentField += char;
        i++;
      }
    } else {
      if (char === '"') {
        // Start of quoted field
        inQuotes = true;
        i++;
      } else if (char === ',') {
        // End of field
        currentRow.push(currentField.trim());
        currentField = '';
        i++;
      } else if (char === '\r' && nextChar === '\n') {
        // CRLF line ending
        currentRow.push(currentField.trim());
        rows.push(currentRow);
        currentRow = [];
        currentField = '';
        i += 2;
      } else if (char === '\n') {
        // LF line ending
        currentRow.push(currentField.trim());
        rows.push(currentRow);
        currentRow = [];
        currentField = '';
        i++;
      } else if (char === '\r') {
        // CR line ending (old Mac)
        currentRow.push(currentField.trim());
        rows.push(currentRow);
        currentRow = [];
        currentField = '';
        i++;
      } else {
        currentField += char;
        i++;
      }
    }
  }

  // Handle last field/row
  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    rows.push(currentRow);
  }

  // Filter out empty rows
  return rows.filter(row => row.length > 0 && row.some(cell => cell !== ''));
}

function parseCsvFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');

  // Remove BOM if present
  const cleanContent = content.charCodeAt(0) === 0xFEFF
    ? content.slice(1)
    : content;

  const rows = parseCsvRfc4180(cleanContent);

  if (rows.length < 2) {
    throw new Error('CSV file is empty or has no data rows');
  }

  const headers = rows[0];
  const dataRows = rows.slice(1);

  // Convert to objects
  const objects = dataRows.map(values => {
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] || '';
    }
    return row;
  });

  return { headers, rows: objects };
}

// ============================================
// Row Processing
// ============================================

function computeRowHash(row) {
  const normalized = {};

  for (const key of Object.keys(row).sort()) {
    let value = row[key];

    if (typeof value === 'string') {
      value = value.trim().toLowerCase();
    }

    // Skip empty values for hash stability
    if (value !== '' && value !== null && value !== undefined) {
      normalized[key] = value;
    }
  }

  const json = JSON.stringify(normalized);
  return crypto.createHash('sha256').update(json).digest('hex').substring(0, 32);
}

/**
 * Extract Airtable record ID from row
 * Priority: Record ID > LookupRecordIDPrimaryReq > record_id > id
 */
function extractSourceRowId(row) {
  const idFields = [
    'Record ID',
    'Airtable Record ID',
    'LookupRecordIDPrimaryReq',  // Fallback for linked records
    'record_id',
    'id',
    'ID',
  ];

  for (const field of idFields) {
    const value = row[field];
    if (value && typeof value === 'string') {
      const trimmed = value.trim();
      // Valid Airtable record IDs start with "rec"
      if (trimmed && (trimmed.startsWith('rec') || !idFields.slice(0, 2).includes(field))) {
        return trimmed;
      }
    }
  }

  return null;
}

/**
 * Detect suspect row issues
 * Returns array of issue objects: { type, severity, details }
 */
function detectSuspectIssues(row) {
  const issues = [];

  // Get relevant fields
  const address = row['Address'] || row['address'] || '';
  const caseNumber = row['Case Number'] || row['case_number'] || '';
  const mapImage = row['Map Image'] || row['map_image'] || '';

  // Check: Address contains attachment URL
  if (address.includes('airtableusercontent') || address.includes('v5.airtableusercontent')) {
    issues.push({
      type: 'address_has_attachment',
      severity: 2,
      details: `Address contains attachment URL: ${address.substring(0, 100)}...`,
    });
  }

  // Check: Case Number looks like HTML
  if (caseNumber.includes('<br') || caseNumber.includes('<div') ||
      caseNumber.includes('</') || caseNumber.includes('<p')) {
    issues.push({
      type: 'case_number_looks_html',
      severity: 2,
      details: `Case Number contains HTML: ${caseNumber.substring(0, 100)}...`,
    });
  }

  // Check: Map Image is state code or ZIP (column drift)
  const mapImageTrimmed = mapImage.trim().toUpperCase();
  if (mapImageTrimmed === 'CA' || mapImageTrimmed === 'CALIFORNIA' ||
      /^[0-9]{5}(-[0-9]{4})?$/.test(mapImageTrimmed)) {
    issues.push({
      type: 'map_image_column_drift',
      severity: 2,
      details: `Map Image appears to be state/ZIP (column misalignment): ${mapImage}`,
    });
  }

  // Check: Address is junk (too short, ZIP-only, state-only)
  const addressTrimmed = address.trim();
  if (addressTrimmed && addressTrimmed.length > 0) {
    if (/^[0-9]{5}(-[0-9]{4})?$/.test(addressTrimmed)) {
      issues.push({
        type: 'address_is_junk',
        severity: 2,
        details: `Address is ZIP-only: ${addressTrimmed}`,
      });
    } else if (addressTrimmed.toUpperCase() === 'CA' || addressTrimmed.toUpperCase() === 'CALIFORNIA') {
      issues.push({
        type: 'address_is_junk',
        severity: 2,
        details: `Address is state-only: ${addressTrimmed}`,
      });
    } else if (addressTrimmed.length < 5) {
      issues.push({
        type: 'address_is_junk',
        severity: 1,
        details: `Address too short: ${addressTrimmed}`,
      });
    } else if (!/[0-9]/.test(addressTrimmed)) {
      issues.push({
        type: 'address_is_junk',
        severity: 1,
        details: `Address has no digits (no street number): ${addressTrimmed}`,
      });
    }
  }

  return issues;
}

// ============================================
// Database Operations
// ============================================

async function createIngestRun(client, filePath, fileName, fileSha256, rowCount) {
  const result = await client.query(`
    INSERT INTO ops.ingest_runs (
      source_system,
      source_table,
      source_file_path,
      source_file_name,
      source_file_sha256,
      row_count,
      run_status,
      started_at
    ) VALUES ($1, $2, $3, $4, $5, $6, 'running', NOW())
    RETURNING run_id
  `, [SOURCE_SYSTEM, SOURCE_TABLE, filePath, fileName, fileSha256, rowCount]);

  return result.rows[0].run_id;
}

async function updateIngestRunComplete(client, runId, stats, durationMs) {
  await client.query(`
    UPDATE ops.ingest_runs
    SET
      rows_inserted = $2,
      rows_linked = $3,
      rows_suspect = $4,
      run_status = 'completed',
      run_duration_ms = $5,
      completed_at = NOW()
    WHERE run_id = $1
  `, [runId, stats.inserted, stats.linked, stats.suspect, durationMs]);
}

async function insertStagedRecord(client, row, sourceFile, rowHash, sourceRowId) {
  const result = await client.query(`
    INSERT INTO ops.staged_records (
      source_system,
      source_table,
      source_row_id,
      source_file,
      row_hash,
      payload,
      created_at,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
    ON CONFLICT (source_system, source_table, row_hash)
    DO UPDATE SET updated_at = NOW()
    RETURNING id, (xmax = 0) AS was_inserted
  `, [
    SOURCE_SYSTEM,
    SOURCE_TABLE,
    sourceRowId,
    sourceFile,
    rowHash,
    JSON.stringify(row),
  ]);

  return {
    id: result.rows[0].id,
    wasInserted: result.rows[0].was_inserted,
  };
}

async function linkRunRecord(client, runId, stagedRecordId, csvRowNumber, wasInserted) {
  await client.query(`
    INSERT INTO ops.ingest_runs (run_id, staged_record_id, csv_row_number, was_inserted)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (run_id, staged_record_id) DO NOTHING
  `, [runId, stagedRecordId, csvRowNumber, wasInserted]);
}

async function insertDataIssue(client, stagedRecordId, issue, sourceRowId) {
  await client.query(`
    INSERT INTO ops.data_issues (
      entity_type,
      entity_id,
      issue_type,
      severity,
      details,
      first_seen_at,
      last_seen_at
    ) VALUES ('staged_record', $1, $2, $3, $4, NOW(), NOW())
    ON CONFLICT (entity_type, entity_id, issue_type)
    DO UPDATE SET
      last_seen_at = NOW(),
      details = EXCLUDED.details
  `, [
    stagedRecordId,
    issue.type,
    issue.severity,
    JSON.stringify({ message: issue.details, source_row_id: sourceRowId }),
  ]);
}

// ============================================
// Main Processing
// ============================================

async function ingestRows(client, rows, sourceFile, runId, options) {
  const stats = {
    total: rows.length,
    inserted: 0,
    skipped: 0,
    linked: 0,
    suspect: 0,
    errors: 0,
    missingId: 0,
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const csvRowNumber = i + 2; // 1-indexed, +1 for header
    const rowHash = computeRowHash(row);
    const sourceRowId = extractSourceRowId(row);

    if (!sourceRowId) {
      stats.missingId++;
    }

    if (options.dryRun) {
      if (options.verbose) {
        const issues = detectSuspectIssues(row);
        console.log(`  [dry-run] Row ${csvRowNumber}: hash=${rowHash.substring(0, 8)}... id=${sourceRowId || '(none)'} issues=${issues.length}`);
      }
      stats.inserted++;
      stats.linked++;
      continue;
    }

    try {
      // Insert/update staged record
      const { id: stagedRecordId, wasInserted } = await insertStagedRecord(
        client, row, sourceFile, rowHash, sourceRowId
      );

      if (wasInserted) {
        stats.inserted++;
        if (options.verbose) {
          console.log(`  ${green}+${reset} Row ${csvRowNumber}: inserted ${stagedRecordId.substring(0, 8)}...`);
        }
      } else {
        stats.skipped++;
        if (options.verbose) {
          console.log(`  ${yellow}=${reset} Row ${csvRowNumber}: exists ${stagedRecordId.substring(0, 8)}...`);
        }
      }

      // Link to run (even if record already existed)
      await linkRunRecord(client, runId, stagedRecordId, csvRowNumber, wasInserted);
      stats.linked++;

      // Detect and record suspect issues
      const issues = detectSuspectIssues(row);
      if (issues.length > 0) {
        stats.suspect++;
        for (const issue of issues) {
          await insertDataIssue(client, stagedRecordId, issue, sourceRowId);
        }
        if (options.verbose) {
          console.log(`    ${yellow}!${reset} Suspect: ${issues.map(i => i.type).join(', ')}`);
        }
      }
    } catch (e) {
      stats.errors++;
      console.error(`  ${red}!${reset} Row ${csvRowNumber} error: ${e.message}`);
    }
  }

  return stats;
}

async function main() {
  const options = parseArgs();
  const startTime = Date.now();

  console.log(`\n${bold}Airtable Trapping Requests Ingest${reset}`);
  console.log('═'.repeat(50));

  // Check DATABASE_URL
  if (!process.env.DATABASE_URL) {
    console.error(`${red}Error:${reset} DATABASE_URL not set`);
    console.log('Run: set -a && source .env && set +a');
    process.exit(1);
  }

  // Find CSV file
  let csvPath = options.csvPath || findLatestCsv();

  if (!csvPath) {
    console.error(`${red}Error:${reset} No CSV file specified and none found in default location`);
    console.log(`Expected: ${DEFAULT_INGEST_PATH}/airtable/trapping_requests/*.csv`);
    printUsage();
    process.exit(1);
  }

  if (!fs.existsSync(csvPath)) {
    console.error(`${red}Error:${reset} CSV file not found: ${csvPath}`);
    process.exit(1);
  }

  csvPath = path.resolve(csvPath);
  const sourceFile = path.basename(csvPath);
  const fileSha256 = computeFileSha256(csvPath);

  console.log(`\n${cyan}Source:${reset} ${csvPath}`);
  console.log(`${cyan}SHA256:${reset} ${fileSha256.substring(0, 16)}...`);
  console.log(`${cyan}Mode:${reset} ${options.dryRun ? 'DRY RUN (no DB writes)' : 'LIVE'}`);

  // Parse CSV with robust parser
  console.log(`\n${bold}Parsing CSV (RFC 4180)...${reset}`);
  const { headers, rows } = parseCsvFile(csvPath);
  console.log(`  Columns: ${headers.length}`);
  console.log(`  Rows: ${rows.length}`);

  // Show headers
  if (options.verbose) {
    console.log(`\n${bold}Headers:${reset}`);
    headers.forEach((h, i) => console.log(`  ${i + 1}. ${h}`));
  }

  if (rows.length === 0) {
    console.log(`${yellow}Warning:${reset} No data rows to ingest`);
    process.exit(0);
  }

  // Show sample row
  if (options.verbose && rows.length > 0) {
    console.log(`\n${bold}Sample row (first):${reset}`);
    const sample = rows[0];
    for (const key of Object.keys(sample).slice(0, 5)) {
      const val = (sample[key] || '').substring(0, 50);
      console.log(`  ${key}: ${val}${(sample[key] || '').length > 50 ? '...' : ''}`);
    }
  }

  // Connect to database
  let client = null;
  let runId = null;

  if (!options.dryRun) {
    console.log(`\n${bold}Connecting to database...${reset}`);
    client = new Client({ connectionString: process.env.DATABASE_URL });
    try {
      await client.connect();
      console.log(`  ${green}✓${reset} Connected`);

      // Create ingest run
      runId = await createIngestRun(client, csvPath, sourceFile, fileSha256, rows.length);
      console.log(`  ${green}✓${reset} Created run: ${runId.substring(0, 8)}...`);
    } catch (e) {
      console.error(`  ${red}✗${reset} Connection failed: ${e.message}`);
      process.exit(1);
    }
  }

  // Ingest rows
  console.log(`\n${bold}Ingesting rows...${reset}`);
  const stats = await ingestRows(client, rows, sourceFile, runId, options);

  // Complete run
  const durationMs = Date.now() - startTime;
  if (client && runId) {
    await updateIngestRunComplete(client, runId, stats, durationMs);
    await client.end();
  }

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
    console.log(`  psql "$DATABASE_URL" -c "SELECT * FROM ops.v_ingest_run_summary WHERE run_id = '${runId}'"`);
    console.log(`  psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM ops.ingest_runs WHERE run_id = '${runId}'"`);

    if (stats.suspect > 0) {
      console.log(`\n${yellow}Suspect rows detected. Review with:${reset}`);
      console.log(`  psql "$DATABASE_URL" -f sql/queries/QRY_002__staging_suspect_rows.sql`);
    }
  }

  process.exit(stats.errors > 0 ? 1 : 0);
}

main().catch(e => {
  console.error(`${red}Fatal error:${reset}`, e.message);
  console.error(e.stack);
  process.exit(1);
});
