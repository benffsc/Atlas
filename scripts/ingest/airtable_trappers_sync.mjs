#!/usr/bin/env node
/**
 * airtable_trappers_sync.mjs
 *
 * Syncs Trappers directly from Airtable API into Atlas.
 * Uses the same identity linking logic as other imports.
 *
 * Data flow:
 *   JotForm (community signup) → Airtable trappers table → This script
 *     → staged_records (raw)
 *     → find_or_create_person() (dedup/identity linking)
 *     → person_roles (trapper designation)
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
import crypto from 'crypto';
import { validatePersonCreation, logValidationFailure } from '../lib/identity-validation.mjs';

const { Client } = pg;

// Airtable config from env
const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const BASE_ID = process.env.AIRTABLE_BASE_ID || 'appl6zLrRFDvsz0dh';
const TABLE_ID = process.env.AIRTABLE_TRAPPERS_TABLE_ID || 'tblmPBnkrsfqtnsvD';

const SOURCE_SYSTEM = 'airtable';
const SOURCE_TABLE = 'trappers';

// Parse command line args
function parseArgs() {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes('--dry-run'),
    verbose: args.includes('--verbose') || args.includes('-v'),
  };
}

// Fetch all records from Airtable with pagination
async function fetchAllRecords() {
  const records = [];
  let offset = null;
  let page = 1;

  console.log('Fetching trappers from Airtable...');

  while (true) {
    let url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}?pageSize=100`;
    if (offset) {
      url += `&offset=${offset}`;
    }

    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` }
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Airtable API error: ${response.status} ${response.statusText}\n${text}`);
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

// Compute hash for deduplication
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
  if (status === 'approved' || status.includes('approved')) return 'ffsc_trapper'; // Approved = FFSC volunteer trappers
  if (status.includes('legacy')) return 'ffsc_trapper'; // Legacy = FFSC trappers approved before current system
  if (status.includes('community')) return 'community_trapper';
  if (status.includes('semi-active')) return 'community_trapper'; // Semi-active community trappers

  // Default for JotForm signups
  return 'community_trapper';
}

// Extract trapper info from Airtable fields (exact field names from schema)
function extractTrapperInfo(fields) {
  return {
    // Names - Airtable has separate first/last
    firstName: fields['First Name'] || '',
    lastName: fields['Last Name(s)'] || '',
    displayName: fields['Name'] || '',

    // Contact
    email: (fields['Clean Email'] || fields['Email'] || '').toLowerCase().trim(),
    phone: (fields['Phone (Cell)'] || '').replace(/\D/g, ''), // Strip non-digits

    // Trapper classification
    approvalStatus: fields['Approval Status'] || '',
    trapperType: mapTrapperType(fields['Approval Status']),

    // Experience/training
    experienceLevel: fields['Experience level'] || '',
    oversightLevel: fields['Oversight level'] || '',
    onNewProtocols: fields['On New Protocols'] === true,
    introducedToCoordinator: fields['Introduced to trapping coordinator'] === true,

    // Location
    address: fields['Address'] || '',
    preferredRegions: fields['Preferred Regions'] || [],
    commonLocations: fields['Common Trapping Locations'] || [],

    // Notes
    notes: fields['Notes'] || '',

    // Airtable record ID
    recordId: fields['recordid'] || '',

    // Created date
    createdAt: fields['Created'] || null,
  };
}

async function main() {
  const options = parseArgs();

  console.log('\n═══════════════════════════════════════════════════');
  console.log('Airtable Trappers Sync');
  console.log('═══════════════════════════════════════════════════\n');

  // Validate env
  if (!AIRTABLE_PAT) {
    console.error('Error: AIRTABLE_PAT not set in environment');
    console.error('Add to your .env file:');
    console.error('  AIRTABLE_PAT=patXXXXXXXX');
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error('Error: DATABASE_URL not set');
    process.exit(1);
  }

  if (options.dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }

  // Fetch from Airtable
  const airtableRecords = await fetchAllRecords();
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
      console.log(`    Type: ${info.approvalStatus} → ${info.trapperType}`);
      console.log(`    Experience: ${info.experienceLevel || '(none)'}, Oversight: ${info.oversightLevel || '(none)'}`);
      console.log('');
    }
    console.log('Dry run complete. No changes made.');
    process.exit(0);
  }

  // Connect to database
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // Create ingest run
  const timestamp = new Date().toISOString();
  const runResult = await client.query(`
    INSERT INTO trapper.ingest_runs (
      source_system, source_table, source_file_path, source_file_name, source_file_sha256,
      row_count, rows_inserted, rows_linked, rows_suspect, run_status, started_at
    ) VALUES ($1, $2, 'airtable://api/trappers', $3, $4, $5, 0, 0, 0, 'running', NOW())
    RETURNING run_id
  `, [SOURCE_SYSTEM, SOURCE_TABLE, `trappers_sync_${timestamp}`, `api_${timestamp}`, airtableRecords.length]);
  const runId = runResult.rows[0].run_id;
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
    const rowHash = computeRowHash(fields);
    const payload = JSON.stringify(fields);

    try {
      // Stage the raw record
      const stageResult = await client.query(`
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
      `, [SOURCE_SYSTEM, SOURCE_TABLE, airtableRecordId, rowHash, payload]);

      if (stageResult.rows[0]?.was_inserted) {
        staged++;
      } else {
        updated++;
      }

      // Extract trapper info
      const info = extractTrapperInfo(fields);

      let personId = null;
      let linkMethod = null;

      // PRIORITY 1: Check for existing authoritative external link
      // Manual/override links take priority over identity resolution
      const existingLinkResult = await client.query(`
        SELECT person_id, link_type
        FROM trapper.external_person_links
        WHERE source_system = 'airtable'
          AND source_table = 'trappers'
          AND source_record_id = $1
          AND unlinked_at IS NULL
        ORDER BY CASE link_type
          WHEN 'override' THEN 1
          WHEN 'manual' THEN 2
          WHEN 'migration' THEN 3
          WHEN 'auto' THEN 4
        END
        LIMIT 1
      `, [airtableRecordId]);

      if (existingLinkResult.rows[0]) {
        const existingLink = existingLinkResult.rows[0];
        // For authoritative links (manual/override/migration), use directly
        if (['manual', 'override', 'migration'].includes(existingLink.link_type)) {
          personId = existingLink.person_id;
          linkMethod = `external_${existingLink.link_type}`;
          if (options.verbose) console.log(`  📎 ${info.displayName}: Using ${existingLink.link_type} external link`);
        } else {
          // Auto link exists - still use identity resolution but keep link
          personId = existingLink.person_id;
          linkMethod = 'external_auto';
        }
      }

      // PRIORITY 2: Identity resolution (if no authoritative link found)
      if (!personId) {
        // Check if we have identifying info
        if (!info.email && !info.phone) {
          // No identifiers - queue for manual linking
          await client.query(`
            SELECT trapper.queue_pending_trapper_link(
              $1, $2, $3, $4, $5, $6, 'no_identifiers'
            )
          `, [
            airtableRecordId,
            info.displayName,
            info.email || null,
            info.phone || null,
            info.address || null,
            info.trapperType
          ]);
          if (options.verbose) console.log(`  ⏳ ${info.displayName}: Queued for manual linking (no email/phone)`);
          skipped++;
          continue;
        }

        // Pre-validate before sending to SQL (belt-and-suspenders with MIG_919)
        const validation = validatePersonCreation(info.email, info.phone, info.firstName, info.lastName);
        if (!validation.valid) {
          logValidationFailure('airtable_trappers_sync', {
            email: info.email, phone: info.phone, firstName: info.firstName, lastName: info.lastName
          }, validation.reason);
          // Queue for manual linking instead of auto-linking
          await client.query(`
            SELECT trapper.queue_pending_trapper_link(
              $1, $2, $3, $4, $5, $6, 'validation_failed'
            )
          `, [
            airtableRecordId,
            info.displayName,
            info.email || null,
            info.phone || null,
            info.address || null,
            info.trapperType
          ]);
          skipped++;
          continue;
        }

        // Run identity resolution
        const personResult = await client.query(`
          SELECT trapper.find_or_create_person(
            $1,  -- email
            $2,  -- phone
            $3,  -- first_name
            $4,  -- last_name
            $5,  -- address
            $6   -- source_system
          ) AS person_id
        `, [
          info.email || null,
          info.phone || null,
          info.firstName || null,
          info.lastName || null,
          info.address || null,
          SOURCE_SYSTEM
        ]);

        personId = personResult.rows[0]?.person_id;
        linkMethod = 'identity_resolution';

        if (!personId) {
          // Identity resolution failed - queue for manual linking
          await client.query(`
            SELECT trapper.queue_pending_trapper_link(
              $1, $2, $3, $4, $5, $6, 'identity_resolution_failed'
            )
          `, [
            airtableRecordId,
            info.displayName,
            info.email || null,
            info.phone || null,
            info.address || null,
            info.trapperType
          ]);
          if (options.verbose) console.log(`  ⏳ ${info.displayName}: Queued for manual linking (identity resolution failed)`);
          skipped++;
          continue;
        }

        // Create auto external link for successful identity resolution
        await client.query(`
          SELECT trapper.link_external_record_to_person(
            'airtable', 'trappers', $1, $2, 'auto', 'trapper_sync'
          )
        `, [airtableRecordId, personId]);
      }

      // Check if this was an existing person or new
      const checkExisting = await client.query(`
        SELECT created_at FROM trapper.sot_people WHERE person_id = $1
      `, [personId]);

      const isNewPerson = checkExisting.rows[0]?.created_at > new Date(Date.now() - 5000); // Created in last 5 seconds
      if (isNewPerson) {
        peopleCreated++;

        // Update display_name if needed (sot_people only has display_name, not first/last)
        if (info.displayName) {
          await client.query(`
            UPDATE trapper.sot_people SET
              display_name = COALESCE(NULLIF(display_name, ''), $2)
            WHERE person_id = $1 AND (display_name IS NULL OR display_name = '')
          `, [personId, info.displayName]);
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

      // Create or update trapper role
      const roleResult = await client.query(`
        INSERT INTO trapper.person_roles (
          person_id, role, trapper_type, role_status,
          source_system, source_record_id, notes, started_at
        ) VALUES ($1, 'trapper', $2, 'active', $3, $4, $5, $6)
        ON CONFLICT (person_id, role)
        DO UPDATE SET
          trapper_type = EXCLUDED.trapper_type,
          source_record_id = EXCLUDED.source_record_id,
          notes = COALESCE(EXCLUDED.notes, trapper.person_roles.notes),
          updated_at = NOW()
        RETURNING (xmax = 0) AS was_inserted
      `, [
        personId,
        info.trapperType,
        SOURCE_SYSTEM,
        airtableRecordId,
        combinedNotes,
        info.createdAt ? new Date(info.createdAt) : null
      ]);

      if (roleResult.rows[0]?.was_inserted) {
        rolesCreated++;
      } else {
        rolesUpdated++;
      }

      if (options.verbose) {
        console.log(`  ✓ ${info.displayName} → ${info.trapperType} (${isNewPerson ? 'new' : 'linked'})`);
      }

    } catch (err) {
      console.error(`  ✗ Error processing "${fields['Name'] || record.id}": ${err.message}`);
      errors++;
    }
  }

  // Mark staged records as processed
  await client.query(`
    UPDATE trapper.staged_records
    SET is_processed = true, processed_at = NOW()
    WHERE source_system = $1 AND source_table = $2
  `, [SOURCE_SYSTEM, SOURCE_TABLE]);

  // Complete run
  await client.query(`
    UPDATE trapper.ingest_runs
    SET rows_inserted = $2, rows_linked = $3, run_status = $4, completed_at = NOW()
    WHERE run_id = $1
  `, [runId, staged, peopleLinked + peopleCreated, errors > 0 ? 'completed_with_errors' : 'completed']);

  await client.end();

  console.log('\n═══════════════════════════════════════════════════');
  console.log('Summary:');
  console.log(`  📥 Staged records:  ${staged} new, ${updated} updated`);
  console.log(`  👤 People:          ${peopleCreated} created, ${peopleLinked} linked to existing`);
  console.log(`  🏷️  Trapper roles:   ${rolesCreated} created, ${rolesUpdated} updated`);
  if (skipped > 0) {
    console.log(`  ⏭️  Skipped:         ${skipped} (no email/phone or failed validation)`);
  }
  if (errors > 0) {
    console.log(`  ⚠️  Errors:          ${errors}`);
  }
  console.log('═══════════════════════════════════════════════════\n');

  process.exit(errors > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Fatal:', e.message);
  console.error(e.stack);
  process.exit(1);
});
