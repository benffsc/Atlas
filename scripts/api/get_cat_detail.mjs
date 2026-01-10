#!/usr/bin/env node
/**
 * get_cat_detail.mjs
 *
 * API script for getting cat details including owners, places, and relationships.
 * This can be used as a reference for building a REST API endpoint.
 *
 * Usage:
 *   node scripts/api/get_cat_detail.mjs <cat_id>
 *   node scripts/api/get_cat_detail.mjs --help
 *
 * Environment:
 *   DATABASE_URL - PostgreSQL connection string
 */

import pg from "pg";

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function getCatDetail(catId) {
  // Get main cat detail
  const catSql = `
    SELECT *
    FROM trapper.v_cat_detail
    WHERE cat_id = $1
  `;

  // Get relationships rollup
  const relationshipsSql = `
    SELECT
      related_entity_id,
      related_entity_type,
      related_entity_name,
      relationship_type,
      relationship_label,
      direction,
      confidence,
      note,
      source,
      created_at
    FROM trapper.v_cat_relationships_rollup
    WHERE cat_id = $1
    ORDER BY relationship_type, related_entity_name
  `;

  const [catResult, relResult] = await Promise.all([
    pool.query(catSql, [catId]),
    pool.query(relationshipsSql, [catId]),
  ]);

  if (catResult.rows.length === 0) {
    return null;
  }

  const cat = catResult.rows[0];

  return {
    cat_id: cat.cat_id,
    display_name: cat.display_name,
    sex: cat.sex,
    altered_status: cat.altered_status,
    breed: cat.breed,
    primary_color: cat.primary_color,
    birth_year: cat.birth_year,
    notes: cat.notes,
    created_at: cat.created_at,
    updated_at: cat.updated_at,
    identifiers: cat.identifiers || [],
    owners: cat.owners || [],
    primary_place: cat.primary_place,
    all_places: cat.all_places || [],
    relationships: relResult.rows,
  };
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help") {
    console.log(`
Usage: node scripts/api/get_cat_detail.mjs <cat_id>

Arguments:
  cat_id    UUID of the cat to fetch

Example:
  node scripts/api/get_cat_detail.mjs 550e8400-e29b-41d4-a716-446655440000
`);
    process.exit(args[0] === "--help" ? 0 : 1);
  }

  const catId = args[0];

  // Validate UUID format
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(catId)) {
    console.error("Error: Invalid UUID format");
    process.exit(1);
  }

  try {
    const result = await getCatDetail(catId);

    if (!result) {
      console.error("Cat not found:", catId);
      process.exit(1);
    }

    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
