#!/usr/bin/env node
/**
 * airtable_link_requests_to_trappers.mjs
 *
 * Links trapping requests to their assigned trappers based on Airtable data.
 * Uses the "Trappers Assigned" field which contains linked record IDs.
 *
 * Special handling:
 *   - "Client Trapping" (recEp51Dwdei6cN2F) → sets no_trapper_reason = 'client_trapping'
 *   - Empty "Trappers Assigned" → no_trapper_reason = 'pending_assignment'
 *   - Actual trappers → links to person via person_roles
 *
 * Usage:
 *   export $(cat .env | grep -v '^#' | xargs)
 *   node scripts/ingest/airtable_link_requests_to_trappers.mjs
 *   node scripts/ingest/airtable_link_requests_to_trappers.mjs --dry-run
 *
 * Required env:
 *   AIRTABLE_PAT - Airtable Personal Access Token
 *   DATABASE_URL - Postgres connection string
 */

import pg from 'pg';

const { Client } = pg;

const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const BASE_ID = 'appl6zLrRFDvsz0dh';
const REQUESTS_TABLE_ID = 'tblc1bva7jFzg8DVF';
const TRAPPERS_TABLE_ID = 'tblmPBnkrsfqtnsvD';

// Special pseudo-trapper for client self-trapping
const CLIENT_TRAPPING_RECORD_ID = 'recEp51Dwdei6cN2F';

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes('--dry-run'),
    verbose: args.includes('--verbose') || args.includes('-v'),
  };
}

