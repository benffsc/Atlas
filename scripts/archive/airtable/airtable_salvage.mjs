#!/usr/bin/env node
/**
 * airtable_salvage.mjs
 *
 * One-time data salvage from Airtable before decommissioning.
 * Imports remaining tables not covered by existing scripts.
 *
 * Covers FFS-186 through FFS-205 (20 Linear issues).
 *
 * Usage:
 *   export $(cat .env | grep -v '^#' | xargs)
 *
 *   # Discover all Airtable table IDs
 *   node scripts/ingest/airtable_salvage.mjs --discover
 *
 *   # Dry run (stage + log, no writes)
 *   node scripts/ingest/airtable_salvage.mjs --dry-run
 *
 *   # Run a specific phase
 *   node scripts/ingest/airtable_salvage.mjs --phase=A
 *   node scripts/ingest/airtable_salvage.mjs --phase=B
 *
 *   # Run a single issue
 *   node scripts/ingest/airtable_salvage.mjs --only=ffs-193
 *
 *   # Verbose output
 *   node scripts/ingest/airtable_salvage.mjs --phase=A --verbose
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
  resolveLinked,
  resolveLinkedAll,
  parseDate,
  parsePositiveInt,
  startIngestRun,
  completeIngestRun,
  discoverTables,
} from '../lib/airtable-shared.mjs';
import { validatePersonCreation } from '../lib/identity-validation.mjs';

const { Client } = pg;

// ============================================================
// Known Airtable Table IDs
// ============================================================
const TABLE_IDS = {
  trapping_requests:    'tblc1bva7jFzg8DVF',
  trappers:             'tblmPBnkrsfqtnsvD',
  appointment_requests: 'tbltFEFUPMS6KZU8Y',
  staff:                'tblBnnx3lZte6KgMn',
  trapper_cats:         'tblP6VojwygMA9VQ3',
  trapper_reports:      'tblE8SFqVfsW051ox',
  project_75:           'tblpjMKadfeunMPq7',
  clients:              'tbl9rWVZiRnNfs6CE',
  locations:            'tblgIujqp8nISVnfK',
  // To be discovered — populate after running --discover
  trapper_cases:        process.env.AT_TRAPPER_CASES_TABLE_ID || null,
  checkout_log:         process.env.AT_CHECKOUT_LOG_TABLE_ID || null,
  call_sheets:          process.env.AT_CALL_SHEETS_TABLE_ID || null,
  ffsc_calendar:        process.env.AT_CALENDAR_TABLE_ID || null,
  events:               process.env.AT_EVENTS_TABLE_ID || null,
  kitten_intake:        process.env.AT_KITTEN_INTAKE_TABLE_ID || null,
  master_cats:          process.env.AT_MASTER_CATS_TABLE_ID || null,
  master_contacts:      process.env.AT_MASTER_CONTACTS_TABLE_ID || null,
  common_trapping_locs: process.env.AT_COMMON_TRAPPING_LOCS_TABLE_ID || null,
  place_contacts:       process.env.AT_PLACE_CONTACTS_TABLE_ID || null,
  surrender_forms:      process.env.AT_SURRENDER_FORMS_TABLE_ID || null,
  equipment:            process.env.AT_EQUIPMENT_TABLE_ID || null,
  trapper_skills:       process.env.AT_TRAPPER_SKILLS_TABLE_ID || null,
};

// ============================================================
// CLI Argument Parsing
// ============================================================
function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    discover: args.includes('--discover'),
    dryRun: args.includes('--dry-run'),
    verbose: args.includes('--verbose') || args.includes('-v'),
    phase: null,
    only: null,
  };

  for (const arg of args) {
    const phaseMatch = arg.match(/^--phase=([A-F])$/i);
    if (phaseMatch) result.phase = phaseMatch[1].toUpperCase();

    const onlyMatch = arg.match(/^--only=(ffs-\d+)$/i);
    if (onlyMatch) result.only = onlyMatch[1].toUpperCase();
  }

  return result;
}

// ============================================================
// Discovery Mode
// ============================================================
async function runDiscover() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('Discovering Airtable Tables');
  console.log('═══════════════════════════════════════════════════\n');

  const tables = await discoverTables();
  const knownIds = new Set(Object.values(TABLE_IDS).filter(Boolean));

  console.log(`Found ${tables.length} tables:\n`);
  for (const table of tables) {
    const known = knownIds.has(table.id);
    const marker = known ? '  ✓' : '  ?';
    console.log(`${marker} ${table.name.padEnd(35)} ${table.id}`);
    if (!known) {
      const fieldNames = table.fields?.map(f => f.name).join(', ') || '(no fields)';
      console.log(`     Fields: ${fieldNames}`);
    }
  }

  console.log('\n  ✓ = Already known   ? = Needs table ID in env\n');
  console.log('Set unknown table IDs as env vars:');
  console.log('  export AT_TRAPPER_CASES_TABLE_ID=tblXXXXXXXX');
  console.log('  export AT_CALL_SHEETS_TABLE_ID=tblXXXXXXXX');
  console.log('  ... etc.\n');
}

// ============================================================
// Resolution Maps — Built Once at Startup
// ============================================================
async function buildResolveMaps(client, options) {
  console.log('\nBuilding resolution maps...');

  const maps = {};

  // Requests: Airtable record ID → Atlas request_id (source_system = 'airtable_ffsc')
  maps.requests = await buildRecordIdMap(client, 'ops.requests', 'request_id', { sourceSystem: 'airtable_ffsc' });
  console.log(`  requests: ${maps.requests.size} mappings`);

  // Trappers: Airtable record ID → Atlas person_id
  // person_roles has no source_record_id for Airtable trappers, so we match by name
  // Fetch Airtable Trappers table and match display_name → Atlas person_id
  maps.trappers = new Map();
  try {
    const atTrappers = await fetchAllRecords(TABLE_IDS.trappers, { quiet: true });
    const trapperNameResult = await client.query(
      `SELECT p.person_id, LOWER(TRIM(p.display_name)) AS display_name
       FROM sot.people p
       JOIN sot.person_roles pr ON pr.person_id = p.person_id
       WHERE pr.role IN ('trapper', 'community_trapper')`
    );
    const nameToId = new Map(trapperNameResult.rows.map(r => [r.display_name, r.person_id]));
    for (const rec of atTrappers) {
      const atName = (rec.fields['Name'] || '').trim().toLowerCase();
      if (atName && nameToId.has(atName)) {
        maps.trappers.set(rec.id, nameToId.get(atName));
      }
    }
  } catch (err) {
    console.warn(`  WARNING: Could not build trapper map: ${err.message}`);
  }
  console.log(`  trappers: ${maps.trappers.size} mappings`);

  // Staff: Airtable record ID → Atlas person_id
  // person_roles has no source_record_id for Airtable staff, so we match by name
  maps.staff = new Map();
  try {
    const atStaff = await fetchAllRecords(TABLE_IDS.staff, { quiet: true });
    const staffNameResult = await client.query(
      `SELECT p.person_id, LOWER(TRIM(p.display_name)) AS display_name
       FROM sot.people p
       JOIN sot.person_roles pr ON pr.person_id = p.person_id
       WHERE pr.role = 'staff'`
    );
    const nameToId = new Map(staffNameResult.rows.map(r => [r.display_name, r.person_id]));
    for (const rec of atStaff) {
      const first = (rec.fields['First Name'] || '').trim();
      const last = (rec.fields['Last name'] || rec.fields['Last Name'] || '').trim();
      const atName = `${first} ${last}`.trim().toLowerCase();
      if (atName && nameToId.has(atName)) {
        maps.staff.set(rec.id, nameToId.get(atName));
      }
    }
  } catch (err) {
    console.warn(`  WARNING: Could not build staff map: ${err.message}`);
  }
  console.log(`  staff: ${maps.staff.size} mappings`);

  // People: from staged_records + sot.people.source_record_id
  const peopleResult = await client.query(
    `SELECT person_id, source_record_id FROM sot.people
     WHERE source_system = 'airtable' AND source_record_id IS NOT NULL`
  );
  maps.people = new Map(peopleResult.rows.map(r => [r.source_record_id, r.person_id]));
  console.log(`  people: ${maps.people.size} mappings`);

  // Places: sot.places has no source_record_id — rely on staged_records fallback below
  maps.places = new Map();
  console.log(`  places: 0 mappings (will populate from staged_records)`);

  // Cats: Airtable record ID → Atlas cat_id
  maps.cats = await buildRecordIdMap(client, 'sot.cats', 'cat_id');
  console.log(`  cats: ${maps.cats.size} mappings`);

  // Also build from staged_records for client/location cross-references
  const stagedResult = await client.query(
    `SELECT source_table, source_row_id, payload->>'atlas_person_id' AS person_id,
            payload->>'atlas_place_id' AS place_id
     FROM ops.staged_records
     WHERE source_system = 'airtable' AND is_processed = TRUE`
  );
  for (const row of stagedResult.rows) {
    if (row.person_id && !maps.people.has(row.source_row_id)) {
      maps.people.set(row.source_row_id, row.person_id);
    }
    if (row.place_id && !maps.places.has(row.source_row_id)) {
      maps.places.set(row.source_row_id, row.place_id);
    }
  }
  console.log(`  people (after staged): ${maps.people.size} mappings`);
  console.log(`  places (after staged): ${maps.places.size} mappings`);

  return maps;
}

// ============================================================
// PHASE A: People Enrichment
// ============================================================

/**
 * FFS-193: Import Do Not Contact flags from Clients table
 */
