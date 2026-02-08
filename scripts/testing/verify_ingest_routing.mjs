#!/usr/bin/env node
/**
 * Ingest Routing Verification
 *
 * Verifies that the data ingest pipeline is correctly routing data through
 * centralized functions and the Fellegi-Sunter identity resolution system.
 *
 * Run: node scripts/testing/verify_ingest_routing.mjs
 */

import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

const results = { passed: 0, failed: 0, warnings: 0 };

async function test(name, query, validator) {
  try {
    const { rows } = await pool.query(query);
    const result = validator(rows);
    if (result.pass) {
      console.log(`✅ ${name}`);
      results.passed++;
    } else if (result.warn) {
      console.log(`⚠️  ${name}`);
      console.log(`   ${result.message}`);
      results.warnings++;
    } else {
      console.log(`❌ ${name}`);
      console.log(`   ${result.message}`);
      results.failed++;
    }
  } catch (err) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${err.message}`);
    results.failed++;
  }
}

console.log('');
console.log('========================================');
console.log('Ingest Routing Verification');
console.log('========================================');
console.log('');

console.log('--- 1. Centralized Function Usage ---');
console.log('');

// Check that find_or_create_person exists and is being used
await test(
  'find_or_create_person function exists',
  `SELECT proname FROM pg_proc p
   JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname = 'trapper' AND proname = 'find_or_create_person'`,
  (rows) => rows.length > 0
    ? { pass: true }
    : { pass: false, message: 'Function not found' }
);

// Check that data_engine_resolve_identity uses F-S scoring (at least one overload)
await test(
  'data_engine_resolve_identity uses Fellegi-Sunter scoring',
  `SELECT pg_get_functiondef(p.oid) as def
   FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname = 'trapper' AND proname = 'data_engine_resolve_identity'`,
  (rows) => {
    if (rows.length === 0) return { pass: false, message: 'Function not found' };
    // Check if ANY overload uses F-S scoring
    const hasFS = rows.some(row => row.def.toLowerCase().includes('score_candidates_fs'));
    if (hasFS) {
      return { pass: true };
    }
    return { pass: false, message: 'No function overload references F-S scoring' };
  }
);

console.log('');
console.log('--- 2. F-S Configuration Active ---');
console.log('');

// Check F-S parameters are configured
await test(
  'Fellegi-Sunter parameters are configured',
  `SELECT COUNT(*) as cnt FROM trapper.fellegi_sunter_parameters WHERE is_active`,
  (rows) => rows[0].cnt >= 5
    ? { pass: true }
    : { pass: false, message: `Only ${rows[0].cnt} active parameters (need 5+)` }
);

// Check F-S thresholds are configured
await test(
  'Fellegi-Sunter thresholds are configured',
  `SELECT COUNT(*) as cnt FROM trapper.fellegi_sunter_thresholds WHERE is_active`,
  (rows) => rows[0].cnt >= 1
    ? { pass: true }
    : { pass: false, message: `No active thresholds configured` }
);

// Check threshold values are sensible (log-odds scale: upper ~15, lower ~2)
await test(
  'F-S thresholds have valid values',
  `SELECT upper_threshold, lower_threshold FROM trapper.fellegi_sunter_thresholds WHERE is_active LIMIT 1`,
  (rows) => {
    if (rows.length === 0) return { pass: false, message: 'No thresholds' };
    const upper = parseFloat(rows[0].upper_threshold);
    const lower = parseFloat(rows[0].lower_threshold);
    if (upper > lower && upper > 0 && lower >= -10) {
      return { pass: true };
    }
    return { pass: false, message: `Invalid thresholds: upper=${upper}, lower=${lower}` };
  }
);

console.log('');
console.log('--- 3. Identity Graph Active ---');
console.log('');

// Check identity_edges table exists and has data
await test(
  'Identity edges table exists and has data',
  `SELECT COUNT(*) as cnt FROM trapper.identity_edges`,
  (rows) => rows[0].cnt > 0
    ? { pass: true }
    : { warn: true, message: `Table exists but has ${rows[0].cnt} edges` }
);

// Check merge triggers are active
await test(
  'Person merge trigger is active',
  `SELECT tgname FROM pg_trigger WHERE tgname = 'trg_record_person_merge'`,
  (rows) => rows.length > 0
    ? { pass: true }
    : { pass: false, message: 'Trigger not found - merges will not be tracked' }
);

await test(
  'Place merge trigger is active',
  `SELECT tgname FROM pg_trigger WHERE tgname = 'trg_record_place_merge'`,
  (rows) => rows.length > 0
    ? { pass: true }
    : { pass: false, message: 'Trigger not found - merges will not be tracked' }
);

console.log('');
console.log('--- 4. Data Engine Processing ---');
console.log('');

// Check recent match decisions use F-S scoring
await test(
  'Recent match decisions include F-S scores',
  `SELECT
     COUNT(*) as total,
     COUNT(*) FILTER (WHERE fs_match_probability IS NOT NULL) as with_fs
   FROM trapper.data_engine_match_decisions
   WHERE processed_at > NOW() - INTERVAL '7 days'`,
  (rows) => {
    const { total, with_fs } = rows[0];
    if (total === 0) {
      return { warn: true, message: 'No decisions in last 7 days' };
    }
    const pct = (with_fs / total * 100).toFixed(1);
    if (pct > 0) {
      return { pass: true };
    }
    return { warn: true, message: `${pct}% of recent decisions have F-S scores` };
  }
);

// Check processing pipeline is running
await test(
  'Processing pipeline has recent activity',
  `SELECT MAX(processed_at) as last_processed FROM trapper.data_engine_match_decisions`,
  (rows) => {
    const lastProcessed = rows[0].last_processed;
    if (!lastProcessed) return { warn: true, message: 'No decisions found' };
    const hoursSince = (Date.now() - new Date(lastProcessed).getTime()) / (1000 * 60 * 60);
    if (hoursSince < 24) {
      return { pass: true };
    }
    return { warn: true, message: `Last decision was ${hoursSince.toFixed(0)} hours ago` };
  }
);

console.log('');
console.log('--- 5. No Stale References ---');
console.log('');

// Check no stale cat-place references
await test(
  'No cat_place_relationships pointing to merged places',
  `SELECT COUNT(*) as cnt FROM trapper.cat_place_relationships cpr
   JOIN trapper.places p ON p.place_id = cpr.place_id
   WHERE p.merged_into_place_id IS NOT NULL`,
  (rows) => parseInt(rows[0].cnt) === 0
    ? { pass: true }
    : { pass: false, message: `${rows[0].cnt} stale references found` }
);

// Check no stale person-place references
await test(
  'No person_place_relationships pointing to merged entities',
  `SELECT COUNT(*) as cnt FROM trapper.person_place_relationships ppr
   JOIN trapper.places p ON p.place_id = ppr.place_id
   WHERE p.merged_into_place_id IS NOT NULL`,
  (rows) => parseInt(rows[0].cnt) === 0
    ? { pass: true }
    : { pass: false, message: `${rows[0].cnt} stale place references found` }
);

// Check no stale appointment references
await test(
  'No appointments pointing to merged people',
  `SELECT COUNT(*) as cnt FROM trapper.sot_appointments a
   JOIN trapper.sot_people sp ON sp.person_id = a.person_id
   WHERE sp.merged_into_person_id IS NOT NULL`,
  (rows) => parseInt(rows[0].cnt) === 0
    ? { pass: true }
    : { pass: false, message: `${rows[0].cnt} stale references found` }
);

console.log('');
console.log('--- 6. Source System Processing ---');
console.log('');

// Check staged records processing by source
await test(
  'ClinicHQ staged records processing rate',
  `SELECT
     SUM(CASE WHEN is_processed THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0) * 100 as pct
   FROM trapper.staged_records WHERE source_system = 'clinichq'`,
  (rows) => {
    const pct = rows[0].pct;
    if (pct >= 99) return { pass: true };
    if (pct >= 95) return { warn: true, message: `${pct.toFixed(1)}% processed (target 99%+)` };
    return { pass: false, message: `Only ${pct?.toFixed(1) || 0}% processed` };
  }
);

await test(
  'ShelterLuv staged records processing rate',
  `SELECT
     SUM(CASE WHEN is_processed THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0) * 100 as pct
   FROM trapper.staged_records WHERE source_system = 'shelterluv'`,
  (rows) => {
    const pct = rows[0].pct;
    if (pct >= 90) return { pass: true };
    if (pct >= 80) return { warn: true, message: `${pct.toFixed(1)}% processed (target 90%+)` };
    return { pass: false, message: `Only ${pct?.toFixed(1) || 0}% processed` };
  }
);

await test(
  'PetLink staged records processing rate',
  `SELECT
     SUM(CASE WHEN is_processed THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0) * 100 as pct
   FROM trapper.staged_records WHERE source_system = 'petlink'`,
  (rows) => {
    const pct = rows[0].pct;
    if (pct >= 99) return { pass: true };
    if (pct >= 95) return { warn: true, message: `${pct.toFixed(1)}% processed (target 99%+)` };
    return { pass: false, message: `Only ${pct?.toFixed(1) || 0}% processed` };
  }
);

console.log('');
console.log('--- 7. Retroactive Change Handling ---');
console.log('');

// Check that geocoding uses normalized addresses
await test(
  'save_geocoding_result uses normalize_address',
  `SELECT pg_get_functiondef(p.oid) as def
   FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname = 'trapper' AND proname = 'save_geocoding_result'`,
  (rows) => {
    if (rows.length === 0) return { pass: false, message: 'Function not found' };
    const def = rows[0].def;
    if (def.includes('normalize_address')) {
      return { pass: true };
    }
    return { pass: false, message: 'Function does not use normalize_address (will create duplicates)' };
  }
);

// Check soft-blacklist is being used
await test(
  'Soft-blacklist table has entries',
  `SELECT COUNT(*) as cnt FROM trapper.data_engine_soft_blacklist`,
  (rows) => rows[0].cnt > 0
    ? { pass: true }
    : { warn: true, message: 'No soft-blacklist entries (shared identifiers not tracked)' }
);

console.log('');
console.log('========================================');
console.log(`Results: ${results.passed} passed, ${results.failed} failed, ${results.warnings} warnings`);
console.log('========================================');
console.log('');

await pool.end();
process.exit(results.failed > 0 ? 1 : 0);
