/**
 * ClinicHQ Update Sync Script
 *
 * Purpose: Compare a new ClinicHQ export to existing data and update records
 * where ClinicHQ has new information (microchip added, data corrected, etc.)
 *
 * Usage: node sync-clinichq-updates.cjs <export-file.xlsx> [--dry-run]
 *
 * What it updates:
 * - Microchip: If NULL in our DB but present in export → UPDATE
 * - Cat name: If different and export is newer → UPDATE
 * - Owner info: If our person_id is NULL but export has identifiable owner → LINK
 */

const XLSX = require('xlsx');
const fs = require('fs');
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const DRY_RUN = process.argv.includes('--dry-run');
const EXCLUDE_TODAY = process.argv.includes('--exclude-today');
const EXPORT_FILE = process.argv[2];

if (!EXPORT_FILE || EXPORT_FILE.startsWith('--')) {
  console.log('Usage: node sync-clinichq-updates.cjs <export-file.xlsx> [--dry-run]');
  console.log('');
  console.log('Options:');
  console.log('  --dry-run    Show what would be updated without making changes');
  process.exit(1);
}

async function main() {
  console.log('='.repeat(60));
  console.log('ClinicHQ Update Sync');
  console.log('='.repeat(60));
  console.log('Export file:', EXPORT_FILE);
  console.log('Mode:', DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE (will update database)');
  if (EXCLUDE_TODAY) {
    const today = new Date().toISOString().split('T')[0];
    console.log('Excluding today\'s appointments:', today);
  }
  console.log('');

  // Load export
  if (!fs.existsSync(EXPORT_FILE)) {
    console.error('File not found:', EXPORT_FILE);
    process.exit(1);
  }

  const buffer = fs.readFileSync(EXPORT_FILE);
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  console.log(`Loaded ${rows.length} rows from export`);

  const stats = {
    total: rows.length,
    microchipsAdded: 0,
    namesUpdated: 0,
    ownersLinked: 0,
    newAppointments: 0,
    noChanges: 0,
    errors: 0
  };

  const changes = [];

  for (const row of rows) {
    try {
      const result = await processRow(row);
      if (result.change) {
        changes.push(result);
        if (result.type === 'microchip_added') stats.microchipsAdded++;
        if (result.type === 'name_updated') stats.namesUpdated++;
        if (result.type === 'owner_linked') stats.ownersLinked++;
        if (result.type === 'new_appointment') stats.newAppointments++;
      } else {
        stats.noChanges++;
      }
    } catch (err) {
      stats.errors++;
      console.error('Error processing row:', row['Appointment Number'] || row['Number'], err.message);
    }
  }

  // Print summary
  console.log('');
  console.log('='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total rows processed: ${stats.total}`);
  console.log(`No changes needed: ${stats.noChanges}`);
  console.log(`Microchips added: ${stats.microchipsAdded}`);
  console.log(`Names updated: ${stats.namesUpdated}`);
  console.log(`Owners linked: ${stats.ownersLinked}`);
  console.log(`New appointments: ${stats.newAppointments}`);
  console.log(`Errors: ${stats.errors}`);

  if (changes.length > 0) {
    console.log('');
    console.log('='.repeat(60));
    console.log('CHANGES' + (DRY_RUN ? ' (would be made)' : ' (applied)'));
    console.log('='.repeat(60));
    for (const c of changes) {
      console.log(`[${c.type}] ${c.catName || 'Unknown'}: ${c.description}`);
    }
  }

  if (DRY_RUN && changes.length > 0) {
    console.log('');
    console.log('Run without --dry-run to apply these changes.');
  }

  await pool.end();
}

async function processRow(row) {
  // Extract data from row
  const appointmentNumber = (row['Appointment Number'] || row['Number'] || row['Appt Number'] || '').toString().trim();
  const microchip = (row['Microchip Number'] || row['Microchip #'] || '').toString().trim();
  const catName = (row['Animal Name'] || row['Name'] || '').toString().trim();
  const appointmentDate = parseDate(row['Date'] || row['Appointment Date']);
  const ownerFirst = (row['Owner First Name'] || '').toString().trim();
  const ownerLast = (row['Owner Last Name'] || '').toString().trim();

  if (!appointmentNumber && !microchip && !catName) {
    return { change: false };
  }

  // Skip today's appointments if --exclude-today flag is set
  if (EXCLUDE_TODAY && appointmentDate) {
    const today = new Date().toISOString().split('T')[0];
    if (appointmentDate === today) {
      return { change: false };
    }
  }

  // Find existing appointment by appointment_number first
  let appointment = null;
  if (appointmentNumber) {
    const result = await pool.query(`
      SELECT a.appointment_id, a.cat_id, a.person_id, a.appointment_date,
             c.name as cat_name, c.microchip as cat_microchip,
             ci.id_value as cat_identifier_microchip
      FROM ops.appointments a
      LEFT JOIN sot.cats c ON c.cat_id = a.cat_id
      LEFT JOIN sot.cat_identifiers ci ON ci.cat_id = a.cat_id AND ci.id_type = 'microchip'
      WHERE a.appointment_number = $1
      LIMIT 1
    `, [appointmentNumber]);
    appointment = result.rows[0];
  }

  // Fallback: match by cat name + date + owner name (for appointments with NULL appointment_number)
  if (!appointment && catName && appointmentDate) {
    const result = await pool.query(`
      SELECT a.appointment_id, a.cat_id, a.person_id, a.appointment_date,
             c.name as cat_name, c.microchip as cat_microchip,
             ci.id_value as cat_identifier_microchip,
             p.display_name as owner_name
      FROM ops.appointments a
      LEFT JOIN sot.cats c ON c.cat_id = a.cat_id
      LEFT JOIN sot.cat_identifiers ci ON ci.cat_id = a.cat_id AND ci.id_type = 'microchip'
      LEFT JOIN sot.people p ON p.person_id = a.person_id
      WHERE a.appointment_date = $1
        AND c.name ILIKE $2
        AND (p.display_name ILIKE $3 OR $3 = '')
      LIMIT 1
    `, [appointmentDate, catName, ownerLast ? `%${ownerLast}%` : '']);
    appointment = result.rows[0];
  }

  if (!appointment) {
    // New appointment - could add logic to import it
    return {
      change: true,
      type: 'new_appointment',
      catName,
      description: `Appointment ${appointmentNumber || catName + ' on ' + appointmentDate} not in database (would need import)`
    };
  }

  // Check if microchip needs to be added
  const existingChip = appointment.cat_identifier_microchip || appointment.cat_microchip;

  if (microchip && !existingChip && appointment.cat_id) {
    // Microchip in export but not in our DB - UPDATE!
    if (!DRY_RUN) {
      // Add to cat_identifiers (unique on id_type, id_value)
      await pool.query(`
        INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, source_system, created_at)
        VALUES ($1, 'microchip', $2, 'clinichq', NOW())
        ON CONFLICT (id_type, id_value) DO NOTHING
      `, [appointment.cat_id, microchip]);

      // Also update sot.cats.microchip for backwards compat
      await pool.query(`
        UPDATE sot.cats SET microchip = $1, updated_at = NOW()
        WHERE cat_id = $2 AND (microchip IS NULL OR microchip = '')
      `, [microchip, appointment.cat_id]);
    }

    return {
      change: true,
      type: 'microchip_added',
      catName: appointment.cat_name || catName,
      description: `Added microchip ${microchip} (was NULL)`
    };
  }

  // Check if name needs updating
  if (catName && appointment.cat_name && catName !== appointment.cat_name && appointment.cat_id) {
    // Name changed - only update if it looks like a correction (not just case change)
    const isSignificantChange = catName.toLowerCase() !== appointment.cat_name.toLowerCase();
    if (isSignificantChange) {
      if (!DRY_RUN) {
        await pool.query(`
          UPDATE sot.cats SET name = $1, updated_at = NOW()
          WHERE cat_id = $2
        `, [catName, appointment.cat_id]);
      }
      return {
        change: true,
        type: 'name_updated',
        catName,
        description: `Name changed from "${appointment.cat_name}" to "${catName}"`
      };
    }
  }

  return { change: false };
}

function parseDate(value) {
  if (!value) return null;
  // Handle MM/DD/YYYY format
  const str = value.toString();
  const match = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (match) {
    return `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
  }
  return str;
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
