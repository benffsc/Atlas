import { Pool, QueryResult, QueryResultRow } from "pg";

// Custom error class for database connection issues
export class DatabaseConnectionError extends Error {
  constructor(message: string, public originalError?: Error) {
    super(message);
    this.name = "DatabaseConnectionError";
  }
}

// Validate DATABASE_URL is configured
if (!process.env.DATABASE_URL) {
  console.error(
    "FATAL: DATABASE_URL environment variable is not set.\n" +
    "Please configure DATABASE_URL in your environment or .env.local file.\n" +
    "Get it from: Supabase Dashboard > Project Settings > Database > Connection string"
  );
  // Don't throw in module scope - let queries fail with clear error messages
}

// Serverless-optimized connection pool settings
// Vercel serverless functions need smaller pools since each invocation may spawn a new instance
const isServerless = process.env.VERCEL === "1" || process.env.AWS_LAMBDA_FUNCTION_NAME;

// Create a connection pool (may be undefined if DATABASE_URL is missing)
// Using Supabase Session Pooler which handles connection multiplexing
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes("localhost")
        ? false
        : { rejectUnauthorized: false },
      // Serverless: use small pool (3) to handle concurrent requests without exhausting connections
      // The Supabase pooler handles the actual connection multiplexing
      // Local/Server: use larger pool for performance
      max: isServerless ? 3 : 10,
      // Shorter timeouts for serverless to fail fast and release connections
      idleTimeoutMillis: isServerless ? 15000 : 30000,
      connectionTimeoutMillis: isServerless ? 8000 : 10000,
    })
  : null;

// Handle pool errors (only if pool exists)
if (pool) {
  pool.on("error", (err) => {
    console.error("Unexpected database pool error:", err);
  });
}

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
  // Check if pool is configured
  if (!pool) {
    throw new DatabaseConnectionError(
      "DATABASE_URL is not configured. Please set the DATABASE_URL environment variable."
    );
  }

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

/**
 * Execute a statement (INSERT/UPDATE/DELETE) and return the result
 * Useful when you need access to rowCount but not rows
 */
export async function execute(
  sql: string,
  params: unknown[] = []
): Promise<QueryResult> {
  return await query(sql, params);
}

/**
 * Execute a callback within a database transaction
 * Automatically handles BEGIN/COMMIT/ROLLBACK
 * @param callback - Function that receives a transaction client with query methods
 * @returns Result from the callback function
 */
export async function withTransaction<T>(
  callback: (tx: TransactionClient) => Promise<T>
): Promise<T> {
  if (!pool) {
    throw new DatabaseConnectionError(
      "DATABASE_URL is not configured. Please set the DATABASE_URL environment variable."
    );
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const tx: TransactionClient = {
      query: async <R extends QueryResultRow = QueryResultRow>(
        sql: string,
        params: unknown[] = []
      ): Promise<QueryResult<R>> => {
        return client.query<R>(sql, params);
      },
      queryRows: async <R extends QueryResultRow = QueryResultRow>(
        sql: string,
        params: unknown[] = []
      ): Promise<R[]> => {
        const result = await client.query<R>(sql, params);
        return result.rows;
      },
      queryOne: async <R extends QueryResultRow = QueryResultRow>(
        sql: string,
        params: unknown[] = []
      ): Promise<R | null> => {
        const result = await client.query<R>(sql, params);
        return result.rows[0] || null;
      },
    };

    const result = await callback(tx);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Transaction client interface for use within withTransaction callback
 */
export interface TransactionClient {
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[]
  ): Promise<QueryResult<T>>;
  queryRows<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[]
  ): Promise<T[]>;
  queryOne<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[]
  ): Promise<T | null>;
}

export default pool;
