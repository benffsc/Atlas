#!/usr/bin/env node

/**
 * Data Integrity Edge Case Testing
 *
 * This script uses raw data to find edge cases and gaps that
 * automated functions may have missed. It tests:
 *
 * 1. Data linkage integrity
 * 2. Orphaned records
 * 3. Missing relationships
 * 4. Duplicate detection edge cases
 * 5. Context coverage gaps
 * 6. Entity resolution gaps
 *
 * Usage:
 *   node scripts/testing/data_integrity_edge_cases.mjs
 *   node scripts/testing/data_integrity_edge_cases.mjs --verbose
 */

import pg from "pg";
import dotenv from "dotenv";
import { parseArgs } from "util";

dotenv.config({ path: ".env.local" });

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const { values: args } = parseArgs({
  options: {
    verbose: { type: "boolean", short: "v", default: false },
  },
});

const TESTS = [];
const RESULTS = { passed: 0, failed: 0, warnings: 0, findings: [] };

function test(name, fn) {
  TESTS.push({ name, fn });
}

function warn(message, details = null) {
  RESULTS.warnings++;
  RESULTS.findings.push({ type: "warning", message, details });
  if (args.verbose && details) {
    console.log(`    Details: ${JSON.stringify(details).slice(0, 200)}`);
  }
}

function finding(message, details = null) {
  RESULTS.findings.push({ type: "finding", message, details });
  if (args.verbose && details) {
    console.log(`    Details: ${JSON.stringify(details).slice(0, 200)}`);
  }
}

async function runTests() {
  console.log("=" .repeat(70));
  console.log("  DATA INTEGRITY EDGE CASE TESTING");
  console.log("  Using raw data to find gaps and edge cases");
  console.log("=" .repeat(70));
  console.log("");

  const client = await pool.connect();

  try {
    for (const { name, fn } of TESTS) {
      process.stdout.write(`  ${name}... `);
      try {
        await fn(client);
        console.log("✓ PASS");
        RESULTS.passed++;
      } catch (error) {
        console.log("✗ FAIL");
        RESULTS.failed++;
        RESULTS.findings.push({ type: "error", test: name, error: error.message });
      }
    }
  } finally {
    client.release();
    await pool.end();
  }

  console.log("");
  console.log("=" .repeat(70));
  console.log(`  RESULTS: ${RESULTS.passed} passed, ${RESULTS.failed} failed, ${RESULTS.warnings} warnings`);
  console.log("=" .repeat(70));

  if (RESULTS.findings.length > 0) {
    console.log("\nFindings:");
    for (const f of RESULTS.findings) {
      const icon = f.type === "error" ? "❌" : f.type === "warning" ? "⚠️" : "ℹ️";
      console.log(`  ${icon} ${f.message || f.test}: ${f.error || ""}`);
    }
  }
}

// ============================================================================
// 1. LINKAGE INTEGRITY TESTS
// ============================================================================

test("places without any relationships or contexts are flagged", async (client) => {
  const result = await client.query(`
    SELECT COUNT(*) as count
    FROM sot.places p
    WHERE p.merged_into_place_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM sot.cat_place_relationships cpr WHERE cpr.place_id = p.place_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM sot.person_place_relationships ppr WHERE ppr.place_id = p.place_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM ops.requests r WHERE r.place_id = p.place_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM sot.place_contexts pc WHERE pc.place_id = p.place_id
      )
  `);
  const count = parseInt(result.rows[0].count);
  if (count > 0) {
    warn(`Found ${count} orphaned places with no relationships or contexts`);
  }
});

test("cats without any appointments or relationships", async (client) => {
  const result = await client.query(`
    SELECT COUNT(*) as count
    FROM sot.cats c
    WHERE c.merged_into_cat_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM ops.appointments a WHERE a.cat_id = c.cat_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM sot.cat_place_relationships cpr WHERE cpr.cat_id = c.cat_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM sot.person_cat_relationships pcr WHERE pcr.cat_id = c.cat_id
      )
  `);
  const count = parseInt(result.rows[0].count);
  if (count > 0) {
    warn(`Found ${count} cats with no appointments or relationships`);
  }
});

test("people without any identifiers (email/phone)", async (client) => {
  const result = await client.query(`
    SELECT COUNT(*) as count
    FROM sot.people p
    WHERE p.merged_into_person_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM sot.person_identifiers pi WHERE pi.person_id = p.person_id
      )
  `);
  const count = parseInt(result.rows[0].count);
  if (count > 0) {
    warn(`Found ${count} people with no identifiers - may be hard to match`);
  }
});

// ============================================================================
// 2. RELATIONSHIP INTEGRITY TESTS
// ============================================================================

test("person-cat relationships have valid entities on both sides", async (client) => {
  const result = await client.query(`
    SELECT COUNT(*) as count
    FROM sot.person_cat_relationships pcr
    LEFT JOIN sot.people p ON p.person_id = pcr.person_id
    LEFT JOIN sot.cats c ON c.cat_id = pcr.cat_id
    WHERE p.person_id IS NULL OR c.cat_id IS NULL
  `);
  const count = parseInt(result.rows[0].count);
  if (count > 0) {
    throw new Error(`Found ${count} person-cat relationships with missing entities`);
  }
});

