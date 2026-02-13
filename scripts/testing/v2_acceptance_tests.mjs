#!/usr/bin/env node
/**
 * V2 Database Acceptance Tests
 *
 * Tests V2 schemas (source.*, ops.*, sot.*) for:
 *   - Schema integrity
 *   - Data Engine functions
 *   - Entity linking
 *   - Workflow data migration
 *   - API compatibility
 *
 * Usage:
 *   DATABASE_URL=<V2_URL> node scripts/testing/v2_acceptance_tests.mjs
 */

import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 30000,
});

const tests = [];
let passCount = 0;
let failCount = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

async function runTests() {
  console.log('\n========================================');
  console.log('V2 Database Acceptance Tests');
  console.log('========================================\n');

  for (const { name, fn } of tests) {
    try {
      const result = await fn();
      if (result.pass) {
        console.log(`✅ ${name}`);
        if (result.details) console.log(`   ${result.details}`);
        passCount++;
      } else {
        console.log(`❌ ${name}`);
        console.log(`   ${result.message}`);
        if (result.details) console.log(`   ${result.details}`);
        failCount++;
      }
    } catch (err) {
      console.log(`❌ ${name}`);
      console.log(`   Error: ${err.message}`);
      failCount++;
    }
  }

  console.log('\n========================================');
  console.log(`Results: ${passCount} passed, ${failCount} failed`);
  console.log('========================================\n');

  await pool.end();
  process.exit(failCount > 0 ? 1 : 0);
}

// ============================================================================
// SECTION 1: V2 Schema Existence
// ============================================================================

test('Schema: source exists', async () => {
  const result = await pool.query(`
    SELECT 1 FROM information_schema.schemata WHERE schema_name = 'source' LIMIT 1
  `);
  return { pass: result.rows.length > 0, message: 'source schema missing' };
});

test('Schema: ops exists', async () => {
  const result = await pool.query(`
    SELECT 1 FROM information_schema.schemata WHERE schema_name = 'ops' LIMIT 1
  `);
  return { pass: result.rows.length > 0, message: 'ops schema missing' };
});

test('Schema: sot exists', async () => {
  const result = await pool.query(`
    SELECT 1 FROM information_schema.schemata WHERE schema_name = 'sot' LIMIT 1
  `);
  return { pass: result.rows.length > 0, message: 'sot schema missing' };
});

// ============================================================================
// SECTION 2: Core Tables Exist
// ============================================================================

test('Table: sot.people exists', async () => {
  const result = await pool.query(`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'sot' AND table_name = 'people' LIMIT 1
  `);
  return { pass: result.rows.length > 0, message: 'sot.people table missing' };
});

test('Table: sot.cats exists', async () => {
  const result = await pool.query(`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'sot' AND table_name = 'cats' LIMIT 1
  `);
  return { pass: result.rows.length > 0, message: 'sot.cats table missing' };
});

test('Table: sot.places exists', async () => {
  const result = await pool.query(`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'sot' AND table_name = 'places' LIMIT 1
  `);
  return { pass: result.rows.length > 0, message: 'sot.places table missing' };
});

test('Table: ops.appointments exists', async () => {
  const result = await pool.query(`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'ops' AND table_name = 'appointments' LIMIT 1
  `);
  return { pass: result.rows.length > 0, message: 'ops.appointments table missing' };
});

test('Table: ops.requests exists', async () => {
  const result = await pool.query(`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'ops' AND table_name = 'requests' LIMIT 1
  `);
  return { pass: result.rows.length > 0, message: 'ops.requests table missing' };
});

test('Table: ops.intake_submissions exists', async () => {
  const result = await pool.query(`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'ops' AND table_name = 'intake_submissions' LIMIT 1
  `);
  return { pass: result.rows.length > 0, message: 'ops.intake_submissions table missing' };
});

test('Table: ops.journal_entries exists', async () => {
  const result = await pool.query(`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'ops' AND table_name = 'journal_entries' LIMIT 1
  `);
  return { pass: result.rows.length > 0, message: 'ops.journal_entries table missing' };
});

test('Table: ops.clinic_accounts exists', async () => {
  const result = await pool.query(`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'ops' AND table_name = 'clinic_accounts' LIMIT 1
  `);
  return { pass: result.rows.length > 0, message: 'ops.clinic_accounts table missing' };
});

// ============================================================================
// SECTION 3: Data Engine Functions Exist
// ============================================================================

