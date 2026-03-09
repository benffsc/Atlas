#!/usr/bin/env node
/**
 * clinichq_scrape_import.mjs — Import ClinicHQ scrape CSV into source.clinichq_scrape
 *
 * Daniel's scraper captures the full ClinicHQ appointment UI. This script
 * imports the merged CSV with idempotent upsert (ON CONFLICT on record_id).
 *
 * Usage:
 *   node scripts/ingest/clinichq_scrape_import.mjs [path-to-csv]
 *
 * Default CSV: data/reference/clinichq_scrape/clinichq_appointments_medical_merged.csv
 *
 * FFS-361 / MIG_2879
 */

import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { parse } from 'csv-parse/sync';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const { Client } = pg;

const DEFAULT_CSV_PATH = 'data/reference/clinichq_scrape/clinichq_appointments_medical_merged.csv';
const BATCH_SIZE = 500;

const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
};
const { green, red, yellow, cyan, reset, bold } = colors;

// CSV columns → table columns (1:1 mapping, same names)
const TABLE_COLUMNS = [
  'record_id',
  'client_id',
  'appointment_date',
  'appointment_type',
  'checkout_status',
  'owner_display_name',
  'animal_heading_raw',
  'animal_name',
  'animal_id',
  'heading_labels_json',
  'animal_info_raw',
  'animal_species_sex_breed',
  'animal_colors',
  'animal_type',
  'animal_weight_info',
  'animal_age',
  'animal_microchip_info',
  'animal_trapper',
  'animal_caution',
  'animal_quick_notes',
  'animal_appointment_notes',
  'owner_info_text',
  'services_text',
  'sterilization_status',
  'weight',
  'microchip',
  'internal_medical_notes',
  'vet_notes',
  'scraped_at_utc',
];

// Columns that get updated on conflict (everything except record_id and imported_at)
const UPSERT_COLUMNS = TABLE_COLUMNS.filter(c => c !== 'record_id');

/**
 * Convert a CSV row value to a database-ready value.
 * Empty strings → NULL, heading_labels_json → parsed JSON, scraped_at_utc → timestamp.
 */
function transformValue(column, value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (column === 'heading_labels_json') {
    try {
      const parsed = JSON.parse(value);
      return JSON.stringify(parsed);
    } catch {
      return null;
    }
  }

  if (column === 'scraped_at_utc') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  return value;
}

/**
 * Build a batch INSERT ... ON CONFLICT DO UPDATE statement.
 */
function buildUpsertSQL(batchSize) {
  const placeholders = [];
  const colCount = TABLE_COLUMNS.length;

  for (let row = 0; row < batchSize; row++) {
    const rowPlaceholders = TABLE_COLUMNS.map((_, col) => `$${row * colCount + col + 1}`);
    placeholders.push(`(${rowPlaceholders.join(', ')})`);
  }

  const updateSet = UPSERT_COLUMNS
    .map(c => {
      if (c === 'heading_labels_json') {
        return `${c} = EXCLUDED.${c}::jsonb`;
      }
      if (c === 'scraped_at_utc') {
        return `${c} = EXCLUDED.${c}::timestamptz`;
      }
      return `${c} = EXCLUDED.${c}`;
    })
    .join(',\n        ');

  return `
    INSERT INTO source.clinichq_scrape (${TABLE_COLUMNS.join(', ')}, imported_at)
    VALUES ${placeholders.map(p => `${p.slice(0, -1)}, NOW())`).join(',\n           ')}
    ON CONFLICT (record_id) DO UPDATE SET
        ${updateSet},
        imported_at = NOW()
  `;
}

