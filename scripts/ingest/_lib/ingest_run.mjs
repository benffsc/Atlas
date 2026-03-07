/**
 * ingest_run.mjs
 *
 * Shared utilities for ingest run tracking
 * - Create/complete runs
 * - Link run records
 * - File hashing
 * - Row hashing
 * - Suspect detection
 *
 * Usage:
 *   import { IngestRunner } from './_lib/ingest_run.mjs';
 *   const runner = new IngestRunner(client, sourceSystem, sourceTable);
 *   const runId = await runner.createRun(filePath, rowCount);
 *   // ... process rows ...
 *   await runner.completeRun(stats);
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// ============================================
// File Utilities
// ============================================

/**
 * Compute SHA256 hash of file contents
 */
export function computeFileSha256(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Compute hash of row data for deduplication
 * Uses sorted keys and normalized values
 */
export function computeRowHash(row) {
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
 * Find most recent CSV file in directory matching pattern
 */
export function findLatestCsv(baseDir, subPath) {
  const searchDir = path.join(baseDir, subPath);

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

// ============================================
// Source Row ID Extraction
// ============================================

/**
 * Extract source row ID from row using candidate fields
 * @param {object} row - Row data
 * @param {string[]} idFieldCandidates - Priority-ordered field names to check
 * @returns {string|null} Extracted ID or null
 */
export function extractSourceRowId(row, idFieldCandidates = []) {
  const defaultCandidates = [
    'Record ID',
    'Airtable Record ID',
    'LookupRecordIDPrimaryReq',
    'record_id',
    'id',
    'ID',
  ];

  const candidates = [...idFieldCandidates, ...defaultCandidates];

  for (const field of candidates) {
    const value = row[field];
    if (value && typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }

  return null;
}

// ============================================
// Suspect Detection
// ============================================

/**
 * Base suspect detection rules (source-agnostic)
 * Can be extended with source-specific rules
 */
export function detectBaseSuspectIssues(row) {
  const issues = [];

  // Check all string fields for common issues
  for (const [key, value] of Object.entries(row)) {
    if (typeof value !== 'string' || !value) continue;

    // Attachment URLs in non-attachment fields
    if (value.includes('airtableusercontent') || value.includes('v5.airtableusercontent')) {
      const isAttachmentField = /attachment|image|photo|file/i.test(key);
      if (!isAttachmentField) {
        issues.push({
          type: 'field_has_attachment_url',
          field: key,
          severity: 2,
          details: `${key} contains attachment URL: ${value.substring(0, 80)}...`,
        });
      }
    }

    // HTML content in non-HTML fields
    if (value.includes('<br') || value.includes('<div') ||
        value.includes('</') || value.includes('<p>')) {
      const isHtmlField = /notes|description|details|html/i.test(key);
      if (!isHtmlField) {
        issues.push({
          type: 'field_has_html',
          field: key,
          severity: 1,
          details: `${key} contains HTML: ${value.substring(0, 80)}...`,
        });
      }
    }
  }

  return issues;
}

/**
 * Address-specific suspect detection
 */
export function detectAddressSuspectIssues(address) {
  const issues = [];
  if (!address) return issues;

  const trimmed = address.trim();

  if (/^[0-9]{5}(-[0-9]{4})?$/.test(trimmed)) {
    issues.push({
      type: 'address_is_junk',
      severity: 2,
      details: `Address is ZIP-only: ${trimmed}`,
    });
  } else if (trimmed.toUpperCase() === 'CA' || trimmed.toUpperCase() === 'CALIFORNIA') {
    issues.push({
      type: 'address_is_junk',
      severity: 2,
      details: `Address is state-only: ${trimmed}`,
    });
  } else if (trimmed.length < 5) {
    issues.push({
      type: 'address_is_junk',
      severity: 1,
      details: `Address too short: ${trimmed}`,
    });
  } else if (!/[0-9]/.test(trimmed)) {
    issues.push({
      type: 'address_is_junk',
      severity: 1,
      details: `Address has no digits: ${trimmed}`,
    });
  }

  return issues;
}

// ============================================
// IngestRunner Class
// ============================================

export class IngestRunner {
  constructor(client, sourceSystem, sourceTable, options = {}) {
    this.client = client;
    this.sourceSystem = sourceSystem;
    this.sourceTable = sourceTable;
    this.runId = null;
    this.startTime = Date.now();
    this.idFieldCandidates = options.idFieldCandidates || [];
    this.detectSuspect = options.detectSuspect || detectBaseSuspectIssues;
  }

  /**
   * Create a new ingest run record
   */
  async createRun(filePath, rowCount) {
    const fileName = path.basename(filePath);
    const fileSha256 = computeFileSha256(filePath);

    const result = await this.client.query(`
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
    `, [this.sourceSystem, this.sourceTable, filePath, fileName, fileSha256, rowCount]);

    this.runId = result.rows[0].run_id;
    return this.runId;
  }

  /**
   * Mark run as completed with stats
   */
  async completeRun(stats) {
    const durationMs = Date.now() - this.startTime;

    await this.client.query(`
      UPDATE ops.ingest_runs
      SET
        rows_inserted = $2,
        rows_linked = $3,
        rows_suspect = $4,
        run_status = 'completed',
        run_duration_ms = $5,
        completed_at = NOW()
      WHERE run_id = $1
    `, [this.runId, stats.inserted, stats.linked, stats.suspect, durationMs]);
  }

  /**
   * Mark run as failed with error message
   */
  async failRun(errorMessage) {
    const durationMs = Date.now() - this.startTime;

    await this.client.query(`
      UPDATE ops.ingest_runs
      SET
        run_status = 'failed',
        error_message = $2,
        run_duration_ms = $3,
        completed_at = NOW()
      WHERE run_id = $1
    `, [this.runId, errorMessage, durationMs]);
  }

  /**
   * Insert or update a staged record
   */
  async insertStagedRecord(row, sourceFile) {
    const rowHash = computeRowHash(row);
    const sourceRowId = extractSourceRowId(row, this.idFieldCandidates);

    const result = await this.client.query(`
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
      this.sourceSystem,
      this.sourceTable,
      sourceRowId,
      sourceFile,
      rowHash,
      JSON.stringify(row),
    ]);

    return {
      id: result.rows[0].id,
      wasInserted: result.rows[0].was_inserted,
      sourceRowId,
      rowHash,
    };
  }

  /**
   * Link a staged record to the current run
   */
  async linkRunRecord(stagedRecordId, csvRowNumber, wasInserted) {
    await this.client.query(`
      INSERT INTO ops.ingest_runs (run_id, staged_record_id, csv_row_number, was_inserted)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (run_id, staged_record_id) DO NOTHING
    `, [this.runId, stagedRecordId, csvRowNumber, wasInserted]);
  }

  /**
   * Record a data issue for a staged record
   */
  async insertDataIssue(stagedRecordId, issue, sourceRowId) {
    await this.client.query(`
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
      JSON.stringify({ message: issue.details, source_row_id: sourceRowId, field: issue.field }),
    ]);
  }

  /**
   * Process a single row: insert, link, detect issues
   */
  async processRow(row, csvRowNumber, sourceFile, options = {}) {
    const result = {
      wasInserted: false,
      issues: [],
      sourceRowId: null,
    };

    try {
      // Insert/update staged record
      const { id: stagedRecordId, wasInserted, sourceRowId } = await this.insertStagedRecord(row, sourceFile);
      result.wasInserted = wasInserted;
      result.sourceRowId = sourceRowId;

      // Link to run
      await this.linkRunRecord(stagedRecordId, csvRowNumber, wasInserted);

      // Detect suspect issues
      const issues = this.detectSuspect(row);
      result.issues = issues;

      // Record issues
      for (const issue of issues) {
        await this.insertDataIssue(stagedRecordId, issue, sourceRowId);
      }

      return result;
    } catch (e) {
      result.error = e.message;
      return result;
    }
  }
}

// ============================================
// Console Colors
// ============================================

export const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
};