test('Function: sot.find_or_create_person exists', async () => {
  const result = await pool.query(`
    SELECT 1 FROM information_schema.routines
    WHERE routine_schema = 'sot' AND routine_name = 'find_or_create_person' LIMIT 1
  `);
  return { pass: result.rows.length > 0, message: 'sot.find_or_create_person function missing' };
});

test('Function: sot.find_or_create_place_deduped exists', async () => {
  const result = await pool.query(`
    SELECT 1 FROM information_schema.routines
    WHERE routine_schema = 'sot' AND routine_name = 'find_or_create_place_deduped' LIMIT 1
  `);
  return { pass: result.rows.length > 0, message: 'sot.find_or_create_place_deduped function missing' };
});

test('Function: sot.find_or_create_cat_by_microchip exists', async () => {
  const result = await pool.query(`
    SELECT 1 FROM information_schema.routines
    WHERE routine_schema = 'sot' AND routine_name = 'find_or_create_cat_by_microchip' LIMIT 1
  `);
  return { pass: result.rows.length > 0, message: 'sot.find_or_create_cat_by_microchip function missing' };
});

test('Function: sot.should_be_person exists', async () => {
  const result = await pool.query(`
    SELECT 1 FROM information_schema.routines
    WHERE routine_schema = 'sot' AND routine_name = 'should_be_person' LIMIT 1
  `);
  return { pass: result.rows.length > 0, message: 'sot.should_be_person function missing' };
});

test('Function: sot.classify_owner_name exists', async () => {
  const result = await pool.query(`
    SELECT 1 FROM information_schema.routines
    WHERE routine_schema = 'sot' AND routine_name = 'classify_owner_name' LIMIT 1
  `);
  return { pass: result.rows.length > 0, message: 'sot.classify_owner_name function missing' };
});

test('Function: sot.data_engine_score_candidates exists', async () => {
  const result = await pool.query(`
    SELECT 1 FROM information_schema.routines
    WHERE routine_schema = 'sot' AND routine_name = 'data_engine_score_candidates' LIMIT 1
  `);
  return { pass: result.rows.length > 0, message: 'sot.data_engine_score_candidates function missing' };
});

// ============================================================================
// SECTION 4: Entity Linking Functions Exist
// ============================================================================

test('Function: sot.link_appointments_to_cats exists', async () => {
  const result = await pool.query(`
    SELECT 1 FROM information_schema.routines
    WHERE routine_schema = 'sot' AND routine_name = 'link_appointments_to_cats' LIMIT 1
  `);
  return { pass: result.rows.length > 0, message: 'sot.link_appointments_to_cats function missing' };
});

test('Function: sot.link_appointments_to_people exists', async () => {
  const result = await pool.query(`
    SELECT 1 FROM information_schema.routines
    WHERE routine_schema = 'sot' AND routine_name = 'link_appointments_to_people' LIMIT 1
  `);
  return { pass: result.rows.length > 0, message: 'sot.link_appointments_to_people function missing' };
});

test('Function: sot.link_appointments_to_places exists', async () => {
  const result = await pool.query(`
    SELECT 1 FROM information_schema.routines
    WHERE routine_schema = 'sot' AND routine_name = 'link_appointments_to_places' LIMIT 1
  `);
  return { pass: result.rows.length > 0, message: 'sot.link_appointments_to_places function missing' };
});

// ============================================================================
// SECTION 5: Workflow Functions Exist
// ============================================================================

test('Function: sot.convert_intake_to_request exists', async () => {
  const result = await pool.query(`
    SELECT 1 FROM information_schema.routines
    WHERE routine_schema = 'sot' AND routine_name = 'convert_intake_to_request' LIMIT 1
  `);
  return { pass: result.rows.length > 0, message: 'sot.convert_intake_to_request function missing' };
});

test('Function: sot.match_intake_to_person exists', async () => {
  const result = await pool.query(`
    SELECT 1 FROM information_schema.routines
    WHERE routine_schema = 'sot' AND routine_name = 'match_intake_to_person' LIMIT 1
  `);
  return { pass: result.rows.length > 0, message: 'sot.match_intake_to_person function missing' };
});

test('Function: sot.link_intake_to_place exists', async () => {
  const result = await pool.query(`
    SELECT 1 FROM information_schema.routines
    WHERE routine_schema = 'sot' AND routine_name = 'link_intake_to_place' LIMIT 1
  `);
  return { pass: result.rows.length > 0, message: 'sot.link_intake_to_place function missing' };
});