test("cat-place relationships have valid entities on both sides", async (client) => {
  const result = await client.query(`
    SELECT COUNT(*) as count
    FROM sot.cat_place_relationships cpr
    LEFT JOIN sot.cats c ON c.cat_id = cpr.cat_id
    LEFT JOIN sot.places p ON p.place_id = cpr.place_id
    WHERE c.cat_id IS NULL OR p.place_id IS NULL
  `);
  const count = parseInt(result.rows[0].count);
  if (count > 0) {
    throw new Error(`Found ${count} cat-place relationships with missing entities`);
  }
});

test("place contexts reference valid place_context_types", async (client) => {
  const result = await client.query(`
    SELECT COUNT(*) as count
    FROM sot.place_contexts pc
    LEFT JOIN sot.place_context_types pct ON pct.context_type = pc.context_type
    WHERE pct.context_type IS NULL
  `);
  const count = parseInt(result.rows[0].count);
  if (count > 0) {
    throw new Error(`Found ${count} contexts with invalid context_type`);
  }
});

// ============================================================================
// 3. DUPLICATE EDGE CASE DETECTION
// ============================================================================

test("near-duplicate places (similar addresses, different IDs)", async (client) => {
  const result = await client.query(`
    SELECT p1.place_id as place_1, p2.place_id as place_2,
           p1.formatted_address as addr_1, p2.formatted_address as addr_2,
           similarity(p1.formatted_address, p2.formatted_address) as sim
    FROM sot.places p1
    JOIN sot.places p2 ON p1.place_id < p2.place_id
    WHERE p1.merged_into_place_id IS NULL
      AND p2.merged_into_place_id IS NULL
      AND p1.formatted_address IS NOT NULL
      AND p2.formatted_address IS NOT NULL
      AND similarity(p1.formatted_address, p2.formatted_address) > 0.8
    LIMIT 10
  `);
  if (result.rows.length > 0) {
    finding(`Found ${result.rows.length}+ near-duplicate places (similarity > 80%)`, result.rows[0]);
  }
});

test("people with same phone in different records", async (client) => {
  const result = await client.query(`
    SELECT pi.id_value_norm as phone, COUNT(DISTINCT pi.person_id) as person_count
    FROM sot.person_identifiers pi
    WHERE pi.id_type = 'phone'
      AND pi.id_value_norm IS NOT NULL
      AND pi.id_value_norm != ''
      AND LENGTH(pi.id_value_norm) >= 10
    GROUP BY pi.id_value_norm
    HAVING COUNT(DISTINCT pi.person_id) > 2
    LIMIT 10
  `);
  if (result.rows.length > 0) {
    finding(`Found ${result.rows.length} phone numbers linked to 3+ people (possible household or duplicates)`, result.rows[0]);
  }
});

test("cats with similar names at same place (potential duplicates)", async (client) => {
  const result = await client.query(`
    SELECT cpr1.place_id, c1.cat_id as cat_1, c2.cat_id as cat_2,
           c1.display_name as name_1, c2.display_name as name_2,
           similarity(c1.display_name, c2.display_name) as sim
    FROM sot.cat_place_relationships cpr1
    JOIN sot.cat_place_relationships cpr2 ON cpr1.place_id = cpr2.place_id AND cpr1.cat_id < cpr2.cat_id
    JOIN sot.cats c1 ON c1.cat_id = cpr1.cat_id AND c1.merged_into_cat_id IS NULL
    JOIN sot.cats c2 ON c2.cat_id = cpr2.cat_id AND c2.merged_into_cat_id IS NULL
    WHERE c1.display_name IS NOT NULL AND c2.display_name IS NOT NULL
      AND similarity(c1.display_name, c2.display_name) > 0.7
    LIMIT 10
  `);
  if (result.rows.length > 0) {
    finding(`Found ${result.rows.length}+ similar-named cats at same place (check for duplicates)`, result.rows[0]);
  }
});

// ============================================================================
// 4. CONTEXT COVERAGE GAPS
// ============================================================================

test("requests with places but no colony_site context assigned", async (client) => {
  const result = await client.query(`
    SELECT COUNT(*) as count
    FROM ops.requests r
    WHERE r.place_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM sot.place_contexts pc
        WHERE pc.place_id = r.place_id
          AND pc.context_type = 'colony_site'
      )
  `);
  const count = parseInt(result.rows[0].count);
  if (count > 0) {
    warn(`Found ${count} requests with places missing colony_site context`);
  }
});

test("adopter relationships without adopter_residence context on linked places", async (client) => {
  const result = await client.query(`
    SELECT COUNT(DISTINCT ppr.place_id) as count
    FROM sot.person_cat_relationships pcr
    JOIN sot.person_place_relationships ppr ON ppr.person_id = pcr.person_id
    WHERE pcr.relationship_type = 'adopter'
      AND NOT EXISTS (
        SELECT 1 FROM sot.place_contexts pc
        WHERE pc.place_id = ppr.place_id
          AND pc.context_type = 'adopter_residence'
      )
  `);
  const count = parseInt(result.rows[0].count);
  if (count > 0) {
    finding(`Found ${count} adopter places missing adopter_residence context`);
  }
});

