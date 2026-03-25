/**
 * airtable-shared.mjs
 *
 * Shared utilities for Airtable ingest scripts.
 * Extracted from duplicated patterns across:
 *   - airtable_trappers_sync.mjs
 *   - airtable_trapping_requests_sync.mjs
 *   - airtable_staff_sync.mjs
 *   - airtable_appointment_requests_sync.mjs
 *   - airtable_project75_sync.mjs
 *   - airtable_photos_sync.mjs
 *
 * Usage:
 *   import { fetchAllRecords, computeRowHash, stageRecord, buildRecordIdMap } from '../lib/airtable-shared.mjs';
 */

import crypto from 'crypto';

const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const DEFAULT_BASE_ID = 'appl6zLrRFDvsz0dh';

/**
 * Fetch all records from an Airtable table with automatic pagination.
 *
 * @param {string} tableId - Airtable table ID (e.g., 'tblmPBnkrsfqtnsvD')
 * @param {Object} [options]
 * @param {string} [options.baseId] - Airtable base ID (defaults to FFSC base)
 * @param {string} [options.pat] - Airtable PAT (defaults to env)
 * @param {string} [options.view] - Optional view name/ID to filter records
 * @param {string[]} [options.fields] - Optional field names to return
 * @param {string} [options.filterByFormula] - Optional Airtable formula filter
 * @param {boolean} [options.quiet] - Suppress progress logging
 * @returns {Promise<Array<{id: string, fields: Object, createdTime: string}>>}
 */
export async function fetchAllRecords(tableId, options = {}) {
  const pat = options.pat || AIRTABLE_PAT;
  const baseId = options.baseId || process.env.AIRTABLE_BASE_ID || DEFAULT_BASE_ID;

  if (!pat) {
    throw new Error('AIRTABLE_PAT environment variable is required');
  }

  const records = [];
  let offset = null;
  let page = 1;

  if (!options.quiet) {
    console.log(`  Fetching from table ${tableId}...`);
  }

  while (true) {
    const params = new URLSearchParams({ pageSize: '100' });
    if (offset) params.set('offset', offset);
    if (options.view) params.set('view', options.view);
    if (options.filterByFormula) params.set('filterByFormula', options.filterByFormula);
    if (options.fields) {
      for (const f of options.fields) {
        params.append('fields[]', f);
      }
    }

    const url = `https://api.airtable.com/v0/${baseId}/${tableId}?${params}`;
    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${pat}` }
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Airtable API error: ${response.status} ${response.statusText}\n${text}`);
    }

    const data = await response.json();
    records.push(...data.records);

    if (!options.quiet) {
      console.log(`    Page ${page}: ${data.records.length} records (total: ${records.length})`);
    }

    if (data.offset) {
      offset = data.offset;
      page++;
    } else {
      break;
    }
  }

  return records;
}

/**
 * Compute a deterministic hash for deduplication.
 * Normalizes all field values (lowercase strings, trim, sort keys).
 *
 * @param {Object} fields - Airtable record fields
 * @returns {string} 32-char hex hash
 */
