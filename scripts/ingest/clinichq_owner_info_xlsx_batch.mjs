#!/usr/bin/env node
/**
 * clinichq_owner_info_xlsx_batch.mjs
 *
 * BATCH-OPTIMIZED version - ~10-20x faster than row-by-row
 * Ingests ClinicHQ owner_info XLSX into trapper.staged_records.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import pg from 'pg';
import { parseXlsxFile } from './_lib/xlsx_reader.mjs';
import { computeFileSha256, colors } from './_lib/ingest_run.mjs';

const { Client } = pg;
const { green, red, yellow, cyan, reset, bold } = colors;

const SOURCE_SYSTEM = 'clinichq';
const SOURCE_TABLE = 'owner_info';
const BATCH_SIZE = 500; // Rows per INSERT - sweet spot for performance vs memory

function computeRowHash(row) {
  const normalized = {};
  for (const key of Object.keys(row).sort()) {
    let value = row[key];
    if (typeof value === 'string') value = value.trim().toLowerCase();
    if (value !== '' && value !== null && value !== undefined) {
      normalized[key] = value;
    }
  }
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex').substring(0, 32);
}

function extractSourceRowId(row) {
  const candidates = ['Owner ID', 'Client ID', 'owner_id', 'ID', 'id'];
  for (const field of candidates) {
    const value = row[field];
    if (value && typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

async function main() {
  const xlsxPath = process.argv[2];
  if (!xlsxPath) {
    console.error(`Usage: node ${path.basename(process.argv[1])} <xlsx-path>`);
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error(`${red}Error:${reset} DATABASE_URL not set`);
    process.exit(1);
  }

  console.log(`\n${bold}ClinicHQ Owner Info Ingest (BATCH)${reset}`);
  console.log('═'.repeat(50));
  console.log(`${cyan}Source:${reset} ${xlsxPath}`);
  console.log(`${cyan}Batch size:${reset} ${BATCH_SIZE} rows`);

  const startTime = Date.now();
  const { headers, rows, sheetName } = parseXlsxFile(xlsxPath);
  console.log(`  Sheet: ${sheetName}, Columns: ${headers.length}, Rows: ${rows.length}`);

  if (rows.length === 0) {
    console.log(`${yellow}Warning:${reset} No data rows`);
    process.exit(0);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // Create run record
  const fileSha256 = computeFileSha256(path.resolve(xlsxPath));
  const runResult = await client.query(`
    INSERT INTO trapper.ingest_runs (
      source_system, source_table, source_file_path, source_file_name,
      source_file_sha256, row_count, run_status, started_at
    ) VALUES ($1, $2, $3, $4, $5, $6, 'running', NOW())
    RETURNING run_id
  `, [SOURCE_SYSTEM, SOURCE_TABLE, path.resolve(xlsxPath), path.basename(xlsxPath), fileSha256, rows.length]);
  const runId = runResult.rows[0].run_id;
  console.log(`  ${green}✓${reset} Run: ${runId.substring(0, 8)}...`);

  // Prepare all row data
  const sourceFile = path.basename(xlsxPath);
  const preparedRows = rows.map((row, idx) => ({
    source_row_id: extractSourceRowId(row),
    row_hash: computeRowHash(row),
    payload: JSON.stringify(row),
    csv_row_number: idx + 2,
  }));

  let totalInserted = 0;
  let totalSkipped = 0;
  const totalBatches = Math.ceil(preparedRows.length / BATCH_SIZE);

  console.log(`\n${cyan}Processing ${totalBatches} batches...${reset}`);

  for (let batchNum = 0; batchNum < totalBatches; batchNum++) {
    const batchStart = batchNum * BATCH_SIZE;
    const batch = preparedRows.slice(batchStart, batchStart + BATCH_SIZE);

    // Deduplicate within batch by row_hash (keep last occurrence)
    const seenHashes = new Map();
    for (const row of batch) {
      seenHashes.set(row.row_hash, row);
    }
    const dedupedBatch = Array.from(seenHashes.values());

    // Build batch INSERT using unnest for maximum efficiency
    // This does ~500 rows in a single query instead of 500 queries
    const sourceRowIds = dedupedBatch.map(r => r.source_row_id);
    const rowHashes = dedupedBatch.map(r => r.row_hash);
    const payloads = dedupedBatch.map(r => r.payload);

    const insertResult = await client.query(`
      WITH input_data AS (
        SELECT
          unnest($1::text[]) AS source_row_id,
          unnest($2::text[]) AS row_hash,
          unnest($3::jsonb[]) AS payload
      ),
      upserted AS (
        INSERT INTO trapper.staged_records (
          source_system, source_table, source_row_id, source_file, row_hash, payload, created_at, updated_at
        )
        SELECT
          $4, $5, source_row_id, $6, row_hash, payload, NOW(), NOW()
        FROM input_data
        ON CONFLICT (source_system, source_table, row_hash)
        DO UPDATE SET updated_at = NOW()
        RETURNING id, (xmax = 0) AS was_inserted
      )
      SELECT
        COUNT(*) FILTER (WHERE was_inserted) AS inserted,
        COUNT(*) FILTER (WHERE NOT was_inserted) AS skipped
      FROM upserted
    `, [sourceRowIds, rowHashes, payloads, SOURCE_SYSTEM, SOURCE_TABLE, sourceFile]);

    const batchInserted = parseInt(insertResult.rows[0].inserted) || 0;
    const batchSkipped = parseInt(insertResult.rows[0].skipped) || 0;
    totalInserted += batchInserted;
    totalSkipped += batchSkipped;

    // Progress update every 10 batches or on last batch
    if (batchNum % 10 === 0 || batchNum === totalBatches - 1) {
      const pct = ((batchNum + 1) / totalBatches * 100).toFixed(1);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const rate = Math.round((batchStart + batch.length) / (Date.now() - startTime) * 1000);
      process.stdout.write(`\r  Batch ${batchNum + 1}/${totalBatches} (${pct}%) - ${rate} rows/sec - ${elapsed}s elapsed`);
    }
  }

  console.log('\n');

  // Complete run
  const durationMs = Date.now() - startTime;
  await client.query(`
    UPDATE trapper.ingest_runs
    SET rows_inserted = $2, rows_linked = $3, run_status = 'completed',
        run_duration_ms = $4, completed_at = NOW()
    WHERE run_id = $1
  `, [runId, totalInserted, totalInserted + totalSkipped, durationMs]);

  await client.end();

  console.log(`${bold}Summary:${reset}`);
  console.log(`  ${green}✓${reset} Inserted: ${totalInserted.toLocaleString()}`);
  console.log(`  ${yellow}○${reset} Skipped (duplicates): ${totalSkipped.toLocaleString()}`);
  console.log(`  ${cyan}⏱${reset} Time: ${(durationMs / 1000).toFixed(1)}s (${Math.round(rows.length / durationMs * 1000)} rows/sec)`);
}

main().catch(e => { console.error(`${red}Fatal:${reset}`, e.message); process.exit(1); });