async function importDNCFlags(client, records, maps, options) {
  const label = 'FFS-193: DNC Flags';
  console.log(`\n  ${label}`);
  const stats = { imported: 0, skipped: 0, errors: 0 };

  for (const rec of records) {
    const f = rec.fields;
    await stageRecord(client, 'airtable', 'clients_dnc', rec.id, f);

    // Look for DNC indicator fields
    const isDNC = f['Do Not Contact'] === true || f['Do Not Contact'] === 'true'
      || f['DNC'] === true || f['DNC'] === 'true';

    if (!isDNC) { stats.skipped++; continue; }

    // Resolve person via linked record or email
    let personId = resolveLinked(f['Person'] || f['Linked Person'], maps.people);
    if (!personId) personId = maps.people.get(rec.id);

    if (!personId && f['Email']) {
      const emailResult = await client.query(
        `SELECT person_id FROM sot.person_identifiers
         WHERE id_type = 'email' AND id_value_norm = $1 AND confidence >= 0.5
         LIMIT 1`,
        [f['Email'].toLowerCase().trim()]
      );
      if (emailResult.rows.length > 0) personId = emailResult.rows[0].person_id;
    }

    if (!personId) { stats.skipped++; continue; }
    if (options.dryRun) { stats.skipped++; continue; }

    try {
      await client.query(
        `UPDATE sot.people SET do_not_contact = TRUE, do_not_contact_reason = $2
         WHERE person_id = $1 AND (do_not_contact IS NULL OR do_not_contact = FALSE)`,
        [personId, f['DNC Reason'] || f['Do Not Contact Reason'] || 'Imported from Airtable']
      );
      stats.imported++;
    } catch (err) {
      console.error(`    Error updating DNC for ${personId}: ${err.message}`);
      stats.errors++;
    }
  }

  console.log(`    ${JSON.stringify(stats)}`);
  return stats;
}

/**
 * FFS-201: Import contact aliases from Master Contacts table
 */
async function importContactAliases(client, records, maps, options) {
  const label = 'FFS-201: Contact Aliases';
  console.log(`\n  ${label}`);
  const stats = { imported: 0, skipped: 0, errors: 0 };

  for (const rec of records) {
    const f = rec.fields;
    await stageRecord(client, 'airtable', 'master_contacts', rec.id, f);

    // Look for alias/alternate name fields
    const aliases = [];
    if (f['Also Known As']) aliases.push(...String(f['Also Known As']).split(',').map(s => s.trim()).filter(Boolean));
    if (f['Alternate Name']) aliases.push(String(f['Alternate Name']).trim());
    if (f['Alias']) aliases.push(...String(f['Alias']).split(',').map(s => s.trim()).filter(Boolean));

    if (aliases.length === 0) { stats.skipped++; continue; }

    // Resolve person
    let personId = resolveLinked(f['Person'] || f['Linked Person'], maps.people);
    if (!personId) personId = maps.people.get(rec.id);

    if (!personId && f['Email']) {
      const result = await client.query(
        `SELECT person_id FROM sot.person_identifiers
         WHERE id_type = 'email' AND id_value_norm = $1 AND confidence >= 0.5 LIMIT 1`,
        [f['Email'].toLowerCase().trim()]
      );
      if (result.rows.length > 0) personId = result.rows[0].person_id;
    }

    if (!personId) { stats.skipped++; continue; }
    if (options.dryRun) { stats.skipped++; continue; }

    try {
      await client.query(
        `UPDATE sot.people SET aliases = (SELECT ARRAY(SELECT DISTINCT unnest(COALESCE(aliases,'{}') || $2::text[])))
         WHERE person_id = $1`,
        [personId, aliases]
      );
      stats.imported++;
    } catch (err) {
      console.error(`    Error updating aliases for ${personId}: ${err.message}`);
      stats.errors++;
    }
  }

  console.log(`    ${JSON.stringify(stats)}`);
  return stats;
}

/**
 * FFS-192: Trapper profile enrichment (skills, cert dates, notes)
 */
async function importTrapperEnrichment(client, records, maps, options) {
  const label = 'FFS-192: Trapper Enrichment';
  console.log(`\n  ${label}`);
  const stats = { imported: 0, skipped: 0, errors: 0 };

  for (const rec of records) {
    const f = rec.fields;
    // These records should already be staged by airtable_trappers_sync.mjs
    // We just enrich trapper_profiles with additional fields

    const personId = maps.trappers.get(rec.id);
    if (!personId) { stats.skipped++; continue; }

    const certDate = parseDate(f['Certification Date'] || f['Approved Date']);
    const notes = f['Notes'] || f['Admin Notes'] || null;
    const rescueName = f['Rescue Name'] || f['Organization'] || null;

    if (!certDate && !notes && !rescueName) { stats.skipped++; continue; }
    if (options.dryRun) { stats.skipped++; continue; }

    try {
      await client.query(
        `INSERT INTO sot.trapper_profiles (person_id, certified_date, notes, rescue_name, source_system)
         VALUES ($1, $2, $3, $4, 'airtable')
         ON CONFLICT (person_id) DO UPDATE SET
           certified_date = COALESCE(sot.trapper_profiles.certified_date, EXCLUDED.certified_date),
           notes = CASE WHEN EXCLUDED.notes IS NOT NULL AND sot.trapper_profiles.notes NOT ILIKE '%' || EXCLUDED.notes || '%'
             THEN COALESCE(sot.trapper_profiles.notes, '') || E'\n' || EXCLUDED.notes
             ELSE sot.trapper_profiles.notes END,
           rescue_name = COALESCE(sot.trapper_profiles.rescue_name, EXCLUDED.rescue_name)`,
        [personId, certDate, notes, rescueName]
      );
      stats.imported++;
    } catch (err) {
      console.error(`    Error enriching trapper ${personId}: ${err.message}`);
      stats.errors++;
    }
  }

  console.log(`    ${JSON.stringify(stats)}`);
  return stats;
}

