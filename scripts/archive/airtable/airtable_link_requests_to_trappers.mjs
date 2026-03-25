#!/usr/bin/env node
/**
 * airtable_link_requests_to_trappers.mjs
 *
 * Links trapping requests to their assigned trappers based on Airtable data.
 * Uses the "Trappers Assigned" field which contains linked record IDs.
 *
 * MULTI-TRAPPER SUPPORT (MIG_207):
 * --------------------------------
 * This script populates request_trapper_assignments table which supports
 * multiple trappers per request with history tracking. The first trapper
 * in Airtable's list is marked as is_primary = true.
 *
 * Special handling:
 *   - "Client Trapping" (recEp51Dwdei6cN2F) → sets no_trapper_reason = 'client_trapping'
 *   - Empty "Trappers Assigned" → no_trapper_reason = 'pending_assignment'
 *   - Actual trappers → links to person via request_trapper_assignments
 *
 * ATTRIBUTION WINDOWS (MIG_208):
 * ------------------------------
 * Trapper statistics (v_trapper_full_stats) use v_request_alteration_stats
 * which employs rolling attribution windows. This means:
 *   - Active requests capture cats brought to clinic up to NOW + 6 months
 *   - Resolved requests have 3-month buffer for late clinic visits
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
    FROM sot.person_roles pr
    JOIN sot.people p ON p.person_id = pr.person_id
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
    FROM sot.person_roles pr
    JOIN sot.people p ON p.person_id = pr.person_id
    WHERE pr.role = 'trapper'
  `);
  for (const row of allTrappersResult.rows) {
    trappersByName[row.display_name.toLowerCase().trim()] = row.person_id;
  }

  // Process requests
  let linked = 0;
  let totalAssignments = 0;  // Total trapper assignments created
  let clientTrapping = 0;
  let noTrapperSet = 0;
  let notFound = 0;
  let errors = 0;

  for (const record of airtableRequests) {
    const airtableRequestId = record.id;
    const trapperIds = record.fields['Trappers Assigned'] || [];
    const caseNum = record.fields['Case Number'] || record.id;

    try {
      // Find the request in Atlas by source_record_id
      const reqResult = await client.query(`
        SELECT request_id, assigned_trapper_id, no_trapper_reason
        FROM ops.requests
        WHERE source_record_id = $1
      `, [airtableRequestId]);

      if (reqResult.rows.length === 0) {
        // Request not in Atlas yet - skip
        continue;
      }

      const request = reqResult.rows[0];

      // Check if already has basic assignment (but still populate multi-trapper table)
      const hadPriorAssignment = request.assigned_trapper_id || request.no_trapper_reason;

      // Handle different cases
      if (trapperIds.length === 0) {
        // No trapper assigned - mark as pending
        await client.query(`
          UPDATE ops.requests
          SET no_trapper_reason = 'pending_assignment', updated_at = NOW()
          WHERE request_id = $1
        `, [request.request_id]);
        noTrapperSet++;

      } else if (trapperIds.includes(CLIENT_TRAPPING_RECORD_ID) && trapperIds.length === 1) {
        // Client is trapping themselves (only Client Trapping, no other trapper)
        await client.query(`
          UPDATE ops.requests
          SET no_trapper_reason = 'client_trapping', updated_at = NOW()
          WHERE request_id = $1
        `, [request.request_id]);
        clientTrapping++;
        if (options.verbose) console.log(`  ✓ Case ${caseNum}: client_trapping`);

      } else {
        // Has real trapper(s) - filter out Client Trapping pseudo-record
        const realTrapperIds = trapperIds.filter(id => id !== CLIENT_TRAPPING_RECORD_ID);

        // Process ALL trappers, first one is primary
        let primarySet = false;
        let assignedCount = 0;

        for (let i = 0; i < realTrapperIds.length; i++) {
          const trapperId = realTrapperIds[i];
          const isPrimary = (i === 0);
          let personId = null;

          // First try by source_record_id
          if (trapperIdMap[trapperId]) {
            personId = trapperIdMap[trapperId].personId;
          } else {
            // Try by name match
            const trapperName = trapperNames[trapperId];
            if (trapperName) {
              personId = trappersByName[trapperName.toLowerCase().trim()];
            }
          }

          if (personId) {
            // Check if assignment already exists (active)
            const existingCheck = await client.query(`
              SELECT assignment_id, is_primary
              FROM ops.request_trapper_assignments
              WHERE request_id = $1 AND trapper_person_id = $2 AND unassigned_at IS NULL
            `, [request.request_id, personId]);

            const wasExisting = existingCheck.rows.length > 0;
            const oldIsPrimary = wasExisting ? existingCheck.rows[0].is_primary : null;
            const primaryChanged = wasExisting && oldIsPrimary !== isPrimary;

            if (wasExisting) {
              // Update existing assignment if is_primary changed
              if (primaryChanged) {
                await client.query(`
                  UPDATE ops.request_trapper_assignments
                  SET is_primary = $3, updated_at = NOW()
                  WHERE request_id = $1 AND trapper_person_id = $2 AND unassigned_at IS NULL
                `, [request.request_id, personId, isPrimary]);

                // Log the change
                await client.query(`
                  INSERT INTO ops.entity_edits (
                    entity_type, entity_id, edit_type, field_name, old_value, new_value,
                    related_entity_type, related_entity_id, reason, edited_by, edit_source
                  ) VALUES (
                    'request', $1, 'update', 'trapper_is_primary',
                    $3::jsonb, $4::jsonb,
                    'person', $2, 'Airtable sync updated primary status',
                    'airtable_link_script', 'airtable_sync'
                  )
                `, [request.request_id, personId, JSON.stringify(oldIsPrimary), JSON.stringify(isPrimary)]);
              }
            } else {
              // Insert new assignment
              await client.query(`
                INSERT INTO ops.request_trapper_assignments (
                  request_id, trapper_person_id, is_primary,
                  assignment_reason, source_system, source_record_id, created_by
                ) VALUES ($1, $2, $3, 'airtable_sync', 'airtable', $4, 'airtable_link_script')
              `, [request.request_id, personId, isPrimary, trapperId]);

              // Log the new assignment
              await client.query(`
                INSERT INTO ops.entity_edits (
                  entity_type, entity_id, edit_type, field_name, new_value,
                  related_entity_type, related_entity_id, reason, edited_by, edit_source
                ) VALUES (
                  'request', $1, 'link', 'trapper_assignment',
                  $3::jsonb,
                  'person', $2, 'Airtable sync added trapper',
                  'airtable_link_script', 'airtable_sync'
                )
              `, [request.request_id, personId, JSON.stringify({ is_primary: isPrimary })]);
            }

            assignedCount++;
            if (!wasExisting) totalAssignments++;

            // Set primary trapper on sot_requests (first one only, if not already set)
            if (isPrimary && !primarySet && !hadPriorAssignment) {
              await client.query(`
                UPDATE ops.requests
                SET assigned_trapper_id = $2, updated_at = NOW()
                WHERE request_id = $1
              `, [request.request_id, personId]);
              primarySet = true;
            }
          } else {
            if (options.verbose) {
              console.log(`    ? Trapper not found: ${trapperNames[trapperId] || trapperId}`);
            }
          }
        }

        if (assignedCount > 0) {
          linked++;
          if (options.verbose) {
            const names = realTrapperIds.map(id => trapperNames[id] || id).join(', ');
            console.log(`  ✓ Case ${caseNum}: ${names} (${assignedCount} trappers)`);
          }
        } else {
          notFound++;
          if (options.verbose) {
            console.log(`  ? Case ${caseNum}: no trappers found`);
          }
        }
      }

      // Change logging now handled per-assignment above

    } catch (err) {
      console.error(`  ✗ Error on case ${caseNum}: ${err.message}`);
      errors++;
    }
  }

  await client.end();

  console.log('\n═══════════════════════════════════════════════════');
  console.log('Summary:');
  console.log(`  🔗 Requests with trappers: ${linked}`);
  console.log(`  👥 Total trapper assignments: ${totalAssignments}`);
  console.log(`  👤 Client trapping: ${clientTrapping}`);
  console.log(`  ⏳ Pending assignment: ${noTrapperSet}`);
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
