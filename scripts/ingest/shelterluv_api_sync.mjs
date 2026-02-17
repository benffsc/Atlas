#!/usr/bin/env node
/**
 * shelterluv_api_sync.mjs - ShelterLuv API Sync
 *
 * Fetches animals, people, and events from ShelterLuv API and stages them
 * for processing by Atlas Data Engine.
 *
 * Usage:
 *   node shelterluv_api_sync.mjs                    # Full sync (all endpoints)
 *   node shelterluv_api_sync.mjs --type animals    # Sync only animals
 *   node shelterluv_api_sync.mjs --type people     # Sync only people
 *   node shelterluv_api_sync.mjs --type events     # Sync only events
 *   node shelterluv_api_sync.mjs --incremental     # Only fetch new records since last sync
 *   node shelterluv_api_sync.mjs --dry-run         # Don't write to database
 *   node shelterluv_api_sync.mjs --limit 100       # Limit records per endpoint
 */

import pg from 'pg';
import crypto from 'crypto';

const { Client } = pg;

// ============================================
// Configuration
// ============================================

const SOURCE_SYSTEM = 'shelterluv';
const API_BASE_URL = 'https://www.shelterluv.com/api/v1';
const RATE_LIMIT_DELAY_MS = 250; // Conservative rate limiting

// Console colors
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
};

const { green, red, yellow, cyan, reset, bold } = colors;

// ============================================
// API Client
// ============================================

class ShelterLuvAPI {
  constructor(apiKey) {
    if (!apiKey) {
      throw new Error('SHELTERLUV_API_KEY is required');
    }
    this.apiKey = apiKey;
    this.requestCount = 0;
  }

  async fetch(endpoint, params = {}) {
    const url = new URL(`${API_BASE_URL}${endpoint}`);

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, value);
      }
    }

    this.requestCount++;

    const response = await fetch(url.toString(), {
      headers: {
        'X-Api-Key': this.apiKey,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`API error ${response.status}: ${text}`);
    }

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS));

    return response.json();
  }

  /**
   * Fetch all records from a paginated endpoint
   * @param {string} endpoint - API endpoint (e.g., '/animals')
   * @param {object} options - Options
   * @param {number} options.limit - Max records to fetch (0 = unlimited)
   * @param {number} options.after - Unix timestamp for incremental sync
   * @param {function} options.onBatch - Callback for each batch
   */
  async fetchAll(endpoint, options = {}) {
    const { limit = 0, after = null, onBatch } = options;
    const allRecords = [];
    let offset = 0;
    const pageSize = 100;

    while (true) {
      const params = { offset };
      if (after) {
        params.after = after;
      }

      const data = await this.fetch(endpoint, params);

      // ShelterLuv returns different structures for different endpoints
      const records = data.animals || data.people || data.events || [];
      const total = data.total_count || 0;

      if (records.length === 0) {
        break;
      }

      allRecords.push(...records);

      if (onBatch) {
        onBatch(records, allRecords.length, total);
      }

      // Check if we've hit the limit
      if (limit > 0 && allRecords.length >= limit) {
        return allRecords.slice(0, limit);
      }

      // Check if we've fetched all records
      if (allRecords.length >= total || records.length < pageSize) {
        break;
      }

      offset += pageSize;
    }

    return allRecords;
  }
}

// ============================================
// Database Operations
// ============================================

function computeRowHash(row) {
  const normalized = {};
  for (const key of Object.keys(row).sort()) {
    let value = row[key];
    if (typeof value === 'string') {
      value = value.trim().toLowerCase();
    } else if (typeof value === 'object' && value !== null) {
      value = JSON.stringify(value);
    }
    if (value !== '' && value !== null && value !== undefined) {
      normalized[key] = value;
    }
  }
  const json = JSON.stringify(normalized);
  return crypto.createHash('sha256').update(json).digest('hex').substring(0, 32);
}

async function getSyncState(client, syncType) {
  const result = await client.query(`
    SELECT last_sync_timestamp, last_sync_at, records_synced
    FROM source.shelterluv_sync_state
    WHERE sync_type = $1
  `, [syncType]);
  return result.rows[0] || { last_sync_timestamp: null };
}

async function updateSyncState(client, syncType, lastTimestamp, recordsSynced, totalRecords, error = null) {
  await client.query(`
    SELECT source.update_shelterluv_sync_state($1, $2, $3, $4, $5)
  `, [syncType, lastTimestamp, recordsSynced, totalRecords, error]);
}

async function stageRecord(client, sourceTable, record, sourceRowId) {
  const rowHash = computeRowHash(record);

  const result = await client.query(`
    INSERT INTO ops.staged_records (
      source_system, source_table, source_row_id, row_hash, payload,
      created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
    ON CONFLICT (source_system, source_table, row_hash)
    DO UPDATE SET updated_at = NOW()
    RETURNING id, (xmax = 0) AS was_inserted
  `, [SOURCE_SYSTEM, sourceTable, sourceRowId, rowHash, JSON.stringify(record)]);

  return result.rows[0];
}