/**
 * FFS-205a: Equipment inventory import
 */
async function importEquipment(client, records, maps, options) {
  const label = 'FFS-205a: Equipment';
  console.log(`\n  ${label}`);
  const stats = { imported: 0, skipped: 0, errors: 0 };

  for (const rec of records) {
    const f = rec.fields;
    await stageRecord(client, 'airtable', 'equipment', rec.id, f);

    const equipmentType = f['Type'] || f['Equipment Type'] || f['Name'] || 'unknown';
    const equipmentName = f['Name'] || f['Equipment Name'] || null;
    const serialNumber = f['Serial Number'] || f['Serial #'] || null;
    const condition = f['Condition'] || f['Status'] || null;
    const notes = f['Notes'] || null;
    const isAvailable = f['Available'] !== false && f['Checked Out'] !== true;

    if (options.dryRun) { stats.skipped++; continue; }

    try {
      await client.query(
        `INSERT INTO ops.equipment (equipment_type, equipment_name, serial_number, condition, notes, is_available, source_system, source_record_id)
         VALUES ($1, $2, $3, $4, $5, $6, 'airtable', $7)
         ON CONFLICT (source_system, source_record_id) DO NOTHING`,
        [equipmentType, equipmentName, serialNumber, condition, notes, isAvailable, rec.id]
      );
      stats.imported++;
    } catch (err) {
      console.error(`    Error importing equipment ${rec.id}: ${err.message}`);
      stats.errors++;
    }
  }

  console.log(`    ${JSON.stringify(stats)}`);
  return stats;
}

// ============================================================
// PHASE B: Request Enrichment
// ============================================================

/**
 * FFS-186: Import trapper-to-request assignments from Airtable linked records
 */
async function importTrapperAssignments(client, records, maps, options) {
  const label = 'FFS-186: Trapper Assignments';
  console.log(`\n  ${label}`);
  const stats = { imported: 0, skipped: 0, errors: 0 };

  for (const rec of records) {
    const f = rec.fields;
    const trapperLinked = f['Trappers Assigned'];
    if (!trapperLinked) { stats.skipped++; continue; }

    const requestId = maps.requests.get(rec.id);
    if (!requestId) { stats.skipped++; continue; }

    const trapperIds = resolveLinkedAll(trapperLinked, maps.trappers);
    if (trapperIds.length === 0) { stats.skipped++; continue; }
    if (options.dryRun) {
      if (options.verbose) console.log(`    [dry-run] ${rec.id} → ${trapperIds.length} trapper(s)`);
      stats.imported += trapperIds.length;
      continue;
    }

    for (const trapperId of trapperIds) {
      try {
        await client.query(
          `INSERT INTO ops.request_trapper_assignments
             (request_id, trapper_person_id, assignment_type, status, assigned_by, source_system)
           VALUES ($1, $2, 'primary', 'active', 'airtable_salvage', 'airtable')
           ON CONFLICT (request_id, trapper_person_id) DO NOTHING`,
          [requestId, trapperId]
        );
        stats.imported++;
      } catch (err) {
        console.error(`    Error assigning trapper ${trapperId} to request ${requestId}: ${err.message}`);
        stats.errors++;
      }
    }
  }

  console.log(`    ${JSON.stringify(stats)}`);
  return stats;
}

/**
 * FFS-187: Staff assignments on requests
 *
 * Two outputs:
 *   1. received_by (TEXT) on ops.requests — provenance: "who at FFSC handled this"
 *   2. ops.request_trapper_assignments — operational link for staff-coordinators
 *      (staff with trapper_type='coordinator' use the same assignment table as trappers)
 *
 * IMPORTANT: Do NOT call find_or_create_person() with FFSC emails —
 * they are soft-blacklisted (MIG_2009) and should_be_person() rejects them.
 * Staff members already exist in sot.people via VolunteerHub or atlas_ui.
 * We only use pre-resolved person_ids from maps.staff.
 */
async function importStaffAssignments(client, records, maps, options) {
  const label = 'FFS-187: Staff Assignments';
  console.log(`\n  ${label}`);
  const stats = { imported: 0, received_by: 0, assignments: 0, skipped: 0, errors: 0 };

  for (const rec of records) {
    const f = rec.fields;
    const staffLinked = f['Staff Assigned'];
    if (!staffLinked) { stats.skipped++; continue; }

    const requestId = maps.requests.get(rec.id);
    if (!requestId) { stats.skipped++; continue; }

    // Resolve ALL linked staff (a request may have multiple staff assigned)
    const staffPersonIds = resolveLinkedAll(staffLinked, maps.staff);

    // For received_by: use first resolved staff member's display name
    let staffDisplayName = null;
    if (staffPersonIds.length > 0) {
      const nameResult = await client.query(
        `SELECT display_name FROM sot.people WHERE person_id = $1 LIMIT 1`,
        [staffPersonIds[0]]
      );
      staffDisplayName = nameResult.rows[0]?.display_name;
    }

    if (!staffDisplayName && staffPersonIds.length === 0) { stats.skipped++; continue; }
    if (options.dryRun) {
      if (options.verbose) console.log(`    [dry-run] ${rec.id} → ${staffPersonIds.length} staff, name=${staffDisplayName}`);
      stats.received_by += staffDisplayName ? 1 : 0;
      stats.assignments += staffPersonIds.length;
      continue;
    }

    try {
      // 1. Set received_by (provenance text field)
      if (staffDisplayName) {
        await client.query(
          `UPDATE ops.requests SET received_by = $2 WHERE request_id = $1 AND received_by IS NULL`,
          [requestId, staffDisplayName]
        );
        stats.received_by++;
        stats.imported++;
      }

      // 2. Insert operational assignment for each staff-coordinator
      //    Uses same table as trappers — staff coordinators have trapper_type='coordinator'
      for (const personId of staffPersonIds) {
        await client.query(
          `INSERT INTO ops.request_trapper_assignments
             (request_id, trapper_person_id, assignment_type, status, assigned_by, source_system)
           VALUES ($1, $2, 'primary', 'active', 'airtable_salvage', 'airtable')
           ON CONFLICT (request_id, trapper_person_id) DO NOTHING`,
          [requestId, personId]
        );
        stats.assignments++;
        stats.imported++;
      }
    } catch (err) {
      console.error(`    Error assigning staff to request ${requestId}: ${err.message}`);
      stats.errors++;
    }
  }

  console.log(`    ${JSON.stringify(stats)}`);
  return stats;
}

/**
 * Map free-text feeding frequency to valid enum values.
 * Returns null if no match (caller should preserve raw text in internal_notes).
 */
