#!/usr/bin/env node
/**
 * airtable_equipment_sync.mjs
 *
 * Ongoing sync of Equipment inventory + Check-Out Log from Airtable into Atlas.
 * Designed to be re-run safely (idempotent via ON CONFLICT upserts).
 *
 * Data flow:
 *   Airtable Equipment table → ops.equipment (upsert)
 *   Airtable Check-Out Log table → ops.equipment_checkouts (upsert)
 *   Updates is_available based on latest checkout status.
 *
 * Usage:
 *   export $(cat .env | grep -v '^#' | xargs)
 *
 *   node scripts/ingest/airtable_equipment_sync.mjs --dry-run
 *   node scripts/ingest/airtable_equipment_sync.mjs
 *   node scripts/ingest/airtable_equipment_sync.mjs --verbose
 *
 * Required env:
 *   AIRTABLE_PAT  - Airtable Personal Access Token
 *   DATABASE_URL  - Postgres connection string
 */

import pg from 'pg';
import {
  fetchAllRecords,
  stageRecord,
  buildRecordIdMap,
  resolveLinkedAll,
  parseDate,
  startIngestRun,
  completeIngestRun,
} from '../lib/airtable-shared.mjs';

const { Client } = pg;

const EQUIPMENT_TABLE_ID = process.env.AT_EQUIPMENT_TABLE_ID || 'tblQ9fsfQUVpiI7VL';
const CHECKOUT_LOG_TABLE_ID = process.env.AT_CHECKOUT_LOG_TABLE_ID || 'tbl7KMM4RC7EnnWYN';

const SOURCE_SYSTEM = 'airtable';

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes('--dry-run'),
    verbose: args.includes('--verbose') || args.includes('-v'),
  };
}

// ============================================================
// Equipment Sync
// ============================================================

async function syncEquipment(client, options) {
  console.log('\n--- Equipment Inventory ---');
  const records = await fetchAllRecords(EQUIPMENT_TABLE_ID);
  console.log(`  Fetched ${records.length} equipment records from Airtable`);

  const stats = { inserted: 0, updated: 0, staged: 0, errors: 0 };

  for (const rec of records) {
    const f = rec.fields;

    // Stage raw record
    const { wasInserted } = await stageRecord(client, SOURCE_SYSTEM, 'equipment', rec.id, f);
    if (wasInserted) stats.staged++;

    const equipmentType = f['Type'] || f['Equipment Type'] || f['Name'] || 'unknown';
    const equipmentName = f['Name'] || f['Equipment Name'] || null;
    const serialNumber = f['Serial Number'] || f['Serial #'] || null;
    const condition = f['Condition'] || f['Status'] || null;
    const notes = f['Notes'] || null;
    const isAvailable = f['Available'] !== false && f['Checked Out'] !== true;

    if (options.dryRun) {
      if (options.verbose) console.log(`    [dry-run] ${equipmentName || equipmentType} (${rec.id})`);
      continue;
    }

    try {
      const result = await client.query(
        `INSERT INTO ops.equipment
           (equipment_type, equipment_name, serial_number, condition, notes, is_available, source_system, source_record_id)
         VALUES ($1, $2, $3, $4, $5, $6, 'airtable', $7)
         ON CONFLICT (source_system, source_record_id) DO UPDATE SET
           equipment_type = EXCLUDED.equipment_type,
           equipment_name = EXCLUDED.equipment_name,
           serial_number = EXCLUDED.serial_number,
           condition = EXCLUDED.condition,
           notes = EXCLUDED.notes,
           is_available = EXCLUDED.is_available
         RETURNING (xmax = 0) AS was_inserted`,
        [equipmentType, equipmentName, serialNumber, condition, notes, isAvailable, rec.id]
      );
      if (result.rows[0]?.was_inserted) {
        stats.inserted++;
      } else {
        stats.updated++;
      }
    } catch (err) {
      console.error(`    Error syncing equipment ${rec.id}: ${err.message}`);
      stats.errors++;
    }
  }

  console.log(`  Equipment: ${stats.inserted} inserted, ${stats.updated} updated, ${stats.staged} staged, ${stats.errors} errors`);
  return stats;
}

// ============================================================
// Equipment Checkouts Sync
// ============================================================

