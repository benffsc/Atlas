#!/usr/bin/env node
/**
 * airtable_trappers_sync.mjs
 *
 * Syncs Trappers directly from Airtable API into Atlas.
 * Uses the same identity linking logic as other imports.
 *
 * Data flow:
 *   JotForm (community signup) → Airtable trappers table → This script
 *     → ops.staged_records (raw)
 *     → sot.find_or_create_person() (dedup/identity linking)
 *     → sot.person_roles (trapper designation)
 *
 * Usage:
 *   # First load env vars:
 *   export $(cat .env | grep -v '^#' | xargs)
 *
 *   # Then run:
 *   node scripts/ingest/airtable_trappers_sync.mjs
 *   node scripts/ingest/airtable_trappers_sync.mjs --dry-run
 *   node scripts/ingest/airtable_trappers_sync.mjs --verbose
 *
 * Required env (in root .env):
 *   AIRTABLE_PAT - Airtable Personal Access Token
 *   DATABASE_URL - Postgres connection string
 */

import pg from 'pg';
import {
  fetchAllRecords,
  stageRecord,
  startIngestRun,
  completeIngestRun,
} from '../lib/airtable-shared.mjs';
import { validatePersonCreation, logValidationFailure } from '../lib/identity-validation.mjs';

const { Client } = pg;

const TABLE_ID = process.env.AIRTABLE_TRAPPERS_TABLE_ID || 'tblmPBnkrsfqtnsvD';
const SOURCE_SYSTEM = 'airtable';
const SOURCE_TABLE = 'trappers';

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes('--dry-run'),
    verbose: args.includes('--verbose') || args.includes('-v'),
  };
}

// Map Airtable "Approval Status" to our trapper_type enum
// FFSC trappers (represent FFSC):
// - "Approved" = FFSC trappers (volunteers who became trappers)
// - "Legacy Trapper" = FFSC trappers who were approved before current system
// Community trappers (contract only, do NOT represent FFSC):
// - "Community Trapper" = community trappers (only trap at specific locations)
// - "Semi-Active" = less active community trappers
function mapTrapperType(approvalStatus) {
  const status = (approvalStatus || '').toLowerCase();

  if (status.includes('coordinator')) return 'coordinator';
  if (status.includes('head')) return 'head_trapper';
  if (status.includes('ffsc') || status.includes('staff')) return 'ffsc_trapper';
  if (status === 'approved' || status.includes('approved')) return 'ffsc_trapper';
  if (status.includes('legacy')) return 'ffsc_trapper';
  if (status.includes('community')) return 'community_trapper';
  if (status.includes('semi-active')) return 'community_trapper';

  // Default for JotForm signups
  return 'community_trapper';
}

// Extract trapper info from Airtable fields (exact field names from schema)
function extractTrapperInfo(fields) {
  return {
    firstName: fields['First Name'] || '',
    lastName: fields['Last Name(s)'] || '',
    displayName: fields['Name'] || '',
    email: (fields['Clean Email'] || fields['Email'] || '').toLowerCase().trim(),
    phone: (fields['Phone (Cell)'] || '').replace(/\D/g, ''),
    approvalStatus: fields['Approval Status'] || '',
    trapperType: mapTrapperType(fields['Approval Status']),
    experienceLevel: fields['Experience level'] || '',
    oversightLevel: fields['Oversight level'] || '',
    onNewProtocols: fields['On New Protocols'] === true,
    introducedToCoordinator: fields['Introduced to trapping coordinator'] === true,
    address: fields['Address'] || '',
    preferredRegions: fields['Preferred Regions'] || [],
    commonLocations: fields['Common Trapping Locations'] || [],
    notes: fields['Notes'] || '',
    recordId: fields['recordid'] || '',
    createdAt: fields['Created'] || null,
  };
}