test("clinics in appointments but missing clinic context", async (client) => {
  const result = await client.query(`
    SELECT a.place_id, COUNT(*) as appt_count
    FROM ops.appointments a
    WHERE a.place_id IS NOT NULL
      AND (a.is_spay OR a.is_neuter)
      AND NOT EXISTS (
        SELECT 1 FROM sot.place_contexts pc
        WHERE pc.place_id = a.place_id
          AND pc.context_type = 'clinic'
      )
    GROUP BY a.place_id
    HAVING COUNT(*) >= 5
    LIMIT 5
  `);
  if (result.rows.length > 0) {
    finding(`Found ${result.rows.length} high-volume appointment places missing clinic context`, result.rows[0]);
  }
});

// ============================================================================
// 5. ENTITY RESOLUTION GAPS
// ============================================================================

test("staged records not yet processed", async (client) => {
  const result = await client.query(`
    SELECT source_system, source_table, COUNT(*) as count
    FROM ops.staged_records
    WHERE NOT is_processed
    GROUP BY source_system, source_table
    ORDER BY count DESC
    LIMIT 10
  `);
  if (result.rows.length > 0) {
    const total = result.rows.reduce((sum, r) => sum + parseInt(r.count), 0);
    finding(`Found ${total} unprocessed staged records`, result.rows);
  }
});

test("people with only one identifier type may be harder to match", async (client) => {
  const result = await client.query(`
    SELECT p.person_id, p.display_name, pi.id_type, COUNT(*) as id_count
    FROM sot.people p
    JOIN sot.person_identifiers pi ON pi.person_id = p.person_id
    WHERE p.merged_into_person_id IS NULL
    GROUP BY p.person_id, p.display_name, pi.id_type
    HAVING COUNT(DISTINCT pi.id_type) = 1
    LIMIT 100
  `);
  // Just informational
  finding(`${result.rows.length}+ people have only one identifier type (email OR phone, not both)`);
});

// ============================================================================
// 6. DATA QUALITY EDGE CASES
// ============================================================================

test("appointments without linked cats", async (client) => {
  const result = await client.query(`
    SELECT COUNT(*) as count
    FROM ops.appointments a
    WHERE a.cat_id IS NULL
  `);
  const count = parseInt(result.rows[0].count);
  if (count > 0) {
    finding(`Found ${count} appointments without linked cats`);
  }
});

test("cats with microchips in unusual formats", async (client) => {
  const result = await client.query(`
    SELECT ci.id_value, LENGTH(ci.id_value) as len
    FROM sot.cat_identifiers ci
    WHERE ci.id_type = 'microchip'
      AND (LENGTH(ci.id_value) < 9 OR LENGTH(ci.id_value) > 15)
    LIMIT 10
  `);
  if (result.rows.length > 0) {
    finding(`Found ${result.rows.length}+ microchips with unusual lengths (not 9-15 digits)`, result.rows[0]);
  }
});

test("places with coordinates but no formatted address", async (client) => {
  const result = await client.query(`
    SELECT COUNT(*) as count
    FROM sot.places p
    WHERE p.location IS NOT NULL
      AND (p.formatted_address IS NULL OR p.formatted_address = '')
      AND p.merged_into_place_id IS NULL
  `);
  const count = parseInt(result.rows[0].count);
  if (count > 0) {
    finding(`Found ${count} places with coordinates but no address`);
  }
});

// Skipped: data_engine_match_decisions table removed in v2 (MIG_2299)

// ============================================================================
// 7. TIPPY TOOL READINESS
// ============================================================================

// Skipped: query_person_cat_history function removed in v2 (MIG_2299)

test("v_place_active_contexts has data for Tippy queries", async (client) => {
  const result = await client.query(`
    SELECT context_type, COUNT(*) as count
    FROM sot.v_place_active_contexts
    GROUP BY context_type
    ORDER BY count DESC
  `);
  if (result.rows.length === 0) {
    throw new Error("No active place contexts - Tippy context queries will fail");
  }
  finding(`Tippy can query ${result.rows.length} context types: ${result.rows.map(r => `${r.context_type}(${r.count})`).join(", ")}`);
});

test("regional area queries will return results", async (client) => {
  // Test key regions
  const regions = ["Petaluma", "Santa Rosa", "Sebastopol", "Healdsburg"];
  for (const region of regions) {
    const result = await client.query(`
      SELECT COUNT(*) as count
      FROM sot.places p
      WHERE p.merged_into_place_id IS NULL
        AND p.formatted_address ILIKE $1
    `, [`%${region}%`]);
    const count = parseInt(result.rows[0].count);
    if (count === 0) {
      warn(`No places found for region: ${region}`);
    } else {
      finding(`Region "${region}" has ${count} places for Tippy queries`);
    }
  }
});

// ============================================================================
// RUN ALL TESTS
// ============================================================================

runTests();