async function syncCheckouts(client, options) {
  console.log('\n--- Equipment Check-Out Log ---');
  const records = await fetchAllRecords(CHECKOUT_LOG_TABLE_ID);
  console.log(`  Fetched ${records.length} checkout records from Airtable`);

  // Build maps for resolving linked records
  const equipmentMap = await buildRecordIdMap(client, 'ops.equipment', 'equipment_id');

  // Build name→person_id map for matching checkout names to trappers
  const trapperNameResult = await client.query(
    `SELECT p.person_id, LOWER(TRIM(p.display_name)) AS display_name
     FROM sot.people p
     JOIN sot.person_roles pr ON pr.person_id = p.person_id
     WHERE pr.role IN ('trapper', 'community_trapper')`
  );
  const nameToTrapper = new Map(trapperNameResult.rows.map(r => [r.display_name, r.person_id]));
  if (options.verbose) console.log(`  Resolved ${nameToTrapper.size} trapper names for checkout matching`);

  const stats = { inserted: 0, updated: 0, staged: 0, skipped: 0, errors: 0 };

  for (const rec of records) {
    const f = rec.fields;

    // Stage raw record
    const { wasInserted } = await stageRecord(client, SOURCE_SYSTEM, 'checkout_log', rec.id, f);
    if (wasInserted) stats.staged++;

    // Resolve linked equipment
    const equipmentIds = resolveLinkedAll(f['Equipment'] || f['Unified Links'], equipmentMap);
    if (equipmentIds.length === 0) {
      stats.skipped++;
      continue;
    }

    // Resolve person by name (text field, not linked record)
    const personName = (f['Name'] || '').trim().toLowerCase();
    const personId = personName ? (nameToTrapper.get(personName) || null) : null;

    const timestamp = parseDate(f['Timestamp']);
    const action = (f['Action'] || '').toLowerCase();
    const checkedOutAt = action.includes('check-out') || action.includes('checkout') ? timestamp : null;
    const returnedAt = action.includes('check-in') || action.includes('checkin') || action.includes('return') ? timestamp : null;
    const notes = [f['Action'], f['Notes']].filter(Boolean).join(' — ') || null;

    if (options.dryRun) {
      if (options.verbose) console.log(`    [dry-run] ${personName || '(unknown)'} — ${action} — ${equipmentIds.length} item(s)`);
      continue;
    }

    // One checkout record per equipment item in this log entry
    for (const equipmentId of equipmentIds) {
      const sourceRecordId = `${rec.id}_${equipmentId}`;
      try {
        const result = await client.query(
          `INSERT INTO ops.equipment_checkouts
             (equipment_id, person_id, checked_out_at, returned_at, notes,
              source_system, source_record_id)
           VALUES ($1, $2, $3, $4, $5, 'airtable', $6)
           ON CONFLICT (source_system, source_record_id) DO UPDATE SET
             equipment_id = EXCLUDED.equipment_id,
             person_id = COALESCE(EXCLUDED.person_id, ops.equipment_checkouts.person_id),
             checked_out_at = COALESCE(EXCLUDED.checked_out_at, ops.equipment_checkouts.checked_out_at),
             returned_at = COALESCE(EXCLUDED.returned_at, ops.equipment_checkouts.returned_at),
             notes = EXCLUDED.notes
           RETURNING (xmax = 0) AS was_inserted`,
          [equipmentId, personId, checkedOutAt, returnedAt, notes, sourceRecordId]
        );
        if (result.rows[0]?.was_inserted) {
          stats.inserted++;
        } else {
          stats.updated++;
        }
      } catch (err) {
        console.error(`    Error syncing checkout ${rec.id}: ${err.message}`);
        stats.errors++;
      }
    }
  }

  console.log(`  Checkouts: ${stats.inserted} inserted, ${stats.updated} updated, ${stats.skipped} skipped (no equipment match), ${stats.errors} errors`);
  return stats;
}

// ============================================================
// Update equipment availability based on checkout status
// ============================================================

async function updateAvailability(client, options) {
  if (options.dryRun) {
    console.log('\n--- Availability Update (skipped in dry-run) ---');
    return { updated: 0 };
  }

  console.log('\n--- Updating Equipment Availability ---');

  // Equipment is unavailable if its latest checkout has no return date
  const result = await client.query(`
    WITH latest_checkout AS (
      SELECT DISTINCT ON (equipment_id)
        equipment_id,
        returned_at
      FROM ops.equipment_checkouts
      ORDER BY equipment_id, COALESCE(checked_out_at, created_at) DESC
    )
    UPDATE ops.equipment e SET
      is_available = COALESCE(lc.returned_at IS NOT NULL, TRUE)
    FROM latest_checkout lc
    WHERE e.equipment_id = lc.equipment_id
      AND e.is_available IS DISTINCT FROM COALESCE(lc.returned_at IS NOT NULL, TRUE)
  `);

  console.log(`  Updated availability for ${result.rowCount} equipment items`);
  return { updated: result.rowCount };
}

// ============================================================
// Main
// ============================================================

async function main() {
  const options = parseArgs();

  console.log('\n===============================================');
  console.log('Airtable Equipment Sync');
  console.log('===============================================');

  if (!process.env.AIRTABLE_PAT) {
    console.error('Error: AIRTABLE_PAT not set');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('Error: DATABASE_URL not set');
    process.exit(1);
  }

  if (options.dryRun) {
    console.log('DRY RUN MODE - No database writes\n');
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  let runId = null;
  if (!options.dryRun) {
    runId = await startIngestRun(client, 'equipment_sync', 0);
    console.log(`Run ID: ${runId.substring(0, 8)}...`);
  }

  const equipStats = await syncEquipment(client, options);
  const checkoutStats = await syncCheckouts(client, options);
  const availStats = await updateAvailability(client, options);

  if (runId) {
    const totalImported = equipStats.inserted + checkoutStats.inserted;
    const totalErrors = equipStats.errors + checkoutStats.errors;
    await completeIngestRun(client, runId, { imported: totalImported, errors: totalErrors });
  }

  await client.end();

  console.log('\n===============================================');
  console.log('Summary:');
  console.log(`  Equipment: ${equipStats.inserted} new, ${equipStats.updated} updated`);
  console.log(`  Checkouts: ${checkoutStats.inserted} new, ${checkoutStats.updated} updated, ${checkoutStats.skipped} skipped`);
  console.log(`  Availability: ${availStats.updated} changed`);
  const totalErrors = equipStats.errors + checkoutStats.errors;
  if (totalErrors > 0) console.log(`  Errors: ${totalErrors}`);
  console.log('===============================================\n');

  process.exit(totalErrors > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Fatal:', e.message);
  console.error(e.stack);
  process.exit(1);
});
