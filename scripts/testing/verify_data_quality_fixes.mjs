#!/usr/bin/env node
/**
 * Verify Data Quality Fixes - MIG_466
 *
 * Run before and after migration to verify fixes:
 *   node scripts/testing/verify_data_quality_fixes.mjs
 *
 * Tests:
 * 1. People without email identifiers
 * 2. People without phone identifiers
 * 3. Staged records processing status
 * 4. Identity resolution verification
 */

import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 30000,
});

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

async function runTests() {
  console.log('\n========================================');
  console.log('Data Quality Verification Tests');
  console.log('========================================\n');

  let passed = 0;
  let failed = 0;

  for (const { name, fn } of tests) {
    try {
      const result = await fn();
      if (result.pass) {
        console.log(`✅ ${name}`);
        if (result.details) console.log(`   ${result.details}`);
        passed++;
      } else {
        console.log(`❌ ${name}`);
        console.log(`   ${result.message}`);
        if (result.details) console.log(`   ${result.details}`);
        failed++;
      }
    } catch (err) {
      console.log(`❌ ${name}`);
      console.log(`   Error: ${err.message}`);
      failed++;
    }
  }

  console.log('\n========================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('========================================\n');

  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

// ============================================================================
// TEST: People without email identifiers
// ============================================================================

test('People with primary_email should have email identifier', async () => {
  const result = await pool.query(`
    SELECT COUNT(*) as count
    FROM trapper.sot_people p
    WHERE p.primary_email IS NOT NULL
      AND TRIM(p.primary_email) != ''
      AND p.merged_into_person_id IS NULL
      AND NOT EXISTS (
          SELECT 1 FROM trapper.person_identifiers pi
          WHERE pi.person_id = p.person_id AND pi.id_type = 'email'
      )
  `);

  const count = parseInt(result.rows[0].count);

  // After fix, should be 0 or very low (edge cases with duplicate emails)
  if (count === 0) {
    return { pass: true, details: 'All people with emails have identifiers indexed' };
  } else if (count < 100) {
    return { pass: true, details: `${count} people still missing (likely duplicate email conflicts)` };
  } else {
    return {
      pass: false,
      message: `${count} people have primary_email but no email identifier`,
      details: 'Run MIG_466 to backfill'
    };
  }
});

// ============================================================================
// TEST: People without phone identifiers
// ============================================================================

test('People with primary_phone should have phone identifier', async () => {
  const result = await pool.query(`
    SELECT COUNT(*) as count
    FROM trapper.sot_people p
    WHERE p.primary_phone IS NOT NULL
      AND LENGTH(trapper.norm_phone_us(p.primary_phone)) >= 10
      AND p.merged_into_person_id IS NULL
      AND NOT EXISTS (
          SELECT 1 FROM trapper.person_identifiers pi
          WHERE pi.person_id = p.person_id AND pi.id_type = 'phone'
      )
      AND NOT EXISTS (
          SELECT 1 FROM trapper.identity_phone_blacklist bl
          WHERE bl.phone_norm = trapper.norm_phone_us(p.primary_phone)
      )
  `);

  const count = parseInt(result.rows[0].count);

  // After fix, should be 0 or very low (edge cases with blacklisted or duplicate phones)
  if (count === 0) {
    return { pass: true, details: 'All people with phones have identifiers indexed' };
  } else if (count < 100) {
    return { pass: true, details: `${count} people still missing (likely duplicate phone conflicts)` };
  } else {
    return {
      pass: false,
      message: `${count} people have primary_phone but no phone identifier`,
      details: 'Run MIG_466 to backfill'
    };
  }
});

// ============================================================================
// TEST: ClinicHQ staged records processing
// ============================================================================

test('ClinicHQ appointment_info should be mostly processed', async () => {
  const result = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE is_processed) as processed,
      COUNT(*) FILTER (WHERE NOT is_processed) as unprocessed
    FROM trapper.staged_records
    WHERE source_system = 'clinichq'
      AND source_table = 'appointment_info'
  `);

  const { processed, unprocessed } = result.rows[0];
  const total = parseInt(processed) + parseInt(unprocessed);
  const pct = total > 0 ? Math.round(100 * parseInt(processed) / total) : 100;

  if (pct >= 90) {
    return { pass: true, details: `${pct}% processed (${processed}/${total})` };
  } else {
    return {
      pass: false,
      message: `Only ${pct}% processed`,
      details: `${unprocessed} records still unprocessed`
    };
  }
});

test('ClinicHQ cat_info should be mostly processed', async () => {
  const result = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE is_processed) as processed,
      COUNT(*) FILTER (WHERE NOT is_processed) as unprocessed
    FROM trapper.staged_records
    WHERE source_system = 'clinichq'
      AND source_table = 'cat_info'
  `);

  const { processed, unprocessed } = result.rows[0];
  const total = parseInt(processed) + parseInt(unprocessed);
  const pct = total > 0 ? Math.round(100 * parseInt(processed) / total) : 100;

  // cat_info has ~5000 without microchips, so 85% is acceptable
  if (pct >= 85) {
    return { pass: true, details: `${pct}% processed (${processed}/${total})` };
  } else {
    return {
      pass: false,
      message: `Only ${pct}% processed`,
      details: `${unprocessed} records still unprocessed (some may lack microchips)`
    };
  }
});