// ============================================================================
// SECTION 6: Data Counts Verification
// ============================================================================

test('Data: Cats count > 30,000', async () => {
  const result = await pool.query(`SELECT COUNT(*) as count FROM sot.cats WHERE merged_into_cat_id IS NULL`);
  const count = parseInt(result.rows[0].count);
  return {
    pass: count > 30000,
    message: `Expected > 30,000 cats, found ${count}`,
    details: `${count} cats`
  };
});

test('Data: People count > 5,000', async () => {
  const result = await pool.query(`SELECT COUNT(*) as count FROM sot.people WHERE merged_into_person_id IS NULL`);
  const count = parseInt(result.rows[0].count);
  return {
    pass: count > 5000,
    message: `Expected > 5,000 people, found ${count}`,
    details: `${count} people`
  };
});

test('Data: Places count > 7,000', async () => {
  const result = await pool.query(`SELECT COUNT(*) as count FROM sot.places WHERE merged_into_place_id IS NULL`);
  const count = parseInt(result.rows[0].count);
  return {
    pass: count > 7000,
    message: `Expected > 7,000 places, found ${count}`,
    details: `${count} places`
  };
});

test('Data: Appointments count > 30,000', async () => {
  const result = await pool.query(`SELECT COUNT(*) as count FROM ops.appointments`);
  const count = parseInt(result.rows[0].count);
  return {
    pass: count > 30000,
    message: `Expected > 30,000 appointments, found ${count}`,
    details: `${count} appointments`
  };
});

test('Data: Requests match V1 (291)', async () => {
  const result = await pool.query(`SELECT COUNT(*) as count FROM ops.requests`);
  const count = parseInt(result.rows[0].count);
  return {
    pass: count === 291,
    message: `Expected 291 requests (V1 match), found ${count}`,
    details: `${count} requests`
  };
});

test('Data: Intakes match V1 (1212)', async () => {
  const result = await pool.query(`SELECT COUNT(*) as count FROM ops.intake_submissions`);
  const count = parseInt(result.rows[0].count);
  return {
    pass: count >= 1212,
    message: `Expected >= 1212 intakes (V1 match), found ${count}`,
    details: `${count} intakes`
  };
});

test('Data: Journals match V1 (1916)', async () => {
  const result = await pool.query(`SELECT COUNT(*) as count FROM ops.journal_entries`);
  const count = parseInt(result.rows[0].count);
  return {
    pass: count >= 1916,
    message: `Expected >= 1916 journals (V1 match), found ${count}`,
    details: `${count} journals`
  };
});

// ============================================================================
// SECTION 7: Entity Linking Coverage
// ============================================================================

test('Linking: >95% appointments have cat_id', async () => {
  const result = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE cat_id IS NOT NULL) * 100.0 / NULLIF(COUNT(*), 0) as pct
    FROM ops.appointments
  `);
  const pct = parseFloat(result.rows[0].pct || 0);
  return {
    pass: pct > 95,
    message: `Expected > 95% linked, found ${pct.toFixed(1)}%`,
    details: `${pct.toFixed(1)}% appointments linked to cats`
  };
});

test('Linking: >90% appointments have person_id', async () => {
  const result = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE person_id IS NOT NULL) * 100.0 / NULLIF(COUNT(*), 0) as pct
    FROM ops.appointments
  `);
  const pct = parseFloat(result.rows[0].pct || 0);
  return {
    pass: pct > 90,
    message: `Expected > 90% linked, found ${pct.toFixed(1)}%`,
    details: `${pct.toFixed(1)}% appointments linked to people`
  };
});

