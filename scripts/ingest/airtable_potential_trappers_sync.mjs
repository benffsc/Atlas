#!/usr/bin/env node
/**
 * airtable_potential_trappers_sync.mjs
 *
 * Ongoing sync of Potential Trappers from Airtable into Atlas.
 * Tracks the VolunteerHub signup → orientation → contract pipeline.
 *
 * Data flow:
 *   Airtable "Potential Trappers" table → ops.potential_trappers (upsert)
 *   Resolves person_id by email/phone when available.
 *
 * Usage:
 *   export $(cat .env | grep -v '^#' | xargs)
 *
 *   # Discover table ID (if not known)
 *   node scripts/ingest/airtable_potential_trappers_sync.mjs --discover
 *
 *   node scripts/ingest/airtable_potential_trappers_sync.mjs --dry-run
 *   node scripts/ingest/airtable_potential_trappers_sync.mjs
 *   node scripts/ingest/airtable_potential_trappers_sync.mjs --verbose
 *
 * Required env:
 *   AIRTABLE_PAT  - Airtable Personal Access Token
 *   DATABASE_URL  - Postgres connection string
 *   AT_POTENTIAL_TRAPPERS_TABLE_ID - Airtable table ID (or use --discover)
 */

import pg from 'pg';
import {
  fetchAllRecords,
  stageRecord,
  startIngestRun,
  completeIngestRun,
  discoverTables,
} from '../lib/airtable-shared.mjs';

const { Client } = pg;

const TABLE_ID = process.env.AT_POTENTIAL_TRAPPERS_TABLE_ID || null;
const SOURCE_SYSTEM = 'airtable';
const SOURCE_TABLE = 'potential_trappers';

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    discover: args.includes('--discover'),
    dryRun: args.includes('--dry-run'),
    verbose: args.includes('--verbose') || args.includes('-v'),
  };
}

/**
 * Derive pipeline status from Airtable checkbox fields.
 * Priority: contract_submitted > contract_sent > orientation_completed > new
 */
function derivePipelineStatus(fields) {
  const orientationDone = fields['Orientation Completed'] === true
    || fields['Completed Orientation'] === true
    || fields['Orientation'] === true;
  const contractSent = fields['Contract Sent'] === true
    || fields['Sent Contract'] === true;
  const contractSubmitted = fields['Contract Submitted'] === true
    || fields['Signed Contract'] === true
    || fields['Contract Received'] === true;

  if (contractSubmitted) return 'contract_submitted';
  if (contractSent) return 'contract_sent';
  if (orientationDone) return 'orientation_completed';
  return 'new';
}

/**
 * Extract fields from Airtable record — tries multiple field name variants.
 */
function extractInfo(fields) {
  const email = (
    fields['Email'] || fields['Clean Email'] || fields['Email Address'] || ''
  ).toLowerCase().trim() || null;

  const rawPhone = fields['Phone'] || fields['Phone Number'] || fields['Cell Phone'] || '';
  const phone = rawPhone.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1') || null;

  const name = fields['Name'] || fields['Full Name']
    || [fields['First Name'], fields['Last Name']].filter(Boolean).join(' ')
    || null;

  const orientationCompleted = fields['Orientation Completed'] === true
    || fields['Completed Orientation'] === true
    || fields['Orientation'] === true;
  const contractSent = fields['Contract Sent'] === true
    || fields['Sent Contract'] === true;
  const contractSubmitted = fields['Contract Submitted'] === true
    || fields['Signed Contract'] === true
    || fields['Contract Received'] === true;

  const notes = fields['Notes'] || fields['Comments'] || null;

  return {
    email,
    phone,
    name,
    orientationCompleted,
    contractSent,
    contractSubmitted,
    pipelineStatus: derivePipelineStatus(fields),
    notes,
  };
}

/**
 * Resolve person_id by email or phone lookup.
 */
async function resolvePersonId(client, email, phone) {
  if (email) {
    const r = await client.query(
      `SELECT person_id FROM sot.person_identifiers
       WHERE id_type = 'email' AND id_value_norm = $1 AND confidence >= 0.5 LIMIT 1`,
      [email]
    );
    if (r.rows.length > 0) return r.rows[0].person_id;
  }

  if (phone && phone.length === 10) {
    const r = await client.query(
      `SELECT person_id FROM sot.person_identifiers
       WHERE id_type = 'phone' AND id_value_norm = $1 AND confidence >= 0.5 LIMIT 1`,
      [phone]
    );
    if (r.rows.length > 0) return r.rows[0].person_id;
  }

  return null;
}

// ============================================================
// Main
// ============================================================