// ============================================================================
// TEST: PetLink staged records processing
// ============================================================================

test('PetLink pets should be mostly processed', async () => {
  const result = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE is_processed) as processed,
      COUNT(*) FILTER (WHERE NOT is_processed) as unprocessed
    FROM trapper.staged_records
    WHERE source_system = 'petlink'
      AND source_table = 'pets'
  `);

  const { processed, unprocessed } = result.rows[0];
  const total = parseInt(processed) + parseInt(unprocessed);
  const pct = total > 0 ? Math.round(100 * parseInt(processed) / total) : 100;

  if (pct >= 90) {
    return { pass: true, details: `${pct}% processed (${processed}/${total})` };
  } else {
    return {
      pass: false,
      message: `Only ${pct}% processed`,
      details: `${unprocessed} records still unprocessed`
    };
  }
});

// ============================================================================
// TEST: Identity resolution works
// ============================================================================

test('Identity resolution finds people by email', async () => {
  // Find a random person with email and check if identity resolution works
  const personResult = await pool.query(`
    SELECT p.person_id, p.display_name, p.primary_email
    FROM trapper.sot_people p
    WHERE p.primary_email IS NOT NULL
      AND p.merged_into_person_id IS NULL
    LIMIT 1
  `);

  if (personResult.rows.length === 0) {
    return { pass: true, details: 'No people with emails to test' };
  }

  const person = personResult.rows[0];
  const email = person.primary_email.toLowerCase().trim();

  // Check if we can find them via person_identifiers
  const matchResult = await pool.query(`
    SELECT p.person_id, p.display_name
    FROM trapper.person_identifiers pi
    JOIN trapper.sot_people p ON p.person_id = pi.person_id
    WHERE pi.id_type = 'email'
      AND pi.id_value_norm = $1
      AND p.merged_into_person_id IS NULL
  `, [email]);

  if (matchResult.rows.length > 0 && matchResult.rows[0].person_id === person.person_id) {
    return { pass: true, details: `Found "${person.display_name}" by email` };
  } else {
    return {
      pass: false,
      message: `Could not find person ${person.person_id} by email`,
      details: `Email: ${email}`
    };
  }
});

// ============================================================================
// TEST: Total identifier coverage
// ============================================================================

test('Total person identifier coverage is high', async () => {
  const result = await pool.query(`
    SELECT
      COUNT(DISTINCT p.person_id) as total_people,
      COUNT(DISTINCT pi.person_id) as people_with_identifiers
    FROM trapper.sot_people p
    LEFT JOIN trapper.person_identifiers pi ON pi.person_id = p.person_id
    WHERE p.merged_into_person_id IS NULL
  `);

  const { total_people, people_with_identifiers } = result.rows[0];
  const total = parseInt(total_people);
  const withId = parseInt(people_with_identifiers);
  const pct = total > 0 ? Math.round(100 * withId / total) : 100;

  if (pct >= 80) {
    return { pass: true, details: `${pct}% of people have identifiers (${withId}/${total})` };
  } else {
    return {
      pass: false,
      message: `Only ${pct}% of people have identifiers`,
      details: `${total - withId} people have no email or phone indexed`
    };
  }
});

// ============================================================================
// RUN
// ============================================================================

runTests();