function mapFeedingFrequency(raw) {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower.includes('daily') || lower.includes('every day')) return 'daily';
  if (lower.includes('few times') || lower.includes('several')) return 'few_times_week';
  if (lower.includes('occasional') || lower.includes('sometimes') || lower.includes('weekly')) return 'occasionally';
  if (lower.includes('rare') || lower.includes('seldom')) return 'rarely';
  return null;
}

/**
 * FFS-191: Request operational fields backfill
 */
async function importRequestOperationalFields(client, records, maps, options) {
  const label = 'FFS-191: Request Operational Fields';
  console.log(`\n  ${label}`);
  const stats = { imported: 0, skipped: 0, errors: 0 };

  for (const rec of records) {
    const f = rec.fields;
    const requestId = maps.requests.get(rec.id);
    if (!requestId) { stats.skipped++; continue; }

    // Collect operational fields that may not have been imported
    // Field names from Airtable (note trailing spaces on some)
    const updates = {};
    const beingFed = f['Being Fed?'] ?? f['Is Being Fed'];
    if (beingFed !== undefined) updates.is_being_fed = beingFed === true || beingFed === 'Yes';
    const feedingRaw = f['Who Feeds and when? '] || f['Feeding Schedule'];
    if (feedingRaw) {
      const mapped = mapFeedingFrequency(feedingRaw);
      if (mapped) updates.feeding_frequency = mapped;
      else {
        // Preserve unmappable free text in internal_notes
        updates.internal_notes = (updates.internal_notes || '') + '[Feeding info] ' + feedingRaw;
      }
    }
    if (f['Access Notes'] || f['Access Instructions']) updates.access_notes = f['Access Notes'] || f['Access Instructions'];
    if (f['Internal Notes '] || f['Internal Notes'] || f['Admin Notes']) updates.internal_notes = f['Internal Notes '] || f['Internal Notes'] || f['Admin Notes'];
    if (f['Hold Reason']) updates.hold_reason = f['Hold Reason'];
    if (f['Resolution'] || f['Resolution Notes']) updates.resolution = f['Resolution'] || f['Resolution Notes'];
    if (f['Feeding Location']) updates.feeding_location = f['Feeding Location'];
    if (f['Feeding Time']) updates.feeding_time = f['Feeding Time'];
    if (f['Awareness Duration'] || f['How Long Aware']) updates.awareness_duration = f['Awareness Duration'] || f['How Long Aware'];
    if (f['Can Bring In'] || f['Can Bring Cats']) updates.can_bring_in = f['Can Bring In'] || f['Can Bring Cats'];
    if (f['Mom Fixed'] || f['Mom Spayed']) updates.mom_fixed = f['Mom Fixed'] || f['Mom Spayed'];
    if (f['Kitten Contained']) updates.kitten_contained = f['Kitten Contained'];

    const keys = Object.keys(updates);
    if (keys.length === 0) { stats.skipped++; continue; }
    if (options.dryRun) { stats.skipped++; continue; }

    try {
      // Build dynamic UPDATE — only set fields that are currently NULL
      const setClauses = keys.map((k, i) => `${k} = COALESCE(${k}, $${i + 2})`);
      const values = keys.map(k => updates[k]);
      await client.query(
        `UPDATE ops.requests SET ${setClauses.join(', ')} WHERE request_id = $1`,
        [requestId, ...values]
      );
      stats.imported++;
    } catch (err) {
      console.error(`    Error updating request ${requestId}: ${err.message}`);
      stats.errors++;
    }
  }

  console.log(`    ${JSON.stringify(stats)}`);
  return stats;
}

/**
 * FFS-199: Appointment request additional fields
 */
async function importAppointmentRequestFields(client, records, maps, options) {
  const label = 'FFS-199: Appointment Request Fields';
  console.log(`\n  ${label}`);
  const stats = { imported: 0, skipped: 0, errors: 0 };

  for (const rec of records) {
    const f = rec.fields;
    const requestId = maps.requests.get(rec.id);
    if (!requestId) { stats.skipped++; continue; }

    // Appointment-specific fields that may not have been imported
    const notes = f['Notes'] || f['Additional Notes'] || null;
    const internalNotes = f['Internal Notes'] || f['Staff Notes'] || null;

    if (!notes && !internalNotes) { stats.skipped++; continue; }
    if (options.dryRun) { stats.skipped++; continue; }

    try {
      await client.query(
        `UPDATE ops.requests SET
           notes = COALESCE(notes, $2),
           internal_notes = COALESCE(internal_notes, $3)
         WHERE request_id = $1`,
        [requestId, notes, internalNotes]
      );
      stats.imported++;
    } catch (err) {
      console.error(`    Error updating appt request ${requestId}: ${err.message}`);
      stats.errors++;
    }
  }

  console.log(`    ${JSON.stringify(stats)}`);
  return stats;
}

// ============================================================
// PHASE C: Trapper Operations
// ============================================================

/**
 * FFS-188: Trapper Cases
 */
async function importTrapperCases(client, records, maps, options) {
  const label = 'FFS-188: Trapper Cases';
  console.log(`\n  ${label}`);
  const stats = { imported: 0, skipped: 0, errors: 0 };

  for (const rec of records) {
    const f = rec.fields;
    await stageRecord(client, 'airtable', 'trapper_cases', rec.id, f);

    const requestId = resolveLinked(f['Request'] || f['Trapping Request'], maps.requests);
    const trapperId = resolveLinked(f['Trapper'] || f['Assigned Trapper'], maps.trappers);
    const caseStatus = f['Status'] || f['Case Status'] || null;
    const startedAt = parseDate(f['Start Date'] || f['Started']);
    const completedAt = parseDate(f['End Date'] || f['Completed'] || f['Completed Date']);
    const totalTrapped = parsePositiveInt(f['Cats Trapped'] || f['Total Trapped']);
    const totalReturned = parsePositiveInt(f['Cats Returned'] || f['Total Returned']);
    const notes = f['Notes'] || f['Case Notes'] || null;

    if (options.dryRun) { stats.skipped++; continue; }

    try {
      await client.query(
        `INSERT INTO ops.trapper_cases
           (request_id, trapper_person_id, case_status, started_at, completed_at,
            total_cats_trapped, total_cats_returned, notes, airtable_fields,
            source_system, source_record_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, 'airtable', $10)
         ON CONFLICT (source_system, source_record_id) DO NOTHING`,
        [requestId, trapperId, caseStatus, startedAt, completedAt,
         totalTrapped ?? 0, totalReturned ?? 0, notes,
         JSON.stringify(f), rec.id]
      );
      stats.imported++;
    } catch (err) {
      console.error(`    Error importing case ${rec.id}: ${err.message}`);
      stats.errors++;
    }
  }

  // Store case mapping for FFS-190
  const caseMap = await buildRecordIdMap(client, 'ops.trapper_cases', 'case_id');
  maps.cases = caseMap;

  console.log(`    ${JSON.stringify(stats)}`);
  return stats;
}

/**
 * FFS-189: Trapper Reports (trip reports)
 */