async function main() {
  const csvPath = process.argv[2] || DEFAULT_CSV_PATH;
  const resolvedPath = path.resolve(csvPath);

  console.log(`\n${bold}ClinicHQ Scrape Import${reset}`);
  console.log(`${bold}═══════════════════════════════════════════${reset}`);
  console.log(`  CSV: ${resolvedPath}`);

  // Validate env
  if (!process.env.DATABASE_URL) {
    console.error(`${red}Error:${reset} DATABASE_URL not set in .env`);
    process.exit(1);
  }

  // Read and parse CSV
  if (!fs.existsSync(resolvedPath)) {
    console.error(`${red}Error:${reset} CSV file not found: ${resolvedPath}`);
    process.exit(1);
  }

  console.log(`  Reading CSV...`);
  const csvContent = fs.readFileSync(resolvedPath, 'utf-8');
  const rows = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
  });

  if (rows.length === 0) {
    console.error(`${red}Error:${reset} CSV is empty`);
    process.exit(1);
  }

  // Deduplicate by record_id (keep last occurrence)
  const deduped = new Map();
  for (const row of rows) {
    deduped.set(row.record_id, row);
  }
  const dupeCount = rows.length - deduped.size;
  if (dupeCount > 0) {
    console.log(`  ${yellow}Deduplicated:${reset} ${dupeCount} duplicate record_ids removed (kept last occurrence)`);
  }
  const dedupedRows = Array.from(deduped.values());

  const csvColumns = Object.keys(dedupedRows[0]);
  console.log(`  Rows: ${rows.length} (${dedupedRows.length} unique)`);
  console.log(`  CSV columns: ${csvColumns.join(', ')}`);

  // Validate required columns exist
  const missing = TABLE_COLUMNS.filter(c => !csvColumns.includes(c));
  if (missing.length > 0) {
    console.error(`${red}Error:${reset} Missing CSV columns: ${missing.join(', ')}`);
    process.exit(1);
  }

  // Connect to database
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  const stats = { inserted: 0, updated: 0, errors: 0, batches: 0 };
  const startTime = Date.now();

  try {
    await client.connect();
    console.log(`  ${green}Connected to database${reset}`);

    // Process in batches
    const totalBatches = Math.ceil(dedupedRows.length / BATCH_SIZE);
    console.log(`\n  Processing ${dedupedRows.length} rows in ${totalBatches} batches of ${BATCH_SIZE}...`);

    for (let i = 0; i < dedupedRows.length; i += BATCH_SIZE) {
      const batch = dedupedRows.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;

      try {
        await client.query('BEGIN');

        // Build values array
        const values = [];
        const rowErrors = [];

        for (const row of batch) {
          for (const col of TABLE_COLUMNS) {
            try {
              values.push(transformValue(col, row[col]));
            } catch (err) {
              rowErrors.push(`record_id=${row.record_id}, col=${col}: ${err.message}`);
              values.push(null);
            }
          }
        }

        if (rowErrors.length > 0) {
          for (const err of rowErrors) {
            console.warn(`  ${yellow}Warning:${reset} ${err}`);
          }
        }

        // Build and execute upsert
        const colCount = TABLE_COLUMNS.length;
        const placeholderRows = [];
        for (let r = 0; r < batch.length; r++) {
          const rowPlaceholders = TABLE_COLUMNS.map((_, c) => `$${r * colCount + c + 1}`);
          placeholderRows.push(`(${rowPlaceholders.join(', ')}, NOW())`);
        }

        const updateSet = UPSERT_COLUMNS
          .map(c => `${c} = EXCLUDED.${c}`)
          .join(', ');

        const sql = `
          INSERT INTO source.clinichq_scrape (${TABLE_COLUMNS.join(', ')}, imported_at)
          VALUES ${placeholderRows.join(',\n                 ')}
          ON CONFLICT (record_id) DO UPDATE SET
              ${updateSet},
              imported_at = NOW()
        `;

        await client.query(sql, values);
        await client.query('COMMIT');

        stats.batches++;
        if (batchNum % 10 === 0 || batchNum === totalBatches) {
          const pct = Math.round((batchNum / totalBatches) * 100);
          process.stdout.write(`\r  ${cyan}Progress:${reset} ${batchNum}/${totalBatches} batches (${pct}%)`);
        }
      } catch (err) {
        await client.query('ROLLBACK');
        stats.errors++;
        console.error(`\n  ${red}Batch ${batchNum} failed:${reset} ${err.message}`);
      }
    }

    console.log('\n');

    // Get final counts
    const countResult = await client.query('SELECT COUNT(*) AS total FROM source.clinichq_scrape');
    const totalInTable = parseInt(countResult.rows[0].total, 10);

    // Summary
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`${bold}Summary${reset}`);
    console.log(`  CSV rows:       ${rows.length} (${dedupedRows.length} unique)`);
    console.log(`  Batches:        ${stats.batches} succeeded, ${stats.errors} failed`);
    console.log(`  Rows in table:  ${totalInTable}`);
    console.log(`  Duration:       ${duration}s`);

  } catch (error) {
    console.error(`${red}Error:${reset}`, error.message);
    process.exit(1);
  } finally {
    await client.end();
  }

  if (stats.errors > 0) {
    console.log(`\n${yellow}Completed with ${stats.errors} batch errors${reset}\n`);
    process.exit(1);
  }

  console.log(`\n${green}Import complete!${reset}\n`);
}

main().catch(e => {
  console.error(`${red}Fatal:${reset}`, e.message);
  process.exit(1);
});
