/**
 * V2 Ingest Pipeline - Database Connection
 *
 * Simplified database connection for V2 ingest scripts.
 * Not serverless - runs as batch scripts with longer connections.
 */

import { Pool, QueryResult, QueryResultRow } from "pg";

// Validate DATABASE_URL
if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL environment variable is not set.\n" +
    "Run: source .env && npx ts-node scripts/ingest-v2/..."
  );
}

// Script-optimized pool settings (not serverless)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Handle pool errors
pool.on("error", (err) => {
  console.error("Database pool error:", err);
});

/**
 * Execute a SQL query and return rows
 */
export async function queryRows<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const result = await pool.query<T>(sql, params);
  return result.rows;
}

/**
 * Execute a query and return the first row or null
 */
export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = []
): Promise<T | null> {
  const result = await pool.query<T>(sql, params);
  return result.rows[0] || null;
}

/**
 * Execute a statement and return the full result
 */
export async function execute(
  sql: string,
  params: unknown[] = []
): Promise<QueryResult> {
  return await pool.query(sql, params);
}

/**
 * Close the connection pool (call at end of script)
 */
export async function closePool(): Promise<void> {
  await pool.end();
}

export { pool };
