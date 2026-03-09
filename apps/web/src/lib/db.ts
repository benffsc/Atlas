import { Pool, QueryResult, QueryResultRow } from "pg";

// Re-export QueryResultRow for use in other files
export type { QueryResultRow };

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

// Use Supabase Transaction mode (port 6543) instead of Session mode (port 5432).
// Session mode holds a backend Postgres connection for the entire client session — on Vercel,
// each function invocation creates its own Pool, quickly exhausting the session pooler's limit
// ("MaxClientsInSessionMode: max clients reached"). Transaction mode releases backend connections
// after each query, preventing pool exhaustion under concurrent load.
// Applied to ALL environments since session pooler saturation affects local dev too.
let connectionString = process.env.DATABASE_URL;
if (connectionString?.includes('.pooler.supabase.com:5432')) {
  connectionString = connectionString.replace('.pooler.supabase.com:5432', '.pooler.supabase.com:6543');
}

// Create a connection pool (may be undefined if DATABASE_URL is missing)
const pool = connectionString
  ? new Pool({
      connectionString,
      ssl: connectionString.includes("localhost")
        ? false
        : { rejectUnauthorized: false },
      // Serverless: small pool — Transaction mode pooler handles multiplexing
      // Local/Server: larger pool for development performance
      max: isServerless ? 2 : 10,
      idleTimeoutMillis: isServerless ? 20000 : 30000,
      connectionTimeoutMillis: isServerless ? 10000 : 10000,
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