async function importTrapperReports(client, records, maps, options) {
  const label = 'FFS-189: Trapper Reports';
  console.log(`\n  ${label}`);
  const stats = { imported: 0, skipped: 0, errors: 0 };

  for (const rec of records) {
    const f = rec.fields;
    await stageRecord(client, 'airtable', 'trapper_reports', rec.id, f);

    const requestId = resolveLinked(f['Request'] || f['Trapping Request'] || f['Trapping Requests'], maps.requests);
    if (!requestId) { stats.skipped++; continue; }

    const trapperId = resolveLinked(f['Trapper'], maps.trappers);
    const visitDate = parseDate(f['Date'] || f['Visit Date'] || f['Report Date'] || f['Date of Occurence'] || f['Submitted Date/Time']);
    if (!visitDate) { stats.skipped++; continue; }

    const catsTrapped = parsePositiveInt(f['Cats Trapped'] || f['# Trapped']);
    const catsReturned = parsePositiveInt(f['Cats Returned'] || f['# Returned']);
    const catsSeen = parsePositiveInt(f['Cats Seen'] || f['# Seen']);
    const trapsSet = parsePositiveInt(f['Traps Set'] || f['# Traps Set']);
    const siteNotes = f['Notes'] || f['Site Notes'] || f['Report Notes'] || f['Report Details'] || null;
    const reportedByName = f['Reported By'] || f['Reporter Name'] || f['Name'] || null;

    if (options.dryRun) { stats.skipped++; continue; }

    try {
      const result = await client.query(
        `INSERT INTO ops.trapper_trip_reports
           (request_id, trapper_person_id, reported_by_name, visit_date,
            cats_trapped, cats_returned, cats_seen, traps_set,
            site_notes, submitted_from, source_system, source_record_id)
         SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, 'airtable_salvage', 'airtable', $10
         WHERE NOT EXISTS (
           SELECT 1 FROM ops.trapper_trip_reports
           WHERE source_system = 'airtable' AND source_record_id = $10
         )`,
        [requestId, trapperId, reportedByName, visitDate,
         catsTrapped ?? 0, catsReturned ?? 0, catsSeen, trapsSet,
         siteNotes, rec.id]
      );
      if (result.rowCount > 0) stats.imported++;
      else stats.skipped++;
    } catch (err) {
      console.error(`    Error importing report ${rec.id}: ${err.message}`);
      stats.errors++;
    }
  }

  console.log(`    ${JSON.stringify(stats)}`);
  return stats;
}

/**
 * FFS-190: Trapper Case Cats
 */
async function importTrapperCaseCats(client, records, maps, options) {
  const label = 'FFS-190: Trapper Case Cats';
  console.log(`\n  ${label}`);
  const stats = { imported: 0, skipped: 0, errors: 0 };

  // Ensure case mapping exists
  if (!maps.cases) {
    maps.cases = await buildRecordIdMap(client, 'ops.trapper_cases', 'case_id');
  }

  for (const rec of records) {
    const f = rec.fields;
    await stageRecord(client, 'airtable', 'trapper_case_cats', rec.id, f);

    const caseId = resolveLinked(f['Case'] || f['Trapper Case'] || f['Trapper Case Linked to Request'], maps.cases);
    if (!caseId) { stats.skipped++; continue; }

    const catId = resolveLinked(f['Cat'] || f['Master Cat'], maps.cats);
    const catName = f['Cat Name'] || f['Name'] || null;
    const outcome = f['Outcome'] || f['Status'] || null;
    const trapDate = parseDate(f['Trap Date'] || f['Date Trapped'] || f['Submitted Date/Time']);
    const notes = f['Notes'] || null;

    if (options.dryRun) { stats.skipped++; continue; }

    try {
      await client.query(
        `INSERT INTO ops.trapper_case_cats
           (case_id, cat_id, cat_name, outcome, trap_date, notes,
            airtable_fields, source_system, source_record_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'airtable', $8)
         ON CONFLICT (source_system, source_record_id) DO NOTHING`,
        [caseId, catId, catName, outcome, trapDate, notes,
         JSON.stringify(f), rec.id]
      );
      stats.imported++;
    } catch (err) {
      console.error(`    Error importing case cat ${rec.id}: ${err.message}`);
      stats.errors++;
    }
  }

  console.log(`    ${JSON.stringify(stats)}`);
  return stats;
}

/**
 * FFS-205b: Equipment Checkouts
 */
async function importEquipmentCheckouts(client, records, maps, options) {
  const label = 'FFS-205b: Equipment Checkouts';
  console.log(`\n  ${label}`);
  const stats = { imported: 0, skipped: 0, errors: 0 };

  // Build equipment map from ops.equipment (Airtable record ID → equipment_id)
  const equipmentMap = await buildRecordIdMap(client, 'ops.equipment', 'equipment_id');

  // Build a name→person_id map for matching checkout names to trappers
  const trapperNameResult = await client.query(
    `SELECT p.person_id, LOWER(TRIM(p.display_name)) AS display_name
     FROM sot.people p
     JOIN sot.person_roles pr ON pr.person_id = p.person_id
     WHERE pr.role IN ('trapper', 'community_trapper')`
  );
  const nameToTrapper = new Map(trapperNameResult.rows.map(r => [r.display_name, r.person_id]));

  for (const rec of records) {
    const f = rec.fields;

    // Check-Out Log Table: Equipment is linked, Name is text, Action is Check-Out/Check-In
    const equipmentIds = resolveLinkedAll(f['Equipment'] || f['Unified Links'], equipmentMap);
    if (equipmentIds.length === 0) { stats.skipped++; continue; }

    // Resolve person by name (text field, not linked record)
    const personName = (f['Name'] || '').trim().toLowerCase();
    const personId = personName ? (nameToTrapper.get(personName) || null) : null;

    const timestamp = parseDate(f['Timestamp']);
    const action = (f['Action'] || '').toLowerCase();
    const checkedOutAt = action.includes('check-out') || action.includes('checkout') ? timestamp : null;
    const returnedAt = action.includes('check-in') || action.includes('checkin') || action.includes('return') ? timestamp : null;
    const notes = [f['Action'], f['Notes']].filter(Boolean).join(' — ') || null;

    if (options.dryRun) { stats.skipped++; continue; }

    // Create one checkout record per equipment item in this log entry
    for (const equipmentId of equipmentIds) {
      try {
        await client.query(
          `INSERT INTO ops.equipment_checkouts
             (equipment_id, person_id, checked_out_at, returned_at, notes,
              source_system, source_record_id)
           VALUES ($1, $2, $3, $4, $5, 'airtable', $6)
           ON CONFLICT (source_system, source_record_id) DO NOTHING`,
          [equipmentId, personId, checkedOutAt, returnedAt, notes,
           `${rec.id}_${equipmentId}`]
        );
        stats.imported++;
      } catch (err) {
        console.error(`    Error importing checkout ${rec.id}: ${err.message}`);
        stats.errors++;
      }
    }
  }

  console.log(`    ${JSON.stringify(stats)}`);
  return stats;
}

// ============================================================
// PHASE D: Place Enrichment
// ============================================================

/**
 * FFS-194: Common Trapping Locations → trapper_service_places
 */