export function computeRowHash(fields) {
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

/**
 * Stage a raw record in ops.staged_records for archival.
 * Uses ON CONFLICT to upsert based on hash.
 *
 * @param {import('pg').Client} client - Postgres client
 * @param {string} sourceSystem - e.g., 'airtable'
 * @param {string} sourceTable - e.g., 'trapper_cases'
 * @param {string} recordId - Airtable record ID
 * @param {Object} fields - Airtable record fields
 * @returns {Promise<{wasInserted: boolean}>}
 */
export async function stageRecord(client, sourceSystem, sourceTable, recordId, fields) {
  const hash = computeRowHash(fields);
  const result = await client.query(
    `INSERT INTO ops.staged_records (source_system, source_table, source_row_id, row_hash, payload, created_at, updated_at, is_processed)
     VALUES ($1, $2, $3, $4, $5::jsonb, NOW(), NOW(), FALSE)
     ON CONFLICT (source_system, source_table, row_hash) DO UPDATE SET
       payload = EXCLUDED.payload,
       updated_at = NOW(),
       source_row_id = EXCLUDED.source_row_id
     RETURNING (xmax = 0) AS was_inserted`,
    [sourceSystem, sourceTable, recordId, hash, JSON.stringify(fields)]
  );
  return { wasInserted: result.rows[0]?.was_inserted ?? false };
}

/**
 * Build a lookup map from Airtable record IDs → Atlas UUIDs.
 * Queries a target table for records with source_system = 'airtable'.
 *
 * @param {import('pg').Client} client - Postgres client
 * @param {string} targetTable - Fully qualified table (e.g., 'ops.requests')
 * @param {string} idColumn - Primary key column (e.g., 'request_id')
 * @param {Object} [options]
 * @param {string} [options.sourceRecordIdColumn] - Column name for source_record_id (default: 'source_record_id')
 * @param {string} [options.sourceSystem] - Source system value (default: 'airtable')
 * @param {string} [options.extraWhere] - Additional WHERE clause
 * @returns {Promise<Map<string, string>>} Airtable record ID → Atlas UUID
 */
export async function buildRecordIdMap(client, targetTable, idColumn, options = {}) {
  const srcCol = options.sourceRecordIdColumn || 'source_record_id';
  const srcSys = options.sourceSystem || 'airtable';
  let query = `SELECT ${idColumn}, ${srcCol} FROM ${targetTable} WHERE source_system = $1 AND ${srcCol} IS NOT NULL`;
  const params = [srcSys];

  if (options.extraWhere) {
    query += ` AND ${options.extraWhere}`;
  }

  const result = await client.query(query, params);
  const map = new Map();
  for (const row of result.rows) {
    map.set(row[srcCol], row[idColumn]);
  }
  return map;
}

/**
 * Resolve an Airtable linked record array to Atlas UUIDs.
 * Airtable linked records come as arrays of record IDs: ["recXXXX", "recYYYY"]
 *
 * @param {string[]|string|undefined} linkedField - Airtable linked record field value
 * @param {Map<string, string>} resolveMap - Airtable ID → Atlas UUID map
 * @returns {string|null} First resolved Atlas UUID, or null
 */
export function resolveLinked(linkedField, resolveMap) {
  if (!linkedField) return null;
  const ids = Array.isArray(linkedField) ? linkedField : [linkedField];
  for (const id of ids) {
    const resolved = resolveMap.get(id);
    if (resolved) return resolved;
  }
  return null;
}

/**
 * Resolve ALL Airtable linked records to Atlas UUIDs.
 *
 * @param {string[]|string|undefined} linkedField - Airtable linked record field value
 * @param {Map<string, string>} resolveMap - Airtable ID → Atlas UUID map
 * @returns {string[]} All resolved Atlas UUIDs
 */
export function resolveLinkedAll(linkedField, resolveMap) {
  if (!linkedField) return [];
  const ids = Array.isArray(linkedField) ? linkedField : [linkedField];
  return ids.map(id => resolveMap.get(id)).filter(Boolean);
}

/**
 * Safely parse a date from Airtable field value.
 * Handles ISO dates, MM/DD/YYYY, and various formats.
 *
 * @param {string|undefined} value - Date string from Airtable
 * @returns {string|null} ISO date string or null
 */
export function parseDate(value) {
  if (!value) return null;
  const str = String(value).trim();
  if (!str) return null;

  // Already ISO format
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    return str.substring(0, 10);
  }

  // MM/DD/YYYY
  const mdy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    return `${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`;
  }

  // Try native Date parse as fallback
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    return d.toISOString().substring(0, 10);
  }

  return null;
}

/**
 * Safely extract a positive integer from Airtable field.
 *
 * @param {*} value - Field value
 * @returns {number|null}
 */
export function parsePositiveInt(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = parseInt(value, 10);
  return isNaN(n) || n < 0 ? null : n;
}

/**
 * Create an ingest run tracking record.
 *
 * @param {import('pg').Client} client
 * @param {string} sourceTable - e.g., 'trapper_cases'
 * @param {number} rowCount - Total records fetched
 * @returns {Promise<string>} run_id UUID
 */
export async function startIngestRun(client, sourceTable, rowCount) {
  const result = await client.query(
    `INSERT INTO ops.ingest_runs (source_system, source_table, records_fetched, status, started_at)
     VALUES ('airtable', $1, $2, 'running', NOW())
     RETURNING run_id`,
    [sourceTable, rowCount]
  );
  return result.rows[0].run_id;
}

/**
 * Complete an ingest run with final stats.
 *
 * @param {import('pg').Client} client
 * @param {string} runId
 * @param {Object} stats - { imported, skipped, errors }
 */
export async function completeIngestRun(client, runId, stats) {
  await client.query(
    `UPDATE ops.ingest_runs SET
       records_created = $2,
       records_errored = $3,
       status = $4,
       completed_at = NOW()
     WHERE run_id = $1`,
    [runId, stats.imported || 0, stats.errors || 0, stats.errors > 0 ? 'completed_with_errors' : 'completed']
  );
}

/**
 * Discover all tables in an Airtable base via the metadata API.
 *
 * @param {Object} [options]
 * @param {string} [options.baseId] - Airtable base ID
 * @param {string} [options.pat] - Airtable PAT
 * @returns {Promise<Array<{name: string, id: string, fields: Array}>>}
 */
export async function discoverTables(options = {}) {
  const pat = options.pat || AIRTABLE_PAT;
  const baseId = options.baseId || process.env.AIRTABLE_BASE_ID || DEFAULT_BASE_ID;

  if (!pat) {
    throw new Error('AIRTABLE_PAT environment variable is required');
  }

  const response = await fetch(
    `https://api.airtable.com/v0/meta/bases/${baseId}/tables`,
    { headers: { 'Authorization': `Bearer ${pat}` } }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Airtable metadata API error: ${response.status}\n${text}`);
  }

  const data = await response.json();
  return data.tables;
}
