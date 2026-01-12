#!/usr/bin/env node
/**
 * airtable_trapping_requests_sync.mjs
 *
 * Syncs Trapping Requests directly from Airtable API.
 * Uses Airtable record IDs for deduplication.
 *
 * Usage:
 *   node scripts/ingest/airtable_trapping_requests_sync.mjs
 *
 * Required env:
 *   AIRTABLE_PAT - Airtable Personal Access Token
 *   DATABASE_URL - Postgres connection string
 */

import pg from 'pg';
import crypto from 'crypto';

const { Client } = pg;

const AIRTABLE_PAT = process.env.AIRTABLE_PAT || 'patcjKFzC852FH3sI.ac4874470b704b94ed1545a6d7d67bab536f576d6f3292bdccc9d1eadf635351';
const BASE_ID = 'appl6zLrRFDvsz0dh';
const TABLE_ID = 'tblc1bva7jFzg8DVF';  // Trapping Requests

const SOURCE_SYSTEM = 'airtable';
const SOURCE_TABLE = 'trapping_requests';

async function fetchAllRecords() {
  const records = [];
  let offset = null;
  let page = 1;

  console.log('Fetching from Airtable...');

  while (true) {
    let url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}?pageSize=100`;
    if (offset) {
      url += `&offset=${offset}`;
    }

    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` }
    });

    if (!response.ok) {
      throw new Error(`Airtable API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    records.push(...data.records);
    console.log(`  Page ${page}: ${data.records.length} records (total: ${records.length})`);

    if (data.offset) {
      offset = data.offset;
      page++;
    } else {
      break;
    }
  }

  return records;
}

function computeRowHash(fields) {
  const normalized = {};
  for (const key of Object.keys(fields).sort()) {
    let value = fields[key];
    if (typeof value === 'string') value = value.trim().toLowerCase();
    if (value !== '' && value !== null && value !== undefined) {
      normalized[key] = value;
    }
  }
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex').substring(0, 32);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('Error: DATABASE_URL not set');
    process.exit(1);
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log('Airtable Trapping Requests Sync');
  console.log('═══════════════════════════════════════════════════\n');

  // Fetch from Airtable
  const airtableRecords = await fetchAllRecords();
  console.log(`\nTotal records from Airtable: ${airtableRecords.length}\n`);

  // Connect to database
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // Create ingest run
  const timestamp = new Date().toISOString();
  const runResult = await client.query(`
    INSERT INTO trapper.ingest_runs (
      source_system, source_table, source_file_path, source_file_name, source_file_sha256,
      row_count, rows_inserted, rows_linked, rows_suspect, run_status, started_at
    ) VALUES ($1, $2, 'airtable://api', $3, $4, $5, 0, 0, 0, 'running', NOW())
    RETURNING run_id
  `, [SOURCE_SYSTEM, SOURCE_TABLE, `airtable_sync_${timestamp}`, `api_${timestamp}`, airtableRecords.length]);
  const runId = runResult.rows[0].run_id;
  console.log(`Run ID: ${runId.substring(0, 8)}...`);

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

  for (const record of airtableRecords) {
    const recordId = record.id;
    const fields = record.fields;
    const rowHash = computeRowHash(fields);
    const payload = JSON.stringify(fields);

    // Upsert into staged_records (unique on source_system, source_table, row_hash)
    const result = await client.query(`
      INSERT INTO trapper.staged_records (
        source_system, source_table, source_row_id, row_hash, payload,
        created_at, updated_at, is_processed
      ) VALUES ($1, $2, $3, $4, $5::jsonb, NOW(), NOW(), false)
      ON CONFLICT (source_system, source_table, row_hash)
      DO UPDATE SET
        source_row_id = EXCLUDED.source_row_id,
        payload = EXCLUDED.payload,
        updated_at = NOW()
      RETURNING (xmax = 0) AS was_inserted
    `, [SOURCE_SYSTEM, SOURCE_TABLE, recordId, rowHash, payload]);

    if (result.rows[0]?.was_inserted) {
      inserted++;
    } else {
      updated++;
    }
  }

  // Complete run
  await client.query(`
    UPDATE trapper.ingest_runs
    SET rows_inserted = $2, rows_linked = $3, run_status = 'completed', completed_at = NOW()
    WHERE run_id = $1
  `, [runId, inserted, updated]);

  await client.end();

  console.log('\n═══════════════════════════════════════════════════');
  console.log('Summary:');
  console.log(`  ✓ Inserted: ${inserted}`);
  console.log(`  ↻ Updated:  ${updated}`);
  console.log(`  ○ Unchanged: ${unchanged}`);
  console.log('═══════════════════════════════════════════════════\n');

  // Now convert to sot_requests
  console.log('Converting to sot_requests...');

  const pgClient = new Client({ connectionString: process.env.DATABASE_URL });
  await pgClient.connect();

  const convertResult = await pgClient.query('SELECT * FROM trapper.convert_staged_trapping_requests()');
  console.log(`  Requests created: ${convertResult.rows[0].requests_created}`);
  console.log(`  Linked to place: ${convertResult.rows[0].requests_linked_to_place}`);
  console.log(`  Linked to person: ${convertResult.rows[0].requests_linked_to_person}`);

  await pgClient.end();
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