async function importCommonTrappingLocations(client, records, maps, options) {
  const label = 'FFS-194: Common Trapping Locations';
  console.log(`\n  ${label}`);
  const stats = { imported: 0, skipped: 0, errors: 0 };

  for (const rec of records) {
    const f = rec.fields;
    await stageRecord(client, 'airtable', 'common_trapping_locs', rec.id, f);

    // Try multiple trapper field names
    const trapperIds = resolveLinkedAll(
      f['Trapper'] || f['Assigned Trapper'] || f['Usual Trappers here'],
      maps.trappers
    );
    // If no trapper found, we can still create the place — just skip the service_places link
    const address = f['Address'] || f['Secondary Address'] || null;
    if (!address && trapperIds.length === 0) { stats.skipped++; continue; }

    // Resolve or create place from address
    let placeId = resolveLinked(f['Location'] || f['Place'], maps.places);
    if (!placeId && address) {
      if (options.dryRun) { stats.skipped++; continue; }
      const placeResult = await client.query(
        `SELECT sot.find_or_create_place_deduped($1, $2, NULL, NULL, 'airtable') AS place_id`,
        [address, f['Name of Location'] || f['Location Name'] || f['Name'] || null]
      );
      placeId = placeResult.rows[0]?.place_id;
    }

    if (!placeId) { stats.skipped++; continue; }
    if (trapperIds.length === 0) {
      if (options.verbose) console.log(`    No trapper match for location: ${f['Name of Location'] || rec.id}`);
      stats.skipped++;
      continue;
    }
    if (options.dryRun) { stats.skipped++; continue; }

    const rawType = (f['Type'] || f['Type '] || '').toLowerCase();
    const serviceType = rawType === 'primary' ? 'primary_territory'
      : rawType === 'occasional' ? 'occasional' : 'regular';

    for (const trapperId of trapperIds) {
      try {
        await client.query(
          `INSERT INTO sot.trapper_service_places
             (person_id, place_id, service_type, notes, source_system, evidence_type)
           VALUES ($1, $2, $3, $4, 'airtable', 'imported')
           ON CONFLICT (person_id, place_id) DO NOTHING`,
          [trapperId, placeId, serviceType, f['Notes'] || null]
        );
        stats.imported++;
      } catch (err) {
        console.error(`    Error importing trapping location ${rec.id}: ${err.message}`);
        stats.errors++;
      }
    }
  }

  console.log(`    ${JSON.stringify(stats)}`);
  return stats;
}

/**
 * FFS-195: Place Contacts → person_place relationships
 */
async function importPlaceContacts(client, records, maps, options) {
  const label = 'FFS-195: Place Contacts';
  console.log(`\n  ${label}`);
  const stats = { imported: 0, skipped: 0, errors: 0 };

  // Build inline resolution maps from Airtable Clients and Places tables
  // since the main resolution maps don't cover these tables
  const clientMap = new Map(); // Airtable client record ID → Atlas person_id
  const placeMap = new Map();  // Airtable place record ID → Atlas place_id

  try {
    // Fetch Clients table and resolve by email/phone
    const atClients = await fetchAllRecords(TABLE_IDS.clients, { quiet: true });
    for (const c of atClients) {
      const email = c.fields['Email'] ? c.fields['Email'].toLowerCase().trim() : null;
      const phone = c.fields['Phone'] || c.fields['Clean Phone'] || null;
      if (!email && !phone) continue;

      // Try email first, then phone
      let personId = null;
      if (email) {
        const r = await client.query(
          `SELECT person_id FROM sot.person_identifiers
           WHERE id_type = 'email' AND id_value_norm = $1 AND confidence >= 0.5 LIMIT 1`,
          [email]
        );
        if (r.rows.length > 0) personId = r.rows[0].person_id;
      }
      if (!personId && phone) {
        const normPhone = phone.replace(/\D/g, '').replace(/^1/, '');
        if (normPhone.length === 10) {
          const r = await client.query(
            `SELECT person_id FROM sot.person_identifiers
             WHERE id_type = 'phone' AND id_value_norm = $1 AND confidence >= 0.5 LIMIT 1`,
            [normPhone]
          );
          if (r.rows.length > 0) personId = r.rows[0].person_id;
        }
      }
      // If not found, create via find_or_create_person
      if (!personId && !options.dryRun) {
        const firstName = c.fields['First Name'] || c.fields['Full Name']?.split(' ')[0] || null;
        const lastName = c.fields['Last Name'] || c.fields['Full Name']?.split(' ').slice(1).join(' ') || null;
        const validation = validatePersonCreation(email, phone, firstName, lastName);
        if (validation.valid) {
          const r = await client.query(
            `SELECT sot.find_or_create_person($1, $2, $3, $4, NULL, 'airtable') AS person_id`,
            [email, phone?.replace(/\D/g, '').replace(/^1/, '') || null, firstName, lastName]
          );
          personId = r.rows[0]?.person_id;
        }
      }
      if (personId) clientMap.set(c.id, personId);
    }
    console.log(`    Resolved ${clientMap.size}/${atClients.length} clients → people`);

    // Fetch Places table and resolve by address
    const atPlaces = await fetchAllRecords('tblY1aZratwMVjn5d', { quiet: true });
    for (const p of atPlaces) {
      const addr = p.fields['Address (Full)'] || null;
      const name = p.fields['Place Name'] || p.fields['LMT Place Name'] || null;
      if (!addr) continue;
      if (options.dryRun) continue;

      const r = await client.query(
        `SELECT sot.find_or_create_place_deduped($1, $2, NULL, NULL, 'airtable') AS place_id`,
        [addr, name]
      );
      if (r.rows[0]?.place_id) placeMap.set(p.id, r.rows[0].place_id);
    }
    console.log(`    Resolved ${placeMap.size}/${atPlaces.length} places`);
  } catch (err) {
    console.error(`    Error building Place Contacts maps: ${err.message}`);
  }

  for (const rec of records) {
    const f = rec.fields;
    await stageRecord(client, 'airtable', 'place_contacts', rec.id, f);

    let personId = resolveLinked(f['Contact'] || f['Person'], clientMap)
      || resolveLinked(f['Contact'] || f['Person'], maps.people);
    let placeId = resolveLinked(f['Place'] || f['Location'], placeMap)
      || resolveLinked(f['Place'] || f['Location'], maps.places);

    // Fallback: try to create person if we have contact info
    if (!personId && (f['Email'] || f['Phone'])) {
      const email = f['Email'] ? f['Email'].toLowerCase().trim() : null;
      const phone = f['Phone'] || f['Phone Number'] || null;
      const firstName = f['First Name'] || f['Contact Name']?.split(' ')[0] || null;
      const lastName = f['Last Name'] || f['Contact Name']?.split(' ').slice(1).join(' ') || null;

      const validation = validatePersonCreation(email, phone, firstName, lastName);
      if (validation.valid && !options.dryRun) {
        const personResult = await client.query(
          `SELECT sot.find_or_create_person($1, $2, $3, $4, NULL, 'airtable') AS person_id`,
          [email, phone, firstName, lastName]
        );
        personId = personResult.rows[0]?.person_id;
      }
    }

    if (!personId || !placeId) { stats.skipped++; continue; }
    if (options.dryRun) { stats.skipped++; continue; }

    try {
      // Map to valid relationship_type values
      const rawRel = (f['Relationship'] || f['Role'] || '').toLowerCase();
      const relType = rawRel.includes('caretaker') ? 'colony_caretaker'
        : rawRel.includes('owner') ? 'property_owner'
        : rawRel.includes('resident') ? 'resident'
        : rawRel.includes('neighbor') ? 'neighbor'
        : rawRel.includes('feeder') ? 'feeder'
        : 'contact_address';
      await client.query(
        `INSERT INTO sot.person_place (person_id, place_id, relationship_type, source_system, evidence_type)
         VALUES ($1, $2, $3, 'airtable', 'imported')
         ON CONFLICT (person_id, place_id, relationship_type) DO NOTHING`,
        [personId, placeId, relType]
      );
      stats.imported++;
    } catch (err) {
      console.error(`    Error importing place contact ${rec.id}: ${err.message}`);
      stats.errors++;
    }
  }

  console.log(`    ${JSON.stringify(stats)}`);
  return stats;
}

