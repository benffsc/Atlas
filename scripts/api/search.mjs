#!/usr/bin/env node
/**
 * search.mjs
 *
 * Unified search API script for cats, places, and people.
 * Uses v_search_unified_v3 for combined results.
 *
 * Usage:
 *   node scripts/api/search.mjs "search term"
 *   node scripts/api/search.mjs "fluffy" --type cat
 *   node scripts/api/search.mjs "main street" --type place --limit 20
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

async function search(query, options = {}) {
  const { type = null, limit = 25, offset = 0 } = options;

  const conditions = [`(
    search_text ILIKE $1
    OR search_text_extra ILIKE $1
  )`];
  const params = [`%${query}%`];
  let paramIndex = 2;

  // Filter by entity type
  if (type) {
    conditions.push(`entity_type = $${paramIndex}`);
    params.push(type);
    paramIndex++;
  }

  const whereClause = conditions.join(" AND ");

  const sql = `
    SELECT
      entity_type,
      entity_id,
      display,
      subtitle,
      metadata,
      last_activity
    FROM trapper.v_search_unified_v3
    WHERE ${whereClause}
    ORDER BY
      CASE WHEN display ILIKE $1 THEN 0 ELSE 1 END,  -- Exact matches first
      entity_type,
      display
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `;
  params.push(limit, offset);

  const countSql = `
    SELECT entity_type, COUNT(*) as count
    FROM trapper.v_search_unified_v3
    WHERE ${whereClause}
    GROUP BY entity_type
  `;

  const [dataResult, countResult] = await Promise.all([
    pool.query(sql, params),
    pool.query(countSql, params.slice(0, -2)),
  ]);

  const countsByType = {};
  countResult.rows.forEach((row) => {
    countsByType[row.entity_type] = parseInt(row.count, 10);
  });

  return {
    query,
    results: dataResult.rows,
    counts: countsByType,
    total: Object.values(countsByType).reduce((a, b) => a + b, 0),
    limit,
    offset,
  };
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help") {
    console.log(`
Usage: node scripts/api/search.mjs <query> [OPTIONS]

Arguments:
  query    Search term (name, microchip, address, etc.)

Options:
  --type <cat|place|person>   Filter by entity type
  --limit <N>                 Max results (default: 25)
  --offset <N>                Pagination offset (default: 0)
  --help                      Show this help

Examples:
  node scripts/api/search.mjs "fluffy"
  node scripts/api/search.mjs "main street" --type place
  node scripts/api/search.mjs "982" --type cat  # Search by microchip prefix
`);
    process.exit(args[0] === "--help" ? 0 : 1);
  }

  const query = args[0];
  const options = {};

  for (let i = 1; i < args.length; i++) {
    switch (args[i]) {
      case "--type":
        options.type = args[++i];
        if (!["cat", "place", "person"].includes(options.type)) {
          console.error("Error: --type must be cat, place, or person");
          process.exit(1);
        }
        break;
      case "--limit":
        options.limit = parseInt(args[++i], 10);
        break;
      case "--offset":
        options.offset = parseInt(args[++i], 10);
        break;
    }
  }

  try {
    const result = await search(query, options);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