// ============================================
// Sync Functions
// ============================================

async function syncAnimals(api, client, options) {
  const { incremental, limit, dryRun } = options;
  const syncType = 'animals';

  console.log(`\n${bold}Syncing Animals${reset}`);

  let afterTimestamp = null;
  if (incremental) {
    const state = await getSyncState(client, syncType);
    afterTimestamp = state.last_sync_timestamp;
    if (afterTimestamp) {
      console.log(`  ${cyan}Incremental:${reset} fetching records after ${new Date(afterTimestamp * 1000).toISOString()}`);
    }
  }

  let inserted = 0, skipped = 0, lastTimestamp = afterTimestamp;

  const records = await api.fetchAll('/animals', {
    limit,
    after: afterTimestamp,
    onBatch: (batch, total, serverTotal) => {
      console.log(`  ${cyan}Progress:${reset} ${total}/${serverTotal} animals fetched`);
    },
  });

  console.log(`  ${cyan}Total:${reset} ${records.length} animals to process`);

  for (const animal of records) {
    const sourceRowId = animal['Internal-ID'] || animal.ID;

    // Track latest timestamp for incremental sync
    if (animal.LastUpdatedUnixTime) {
      const ts = parseInt(animal.LastUpdatedUnixTime, 10);
      if (!lastTimestamp || ts > lastTimestamp) {
        lastTimestamp = ts;
      }
    }

    if (dryRun) {
      inserted++;
      continue;
    }

    const result = await stageRecord(client, 'animals', animal, sourceRowId);
    if (result.was_inserted) {
      inserted++;
    } else {
      skipped++;
    }
  }

  if (!dryRun && records.length > 0) {
    await updateSyncState(client, syncType, lastTimestamp, records.length, records.length);
  }

  console.log(`  ${green}Done:${reset} ${inserted} inserted, ${skipped} unchanged`);
  return { inserted, skipped, total: records.length };
}

async function syncPeople(api, client, options) {
  const { incremental, limit, dryRun } = options;
  const syncType = 'people';

  console.log(`\n${bold}Syncing People${reset}`);

  let afterTimestamp = null;
  if (incremental) {
    const state = await getSyncState(client, syncType);
    afterTimestamp = state.last_sync_timestamp;
    if (afterTimestamp) {
      console.log(`  ${cyan}Incremental:${reset} fetching records after ${new Date(afterTimestamp * 1000).toISOString()}`);
    }
  }

  let inserted = 0, skipped = 0, lastTimestamp = afterTimestamp;

  const records = await api.fetchAll('/people', {
    limit,
    after: afterTimestamp,
    onBatch: (batch, total, serverTotal) => {
      console.log(`  ${cyan}Progress:${reset} ${total}/${serverTotal} people fetched`);
    },
  });

  console.log(`  ${cyan}Total:${reset} ${records.length} people to process`);

  for (const person of records) {
    const sourceRowId = person['Internal-ID'] || person.ID;

    // Track latest timestamp for incremental sync
    if (person.LastUpdatedUnixTime) {
      const ts = parseInt(person.LastUpdatedUnixTime, 10);
      if (!lastTimestamp || ts > lastTimestamp) {
        lastTimestamp = ts;
      }
    }

    if (dryRun) {
      inserted++;
      continue;
    }

    const result = await stageRecord(client, 'people', person, sourceRowId);
    if (result.was_inserted) {
      inserted++;
    } else {
      skipped++;
    }
  }

  if (!dryRun && records.length > 0) {
    await updateSyncState(client, syncType, lastTimestamp, records.length, records.length);
  }

  console.log(`  ${green}Done:${reset} ${inserted} inserted, ${skipped} unchanged`);
  return { inserted, skipped, total: records.length };
}