// ============================================================
// PHASE E: Standalone Tables
// ============================================================

/**
 * FFS-196 + FFS-202: Calendar + Events → org_events
 */
async function importOrgEvents(client, records, maps, options) {
  const label = 'FFS-196/202: Org Events';
  console.log(`\n  ${label}`);
  const stats = { imported: 0, skipped: 0, errors: 0 };

  for (const rec of records) {
    const f = rec.fields;
    await stageRecord(client, 'airtable', 'org_events', rec.id, f);

    const eventName = f['Name'] || f['Event Name'] || f['Title'] || f['Summary'];
    if (!eventName) { stats.skipped++; continue; }

    const eventType = f['Type'] || f['Event Type'] || f['Category'] || null;
    const eventDate = parseDate(f['Date'] || f['Start Date'] || f['Event Date']);
    const endDate = parseDate(f['End Date']);
    const location = f['Location'] || f['Venue'] || f['Where'] || null;
    const description = f['Description'] || f['Details'] || f['Notes'] || null;
    const isCancelled = f['Cancelled'] === true || f['Status'] === 'Cancelled';

    if (options.dryRun) { stats.skipped++; continue; }

    try {
      await client.query(
        `INSERT INTO ops.org_events
           (event_name, event_type, event_date, end_date, location, description,
            is_cancelled, airtable_fields, source_system, source_record_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'airtable', $9)
         ON CONFLICT (source_system, source_record_id) DO NOTHING`,
        [eventName, eventType, eventDate, endDate, location, description,
         isCancelled, JSON.stringify(f), rec.id]
      );
      stats.imported++;
    } catch (err) {
      console.error(`    Error importing event ${rec.id}: ${err.message}`);
      stats.errors++;
    }
  }

  console.log(`    ${JSON.stringify(stats)}`);
  return stats;
}

/**
 * FFS-197: Call Sheets → call_logs
 */
async function importCallLogs(client, records, maps, options) {
  const label = 'FFS-197: Call Logs';
  console.log(`\n  ${label}`);
  const stats = { imported: 0, skipped: 0, errors: 0 };

  for (const rec of records) {
    const f = rec.fields;
    await stageRecord(client, 'airtable', 'call_logs', rec.id, f);

    const requestId = resolveLinked(f['Request'] || f['Trapping Request'], maps.requests);
    const callDate = parseDate(f['Date'] || f['Call Date']);
    const callType = f['Type'] || f['Call Type'] || null;
    const notes = f['Notes'] || f['Call Notes'] || f['Summary'] || null;
    const outcome = f['Outcome'] || f['Result'] || null;

    // Resolve caller/staff
    const callerPersonId = resolveLinked(f['Caller'] || f['Client'] || f['Contact'], maps.people);
    const staffPersonId = resolveLinked(f['Staff'] || f['Staff Member'], maps.staff);

    if (options.dryRun) { stats.skipped++; continue; }

    try {
      await client.query(
        `INSERT INTO ops.call_logs
           (request_id, caller_person_id, staff_person_id, call_date,
            call_type, notes, outcome, airtable_fields, source_system, source_record_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'airtable', $9)
         ON CONFLICT (source_system, source_record_id) DO NOTHING`,
        [requestId, callerPersonId, staffPersonId, callDate,
         callType, notes, outcome, JSON.stringify(f), rec.id]
      );
      stats.imported++;
    } catch (err) {
      console.error(`    Error importing call log ${rec.id}: ${err.message}`);
      stats.errors++;
    }
  }

  console.log(`    ${JSON.stringify(stats)}`);
  return stats;
}

/**
 * FFS-198: Kitten Assessments
 */
async function importKittenAssessments(client, records, maps, options) {
  const label = 'FFS-198: Kitten Assessments';
  console.log(`\n  ${label}`);
  const stats = { imported: 0, skipped: 0, errors: 0 };

  for (const rec of records) {
    const f = rec.fields;
    await stageRecord(client, 'airtable', 'kitten_assessments', rec.id, f);

    const catId = resolveLinked(f['Cat'] || f['Kitten'] || f['Animal'], maps.cats);
    const assessmentDate = parseDate(f['Date'] || f['Assessment Date']);
    const ageWeeks = parsePositiveInt(f['Age (weeks)'] || f['Age Weeks'] || f['Estimated Age']);
    const socLevel = f['Socialization Level'] || f['Socialization'] || f['Temperament'] || null;
    const healthNotes = f['Health Notes'] || f['Health'] || f['Medical Notes'] || null;
    const outcome = f['Outcome'] || f['Decision'] || f['Recommendation'] || null;
    const assessor = f['Assessor'] || f['Assessed By'] || null;

    if (options.dryRun) { stats.skipped++; continue; }

    try {
      await client.query(
        `INSERT INTO ops.kitten_assessments
           (cat_id, assessment_date, kitten_age_weeks, socialization_level,
            health_notes, outcome, assessor_name, airtable_fields, source_system, source_record_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'airtable', $9)
         ON CONFLICT (source_system, source_record_id) DO NOTHING`,
        [catId, assessmentDate, ageWeeks, socLevel, healthNotes,
         outcome, assessor, JSON.stringify(f), rec.id]
      );
      stats.imported++;
    } catch (err) {
      console.error(`    Error importing assessment ${rec.id}: ${err.message}`);
      stats.errors++;
    }
  }

  console.log(`    ${JSON.stringify(stats)}`);
  return stats;
}

/**
 * FFS-203: Surrender Forms
 */
async function importSurrenderForms(client, records, maps, options) {
  const label = 'FFS-203: Surrender Forms';
  console.log(`\n  ${label}`);
  const stats = { imported: 0, skipped: 0, errors: 0 };

  for (const rec of records) {
    const f = rec.fields;
    await stageRecord(client, 'airtable', 'surrender_forms', rec.id, f);

    const catId = resolveLinked(f['Cat'] || f['Animal'], maps.cats);
    const surrenderDate = parseDate(f['Date'] || f['Surrender Date']);
    const reason = f['Reason'] || f['Reason for Surrender'] || null;
    const catName = f['Cat Name'] || f['Animal Name'] || f['Name'] || null;
    const catDescription = f['Description'] || f['Cat Description'] || null;

    // Resolve or create surrenderer
    let surrendererId = resolveLinked(f['Surrenderer'] || f['Owner'] || f['Person'], maps.people);
    if (!surrendererId && (f['Email'] || f['Phone'])) {
      const email = f['Email'] ? f['Email'].toLowerCase().trim() : null;
      const phone = f['Phone'] || null;
      const firstName = f['First Name'] || f['Surrenderer Name']?.split(' ')[0] || null;
      const lastName = f['Last Name'] || f['Surrenderer Name']?.split(' ').slice(1).join(' ') || null;

      const validation = validatePersonCreation(email, phone, firstName, lastName);
      if (validation.valid && !options.dryRun) {
        const result = await client.query(
          `SELECT sot.find_or_create_person($1, $2, $3, $4, NULL, 'airtable') AS person_id`,
          [email, phone, firstName, lastName]
        );
        surrendererId = result.rows[0]?.person_id;
      }
    }

    if (options.dryRun) { stats.skipped++; continue; }

    try {
      await client.query(
        `INSERT INTO ops.surrender_forms
           (surrenderer_person_id, cat_id, surrender_date, reason,
            cat_name, cat_description, airtable_fields, source_system, source_record_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'airtable', $8)
         ON CONFLICT (source_system, source_record_id) DO NOTHING`,
        [surrendererId, catId, surrenderDate, reason,
         catName, catDescription, JSON.stringify(f), rec.id]
      );
      stats.imported++;
    } catch (err) {
      console.error(`    Error importing surrender form ${rec.id}: ${err.message}`);
      stats.errors++;
    }
  }

  console.log(`    ${JSON.stringify(stats)}`);
  return stats;
}

