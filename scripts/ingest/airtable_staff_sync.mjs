#!/usr/bin/env node
/**
 * airtable_staff_sync.mjs
 *
 * Syncs FFSC Staff from Airtable into Atlas staff table.
 *
 * Usage:
 *   # First load env vars:
 *   export $(cat .env | grep -v '^#' | xargs)
 *
 *   # Then run:
 *   node scripts/ingest/airtable_staff_sync.mjs
 *   node scripts/ingest/airtable_staff_sync.mjs --dry-run
 *
 * Required env:
 *   AIRTABLE_PAT - Airtable Personal Access Token
 *   DATABASE_URL - Postgres connection string
 */

import pg from 'pg';

const { Client } = pg;

// Airtable config
const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const BASE_ID = 'appl6zLrRFDvsz0dh';
const TABLE_ID = 'tblBnnx3lZte6KgMn'; // Staff table

const SOURCE_SYSTEM = 'airtable';

// Parse command line args
function parseArgs() {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes('--dry-run'),
    verbose: args.includes('--verbose') || args.includes('-v'),
  };
}

// Fetch all records from Airtable
async function fetchAllRecords() {
  const records = [];
  let offset = null;
  let page = 1;

  console.log('Fetching staff from Airtable...');

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

// Extract staff info from Airtable fields
function extractStaffInfo(fields) {
  return {
    firstName: (fields['First Name'] || '').trim(),
    lastName: (fields['Last name'] || '').trim(),
    email: (fields['FFSC Email'] || '').toLowerCase().trim(),
    phone: (fields['Phone (cell) '] || '').trim(),
    workExtension: (fields['Work Ext 7077567999'] || '').trim(),
    role: (fields['Role'] || '').trim(),
  };
}

// Categorize role into department
function getDepartment(role) {
  const r = role.toLowerCase();
  if (r.includes('clinic') || r.includes('kennel')) return 'Clinic';
  if (r.includes('trapping') || r.includes('trapper')) return 'Trapping';
  if (r.includes('foster') || r.includes('adoption') || r.includes('relo')) return 'Adoptions';
  if (r.includes('volunteer')) return 'Volunteers';
  if (r.includes('accounting') || r.includes('admin') || r.includes('executive') || r.includes('director')) return 'Administration';
  if (r.includes('marketing')) return 'Marketing';
  return 'Other';
}

async function main() {
  const options = parseArgs();

  console.log('\n═══════════════════════════════════════════════════');
  console.log('Airtable Staff Sync');
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
    console.log('DRY RUN MODE - No changes will be made\n');
  }

  // Fetch from Airtable
  const airtableRecords = await fetchAllRecords();
  console.log(`\nTotal staff from Airtable: ${airtableRecords.length}\n`);

  if (airtableRecords.length === 0) {
    console.log('No records to process.');
    process.exit(0);
  }

  // Show what we found
  console.log('Staff members:');
  for (const record of airtableRecords) {
    const info = extractStaffInfo(record.fields);
    console.log(`  - ${info.firstName} ${info.lastName} (${info.role})`);
  }
  console.log('');

  if (options.dryRun) {
    console.log('Dry run complete. No changes made.');
    process.exit(0);
  }

  // Connect to database
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  console.log('Connected to database\n');

  let created = 0;
  let updated = 0;
  let errors = 0;

  for (const record of airtableRecords) {
    const airtableRecordId = record.id;
    const info = extractStaffInfo(record.fields);

    if (!info.firstName) {
      console.log(`  Skip: No first name for record ${airtableRecordId}`);
      continue;
    }

    try {
      const result = await client.query(`
        INSERT INTO trapper.staff (
          first_name,
          last_name,
          email,
          phone,
          work_extension,
          role,
          department,
          source_system,
          source_record_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (source_system, source_record_id)
        DO UPDATE SET
          first_name = EXCLUDED.first_name,
          last_name = EXCLUDED.last_name,
          email = EXCLUDED.email,
          phone = EXCLUDED.phone,
          work_extension = EXCLUDED.work_extension,
          role = EXCLUDED.role,
          department = EXCLUDED.department,
          updated_at = NOW()
        RETURNING (xmax = 0) AS was_inserted
      `, [
        info.firstName,
        info.lastName || null,
        info.email || null,
        info.phone || null,
        info.workExtension || null,
        info.role || 'Staff',
        getDepartment(info.role),
        SOURCE_SYSTEM,
        airtableRecordId
      ]);

      if (result.rows[0]?.was_inserted) {
        created++;
        console.log(`  + Created: ${info.firstName} ${info.lastName}`);
      } else {
        updated++;
        if (options.verbose) {
          console.log(`  ~ Updated: ${info.firstName} ${info.lastName}`);
        }
      }

      // Create/find person and link to staff record
      if (info.email || info.phone) {
        // Use find_or_create_person for proper identity linking
        const personResult = await client.query(`
          SELECT trapper.find_or_create_person(
            $1,  -- email
            $2,  -- phone
            $3,  -- first_name
            $4,  -- last_name
            NULL, -- address
            $5   -- source_system
          ) AS person_id
        `, [
          info.email || null,
          info.phone?.replace(/\D/g, '') || null,
          info.firstName,
          info.lastName || null,
          'airtable_staff'
        ]);

        const personId = personResult.rows[0]?.person_id;

        if (personId) {
          // Link staff to person
          await client.query(`
            UPDATE trapper.staff
            SET person_id = $1
            WHERE source_record_id = $2
          `, [personId, airtableRecordId]);

          // Update person's display name to match staff name
          await client.query(`
            UPDATE trapper.sot_people
            SET display_name = $2
            WHERE person_id = $1
              AND (display_name IS NULL OR display_name = '')
          `, [personId, `${info.firstName} ${info.lastName || ''}`.trim()]);

          // Add staff role to person_roles
          await client.query(`
            INSERT INTO trapper.person_roles (person_id, role, role_status, source_system, notes)
            VALUES ($1, 'staff', 'active', 'airtable_staff', $2)
            ON CONFLICT (person_id, role) DO UPDATE SET
              role_status = 'active',
              notes = EXCLUDED.notes,
              updated_at = NOW()
          `, [personId, info.role]);

          if (options.verbose) {
            console.log(`    -> Linked to person ${personId.substring(0, 8)}...`);
          }
        }
      }

    } catch (err) {
      console.error(`  Error processing ${info.firstName}: ${err.message}`);
      errors++;
    }
  }

  await client.end();

  console.log('\n═══════════════════════════════════════════════════');
  console.log('Summary:');
  console.log(`  + Created: ${created}`);
  console.log(`  ~ Updated: ${updated}`);
  if (errors > 0) {
    console.log(`  ! Errors:  ${errors}`);
  }
  console.log('═══════════════════════════════════════════════════\n');

  process.exit(errors > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