async function syncEvents(api, client, options) {
  const { incremental, limit, dryRun } = options;
  const syncType = 'events';

  console.log(`\n${bold}Syncing Events${reset}`);

  let afterTimestamp = null;
  if (incremental) {
    const state = await getSyncState(client, syncType);
    afterTimestamp = state.last_sync_timestamp;
    if (afterTimestamp) {
      console.log(`  ${cyan}Incremental:${reset} fetching events after ${new Date(afterTimestamp * 1000).toISOString()}`);
    }
  }

  let inserted = 0, skipped = 0, lastTimestamp = afterTimestamp;

  const records = await api.fetchAll('/events', {
    limit,
    after: afterTimestamp,
    onBatch: (batch, total, serverTotal) => {
      console.log(`  ${cyan}Progress:${reset} ${total}/${serverTotal} events fetched`);
    },
  });

  console.log(`  ${cyan}Total:${reset} ${records.length} events to process`);

  for (const event of records) {
    const sourceRowId = event['Internal-ID'] || event.ID;

    // Track latest timestamp (events use 'Time' field)
    if (event.Time) {
      const ts = parseInt(event.Time, 10);
      if (!lastTimestamp || ts > lastTimestamp) {
        lastTimestamp = ts;
      }
    }

    if (dryRun) {
      inserted++;
      continue;
    }

    const result = await stageRecord(client, 'events', event, sourceRowId);
    if (result.was_inserted) {
      inserted++;
    } else {
      skipped++;
    }
  }

  if (!dryRun && records.length > 0) {
    await updateSyncState(client, syncType, lastTimestamp, records.length, records.length);
  }

  console.log(`  ${green}Done:${reset} ${inserted} inserted, ${skipped} unchanged`);
  return { inserted, skipped, total: records.length };
}

// ============================================
// Main
// ============================================

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    type: null, // null = all
    incremental: false,
    dryRun: false,
    limit: 0,
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--type':
        options.type = args[++i];
        break;
      case '--incremental':
        options.incremental = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--limit':
        options.limit = parseInt(args[++i], 10);
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      case '--help':
        console.log(`
Usage: node shelterluv_api_sync.mjs [options]

Options:
  --type <type>     Sync only 'animals', 'people', or 'events'
  --incremental     Only fetch records since last sync
  --dry-run         Don't write to database
  --limit <n>       Limit records per endpoint
  --verbose, -v     Show detailed output
  --help            Show this help
        `);
        process.exit(0);
    }
  }

  return options;
}

async function main() {
  const options = parseArgs();

  console.log(`\n${bold}═══════════════════════════════════════════${reset}`);
  console.log(`${bold} ShelterLuv API Sync${reset}`);
  console.log(`${bold}═══════════════════════════════════════════${reset}`);

  if (!process.env.DATABASE_URL) {
    console.error(`${red}Error:${reset} DATABASE_URL not set`);
    process.exit(1);
  }

  if (!process.env.SHELTERLUV_API_KEY) {
    console.error(`${red}Error:${reset} SHELTERLUV_API_KEY not set`);
    process.exit(1);
  }

  if (options.dryRun) {
    console.log(`\n${yellow}DRY RUN MODE${reset} - No changes will be written`);
  }

  const api = new ShelterLuvAPI(process.env.SHELTERLUV_API_KEY);
  const client = new Client({ connectionString: process.env.DATABASE_URL });

  if (!options.dryRun) {
    await client.connect();
  }

  const stats = {
    animals: { inserted: 0, skipped: 0, total: 0 },
    people: { inserted: 0, skipped: 0, total: 0 },
    events: { inserted: 0, skipped: 0, total: 0 },
  };

  try {
    // Sync in order: people first (for identity resolution), then animals, then events
    if (!options.type || options.type === 'people') {
      stats.people = await syncPeople(api, client, options);
    }

    if (!options.type || options.type === 'animals') {
      stats.animals = await syncAnimals(api, client, options);
    }

    if (!options.type || options.type === 'events') {
      stats.events = await syncEvents(api, client, options);
    }

    // Summary
    console.log(`\n${bold}═══════════════════════════════════════════${reset}`);
    console.log(`${bold} Summary${reset}`);
    console.log(`${bold}═══════════════════════════════════════════${reset}`);
    console.log(`  API Requests: ${api.requestCount}`);

    const totalInserted = stats.animals.inserted + stats.people.inserted + stats.events.inserted;
    const totalSkipped = stats.animals.skipped + stats.people.skipped + stats.events.skipped;
    const totalRecords = stats.animals.total + stats.people.total + stats.events.total;

    console.log(`  Total Records: ${totalRecords}`);
    console.log(`  Inserted: ${totalInserted}`);
    console.log(`  Unchanged: ${totalSkipped}`);

    if (!options.dryRun) {
      // Check current sync status
      const statusResult = await client.query(`
        SELECT sync_type, last_sync_at, last_record_time, last_batch_size, sync_health
        FROM ops.v_shelterluv_sync_status
      `);

      console.log(`\n${bold}Sync Status:${reset}`);
      for (const row of statusResult.rows) {
        const health = row.sync_health === 'recent' ? green :
                       row.sync_health === 'stale' ? yellow : red;
        console.log(`  ${row.sync_type}: ${health}${row.sync_health}${reset} (${row.last_batch_size} records)`);
      }
    }

  } catch (error) {
    console.error(`\n${red}Error:${reset}`, error.message);
    if (options.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    if (!options.dryRun) {
      await client.end();
    }
  }

  console.log(`\n${green}Sync complete!${reset}\n`);
}

main().catch(e => {
  console.error(`${red}Fatal:${reset}`, e.message);
  process.exit(1);
});
