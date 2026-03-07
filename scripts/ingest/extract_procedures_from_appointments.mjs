#!/usr/bin/env node
/**
 * extract_procedures_from_appointments.mjs
 *
 * After ingesting ClinicHQ appointment data, run this script to:
 * 1. Create sot_appointments from staged_records using centralized SQL functions
 * 2. Create cat_procedures from sot_appointments based on service_type
 *
 * This uses the centralized functions from MIG_261:
 * - process_pending_clinichq_appointments(): Converts staged records to appointments
 * - create_procedures_from_appointments(): Creates procedures and updates cat status
 *
 * These functions properly:
 * - Look up cats via centralized patterns
 * - Follow merge chains for cats
 * - Handle duplicates safely
 * - Update cat altered_status
 *
 * Usage:
 *   set -a && source .env && set +a
 *   node scripts/ingest/extract_procedures_from_appointments.mjs
 *   node scripts/ingest/extract_procedures_from_appointments.mjs --dry-run
 */

import pg from 'pg';

const { Pool } = pg;

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log('\n=== Extract Procedures from Appointments ===');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}\n`);

  if (!process.env.DATABASE_URL) {
    console.error('Error: DATABASE_URL not set');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // Step 1: Process staged appointments using centralized function
    console.log('Step 1: Processing staged ClinicHQ appointments...');

    if (dryRun) {
      // Count pending records
      const countResult = await pool.query(`
        SELECT COUNT(*) as cnt
        FROM ops.staged_records
        WHERE source_system = 'clinichq'
          AND source_table = 'appointment_info'
          AND processed_at IS NULL
          AND payload->>'Date' IS NOT NULL
          AND payload->>'Date' <> ''
      `);
      console.log(`  Would process ${countResult.rows[0].cnt} pending appointment records`);
    } else {
      // Use centralized function
      const result = await pool.query(`
        SELECT ops.process_pending_clinichq_appointments(1000) AS result
      `);
      const summary = result.rows[0].result;
      console.log(`  Processed: ${summary.processed}`);
      console.log(`  Created: ${summary.created}`);
      console.log(`  Skipped (already exist): ${summary.skipped}`);
      if (summary.errors > 0) {
        console.log(`  Errors: ${summary.errors}`);
      }
    }

    // Step 2: Create procedures from appointments using centralized function
    console.log('\nStep 2: Creating procedures from appointments...');

    if (dryRun) {
      // Count potential spays
      const spayCount = await pool.query(`
        SELECT COUNT(*) as cnt
        FROM ops.appointments a
        WHERE a.cat_id IS NOT NULL
          AND a.service_type ILIKE '%spay%'
          AND NOT EXISTS (
            SELECT 1 FROM ops.cat_procedures cp
            WHERE cp.appointment_id = a.appointment_id AND cp.is_spay = TRUE
          )
      `);
      // Count potential neuters
      const neuterCount = await pool.query(`
        SELECT COUNT(*) as cnt
        FROM ops.appointments a
        WHERE a.cat_id IS NOT NULL
          AND a.service_type ILIKE '%neuter%'
          AND NOT EXISTS (
            SELECT 1 FROM ops.cat_procedures cp
            WHERE cp.appointment_id = a.appointment_id AND cp.is_neuter = TRUE
          )
      `);
      console.log(`  Would create ${spayCount.rows[0].cnt} spay procedures`);
      console.log(`  Would create ${neuterCount.rows[0].cnt} neuter procedures`);
    } else {
      // Use centralized function
      const result = await pool.query(`
        SELECT ops.create_procedures_from_appointments(1000) AS result
      `);
      const summary = result.rows[0].result;
      console.log(`  Spay procedures created: ${summary.spays_created}`);
      console.log(`  Neuter procedures created: ${summary.neuters_created}`);
      console.log(`  Cats updated (altered_status): ${summary.cats_updated}`);
    }

    // Summary
    console.log('\n=== Summary ===');
    const summary = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM ops.appointments) as total_appointments,
        (SELECT COUNT(*) FROM ops.appointments WHERE cat_id IS NULL) as orphaned_appointments,
        (SELECT COUNT(*) FROM ops.cat_procedures WHERE is_spay) as total_spays,
        (SELECT COUNT(*) FROM ops.cat_procedures WHERE is_neuter) as total_neuters,
        (SELECT COUNT(*) FROM sot.cats WHERE altered_status IN ('spayed', 'neutered')) as altered_cats
    `);
    console.log(`Total appointments: ${summary.rows[0].total_appointments}`);
    console.log(`Orphaned appointments (no cat linked): ${summary.rows[0].orphaned_appointments}`);
    console.log(`Total spay procedures: ${summary.rows[0].total_spays}`);
    console.log(`Total neuter procedures: ${summary.rows[0].total_neuters}`);
    console.log(`Cats with altered_status set: ${summary.rows[0].altered_cats}`);

  } finally {
    await pool.end();
  }

  console.log('\nDone!');
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