async function main() {
  const options = parseArgs();

  console.log('\n===============================================');
  console.log('Airtable Trappers Sync');
  console.log('===============================================\n');

  if (!process.env.AIRTABLE_PAT) {
    console.error('Error: AIRTABLE_PAT not set');
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error('Error: DATABASE_URL not set');
    process.exit(1);
  }

  if (options.dryRun) {
    console.log('DRY RUN MODE - No changes will be made\n');
  }

  // Fetch from Airtable
  const airtableRecords = await fetchAllRecords(TABLE_ID);
  console.log(`\nTotal trappers from Airtable: ${airtableRecords.length}\n`);

  if (airtableRecords.length === 0) {
    console.log('No records to process.');
    process.exit(0);
  }

  // Show sample in dry run
  if (options.dryRun) {
    console.log('Sample records:');
    for (const record of airtableRecords.slice(0, 5)) {
      const info = extractTrapperInfo(record.fields);
      console.log(`  - ${info.displayName || '(no name)'}`);
      console.log(`    Email: ${info.email || '(none)'}`);
      console.log(`    Phone: ${info.phone || '(none)'}`);
      console.log(`    Type: ${info.approvalStatus} -> ${info.trapperType}`);
      console.log(`    Experience: ${info.experienceLevel || '(none)'}, Oversight: ${info.oversightLevel || '(none)'}`);
      console.log('');
    }
    console.log('Dry run complete. No changes made.');
    process.exit(0);
  }

  // Connect to database
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const runId = await startIngestRun(client, SOURCE_TABLE, airtableRecords.length);
  console.log(`Run ID: ${runId.substring(0, 8)}...\n`);

  let staged = 0;
  let updated = 0;
  let peopleCreated = 0;
  let peopleLinked = 0;
  let rolesCreated = 0;
  let rolesUpdated = 0;
  let skipped = 0;
  let errors = 0;

  for (const record of airtableRecords) {
    const airtableRecordId = record.id;
    const fields = record.fields;

    try {
      // Stage the raw record via shared lib (ops.staged_records)
      const { wasInserted } = await stageRecord(client, SOURCE_SYSTEM, SOURCE_TABLE, airtableRecordId, fields);
      if (wasInserted) {
        staged++;
      } else {
        updated++;
      }

      const info = extractTrapperInfo(fields);

      // Identity resolution
      if (!info.email && !info.phone) {
        if (options.verbose) console.log(`  -- ${info.displayName}: Skipped (no email/phone)`);
        skipped++;
        continue;
      }

      // Pre-validate before sending to SQL
      const validation = validatePersonCreation(info.email, info.phone, info.firstName, info.lastName);
      if (!validation.valid) {
        logValidationFailure('airtable_trappers_sync', {
          email: info.email, phone: info.phone, firstName: info.firstName, lastName: info.lastName
        }, validation.reason);
        if (options.verbose) console.log(`  -- ${info.displayName}: Skipped (${validation.reason})`);
        skipped++;
        continue;
      }

      // Run identity resolution via sot.find_or_create_person()
      const personResult = await client.query(
        `SELECT sot.find_or_create_person($1, $2, $3, $4, $5, $6) AS person_id`,
        [
          info.email || null,
          info.phone || null,
          info.firstName || null,
          info.lastName || null,
          info.address || null,
          SOURCE_SYSTEM,
        ]
      );

      const personId = personResult.rows[0]?.person_id;

      if (!personId) {
        if (options.verbose) console.log(`  -- ${info.displayName}: Skipped (identity resolution returned null)`);
        skipped++;
        continue;
      }

      // Check if this was an existing person or new
      const checkExisting = await client.query(
        `SELECT created_at FROM sot.people WHERE person_id = $1`,
        [personId]
      );

      const isNewPerson = checkExisting.rows[0]?.created_at > new Date(Date.now() - 5000);
      if (isNewPerson) {
        peopleCreated++;

        // Update display_name if needed
        if (info.displayName) {
          await client.query(
            `UPDATE sot.people SET
               display_name = COALESCE(NULLIF(display_name, ''), $2)
             WHERE person_id = $1 AND (display_name IS NULL OR display_name = '')`,
            [personId, info.displayName]
          );
        }
      } else {
        peopleLinked++;
      }

      // Build notes with experience info
      const notesParts = [];
      if (info.experienceLevel) notesParts.push(`Experience: ${info.experienceLevel}`);
      if (info.oversightLevel) notesParts.push(`Oversight: ${info.oversightLevel}`);
      if (info.notes) notesParts.push(info.notes);
      const combinedNotes = notesParts.join('. ') || null;

      // Create or update trapper role in sot.person_roles
      const roleResult = await client.query(
        `INSERT INTO sot.person_roles (
           person_id, role, trapper_type, role_status,
           source_system, source_record_id, notes, started_at
         ) VALUES ($1, 'trapper', $2, 'active', $3, $4, $5, $6)
         ON CONFLICT (person_id, role)
         DO UPDATE SET
           trapper_type = EXCLUDED.trapper_type,
           source_record_id = EXCLUDED.source_record_id,
           notes = COALESCE(EXCLUDED.notes, sot.person_roles.notes),
           updated_at = NOW()
         RETURNING (xmax = 0) AS was_inserted`,
        [
          personId,
          info.trapperType,
          SOURCE_SYSTEM,
          airtableRecordId,
          combinedNotes,
          info.createdAt ? new Date(info.createdAt) : null,
        ]
      );

      if (roleResult.rows[0]?.was_inserted) {
        rolesCreated++;
      } else {
        rolesUpdated++;
      }

      if (options.verbose) {
        console.log(`  + ${info.displayName} -> ${info.trapperType} (${isNewPerson ? 'new' : 'linked'})`);
      }

    } catch (err) {
      console.error(`  x Error processing "${fields['Name'] || record.id}": ${err.message}`);
      errors++;
    }
  }

  // Mark staged records as processed
  await client.query(
    `UPDATE ops.staged_records
     SET is_processed = true, processed_at = NOW()
     WHERE source_system = $1 AND source_table = $2`,
    [SOURCE_SYSTEM, SOURCE_TABLE]
  );

  await completeIngestRun(client, runId, { imported: staged, errors });
  await client.end();

  console.log('\n===============================================');
  console.log('Summary:');
  console.log(`  Staged records:  ${staged} new, ${updated} updated`);
  console.log(`  People:          ${peopleCreated} created, ${peopleLinked} linked to existing`);
  console.log(`  Trapper roles:   ${rolesCreated} created, ${rolesUpdated} updated`);
  if (skipped > 0) {
    console.log(`  Skipped:         ${skipped} (no email/phone or failed validation)`);
  }
  if (errors > 0) {
    console.log(`  Errors:          ${errors}`);
  }
  console.log('===============================================\n');

  process.exit(errors > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Fatal:', e.message);
  console.error(e.stack);
  process.exit(1);
});
