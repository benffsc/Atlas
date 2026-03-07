#!/usr/bin/env node

/**
 * Data Quality & Tippy Tools Test Script
 *
 * Tests the new Tippy tools for foster/adopter queries:
 * 1. query_person_cat_relationships - Foster/adopter history
 * 2. query_places_by_context - Place context queries
 * 3. query_cat_journey - Cat journey tracking
 *
 * Usage:
 *   node scripts/testing/test_tippy_tools.mjs
 */

import pg from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const TESTS = [];
const RESULTS = { passed: 0, failed: 0, errors: [] };

function test(name, fn) {
  TESTS.push({ name, fn });
}

async function runTests() {
  console.log("=" .repeat(60));
  console.log("  TIPPY TOOLS & DATA QUALITY TEST SUITE");
  console.log("=" .repeat(60));
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
        RESULTS.errors.push({ test: name, error: error.message });
      }
    }
  } finally {
    client.release();
    await pool.end();
  }

  console.log("");
  console.log("=" .repeat(60));
  console.log(`  RESULTS: ${RESULTS.passed} passed, ${RESULTS.failed} failed`);
  console.log("=" .repeat(60));

  if (RESULTS.errors.length > 0) {
    console.log("\nFailed tests:");
    for (const { test, error } of RESULTS.errors) {
      console.log(`  - ${test}: ${error}`);
    }
    process.exit(1);
  }
}

// ============================================================================
// Place Context Tests
// ============================================================================

test("place_context_types table has required types", async (client) => {
  const result = await client.query(`
    SELECT context_type FROM sot.place_context_types
    WHERE context_type IN ('colony_site', 'foster_home', 'adopter_residence', 'clinic')
  `);
  if (result.rows.length < 4) {
    throw new Error(`Expected 4 context types, found ${result.rows.length}`);
  }
});

test("place_contexts table has data", async (client) => {
  const result = await client.query(`
    SELECT COUNT(*) as count FROM sot.place_contexts
  `);
  if (parseInt(result.rows[0].count) === 0) {
    throw new Error("No place contexts found - backfill may not have run");
  }
});

test("v_place_active_contexts view works", async (client) => {
  const result = await client.query(`
    SELECT * FROM sot.v_place_active_contexts LIMIT 5
  `);
  // Just verify view is queryable
  if (!Array.isArray(result.rows)) {
    throw new Error("View did not return array");
  }
});

test("assign_place_context function is idempotent", async (client) => {
  // Get a random place
  const place = await client.query(`
    SELECT place_id FROM sot.places
    WHERE merged_into_place_id IS NULL
    LIMIT 1
  `);
  if (place.rows.length === 0) {
    throw new Error("No places found for testing");
  }

  const placeId = place.rows[0].place_id;

  // Assign context twice - should not error
  await client.query(`SELECT sot.assign_place_context($1, 'colony_site')`, [placeId]);
  const result = await client.query(`SELECT sot.assign_place_context($1, 'colony_site')`, [placeId]);

  if (!result.rows[0].assign_place_context) {
    throw new Error("assign_place_context should return context_id");
  }
});

// ============================================================================
// Person-Cat Relationship Tests
// ============================================================================

test("person_cat_relationships table exists and has data", async (client) => {
  const result = await client.query(`
    SELECT relationship_type, COUNT(*) as count
    FROM sot.person_cat_relationships
    GROUP BY relationship_type
  `);
  if (result.rows.length === 0) {
    throw new Error("No person-cat relationships found");
  }
});

test("v_person_cat_history view works", async (client) => {
  const result = await client.query(`
    SELECT * FROM ops.v_person_cat_history LIMIT 5
  `);
  if (!Array.isArray(result.rows)) {
    throw new Error("View did not return array");
  }
});

test("query_person_cat_history function works", async (client) => {
  const result = await client.query(`
    SELECT * FROM ops.query_person_cat_history(NULL, NULL, 'adopter') LIMIT 5
  `);
  if (!Array.isArray(result.rows)) {
    throw new Error("Function did not return array");
  }
});

test("adopter relationships exist from ShelterLuv outcomes", async (client) => {
  const result = await client.query(`
    SELECT COUNT(*) as count
    FROM sot.person_cat_relationships
    WHERE relationship_type = 'adopter'
      AND source_system = 'shelterluv'
  `);
  if (parseInt(result.rows[0].count) === 0) {
    throw new Error("No adopter relationships from ShelterLuv - outcome processing may not have run");
  }
});

// ============================================================================
// Place Context Queries (for Tippy tools)
// ============================================================================

