/**
 * data_engine_client.mjs
 *
 * Shared client for calling the Data Engine API from ingest scripts.
 * Automatically processes staged records after ingestion.
 *
 * Usage:
 *   import { processAfterIngest, processDataEngine } from './_lib/data_engine_client.mjs';
 *
 *   // After staging records
 *   await processAfterIngest(sourceSystem, sourceTable, batchSize);
 */

import pg from 'pg';

const { Pool } = pg;

/**
 * Process staged records through the Data Engine directly via SQL
 * (No HTTP required - works in any environment)
 *
 * @param {string} sourceSystem - Source system (e.g., 'clinichq', 'volunteerhub')
 * @param {string} sourceTable - Source table (e.g., 'owner_info', 'users')
 * @param {number} batchSize - Number of records to process (default: 500)
 * @returns {Promise<{processed: number, success: number, errors: number}>}
 */
export async function processDataEngine(sourceSystem, sourceTable, batchSize = 500) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 3,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  try {
    // Try unified processor first
    const result = await pool.query(`
      SELECT * FROM ops.data_engine_process_batch_unified($1, $2, $3)
    `, [sourceSystem || null, sourceTable || null, batchSize]);

    if (result.rows[0]) {
      return {
        processed: parseInt(result.rows[0].processed || '0'),
        success: parseInt(result.rows[0].success || '0'),
        errors: parseInt(result.rows[0].errors || '0'),
      };
    }

    return { processed: 0, success: 0, errors: 0 };
  } catch (error) {
    // If unified processor doesn't exist, try legacy approach
    if (error.message?.includes('does not exist')) {
      console.warn('Unified processor not available, using direct processing...');
      return await processDirectly(pool, sourceSystem, sourceTable, batchSize);
    }
    throw error;
  } finally {
    await pool.end();
  }
}

/**
 * Direct processing fallback when unified processor not available
 */
async function processDirectly(pool, sourceSystem, sourceTable, batchSize) {
  let processed = 0;
  let success = 0;
  let errors = 0;

  // Get pending records
  const pending = await pool.query(`
    SELECT id, source_system, source_table
    FROM ops.staged_records
    WHERE NOT is_processed
      AND ($1::TEXT IS NULL OR source_system = $1)
      AND ($2::TEXT IS NULL OR source_table = $2)
    ORDER BY created_at
    LIMIT $3
  `, [sourceSystem, sourceTable, batchSize]);

  for (const record of pending.rows) {
    try {
      // Find processor for this source
      const processor = await pool.query(`
        SELECT processor_function FROM ops.data_engine_processors
        WHERE source_system = $1 AND source_table = $2 AND is_active = true
      `, [record.source_system, record.source_table]);

      if (processor.rows.length > 0) {
        const funcName = processor.rows[0].processor_function;
        await pool.query(`SELECT ops.${funcName}($1)`, [record.id]);
        success++;
      }
      processed++;
    } catch (e) {
      errors++;
      console.error(`Error processing record ${record.id}:`, e.message);
    }
  }

  return { processed, success, errors };
}

/**
 * Process staged records after an ingest run completes
 * Call this at the end of ingest scripts to auto-process new records
 *
 * @param {string} sourceSystem - Source system that was just ingested
 * @param {string} sourceTable - Source table that was just ingested
 * @param {object} options - Optional configuration
 * @param {number} options.batchSize - Records per batch (default: 500)
 * @param {boolean} options.processAll - Keep processing until none left (default: false)
 * @param {function} options.onProgress - Progress callback
 */
export async function processAfterIngest(sourceSystem, sourceTable, options = {}) {
  const {
    batchSize = 500,
    processAll = false,
    onProgress = null,
  } = options;

  console.log(`\nProcessing ${sourceSystem}/${sourceTable} through Data Engine...`);

  let totalProcessed = 0;
  let totalSuccess = 0;
  let totalErrors = 0;
  let iteration = 0;

  do {
    iteration++;
    const result = await processDataEngine(sourceSystem, sourceTable, batchSize);

    totalProcessed += result.processed;
    totalSuccess += result.success;
    totalErrors += result.errors;

    if (onProgress) {
      onProgress({ iteration, ...result, totalProcessed, totalSuccess, totalErrors });
    }

    if (result.processed === 0) break;

    console.log(`  Batch ${iteration}: ${result.processed} processed, ${result.success} success, ${result.errors} errors`);

  } while (processAll);

  console.log(`\nData Engine processing complete:`);
  console.log(`  Total processed: ${totalProcessed}`);
  console.log(`  Success: ${totalSuccess}`);
  console.log(`  Errors: ${totalErrors}`);

  return { totalProcessed, totalSuccess, totalErrors };
}

/**
 * Get current Data Engine stats
 */
export async function getDataEngineStats() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
  });

  try {
    const result = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM ops.staged_records) as total_staged,
        (SELECT COUNT(*) FROM ops.staged_records WHERE NOT is_processed) as pending,
        (SELECT COUNT(*) FROM ops.data_engine_processors WHERE is_active) as active_processors
    `);

    return {
      totalStaged: parseInt(result.rows[0].total_staged || '0'),
      pending: parseInt(result.rows[0].pending || '0'),
      activeProcessors: parseInt(result.rows[0].active_processors || '0'),
    };
  } finally {
    await pool.end();
  }
}

/**
 * Get pending counts by source
 */
export async function getPendingBySource() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
  });

  try {
    const result = await pool.query(`
      SELECT source_system, source_table, COUNT(*) as pending
      FROM ops.staged_records
      WHERE NOT is_processed
      GROUP BY source_system, source_table
      ORDER BY pending DESC
    `);

    return result.rows.map(row => ({
      sourceSystem: row.source_system,
      sourceTable: row.source_table,
      pending: parseInt(row.pending || '0'),
    }));
  } finally {
    await pool.end();
  }
}

export default {
  processDataEngine,
  processAfterIngest,
  getDataEngineStats,
  getPendingBySource,
};
