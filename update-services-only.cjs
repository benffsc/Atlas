/**
 * Fast targeted script to update service_type on existing appointments.
 * Instead of full import (~5 hours), just updates service lists (~minutes).
 */
require('dotenv').config({ path: '.env.local' });
const XLSX = require('xlsx');
const fs = require('fs');
const { Client } = require('pg');

function parseXlsxFile(path) {
  const buffer = fs.readFileSync(path);
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
}

function getString(row, ...keys) {
  for (const key of keys) {
    const val = row[key];
    if (val !== undefined && val !== null && val !== '') return String(val).trim();
  }
  return '';
}

async function main() {
  console.log('=== Update Services Only ===\n');

  // Parse appointment_service export
  console.log('Parsing appointment_service export...');
  const rows = parseXlsxFile('/Users/benmisdiaz/Downloads/report_5814679a-ca2b-4da7-aa36-6c78a5555338.xlsx');
  console.log(`  Total rows: ${rows.length}`);

  // Group services by appointment number
  console.log('Grouping services by appointment...');
  const servicesByAppt = new Map();
  let currentAppt = null;

  for (const row of rows) {
    const apptNumber = getString(row, 'Number', 'Appointment Number', 'Appt Number', 'Appt #');
    const service = getString(row, 'Service / Subsidy', 'Service Item', 'Procedure', 'Service');

    if (apptNumber) {
      currentAppt = apptNumber;
      if (!servicesByAppt.has(apptNumber)) {
        servicesByAppt.set(apptNumber, []);
      }
    }

    if (service && currentAppt) {
      servicesByAppt.get(currentAppt).push(service);
    }
  }

  console.log(`  Unique appointments with services: ${servicesByAppt.size}`);

  // Sample output
  const sample = Array.from(servicesByAppt.entries()).slice(0, 3);
  console.log('\nSample (first 3):');
  for (const [appt, services] of sample) {
    console.log(`  ${appt}: ${services.length} services`);
  }

  // Connect to DB
  console.log('\nConnecting to database...');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // Batch update
  console.log('\nUpdating appointments...');
  let updated = 0;
  let notFound = 0;
  const batchSize = 100;
  const entries = Array.from(servicesByAppt.entries());

  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);

    for (const [apptNumber, services] of batch) {
      const serviceStr = services.join('; ');

      const result = await client.query(`
        UPDATE ops.appointments
        SET service_type = $1, updated_at = NOW()
        WHERE appointment_number = $2
        RETURNING appointment_id
      `, [serviceStr, apptNumber]);

      if (result.rowCount > 0) {
        updated++;
      } else {
        notFound++;
      }
    }

    if ((i + batchSize) % 1000 === 0 || i + batchSize >= entries.length) {
      const pct = Math.round((i + batchSize) / entries.length * 100);
      console.log(`  Progress: ${Math.min(i + batchSize, entries.length)}/${entries.length} (${pct}%) - Updated: ${updated}, Not found: ${notFound}`);
    }
  }

  console.log(`\n=== Done ===`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Not found (missing appointments): ${notFound}`);

  await client.end();
}

main().catch(console.error);
