require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
  const client = await pool.connect();
  try {
    // Check Feb 2 specifically
    const feb2 = await client.query(`
      SELECT
        a.appointment_id,
        a.clinichq_appointment_id,
        a.appointment_date,
        c.name as cat_name,
        c.microchip,
        c.clinichq_animal_id,
        a.created_at
      FROM ops.appointments a
      LEFT JOIN sot.cats c ON c.cat_id = a.cat_id
      WHERE a.appointment_date = '2026-02-02'
      ORDER BY a.clinichq_appointment_id
    `);

    console.log('=== Feb 2, 2026 Appointments ===');
    console.log('Count:', feb2.rows.length, '(expected: 38)');
    console.log('\nAppointments with clinichq_animal_id but no microchip:');
    const noChip = feb2.rows.filter(r => !r.microchip && r.clinichq_animal_id);
    noChip.forEach(r => {
      console.log(`  ${r.clinichq_appointment_id}: ${r.cat_name || 'NO CAT'} (chq_id: ${r.clinichq_animal_id})`);
    });

    // Check Feb 4
    const feb4 = await client.query(`
      SELECT COUNT(*) as count FROM ops.appointments WHERE appointment_date = '2026-02-04'
    `);
    console.log('\n=== Feb 4, 2026 Appointments ===');
    console.log('Count:', feb4.rows[0].count, '(expected: 44)');

    // Check Feb 9
    const feb9 = await client.query(`
      SELECT COUNT(*) as count FROM ops.appointments WHERE appointment_date = '2026-02-09'
    `);
    console.log('\n=== Feb 9, 2026 Appointments ===');
    console.log('Count:', feb9.rows[0].count, '(expected: 38)');

    // Check Feb 11
    const feb11 = await client.query(`
      SELECT COUNT(*) as count FROM ops.appointments WHERE appointment_date = '2026-02-11'
    `);
    console.log('\n=== Feb 11, 2026 Appointments ===');
    console.log('Count:', feb11.rows[0].count, '(expected: 53)');

    // Summary
    console.log('\n=== Summary ===');
    console.log('Missing appointments:');
    console.log(`  Feb 2: ${38 - feb2.rows.length} missing`);
    console.log(`  Feb 4: ${44 - feb4.rows[0].count} missing`);
    console.log(`  Feb 9: ${38 - feb9.rows[0].count} missing`);
    console.log(`  Feb 11: ${53 - feb11.rows[0].count} missing`);

  } finally {
    client.release();
    await pool.end();
  }
}
check();
