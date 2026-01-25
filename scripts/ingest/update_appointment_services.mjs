#!/usr/bin/env node
/**
 * Update Appointment Services from ClinicHQ Export
 *
 * Reads a multi-row ClinicHQ export (one row per service line) and updates
 * sot_appointments.service_type with the aggregated services.
 *
 * This fixes the data gap where 2023-2025 appointments are missing
 * vaccine/treatment details (FVRCP, Revolution, etc.)
 *
 * Usage:
 *   node scripts/ingest/update_appointment_services.mjs /path/to/export.xlsx [--dry-run]
 */

import XLSX from 'xlsx';
import pg from 'pg';
import { config } from 'dotenv';

config();

const { Pool } = pg;

async function main() {
  const filePath = process.argv[2];
  const dryRun = process.argv.includes('--dry-run');

  if (!filePath) {
    console.error('Usage: node update_appointment_services.mjs /path/to/export.xlsx [--dry-run]');
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log('Update Appointment Services from ClinicHQ Export');
  console.log('='.repeat(60));
  console.log('File:', filePath);
  console.log('Dry run:', dryRun);
  console.log();

  // Read XLSX
  console.log('Reading XLSX file...');
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(sheet);
  console.log('Total rows:', data.length);

  // Aggregate services by appointment
  console.log('\nAggregating services by appointment...');
  const appointments = new Map();
  let currentAppt = null;

  for (const row of data) {
    if (row['Number']) {
      currentAppt = row['Number'];
      appointments.set(currentAppt, {
        date: row['Date'],
        microchip: row['Microchip Number'],
        services: [],
        vet: row['Vet Name'],
        temp: row['Temperature'],
        spay: row['Spay'],
        neuter: row['Neuter'],
        technician: row['Technician'],
        felvFiv: row['FeLV/FIV (SNAP test, in-house)'],
        internalNotes: row['Internal Medical Notes']
      });
    }

    // Add service to current appointment
    if (currentAppt && appointments.has(currentAppt)) {
      const service = row['Service / Subsidy'];
      if (service && service.trim() && service !== '---') {
        appointments.get(currentAppt).services.push(service.trim());
      }
    }
  }

  console.log('Unique appointments:', appointments.size);

  // Analyze content
  let hasVaccines = 0;
  let hasFvrcp = 0;
  let hasRabies = 0;
  let hasRevolution = 0;

  for (const appt of appointments.values()) {
    const servicesStr = appt.services.join(' ');
    if (servicesStr.toLowerCase().includes('vaccine')) hasVaccines++;
    if (servicesStr.toLowerCase().includes('fvrcp')) hasFvrcp++;
    if (servicesStr.toLowerCase().includes('rabies')) hasRabies++;
    if (servicesStr.toLowerCase().includes('revolution')) hasRevolution++;
  }

  console.log('\nServices analysis in export:');
  console.log('  With vaccines:', hasVaccines, `(${(hasVaccines/appointments.size*100).toFixed(1)}%)`);
  console.log('  With FVRCP:', hasFvrcp, `(${(hasFvrcp/appointments.size*100).toFixed(1)}%)`);
  console.log('  With Rabies:', hasRabies, `(${(hasRabies/appointments.size*100).toFixed(1)}%)`);
  console.log('  With Revolution:', hasRevolution, `(${(hasRevolution/appointments.size*100).toFixed(1)}%)`);

  // Connect to database
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    // Check how many appointments exist in database
    console.log('\nChecking database...');
    const existingResult = await pool.query(`
      SELECT appointment_number, service_type
      FROM trapper.sot_appointments
      WHERE appointment_number = ANY($1)
    `, [Array.from(appointments.keys())]);

    console.log('Appointments found in database:', existingResult.rows.length);

    // Build update map
    const existingMap = new Map();
    for (const row of existingResult.rows) {
      existingMap.set(row.appointment_number, row.service_type);
    }

    // Identify updates needed
    const updates = [];
    let alreadyComplete = 0;
    let needsUpdate = 0;
    let notInDb = 0;

    for (const [apptNum, apptData] of appointments) {
      if (!existingMap.has(apptNum)) {
        notInDb++;
        continue;
      }

      const currentService = existingMap.get(apptNum) || '';
      const newService = apptData.services.join(' /; ');

      // Check if current data is incomplete (missing vaccines/treatments)
      const currentHasDetail = currentService.toLowerCase().includes('fvrcp') ||
                               currentService.toLowerCase().includes('revolution') ||
                               currentService.toLowerCase().includes('buprenorphine');
      const newHasDetail = newService.toLowerCase().includes('fvrcp') ||
                           newService.toLowerCase().includes('revolution') ||
                           newService.toLowerCase().includes('buprenorphine');

      if (currentHasDetail) {
        alreadyComplete++;
      } else if (newHasDetail && newService.length > currentService.length) {
        needsUpdate++;
        updates.push({
          apptNum,
          oldService: currentService,
          newService
        });
      }
    }

    console.log('\nUpdate analysis:');
    console.log('  Already complete:', alreadyComplete);
    console.log('  Needs update:', needsUpdate);
    console.log('  Not in database:', notInDb);

    // Sample updates
    console.log('\nSample updates (first 3):');
    updates.slice(0, 3).forEach((u, i) => {
      console.log(`\n${i+1}. Appt ${u.apptNum}:`);
      console.log('   OLD:', u.oldService.substring(0, 60) + '...');
      console.log('   NEW:', u.newService.substring(0, 100) + '...');
    });

    if (dryRun) {
      console.log('\n[DRY RUN] Would update', updates.length, 'appointments');
    } else {
      console.log('\nApplying updates...');
      let updated = 0;
      let errors = 0;

      for (const u of updates) {
        try {
          await pool.query(`
            UPDATE trapper.sot_appointments
            SET service_type = $1, updated_at = NOW()
            WHERE appointment_number = $2
          `, [u.newService, u.apptNum]);
          updated++;

          if (updated % 500 === 0) {
            console.log(`  Updated ${updated}/${updates.length}...`);
          }
        } catch (err) {
          errors++;
          console.error(`  Error updating ${u.apptNum}:`, err.message);
        }
      }

      console.log('\nUpdate complete:');
      console.log('  Updated:', updated);
      console.log('  Errors:', errors);
    }

    // Verify results
    if (!dryRun) {
      console.log('\nVerifying results...');
      const verifyResult = await pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE service_type LIKE '%FVRCP%') as with_fvrcp,
          COUNT(*) FILTER (WHERE service_type LIKE '%Revolution%') as with_revolution,
          COUNT(*) as total
        FROM trapper.sot_appointments
        WHERE appointment_date >= '2023-12-01'
      `);

      const v = verifyResult.rows[0];
      console.log('  Total appointments:', v.total);
      console.log('  With FVRCP:', v.with_fvrcp);
      console.log('  With Revolution:', v.with_revolution);
    }

  } finally {
    await pool.end();
  }

  console.log('\n' + '='.repeat(60));
  console.log('Done!');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
