#!/usr/bin/env node
/**
 * get_cats.mjs
 *
 * API script for listing cats with filters.
 * This can be used as a reference for building a REST API endpoint.
 *
 * Usage:
 *   node scripts/api/get_cats.mjs [--query "search"] [--limit N] [--offset N]
 *   node scripts/api/get_cats.mjs --has-place --sex F --altered spayed
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

async function getCats(options = {}) {
  const {
    query = null,
    limit = 50,
    offset = 0,
    hasPlace = null,
    hasOwner = null,
    sex = null,
    alteredStatus = null,
  } = options;

  const conditions = [];
  const params = [];
  let paramIndex = 1;

  // Search query (name, microchip, identifiers)
  if (query) {
    conditions.push(`(
      display_name ILIKE $${paramIndex}
      OR microchip ILIKE $${paramIndex}
      OR identifiers::text ILIKE $${paramIndex}
    )`);
    params.push(`%${query}%`);
    paramIndex++;
  }

  // Filter: has_place
  if (hasPlace === true) {
    conditions.push("has_place = true");
  } else if (hasPlace === false) {
    conditions.push("has_place = false");
  }

  // Filter: has_owner
  if (hasOwner === true) {
    conditions.push("owner_count > 0");
  } else if (hasOwner === false) {
    conditions.push("owner_count = 0");
  }

  // Filter: sex
  if (sex) {
    conditions.push(`sex ILIKE $${paramIndex}`);
    params.push(sex);
    paramIndex++;
  }

  // Filter: altered_status
  if (alteredStatus) {
    conditions.push(`altered_status ILIKE $${paramIndex}`);
    params.push(alteredStatus);
    paramIndex++;
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const sql = `
    SELECT
      cat_id,
      display_name,
      sex,
      altered_status,
      breed,
      microchip,
      owner_count,
      owner_names,
      primary_place_id,
      primary_place_label,
      place_kind,
      has_place,
      created_at
    FROM trapper.v_cat_list
    ${whereClause}
    ORDER BY display_name ASC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `;
  params.push(limit, offset);

  const countSql = `
    SELECT COUNT(*) as total
    FROM trapper.v_cat_list
    ${whereClause}
  `;

  const [dataResult, countResult] = await Promise.all([
    pool.query(sql, params),
    pool.query(countSql, params.slice(0, -2)), // Exclude limit/offset from count
  ]);

  return {
    cats: dataResult.rows,
    total: parseInt(countResult.rows[0].total, 10),
    limit,
    offset,
  };
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const options = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--query":
      case "-q":
        options.query = args[++i];
        break;
      case "--limit":
        options.limit = parseInt(args[++i], 10);
        break;
      case "--offset":
        options.offset = parseInt(args[++i], 10);
        break;
      case "--has-place":
        options.hasPlace = true;
        break;
      case "--no-place":
        options.hasPlace = false;
        break;
      case "--has-owner":
        options.hasOwner = true;
        break;
      case "--no-owner":
        options.hasOwner = false;
        break;
      case "--sex":
        options.sex = args[++i];
        break;
      case "--altered":
        options.alteredStatus = args[++i];
        break;
      case "--help":
        console.log(`
Usage: node scripts/api/get_cats.mjs [OPTIONS]

Options:
  --query, -q <text>    Search by name/microchip
  --limit <N>           Max results (default: 50)
  --offset <N>          Pagination offset (default: 0)
  --has-place           Filter to cats with places
  --no-place            Filter to cats without places
  --has-owner           Filter to cats with owners
  --no-owner            Filter to cats without owners
  --sex <M/F/U>         Filter by sex
  --altered <status>    Filter by altered status
  --help                Show this help
`);
        process.exit(0);
    }
  }

  try {
    const result = await getCats(options);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
