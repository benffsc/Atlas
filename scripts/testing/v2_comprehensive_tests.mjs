#!/usr/bin/env node
/**
 * V2 Comprehensive Database Tests
 *
 * Tests V2 schemas (source.*, ops.*, sot.*, beacon.*) for:
 *   - Schema integrity and table existence
 *   - V2 invariant compliance (INV-1 through INV-35)
 *   - Data Engine functions
 *   - Search functions (MIG_2308)
 *   - Entity linking coverage
 *   - API view compatibility
 *   - Data quality filters (INV-13)
 *
 * Usage:
 *   node scripts/testing/v2_comprehensive_tests.mjs
 *
 * Exit codes:
 *   0 = All tests passed
 *   1 = Some tests failed (see output for details)
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
let warnCount = 0;

function test(name, fn, severity = 'error') {
  tests.push({ name, fn, severity });
}

async function runTests() {
  console.log('\n========================================');
  console.log('V2 Comprehensive Database Tests');
  console.log('========================================\n');

  for (const { name, fn, severity } of tests) {
    try {
      const result = await fn();
      if (result.pass) {
        console.log(`✅ ${name}`);
        if (result.details) console.log(`   ${result.details}`);
        passCount++;
      } else if (severity === 'warn') {
        console.log(`⚠️  ${name}`);
        console.log(`   ${result.message}`);
        if (result.details) console.log(`   ${result.details}`);
        warnCount++;
      } else {
        console.log(`❌ ${name}`);
        console.log(`   ${result.message}`);
        if (result.details) console.log(`   ${result.details}`);
        failCount++;
      }
    } catch (err) {
      if (severity === 'warn') {
        console.log(`⚠️  ${name}`);
        console.log(`   Error: ${err.message}`);
        warnCount++;
      } else {
        console.log(`❌ ${name}`);
        console.log(`   Error: ${err.message}`);
        failCount++;
      }
    }
  }

  console.log('\n========================================');
  console.log(`Results: ${passCount} passed, ${warnCount} warnings, ${failCount} failed`);
  console.log('========================================\n');

  await pool.end();
  process.exit(failCount > 0 ? 1 : 0);
}

// ============================================================================
// SECTION 1: V2 Schema Structure
// ============================================================================

console.log('\n--- Section 1: V2 Schema Structure ---');

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

test('Schema: beacon exists', async () => {
  const result = await pool.query(`
    SELECT 1 FROM information_schema.schemata WHERE schema_name = 'beacon' LIMIT 1
  `);
  return { pass: result.rows.length > 0, message: 'beacon schema missing' };
});

test('Schema: quarantine exists', async () => {
  const result = await pool.query(`
    SELECT 1 FROM information_schema.schemata WHERE schema_name = 'quarantine' LIMIT 1
  `);
  return { pass: result.rows.length > 0, message: 'quarantine schema missing' };
});

// ============================================================================
// SECTION 2: Core Entity Tables
// ============================================================================

console.log('\n--- Section 2: Core Entity Tables ---');

test('Table: sot.cats exists with correct columns', async () => {
  const result = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'sot' AND table_name = 'cats'
      AND column_name IN ('cat_id', 'name', 'merged_into_cat_id', 'data_quality')
  `);
  return {
    pass: result.rows.length >= 3,
    message: `Expected 3+ key columns, found ${result.rows.length}`,
    details: result.rows.map(r => r.column_name).join(', ')
  };
});

test('Table: sot.people exists with correct columns', async () => {
  const result = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'sot' AND table_name = 'people'
      AND column_name IN ('person_id', 'display_name', 'merged_into_person_id', 'data_quality')
  `);
  return {
    pass: result.rows.length >= 3,
    message: `Expected 3+ key columns, found ${result.rows.length}`
  };
});

test('Table: sot.places exists with correct columns', async () => {
  const result = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'sot' AND table_name = 'places'
      AND column_name IN ('place_id', 'display_name', 'merged_into_place_id', 'quality_tier')
  `);
  return {
    pass: result.rows.length >= 3,
    message: `Expected 3+ key columns, found ${result.rows.length}`
  };
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

// ============================================================================
// SECTION 3: V2 Relationship Tables (INV-27)
// ============================================================================

console.log('\n--- Section 3: Relationship Tables ---');

test('Table: sot.cat_place exists (V2 naming)', async () => {
  const result = await pool.query(`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'sot' AND table_name = 'cat_place' LIMIT 1
  `);
  return { pass: result.rows.length > 0, message: 'sot.cat_place table missing' };
});

test('Table: sot.person_cat exists (V2 naming)', async () => {
  const result = await pool.query(`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'sot' AND table_name = 'person_cat' LIMIT 1
  `);
  return { pass: result.rows.length > 0, message: 'sot.person_cat table missing' };
});

test('Table: sot.person_place exists (V2 naming)', async () => {
  const result = await pool.query(`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'sot' AND table_name = 'person_place' LIMIT 1
  `);
  return { pass: result.rows.length > 0, message: 'sot.person_place table missing' };
});

test('INV-27: Relationship tables have NO is_active column', async () => {
  const result = await pool.query(`
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'sot'
      AND table_name IN ('cat_place', 'person_cat', 'person_place')
      AND column_name = 'is_active'
  `);
  return {
    pass: result.rows.length === 0,
    message: `Found is_active column in: ${result.rows.map(r => r.table_name).join(', ')}`,
    details: 'INV-27: Use merged_into_*_id filters instead'
  };
});

// ============================================================================
// SECTION 4: Search Functions (MIG_2308)
// ============================================================================

console.log('\n--- Section 4: Search Functions ---');

test('Function: sot.search_unified exists', async () => {
  const result = await pool.query(`
    SELECT 1 FROM information_schema.routines
    WHERE routine_schema = 'sot' AND routine_name = 'search_unified' LIMIT 1
  `);
  return { pass: result.rows.length > 0, message: 'sot.search_unified function missing (need MIG_2308)' };
});

test('Function: sot.search_suggestions exists', async () => {
  const result = await pool.query(`
    SELECT 1 FROM information_schema.routines
    WHERE routine_schema = 'sot' AND routine_name = 'search_suggestions' LIMIT 1
  `);
  return { pass: result.rows.length > 0, message: 'sot.search_suggestions function missing' };
});

test('Function: sot.search_unified_counts exists', async () => {
  const result = await pool.query(`
    SELECT 1 FROM information_schema.routines
    WHERE routine_schema = 'sot' AND routine_name = 'search_unified_counts' LIMIT 1
  `);
  return { pass: result.rows.length > 0, message: 'sot.search_unified_counts function missing' };
});

test('Search: search_unified returns results', async () => {
  const result = await pool.query(`
    SELECT COUNT(*) as cnt FROM sot.search_unified('petaluma', 'place', 10, 0)
  `);
  const count = parseInt(result.rows[0].cnt);
  return {
    pass: count > 0,
    message: `Expected results for "petaluma", found ${count}`,
    details: `${count} results`
  };
});

// ============================================================================
// SECTION 5: Data Engine Functions
// ============================================================================

console.log('\n--- Section 5: Data Engine Functions ---');

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

test('Function: sot.should_be_person exists (INV-25)', async () => {
  const result = await pool.query(`
    SELECT 1 FROM information_schema.routines
    WHERE routine_schema = 'sot' AND routine_name = 'should_be_person' LIMIT 1
  `);
  return { pass: result.rows.length > 0, message: 'sot.should_be_person function missing (INV-25)' };
});

test('Function: sot.classify_owner_name exists', async () => {
  const result = await pool.query(`
    SELECT 1 FROM information_schema.routines
    WHERE routine_schema = 'sot' AND routine_name = 'classify_owner_name' LIMIT 1
  `);
  return { pass: result.rows.length > 0, message: 'sot.classify_owner_name function missing' };
});

// ============================================================================
// SECTION 6: Data Counts
// ============================================================================

console.log('\n--- Section 6: Data Counts ---');

test('Data: Cats count > 30,000', async () => {
  const result = await pool.query(`SELECT COUNT(*) as count FROM sot.cats WHERE merged_into_cat_id IS NULL`);
  const count = parseInt(result.rows[0].count);
  return {
    pass: count > 30000,
    message: `Expected > 30,000 cats, found ${count}`,
    details: `${count.toLocaleString()} cats`
  };
});

test('Data: People count > 5,000', async () => {
  const result = await pool.query(`SELECT COUNT(*) as count FROM sot.people WHERE merged_into_person_id IS NULL`);
  const count = parseInt(result.rows[0].count);
  return {
    pass: count > 5000,
    message: `Expected > 5,000 people, found ${count}`,
    details: `${count.toLocaleString()} people`
  };
});

test('Data: Places count > 7,000', async () => {
  const result = await pool.query(`SELECT COUNT(*) as count FROM sot.places WHERE merged_into_place_id IS NULL`);
  const count = parseInt(result.rows[0].count);
  return {
    pass: count > 7000,
    message: `Expected > 7,000 places, found ${count}`,
    details: `${count.toLocaleString()} places`
  };
});

test('Data: Appointments count > 30,000', async () => {
  const result = await pool.query(`SELECT COUNT(*) as count FROM ops.appointments`);
  const count = parseInt(result.rows[0].count);
  return {
    pass: count > 30000,
    message: `Expected > 30,000 appointments, found ${count}`,
    details: `${count.toLocaleString()} appointments`
  };
});

// ============================================================================
// SECTION 7: Entity Linking Coverage
// ============================================================================

console.log('\n--- Section 7: Entity Linking ---');

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
// SECTION 8: Data Integrity
// ============================================================================

console.log('\n--- Section 8: Data Integrity ---');

test('Integrity: No orphan cat_place relationships', async () => {
  const result = await pool.query(`
    SELECT COUNT(*) as count
    FROM sot.cat_place cp
    LEFT JOIN sot.cats c ON c.cat_id = cp.cat_id
    WHERE c.cat_id IS NULL
  `);
  const count = parseInt(result.rows[0].count);
  return {
    pass: count === 0,
    message: `Found ${count} orphan cat_place rows`,
    details: count === 0 ? 'No orphans' : `${count} orphan relationships`
  };
});

test('Integrity: No broken cat merge chains', async () => {
  const result = await pool.query(`
    SELECT COUNT(*) as count
    FROM sot.cats c
    WHERE c.merged_into_cat_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM sot.cats c2 WHERE c2.cat_id = c.merged_into_cat_id)
  `);
  const count = parseInt(result.rows[0].count);
  return { pass: count === 0, message: `${count} cats with broken merge chains` };
});

test('Integrity: No broken place merge chains', async () => {
  const result = await pool.query(`
    SELECT COUNT(*) as count
    FROM sot.places p
    WHERE p.merged_into_place_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM sot.places p2 WHERE p2.place_id = p.merged_into_place_id)
  `);
  const count = parseInt(result.rows[0].count);
  return { pass: count === 0, message: `${count} places with broken merge chains` };
});

// ============================================================================
// SECTION 9: INV-13 - Data Quality Filtering
// ============================================================================

console.log('\n--- Section 9: INV-13 Data Quality ---');

test('INV-13: Map view filters garbage/needs_review', async () => {
  const result = await pool.query(`
    SELECT
      CASE
        WHEN definition ILIKE '%garbage%' OR definition ILIKE '%needs_review%' THEN true
        ELSE false
      END as has_filter
    FROM pg_views
    WHERE schemaname = 'ops' AND viewname = 'v_map_atlas_pins'
  `);
  return {
    pass: result.rows.length > 0 && result.rows[0].has_filter,
    message: 'v_map_atlas_pins missing data_quality filter'
  };
});

test('INV-13: search_unified filters garbage data', async () => {
  // The function definition should include data_quality filter
  const result = await pool.query(`
    SELECT prosrc FROM pg_proc
    WHERE proname = 'search_unified' AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'sot')
  `);
  const hasFilter = result.rows.length > 0 &&
    (result.rows[0].prosrc.includes('garbage') || result.rows[0].prosrc.includes('needs_review'));
  return {
    pass: hasFilter,
    message: 'sot.search_unified missing INV-13 data_quality filter'
  };
});

// ============================================================================
// SECTION 10: API Views
// ============================================================================

console.log('\n--- Section 10: API Views ---');

test('View: ops.v_map_atlas_pins exists', async () => {
  const result = await pool.query(`
    SELECT 1 FROM information_schema.views
    WHERE table_schema = 'ops' AND table_name = 'v_map_atlas_pins' LIMIT 1
  `);
  return { pass: result.rows.length > 0, message: 'ops.v_map_atlas_pins view missing' };
});

test('View: ops.v_request_list exists', async () => {
  const result = await pool.query(`
    SELECT 1 FROM information_schema.views
    WHERE table_schema = 'ops' AND table_name = 'v_request_list' LIMIT 1
  `);
  return { pass: result.rows.length > 0, message: 'ops.v_request_list view missing' };
});

test('View: ops.v_intake_triage_queue exists', async () => {
  const result = await pool.query(`
    SELECT 1 FROM information_schema.views
    WHERE table_schema = 'ops' AND table_name = 'v_intake_triage_queue' LIMIT 1
  `);
  return { pass: result.rows.length > 0, message: 'ops.v_intake_triage_queue view missing' };
});

test('View: sot.v_cat_detail exists', async () => {
  const result = await pool.query(`
    SELECT 1 FROM information_schema.views
    WHERE table_schema = 'sot' AND table_name = 'v_cat_detail' LIMIT 1
  `);
  return { pass: result.rows.length > 0, message: 'sot.v_cat_detail view missing' };
});

test('View: sot.v_place_detail_v2 exists', async () => {
  const result = await pool.query(`
    SELECT 1 FROM information_schema.views
    WHERE table_schema = 'sot' AND table_name = 'v_place_detail_v2' LIMIT 1
  `);
  return { pass: result.rows.length > 0, message: 'sot.v_place_detail_v2 view missing' };
});

// ============================================================================
// SECTION 11: Disease Tracking (MIG_2303/2304)
// ============================================================================

console.log('\n--- Section 11: Disease Tracking ---');

test('Disease: Map pins include disease tracking', async () => {
  const result = await pool.query(`
    SELECT COUNT(*) as cnt FROM ops.v_map_atlas_pins WHERE disease_count > 0 OR disease_badges IS NOT NULL
  `);
  const count = parseInt(result.rows[0].cnt);
  return {
    pass: count > 0,
    message: `Expected places with disease info, found ${count}`,
    details: `${count} places have disease tracking`
  };
});

test('Disease: Soft blacklist table exists', async () => {
  const result = await pool.query(`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'sot' AND table_name = 'place_soft_blacklist' LIMIT 1
  `);
  return { pass: result.rows.length > 0, message: 'sot.place_soft_blacklist table missing' };
});

// ============================================================================
// SECTION 12: Soft Blacklist (INV-23)
// ============================================================================

console.log('\n--- Section 12: Soft Blacklist ---');

test('INV-23: Soft blacklist has entries', async () => {
  const result = await pool.query(`SELECT COUNT(*) as count FROM sot.soft_blacklist`);
  const count = parseInt(result.rows[0].count);
  return {
    pass: count > 20,
    message: `Expected > 20 soft blacklist entries, found ${count}`,
    details: `${count} soft blacklist entries (org emails, shared identifiers)`
  };
});

// ============================================================================
// SECTION 13: Storage (Photos)
// ============================================================================

console.log('\n--- Section 13: Storage ---');

test('Storage: request-media bucket exists', async () => {
  const result = await pool.query(`
    SELECT 1 FROM storage.buckets WHERE id = 'request-media' LIMIT 1
  `);
  return { pass: result.rows.length > 0, message: 'request-media bucket missing' };
});

test('Storage: Cat photos exist', async () => {
  const result = await pool.query(`
    SELECT COUNT(*) as cnt FROM storage.objects
    WHERE bucket_id = 'request-media' AND name LIKE 'cats/%'
  `);
  const count = parseInt(result.rows[0].cnt);
  return {
    pass: count > 100,
    message: `Expected > 100 cat photos, found ${count}`,
    details: `${count} cat photos`
  };
}, 'warn');

// ============================================================================
// SECTION 14: Auth Infrastructure
// ============================================================================

console.log('\n--- Section 14: Auth ---');

test('Auth: ops.staff table exists', async () => {
  const result = await pool.query(`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'ops' AND table_name = 'staff' LIMIT 1
  `);
  return { pass: result.rows.length > 0, message: 'ops.staff table missing' };
});

test('Auth: Active staff members exist', async () => {
  const result = await pool.query(`SELECT COUNT(*) as count FROM ops.staff WHERE is_active = true`);
  const count = parseInt(result.rows[0].count);
  return {
    pass: count > 0,
    message: `Expected active staff, found ${count}`,
    details: `${count} active staff members`
  };
});

// Run all tests
runTests();