test("can query places by context type (colony_site)", async (client) => {
  const result = await client.query(`
    SELECT p.place_id, p.formatted_address, pc.context_type
    FROM sot.places p
    JOIN sot.place_contexts pc ON pc.place_id = p.place_id
    WHERE pc.context_type = 'colony_site'
      AND pc.valid_to IS NULL
      AND p.merged_into_place_id IS NULL
    LIMIT 10
  `);
  // Just verify query works
  if (!Array.isArray(result.rows)) {
    throw new Error("Query did not return array");
  }
});

test("can query places by context with area filter", async (client) => {
  const result = await client.query(`
    SELECT p.place_id, p.formatted_address, pc.context_type
    FROM sot.places p
    JOIN sot.place_contexts pc ON pc.place_id = p.place_id
    WHERE pc.context_type = 'colony_site'
      AND pc.valid_to IS NULL
      AND p.merged_into_place_id IS NULL
      AND p.formatted_address ILIKE '%Petaluma%'
    LIMIT 10
  `);
  if (!Array.isArray(result.rows)) {
    throw new Error("Query did not return array");
  }
});

test("adopter_residence contexts exist", async (client) => {
  const result = await client.query(`
    SELECT COUNT(*) as count
    FROM sot.place_contexts
    WHERE context_type = 'adopter_residence'
      AND valid_to IS NULL
  `);
  if (parseInt(result.rows[0].count) === 0) {
    throw new Error("No adopter_residence contexts - outcome processing may not have tagged places");
  }
});

// ============================================================================
// Cat Journey Queries
// ============================================================================

test("can query cat with microchip and relationships", async (client) => {
  const result = await client.query(`
    SELECT
      c.cat_id,
      c.display_name,
      ci.id_value AS microchip,
      ARRAY_AGG(DISTINCT pcr.relationship_type) AS relationship_types
    FROM sot.cats c
    LEFT JOIN sot.cat_identifiers ci ON ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
    LEFT JOIN sot.person_cat_relationships pcr ON pcr.cat_id = c.cat_id
    WHERE c.merged_into_cat_id IS NULL
      AND ci.id_value IS NOT NULL
    GROUP BY c.cat_id, c.display_name, ci.id_value
    LIMIT 5
  `);
  if (!Array.isArray(result.rows)) {
    throw new Error("Query did not return array");
  }
});

test("can trace cat appointments", async (client) => {
  const result = await client.query(`
    SELECT
      c.cat_id,
      c.display_name,
      COUNT(DISTINCT a.appointment_id) AS appointment_count
    FROM sot.cats c
    JOIN ops.appointments a ON a.cat_id = c.cat_id
    WHERE c.merged_into_cat_id IS NULL
    GROUP BY c.cat_id, c.display_name
    HAVING COUNT(DISTINCT a.appointment_id) > 0
    LIMIT 5
  `);
  if (result.rows.length === 0) {
    throw new Error("No cats with appointments found");
  }
});

// ============================================================================
// Data Integrity Tests
// ============================================================================

test("no orphaned cat-place relationships", async (client) => {
  const result = await client.query(`
    SELECT COUNT(*) as count
    FROM sot.cat_place_relationships cpr
    JOIN sot.places p ON p.place_id = cpr.place_id
    WHERE p.merged_into_place_id IS NOT NULL
  `);
  if (parseInt(result.rows[0].count) > 0) {
    throw new Error(`Found ${result.rows[0].count} orphaned cat-place relationships`);
  }
});

test("no orphaned person-cat relationships (merged person)", async (client) => {
  const result = await client.query(`
    SELECT COUNT(*) as count
    FROM sot.person_cat_relationships pcr
    JOIN sot.people p ON p.person_id = pcr.person_id
    WHERE p.merged_into_person_id IS NOT NULL
  `);
  if (parseInt(result.rows[0].count) > 0) {
    throw new Error(`Found ${result.rows[0].count} orphaned person-cat relationships`);
  }
});

test("no duplicate places by normalized_address", async (client) => {
  const result = await client.query(`
    SELECT normalized_address, COUNT(*) as count
    FROM sot.places
    WHERE merged_into_place_id IS NULL
      AND normalized_address IS NOT NULL
    GROUP BY normalized_address
    HAVING COUNT(*) > 1
    LIMIT 1
  `);
  if (result.rows.length > 0) {
    throw new Error(`Found duplicate places: ${result.rows[0].normalized_address}`);
  }
});

test("all place contexts reference valid places", async (client) => {
  const result = await client.query(`
    SELECT COUNT(*) as count
    FROM sot.place_contexts pc
    LEFT JOIN sot.places p ON p.place_id = pc.place_id
    WHERE p.place_id IS NULL
  `);
  if (parseInt(result.rows[0].count) > 0) {
    throw new Error(`Found ${result.rows[0].count} contexts referencing non-existent places`);
  }
});

// ============================================================================
// Run All Tests
// ============================================================================

runTests();