test('Linking: >90% appointments have place_id', async () => {
  const result = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE inferred_place_id IS NOT NULL) * 100.0 / NULLIF(COUNT(*), 0) as pct
    FROM ops.appointments
  `);
  const pct = parseFloat(result.rows[0].pct || 0);
  return {
    pass: pct > 90,
    message: `Expected > 90% linked, found ${pct.toFixed(1)}%`,
    details: `${pct.toFixed(1)}% appointments linked to places`
  };
});

// ============================================================================
// SECTION 8: Clinic Accounts (Pseudo-Profiles)
// ============================================================================

test('Clinic Accounts: Has organization entries', async () => {
  const result = await pool.query(`
    SELECT COUNT(*) as count FROM ops.clinic_accounts WHERE account_type = 'organization'
  `);
  const count = parseInt(result.rows[0].count);
  return {
    pass: count > 1000,
    message: `Expected > 1000 org accounts, found ${count}`,
    details: `${count} organization pseudo-profiles`
  };
});

test('Clinic Accounts: Has site_name entries', async () => {
  const result = await pool.query(`
    SELECT COUNT(*) as count FROM ops.clinic_accounts WHERE account_type = 'site_name'
  `);
  const count = parseInt(result.rows[0].count);
  return {
    pass: count > 500,
    message: `Expected > 500 site_name accounts, found ${count}`,
    details: `${count} site_name pseudo-profiles`
  };
});

test('Clinic Accounts: Has address entries', async () => {
  const result = await pool.query(`
    SELECT COUNT(*) as count FROM ops.clinic_accounts WHERE account_type = 'address'
  `);
  const count = parseInt(result.rows[0].count);
  return {
    pass: count > 400,
    message: `Expected > 400 address accounts, found ${count}`,
    details: `${count} address pseudo-profiles`
  };
});

// ============================================================================
// SECTION 9: Soft Blacklist
// ============================================================================

test('Soft Blacklist: Has entries', async () => {
  const result = await pool.query(`SELECT COUNT(*) as count FROM sot.soft_blacklist`);
  const count = parseInt(result.rows[0].count);
  return {
    pass: count > 20,
    message: `Expected > 20 soft blacklist entries, found ${count}`,
    details: `${count} soft blacklist entries`
  };
});

// ============================================================================
// SECTION 10: Views for UI
// ============================================================================

test('View: ops.v_intake_triage_queue exists', async () => {
  const result = await pool.query(`
    SELECT 1 FROM information_schema.views
    WHERE table_schema = 'ops' AND table_name = 'v_intake_triage_queue' LIMIT 1
  `);
  return { pass: result.rows.length > 0, message: 'ops.v_intake_triage_queue view missing' };
});

test('View: ops.v_active_requests exists', async () => {
  const result = await pool.query(`
    SELECT 1 FROM information_schema.views
    WHERE table_schema = 'ops' AND table_name = 'v_active_requests' LIMIT 1
  `);
  return { pass: result.rows.length > 0, message: 'ops.v_active_requests view missing' };
});

// ============================================================================
// SECTION 11: Relationship Tables
// ============================================================================

test('Table: sot.cat_place has data', async () => {
  const result = await pool.query(`SELECT COUNT(*) as count FROM sot.cat_place`);
  const count = parseInt(result.rows[0].count);
  return {
    pass: count > 30000,
    message: `Expected > 30,000 cat-place links, found ${count}`,
    details: `${count} cat-place relationships`
  };
});

test('Table: sot.person_cat has data', async () => {
  const result = await pool.query(`SELECT COUNT(*) as count FROM sot.person_cat`);
  const count = parseInt(result.rows[0].count);
  return {
    pass: count > 30000,
    message: `Expected > 30,000 person-cat links, found ${count}`,
    details: `${count} person-cat relationships`
  };
});

test('Table: sot.person_place has data', async () => {
  const result = await pool.query(`SELECT COUNT(*) as count FROM sot.person_place`);
  const count = parseInt(result.rows[0].count);
  return {
    pass: count > 8000,
    message: `Expected > 8,000 person-place links, found ${count}`,
    details: `${count} person-place relationships`
  };
});

// ============================================================================
// SECTION 12: Auth Infrastructure
// ============================================================================

test('Table: ops.staff exists', async () => {
  const result = await pool.query(`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'ops' AND table_name = 'staff' LIMIT 1
  `);
  return { pass: result.rows.length > 0, message: 'ops.staff table missing' };
});

test('Data: Staff has entries', async () => {
  const result = await pool.query(`SELECT COUNT(*) as count FROM ops.staff WHERE is_active = true`);
  const count = parseInt(result.rows[0].count);
  return {
    pass: count > 0,
    message: `Expected active staff, found ${count}`,
    details: `${count} active staff members`
  };
});

// ============================================================================
// SECTION 13: Audit Trail
// ============================================================================

test('Table: sot.entity_edits exists', async () => {
  const result = await pool.query(`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'sot' AND table_name = 'entity_edits' LIMIT 1
  `);
  return { pass: result.rows.length > 0, message: 'sot.entity_edits table missing' };
});

test('Table: ops.request_media exists', async () => {
  const result = await pool.query(`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'ops' AND table_name = 'request_media' LIMIT 1
  `);
  return { pass: result.rows.length > 0, message: 'ops.request_media table missing' };
});

// Run all tests
runTests();