async function fetchAllRecords(tableId, tableName) {
  const records = [];
  let offset = null;
  let page = 1;

  console.log(`Fetching ${tableName} from Airtable...`);

  while (true) {
    let url = `https://api.airtable.com/v0/${BASE_ID}/${tableId}?pageSize=100`;
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

async function main() {
  const options = parseArgs();

  console.log('\n═══════════════════════════════════════════════════');
  console.log('Link Requests to Trappers from Airtable');
  console.log('═══════════════════════════════════════════════════\n');

  if (!AIRTABLE_PAT) {
    console.error('Error: AIRTABLE_PAT not set');
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error('Error: DATABASE_URL not set');
    process.exit(1);
  }

  if (options.dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }

  // Fetch trappers first to build a mapping
  const airtableTrappers = await fetchAllRecords(TRAPPERS_TABLE_ID, 'Trappers');

  // Build trapper record ID → name mapping
  const trapperNames = {};
  for (const record of airtableTrappers) {
    trapperNames[record.id] = record.fields['Name'] || '(unnamed)';
  }
  console.log(`\nLoaded ${Object.keys(trapperNames).length} trappers from Airtable\n`);

  // Fetch all requests
  const airtableRequests = await fetchAllRecords(REQUESTS_TABLE_ID, 'Trapping Requests');

  // Count requests with trappers assigned
  let withTrappers = 0;
  let withClientTrapping = 0;
  let withoutTrappers = 0;
  let withMultipleTrappers = 0;

  for (const record of airtableRequests) {
    const trapperIds = record.fields['Trappers Assigned'] || [];
    if (trapperIds.length === 0) {
      withoutTrappers++;
    } else if (trapperIds.includes(CLIENT_TRAPPING_RECORD_ID) && trapperIds.length === 1) {
      withClientTrapping++;
    } else {
      withTrappers++;
      if (trapperIds.length > 1) {
        withMultipleTrappers++;
      }
    }
  }

  console.log('\nAirtable Request Summary:');
  console.log(`  Total requests: ${airtableRequests.length}`);
  console.log(`  With trapper assigned: ${withTrappers}`);
  console.log(`  With multiple trappers: ${withMultipleTrappers}`);
  console.log(`  Client trapping: ${withClientTrapping}`);
  console.log(`  No trapper assigned: ${withoutTrappers}\n`);

  if (options.dryRun) {
    // Show sample assignments
    console.log('Sample trapper assignments:');
    let shown = 0;
    for (const record of airtableRequests) {
      if (shown >= 10) break;
      const trapperIds = record.fields['Trappers Assigned'] || [];
      if (trapperIds.length > 0) {
        const names = trapperIds.map(id => trapperNames[id] || id).join(', ');
        const caseNum = record.fields['Case Number'] || record.id;
        console.log(`  Case ${caseNum}: ${names}`);
        shown++;
      }
    }
    console.log('\nDry run complete. No changes made.');
    process.exit(0);
  }

  // Connect to database
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // Build mapping: Airtable trapper record ID → Atlas person_id
  // Uses person_roles.source_record_id to match
  console.log('Building trapper ID mapping...');
  const trapperIdMap = {};

  const trapperResult = await client.query(`
    SELECT pr.source_record_id, pr.person_id, p.display_name
    FROM trapper.person_roles pr
    JOIN trapper.sot_people p ON p.person_id = pr.person_id
    WHERE pr.role = 'trapper'
      AND pr.source_system = 'airtable'
      AND pr.source_record_id IS NOT NULL
  `);

  for (const row of trapperResult.rows) {
    trapperIdMap[row.source_record_id] = {
      personId: row.person_id,
      displayName: row.display_name
    };
  }
  console.log(`  Found ${Object.keys(trapperIdMap).length} trappers with Airtable record IDs\n`);

  // Also try matching by name for trappers without source_record_id
  const trappersByName = {};
  const allTrappersResult = await client.query(`
    SELECT pr.person_id, p.display_name
    FROM trapper.person_roles pr
    JOIN trapper.sot_people p ON p.person_id = pr.person_id
    WHERE pr.role = 'trapper'
  `);
  for (const row of allTrappersResult.rows) {
    trappersByName[row.display_name.toLowerCase().trim()] = row.person_id;
  }

  // Process requests
  let linked = 0;
  let clientTrapping = 0;
  let noTrapperSet = 0;
  let notFound = 0;
  let alreadySet = 0;
  let errors = 0;

  for (const record of airtableRequests) {
    const airtableRequestId = record.id;
    const trapperIds = record.fields['Trappers Assigned'] || [];
    const caseNum = record.fields['Case Number'] || record.id;

    try {
      // Find the request in Atlas by source_record_id
      const reqResult = await client.query(`
        SELECT request_id, assigned_trapper_id, no_trapper_reason
        FROM trapper.sot_requests
        WHERE source_record_id = $1
      `, [airtableRequestId]);

      if (reqResult.rows.length === 0) {
        // Request not in Atlas yet - skip
        continue;
      }

      const request = reqResult.rows[0];

      // Skip if already has assignment
      if (request.assigned_trapper_id || request.no_trapper_reason) {
        alreadySet++;
        continue;
      }

      // Handle different cases
      if (trapperIds.length === 0) {
        // No trapper assigned - mark as pending
        await client.query(`
          UPDATE trapper.sot_requests
          SET no_trapper_reason = 'pending_assignment', updated_at = NOW()
          WHERE request_id = $1
        `, [request.request_id]);
        noTrapperSet++;

      } else if (trapperIds.includes(CLIENT_TRAPPING_RECORD_ID) && trapperIds.length === 1) {
        // Client is trapping themselves (only Client Trapping, no other trapper)
        await client.query(`
          UPDATE trapper.sot_requests
          SET no_trapper_reason = 'client_trapping', updated_at = NOW()
          WHERE request_id = $1
        `, [request.request_id]);
        clientTrapping++;
        if (options.verbose) console.log(`  ✓ Case ${caseNum}: client_trapping`);

      } else {
        // Has real trapper(s) - filter out Client Trapping pseudo-record
        const realTrapperIds = trapperIds.filter(id => id !== CLIENT_TRAPPING_RECORD_ID);
        // Real trapper(s) assigned - use the first one (primary)
        // For multiple trappers, we take the first; could enhance later
        const primaryTrapperId = realTrapperIds.length > 0 ? realTrapperIds[0] : trapperIds[0];
        let personId = null;

        // First try by source_record_id
        if (trapperIdMap[primaryTrapperId]) {
          personId = trapperIdMap[primaryTrapperId].personId;
        } else {
          // Try by name match
          const trapperName = trapperNames[primaryTrapperId];
          if (trapperName) {
            personId = trappersByName[trapperName.toLowerCase().trim()];
          }
        }

        if (personId) {
          await client.query(`
            UPDATE trapper.sot_requests
            SET assigned_trapper_id = $2, updated_at = NOW()
            WHERE request_id = $1
          `, [request.request_id, personId]);
          linked++;
          if (options.verbose) {
            const name = trapperIdMap[primaryTrapperId]?.displayName || trapperNames[primaryTrapperId];
            console.log(`  ✓ Case ${caseNum}: ${name}`);
          }
        } else {
          notFound++;
          if (options.verbose) {
            console.log(`  ? Case ${caseNum}: trapper not found (${trapperNames[primaryTrapperId] || primaryTrapperId})`);
          }
        }
      }

      // Log the change
      await client.query(`
        INSERT INTO trapper.data_changes (
          entity_type, entity_key, field_name, old_value, new_value, change_source
        ) VALUES ('request', $1, 'trapper_assignment', NULL, $2, 'airtable_link_script')
      `, [
        request.request_id,
        trapperIds.length === 0 ? 'pending_assignment'
          : trapperIds.includes(CLIENT_TRAPPING_RECORD_ID) ? 'client_trapping'
          : trapperNames[trapperIds[0]] || trapperIds[0]
      ]);

    } catch (err) {
      console.error(`  ✗ Error on case ${caseNum}: ${err.message}`);
      errors++;
    }
  }

  await client.end();

  console.log('\n═══════════════════════════════════════════════════');
  console.log('Summary:');
  console.log(`  🔗 Linked to trapper: ${linked}`);
  console.log(`  👤 Client trapping: ${clientTrapping}`);
  console.log(`  ⏳ Pending assignment: ${noTrapperSet}`);
  console.log(`  ⏭️  Already set: ${alreadySet}`);
  if (notFound > 0) {
    console.log(`  ❓ Trapper not found: ${notFound}`);
  }
  if (errors > 0) {
    console.log(`  ⚠️  Errors: ${errors}`);
  }
  console.log('═══════════════════════════════════════════════════\n');

  process.exit(errors > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Fatal:', e.message);
  console.error(e.stack);
  process.exit(1);
});
