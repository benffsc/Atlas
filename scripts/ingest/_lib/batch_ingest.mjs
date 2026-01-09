/**
 * batch_ingest.mjs
 *
 * Optimized batch ingest utilities for large files.
 * Uses true bulk inserts (multi-value INSERT) for high throughput.
 *
 * Key features:
 * - Multi-value INSERT statements (100-500 rows at once)
 * - Connection pooling for reliability
 * - Progress logging
 * - Two-phase: bulk insert staged records, then bulk link to run
 */

import pg from 'pg';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';

const { Pool } = pg;

/**
 * Compute SHA256 hash of row data for deduplication
 */
function computeRowHash(row) {
  const normalized = {};
  for (const key of Object.keys(row).sort()) {
    let value = row[key];
    if (typeof value === 'string') {
      value = value.trim().toLowerCase();
    }
    if (value !== '' && value !== null && value !== undefined) {
      normalized[key] = value;
    }
  }
  const json = JSON.stringify(normalized);
  return crypto.createHash('sha256').update(json).digest('hex').substring(0, 32);
}

/**
 * Extract source row ID from row using candidate fields
 */
function extractSourceRowId(row, idFieldCandidates = []) {
  const defaultCandidates = [
    'Record ID', 'Airtable Record ID', 'LookupRecordIDPrimaryReq',
    'Appointment ID', 'appointment_id', 'Number',
    'record_id', 'id', 'ID',
  ];
  const candidates = [...idFieldCandidates, ...defaultCandidates];

  for (const field of candidates) {
    const value = row[field];
    if (value && typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return null;
}

/**
 * Compute file SHA256 hash
 */
function computeFileSha256(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * BatchIngestRunner - handles large file ingests with optimized bulk inserts
 */
export class BatchIngestRunner {
  constructor(options = {}) {
    this.sourceSystem = options.sourceSystem;
    this.sourceTable = options.sourceTable;
    this.batchSize = options.batchSize || 500;
    this.idFieldCandidates = options.idFieldCandidates || [];
    this.pool = null;
    this.runId = null;
    this.startTime = null;
    this.stats = {
      total: 0,
      inserted: 0,
      skipped: 0,
      linked: 0,
      errors: 0,
      batches: 0,
    };
  }

  async connect() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 60000,
      connectionTimeoutMillis: 30000,
    });
    const client = await this.pool.connect();
    client.release();
    return true;
  }

  async disconnect() {
    if (this.pool) {
      await this.pool.end();
    }
  }

  async createRun(filePath, rowCount) {
    this.startTime = Date.now();
    this.stats.total = rowCount;

    const fileName = path.basename(filePath);
    const fileSha256 = computeFileSha256(filePath);

    const result = await this.pool.query(`
      INSERT INTO trapper.ingest_runs (
        source_system, source_table, source_file_path, source_file_name,
        source_file_sha256, row_count, run_status, started_at
      ) VALUES ($1, $2, $3, $4, $5, $6, 'running', NOW())
      RETURNING run_id
    `, [this.sourceSystem, this.sourceTable, filePath, fileName, fileSha256, rowCount]);

    this.runId = result.rows[0].run_id;
    return this.runId;
  }

  async completeRun() {
    const durationMs = Date.now() - this.startTime;
    await this.pool.query(`
      UPDATE trapper.ingest_runs SET
        rows_inserted = $2, rows_linked = $3, rows_suspect = 0,
        run_status = 'completed', run_duration_ms = $4, completed_at = NOW()
      WHERE run_id = $1
    `, [this.runId, this.stats.inserted, this.stats.linked, durationMs]);
  }

  async failRun(errorMessage) {
    const durationMs = Date.now() - this.startTime;
    await this.pool.query(`
      UPDATE trapper.ingest_runs SET
        run_status = 'failed', error_message = $2,
        run_duration_ms = $3, completed_at = NOW()
      WHERE run_id = $1
    `, [this.runId, errorMessage, durationMs]);
  }

  /**
   * Process rows in batches with optimized bulk inserts
   */
  async processBatches(rows, sourceFile, onProgress = null) {
    const totalBatches = Math.ceil(rows.length / this.batchSize);

    for (let batchNum = 0; batchNum < totalBatches; batchNum++) {
      const start = batchNum * this.batchSize;
      const end = Math.min(start + this.batchSize, rows.length);
      const batch = rows.slice(start, end);

      try {
        await this.processBatchBulk(batch, start + 2, sourceFile);
        this.stats.batches++;

        if (onProgress) {
          onProgress(batchNum + 1, totalBatches, { ...this.stats });
        }
      } catch (e) {
        console.error(`Batch ${batchNum + 1} error: ${e.message}`);
        this.stats.errors += batch.length;
      }
    }

    return this.stats;
  }

  /**
   * Process batch with true bulk INSERT
   */
  async processBatchBulk(batch, startRowNum, sourceFile) {
    const client = await this.pool.connect();

    try {
      // Prepare all rows data
      const rowsDataAll = batch.map((row, i) => ({
        csvRowNumber: startRowNum + i,
        rowHash: computeRowHash(row),
        sourceRowId: extractSourceRowId(row, this.idFieldCandidates),
        payload: JSON.stringify(row),
      }));

      // Deduplicate within batch by row_hash (keep first occurrence)
      const seenHashes = new Set();
      const rowsData = [];
      for (const row of rowsDataAll) {
        if (!seenHashes.has(row.rowHash)) {
          seenHashes.add(row.rowHash);
          rowsData.push(row);
        } else {
          this.stats.skipped++; // Count in-batch dupes as skipped
        }
      }

      if (rowsData.length === 0) {
        return; // Entire batch was duplicates
      }

      // Build multi-value INSERT for staged_records
      // Using unnest for bulk insert which is much faster
      const hashes = rowsData.map(r => r.rowHash);
      const sourceRowIds = rowsData.map(r => r.sourceRowId);
      const payloads = rowsData.map(r => r.payload);

      await client.query('BEGIN');

      // Bulk upsert staged records using unnest
      const insertResult = await client.query(`
        WITH input_rows AS (
          SELECT
            unnest($1::text[]) AS row_hash,
            unnest($2::text[]) AS source_row_id,
            unnest($3::jsonb[]) AS payload
        ),
        upserted AS (
          INSERT INTO trapper.staged_records (
            source_system, source_table, source_row_id, source_file,
            row_hash, payload, created_at, updated_at
          )
          SELECT
            $4, $5, ir.source_row_id, $6,
            ir.row_hash, ir.payload, NOW(), NOW()
          FROM input_rows ir
          ON CONFLICT (source_system, source_table, row_hash)
          DO UPDATE SET updated_at = NOW()
          RETURNING id, row_hash, (xmax = 0) AS was_inserted
        )
        SELECT id, row_hash, was_inserted FROM upserted
      `, [hashes, sourceRowIds, payloads, this.sourceSystem, this.sourceTable, sourceFile]);

      // Count inserts vs skips
      const resultMap = new Map();
      for (const row of insertResult.rows) {
        resultMap.set(row.row_hash, { id: row.id, wasInserted: row.was_inserted });
        if (row.was_inserted) {
          this.stats.inserted++;
        } else {
          this.stats.skipped++;
        }
      }

      // Bulk insert run records
      const runRecordData = rowsData.map(r => {
        const result = resultMap.get(r.rowHash);
        return {
          stagedRecordId: result?.id,
          csvRowNumber: r.csvRowNumber,
          wasInserted: result?.wasInserted || false,
        };
      }).filter(r => r.stagedRecordId);

      if (runRecordData.length > 0) {
        const stagedIds = runRecordData.map(r => r.stagedRecordId);
        const csvRowNums = runRecordData.map(r => r.csvRowNumber);
        const wasInsertedFlags = runRecordData.map(r => r.wasInserted);

        await client.query(`
          INSERT INTO trapper.ingest_run_records (run_id, staged_record_id, csv_row_number, was_inserted)
          SELECT $1, unnest($2::uuid[]), unnest($3::int[]), unnest($4::boolean[])
          ON CONFLICT (run_id, staged_record_id) DO NOTHING
        `, [this.runId, stagedIds, csvRowNums, wasInsertedFlags]);

        this.stats.linked += runRecordData.length;
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}

export const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
};

export default BatchIngestRunner;