async function main() {
  const options = parseArgs();

  console.log('\n===============================================');
  console.log('Airtable Potential Trappers Sync');
  console.log('===============================================');

  if (!process.env.AIRTABLE_PAT) {
    console.error('Error: AIRTABLE_PAT not set');
    process.exit(1);
  }

  // Discover mode: list all tables and exit
  if (options.discover) {
    console.log('\nDiscovering Airtable tables...');
    const tables = await discoverTables();
    for (const t of tables) {
      const match = t.name.toLowerCase().includes('potential') || t.name.toLowerCase().includes('prospect');
      console.log(`  ${match ? '>>>' : '   '} ${t.id}  ${t.name}`);
    }
    console.log('\nSet AT_POTENTIAL_TRAPPERS_TABLE_ID to the correct table ID.');
    process.exit(0);
  }

  if (!TABLE_ID) {
    console.error('Error: AT_POTENTIAL_TRAPPERS_TABLE_ID not set.');
    console.error('Run with --discover to find the table ID, then set it.');
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error('Error: DATABASE_URL not set');
    process.exit(1);
  }

  if (options.dryRun) {
    console.log('DRY RUN MODE - No database writes\n');
  }

  // Fetch from Airtable
  const records = await fetchAllRecords(TABLE_ID);
  console.log(`\nTotal potential trappers: ${records.length}`);

  if (records.length === 0) {
    console.log('No records to process.');
    process.exit(0);
  }

  // Dry run: show sample and exit
  if (options.dryRun) {
    console.log('\nSample records:');
    for (const rec of records.slice(0, 5)) {
      const info = extractInfo(rec.fields);
      console.log(`  - ${info.name || '(no name)'}`);
      console.log(`    Email: ${info.email || '(none)'}, Phone: ${info.phone || '(none)'}`);
      console.log(`    Status: ${info.pipelineStatus}`);
      console.log(`    Orientation: ${info.orientationCompleted}, Contract Sent: ${info.contractSent}, Submitted: ${info.contractSubmitted}`);
    }
    console.log(`\n${records.length} records would be synced.`);
    process.exit(0);
  }

  // Connect to database
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const runId = await startIngestRun(client, SOURCE_TABLE, records.length);
  console.log(`Run ID: ${runId.substring(0, 8)}...`);

  const stats = { inserted: 0, updated: 0, resolved: 0, errors: 0 };

  for (const rec of records) {
    const f = rec.fields;
    const info = extractInfo(f);

    try {
      // Stage raw record
      await stageRecord(client, SOURCE_SYSTEM, SOURCE_TABLE, rec.id, f);

      // Try to resolve person_id
      const personId = await resolvePersonId(client, info.email, info.phone);
      if (personId) stats.resolved++;

      // Upsert into ops.potential_trappers
      const result = await client.query(
        `INSERT INTO ops.potential_trappers
           (display_name, email, phone, person_id,
            orientation_completed, contract_sent, contract_submitted,
            pipeline_status, notes, airtable_fields,
            source_system, source_record_id, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, 'airtable', $11, NOW())
         ON CONFLICT (source_system, source_record_id) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           email = EXCLUDED.email,
           phone = EXCLUDED.phone,
           person_id = COALESCE(EXCLUDED.person_id, ops.potential_trappers.person_id),
           orientation_completed = EXCLUDED.orientation_completed,
           contract_sent = EXCLUDED.contract_sent,
           contract_submitted = EXCLUDED.contract_submitted,
           pipeline_status = EXCLUDED.pipeline_status,
           notes = EXCLUDED.notes,
           airtable_fields = EXCLUDED.airtable_fields,
           updated_at = NOW()
         RETURNING (xmax = 0) AS was_inserted`,
        [
          info.name, info.email, info.phone, personId,
          info.orientationCompleted, info.contractSent, info.contractSubmitted,
          info.pipelineStatus, info.notes, JSON.stringify(f),
          rec.id,
        ]
      );

      if (result.rows[0]?.was_inserted) {
        stats.inserted++;
      } else {
        stats.updated++;
      }

      if (options.verbose) {
        console.log(`  ${result.rows[0]?.was_inserted ? '+' : '~'} ${info.name || rec.id} → ${info.pipelineStatus}${personId ? ' (resolved)' : ''}`);
      }
    } catch (err) {
      console.error(`  Error processing ${info.name || rec.id}: ${err.message}`);
      stats.errors++;
    }
  }

  await completeIngestRun(client, runId, { imported: stats.inserted, errors: stats.errors });
  await client.end();

  console.log('\n===============================================');
  console.log('Summary:');
  console.log(`  Inserted: ${stats.inserted}`);
  console.log(`  Updated:  ${stats.updated}`);
  console.log(`  Resolved to person: ${stats.resolved}`);
  if (stats.errors > 0) console.log(`  Errors: ${stats.errors}`);
  console.log('===============================================\n');

  process.exit(stats.errors > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Fatal:', e.message);
  console.error(e.stack);
  process.exit(1);
});