// ============================================================
// PHASE F: Media (FFS-200) — handled by airtable_photos_sync.mjs
// ============================================================

// ============================================================
// Phase Definitions
// ============================================================
const PHASES = {
  A: {
    name: 'People Enrichment',
    issues: {
      'FFS-193': { fn: importDNCFlags, table: 'clients', tableId: TABLE_IDS.clients },
      'FFS-201': { fn: importContactAliases, table: 'master_contacts', tableId: TABLE_IDS.master_contacts },
      'FFS-192': { fn: importTrapperEnrichment, table: 'trappers', tableId: TABLE_IDS.trappers },
      'FFS-205A': { fn: importEquipment, table: 'equipment', tableId: TABLE_IDS.equipment },
    },
  },
  B: {
    name: 'Request Enrichment',
    issues: {
      'FFS-186': { fn: importTrapperAssignments, table: 'trapping_requests', tableId: TABLE_IDS.trapping_requests },
      'FFS-187': { fn: importStaffAssignments, table: 'trapping_requests', tableId: TABLE_IDS.trapping_requests },
      'FFS-191': { fn: importRequestOperationalFields, table: 'trapping_requests', tableId: TABLE_IDS.trapping_requests },
      'FFS-199': { fn: importAppointmentRequestFields, table: 'appointment_requests', tableId: TABLE_IDS.appointment_requests },
    },
  },
  C: {
    name: 'Trapper Operations',
    issues: {
      'FFS-188': { fn: importTrapperCases, table: 'trapper_cases', tableId: TABLE_IDS.trapper_cases },
      'FFS-189': { fn: importTrapperReports, table: 'trapper_reports', tableId: TABLE_IDS.trapper_reports },
      'FFS-190': { fn: importTrapperCaseCats, table: 'trapper_cats', tableId: TABLE_IDS.trapper_cats },
      'FFS-205B': { fn: importEquipmentCheckouts, table: 'checkout_log', tableId: TABLE_IDS.checkout_log },
    },
  },
  D: {
    name: 'Place Enrichment',
    issues: {
      'FFS-194': { fn: importCommonTrappingLocations, table: 'common_trapping_locs', tableId: TABLE_IDS.common_trapping_locs },
      'FFS-195': { fn: importPlaceContacts, table: 'place_contacts', tableId: TABLE_IDS.place_contacts },
    },
  },
  E: {
    name: 'Standalone Tables',
    issues: {
      'FFS-196': { fn: importOrgEvents, table: 'ffsc_calendar', tableId: TABLE_IDS.ffsc_calendar },
      'FFS-202': { fn: importOrgEvents, table: 'events', tableId: TABLE_IDS.events },
      'FFS-197': { fn: importCallLogs, table: 'call_sheets', tableId: TABLE_IDS.call_sheets },
      'FFS-198': { fn: importKittenAssessments, table: 'kitten_intake', tableId: TABLE_IDS.kitten_intake },
      'FFS-203': { fn: importSurrenderForms, table: 'surrender_forms', tableId: TABLE_IDS.surrender_forms },
    },
  },
};

// ============================================================
// Main
// ============================================================
async function main() {
  const options = parseArgs();

  console.log('\n═══════════════════════════════════════════════════');
  console.log('Airtable Full Data Salvage');
  console.log('═══════════════════════════════════════════════════');
  if (options.dryRun) console.log('  MODE: DRY RUN (no writes)');
  if (options.phase) console.log(`  PHASE: ${options.phase}`);
  if (options.only) console.log(`  ONLY: ${options.only}`);
  console.log('');

  // Discovery mode
  if (options.discover) {
    await runDiscover();
    return;
  }

  // Validate env
  if (!process.env.AIRTABLE_PAT) {
    console.error('ERROR: AIRTABLE_PAT environment variable is required');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL environment variable is required');
    process.exit(1);
  }

  // Connect to database
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  console.log('Connected to database.');

  try {
    // Build resolution maps
    const maps = await buildResolveMaps(client, options);

    // Determine which phases/issues to run
    let phasesToRun = Object.keys(PHASES);
    if (options.phase) {
      phasesToRun = [options.phase];
    }

    const allStats = {};

    for (const phaseKey of phasesToRun) {
      const phase = PHASES[phaseKey];
      if (!phase) {
        console.error(`Unknown phase: ${phaseKey}`);
        continue;
      }

      console.log(`\n╔═══════════════════════════════════════════════╗`);
      console.log(`║ Phase ${phaseKey}: ${phase.name}`);
      console.log(`╚═══════════════════════════════════════════════╝`);

      // Cache fetched records per tableId to avoid re-fetching
      const fetchCache = new Map();

      for (const [issueKey, issue] of Object.entries(phase.issues)) {
        // Filter by --only
        if (options.only && issueKey.toUpperCase() !== options.only) continue;

        // Check if table ID is known
        if (!issue.tableId) {
          console.log(`\n  ${issueKey}: SKIPPED — table ID not configured for '${issue.table}'`);
          console.log(`    Set AT_${issue.table.toUpperCase()}_TABLE_ID env var`);
          continue;
        }

        // Fetch records (cache by tableId)
        let records;
        if (fetchCache.has(issue.tableId)) {
          records = fetchCache.get(issue.tableId);
        } else {
          try {
            records = await fetchAllRecords(issue.tableId);
            fetchCache.set(issue.tableId, records);
          } catch (err) {
            console.error(`  ${issueKey}: FETCH ERROR — ${err.message}`);
            allStats[issueKey] = { imported: 0, skipped: 0, errors: 1 };
            continue;
          }
        }

        console.log(`  ${issueKey}: ${records.length} records fetched`);

        // Track the run
        let runId;
        if (!options.dryRun) {
          runId = await startIngestRun(client, `salvage_${issueKey.toLowerCase()}`, records.length);
        }

        const stats = await issue.fn(client, records, maps, options);
        allStats[issueKey] = stats;

        if (runId) {
          await completeIngestRun(client, runId, stats);
        }
      }
    }

    // Summary
    console.log('\n═══════════════════════════════════════════════════');
    console.log('SALVAGE SUMMARY');
    console.log('═══════════════════════════════════════════════════');
    for (const [issue, stats] of Object.entries(allStats)) {
      const status = stats.errors > 0 ? '⚠' : '✓';
      console.log(`  ${status} ${issue}: imported=${stats.imported} skipped=${stats.skipped} errors=${stats.errors}`);
    }

    if (options.dryRun) {
      console.log('\n  DRY RUN — No changes were written to the database.\n');
    }

  } finally {
    await client.end();
    console.log('\nDatabase connection closed.');
  }
}

main().catch(err => {
  console.error('FATAL ERROR:', err);
  process.exit(1);
});
