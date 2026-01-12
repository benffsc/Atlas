import { Pool, QueryResult, QueryResultRow } from "pg";

// Custom error class for database connection issues
export class DatabaseConnectionError extends Error {
  constructor(message: string, public originalError?: Error) {
    super(message);
    this.name = "DatabaseConnectionError";
  }
}

// Create a connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Handle pool errors
pool.on("error", (err) => {
  console.error("Unexpected database pool error:", err);
});

/**
 * Check if an error is a connection-related error
 */
function isConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("econnrefused") ||
    msg.includes("enotfound") ||
    msg.includes("etimedout") ||
    msg.includes("connection terminated") ||
    msg.includes("connection timeout") ||
    msg.includes("could not connect") ||
    msg.includes("no pg_hba.conf entry") ||
    msg.includes("the database system is starting up") ||
    msg.includes("ssl") ||
    (err as NodeJS.ErrnoException).code === "ECONNREFUSED"
  );
}

/**
 * Execute a SQL query with connection error handling
 * @param sql - SQL query string with $1, $2, etc. placeholders
 * @param params - Array of parameter values
 * @returns Query result rows
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = []
): Promise<QueryResult<T>> {
  let client;
  try {
    client = await pool.connect();
  } catch (err) {
    if (isConnectionError(err)) {
      throw new DatabaseConnectionError(
        "Unable to connect to database. Please check your connection settings.",
        err as Error
      );
    }
    throw err;
  }

  try {
    return await client.query<T>(sql, params);
  } catch (err) {
    if (isConnectionError(err)) {
      throw new DatabaseConnectionError(
        "Database connection lost during query.",
        err as Error
      );
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Execute a query and return just the rows
 */
export async function queryRows<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const result = await query<T>(sql, params);
  return result.rows;
}

/**
 * Execute a query and return the first row or null
 */
export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = []
): Promise<T | null> {
  const result = await query<T>(sql, params);
  return result.rows[0] || null;
}

export default pool;
