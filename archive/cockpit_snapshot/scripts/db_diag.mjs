#!/usr/bin/env node
/**
 * db_diag.mjs - Database connection diagnostic script
 * DEV_012: Diagnose DB connection issues with the same config as the app
 * DEV_014: Added TCP reachability test + Supabase Network Restrictions hints
 *
 * Usage:
 *   source .env && node scripts/db_diag.mjs
 *   # or
 *   DATABASE_URL="postgres://..." node scripts/db_diag.mjs
 *
 * Can also run from apps/web: cd apps/web && node ../../scripts/db_diag.mjs
 */

import pg from 'pg';
import net from 'net';
const { Pool } = pg;

// ============================================================
// Helpers
// ============================================================

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const NC = '\x1b[0m'; // No color

function log(color, prefix, msg) {
  console.log(`${color}[${prefix}]${NC} ${msg}`);
}

function logInfo(msg) { log(BLUE, 'INFO', msg); }
function logOk(msg) { log(GREEN, 'OK', msg); }
function logWarn(msg) { log(YELLOW, 'WARN', msg); }
function logError(msg) { log(RED, 'ERROR', msg); }

/**
 * Test TCP connectivity to host:port
 * Returns: { ok: boolean, latencyMs: number, error?: string }
 */
function testTcpConnectivity(host, port, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const socket = new net.Socket();
    let resolved = false;

    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
      }
    };

    socket.setTimeout(timeoutMs);

    socket.on('connect', () => {
      const latency = Date.now() - startTime;
      cleanup();
      resolve({ ok: true, latencyMs: latency });
    });

    socket.on('timeout', () => {
      cleanup();
      resolve({ ok: false, latencyMs: Date.now() - startTime, error: 'timeout' });
    });

    socket.on('error', (err) => {
      cleanup();
      resolve({ ok: false, latencyMs: Date.now() - startTime, error: err.code || err.message });
    });

    socket.connect(port, host);
  });
}

/**
 * Sanitize a connection string - remove password, show structure
 */
function sanitizeUrl(url) {
  if (!url) return '(not set)';
  try {
    const parsed = new URL(url);
    // Hide password
    if (parsed.password) {
      parsed.password = '***';
    }
    return parsed.toString();
  } catch {
    // Fallback: regex-based sanitization
    return url.replace(/:[^:@]+@/, ':***@');
  }
}

/**
 * Parse DATABASE_URL and extract useful info
 */
function parseDbUrl(connectionString) {
  const result = {
    host: null,
    port: null,
    database: null,
    user: null,
    sslmode: null,
    hasPassword: false,
    looksLikeSupabasePooler: false,
    looksLikeSupabaseDirect: false,
    looksLikeLocalhost: false,
    parseError: null,
    passwordHasSpecialChars: false,
  };

  if (!connectionString) {
    result.parseError = 'DATABASE_URL is not set';
    return result;
  }

  try {
    const url = new URL(connectionString);
    result.host = url.hostname;
    result.port = url.port || '5432';
    result.database = url.pathname.replace(/^\//, '') || 'postgres';
    result.user = url.username;
    result.hasPassword = !!url.password;
    result.sslmode = url.searchParams.get('sslmode');

    // Check for special chars in password that might need encoding
    if (url.password) {
      // Decode to check what's actually there
      try {
        const decoded = decodeURIComponent(url.password);
        // These chars should be encoded: @ : / ? #
        if (/[@:/?#]/.test(decoded)) {
          result.passwordHasSpecialChars = true;
        }
      } catch {
        // If decodeURIComponent fails, password might be malformed
        result.passwordHasSpecialChars = true;
      }
    }

    // Detect Supabase patterns
    const host = result.host.toLowerCase();
    if (host.includes('pooler.supabase')) {
      result.looksLikeSupabasePooler = true;
    } else if (host.includes('supabase.co') || host.includes('supabase.com')) {
      result.looksLikeSupabaseDirect = true;
    }

    // Detect localhost
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
      result.looksLikeLocalhost = true;
    }

    // Also check port for pooler patterns
    if (result.port === '6543' || result.port === '6544') {
      result.looksLikeSupabasePooler = true;
    }

  } catch (e) {
    result.parseError = `Failed to parse URL: ${e.message}`;
  }

  return result;
}

/**
 * Determine SSL config based on parsed URL
 */
function getSslConfig(parsed) {
  // If explicit sslmode=disable, no SSL
  if (parsed.sslmode === 'disable') {
    return { ssl: undefined, reason: 'sslmode=disable' };
  }

  // If localhost, no SSL by default
  if (parsed.looksLikeLocalhost) {
    return { ssl: undefined, reason: 'localhost (no SSL needed)' };
  }

  // If verify-ca or verify-full, strict SSL
  if (parsed.sslmode === 'verify-ca' || parsed.sslmode === 'verify-full') {
    return { ssl: { rejectUnauthorized: true }, reason: `sslmode=${parsed.sslmode}` };
  }

  // If Supabase (pooler or direct), need SSL with rejectUnauthorized: false
  if (parsed.looksLikeSupabasePooler || parsed.looksLikeSupabaseDirect) {
    return { ssl: { rejectUnauthorized: false }, reason: 'Supabase detected' };
  }

  // If explicit require/prefer
  if (parsed.sslmode === 'require' || parsed.sslmode === 'prefer') {
    return { ssl: { rejectUnauthorized: false }, reason: `sslmode=${parsed.sslmode}` };
  }

  // Remote host without explicit sslmode - assume SSL needed
  if (parsed.host) {
    return { ssl: { rejectUnauthorized: false }, reason: 'remote host (SSL assumed)' };
  }

  return { ssl: undefined, reason: 'fallback (no SSL)' };
}

/**
 * Get pool config tuned for connection type
 */
function getPoolConfig(parsed, sslConfig) {
  const config = {
    host: parsed.host,
    port: parseInt(parsed.port, 10) || 5432,
    database: parsed.database,
    user: parsed.user,
    ssl: sslConfig.ssl,
    connectionTimeoutMillis: 10000,  // 10s for diagnostics
    statement_timeout: 10000,
    application_name: 'ffsc-db-diag',
  };

  // If pooler detected, use smaller pool and no prepared statements
  if (parsed.looksLikeSupabasePooler) {
    config.max = 1;
    // Note: pg doesn't have a direct "no prepared statements" flag,
    // but using max=1 and short-lived connections helps
  } else {
    config.max = 3;
  }

  return config;
}

// ============================================================
// Main diagnostic
// ============================================================

async function runDiagnostics() {
  console.log('');
  console.log('========================================');
  console.log('  Atlas DB Connection Diagnostic');
  console.log('  DEV_012');
  console.log('========================================');
  console.log('');

  const dbUrl = process.env.DATABASE_URL;

  // Step 1: Check if DATABASE_URL is set
  logInfo('Checking DATABASE_URL...');
  if (!dbUrl) {
    logError('DATABASE_URL is not set!');
    console.log('');
    console.log('Set it via:');
    console.log('  export DATABASE_URL="postgres://user:pass@host:port/db"');
    console.log('  # or');
    console.log('  source .env && node scripts/db_diag.mjs');
    process.exit(2);
  }
  logOk('DATABASE_URL is set');
  console.log(`  Sanitized: ${sanitizeUrl(dbUrl)}`);

  // Step 2: Parse the URL
  console.log('');
  logInfo('Parsing connection string...');
  const parsed = parseDbUrl(dbUrl);

  if (parsed.parseError) {
    logError(`Parse failed: ${parsed.parseError}`);
    process.exit(2);
  }

  console.log(`  Host:     ${parsed.host}`);
  console.log(`  Port:     ${parsed.port}`);
  console.log(`  Database: ${parsed.database}`);
  console.log(`  User:     ${parsed.user}`);
  console.log(`  Password: ${parsed.hasPassword ? '(set)' : '(not set)'}`);
  console.log(`  sslmode:  ${parsed.sslmode || '(not specified)'}`);

  // Step 3: Detect connection type
  console.log('');
  logInfo('Detecting connection type...');
  if (parsed.looksLikeLocalhost) {
    logOk('Detected: localhost');
  } else if (parsed.looksLikeSupabasePooler) {
    logOk('Detected: Supabase Pooler (Transaction mode)');
    console.log('  - Port 6543/6544 or pooler.supabase host');
    console.log('  - Using max=1 connection');
  } else if (parsed.looksLikeSupabaseDirect) {
    logOk('Detected: Supabase Direct (Session mode)');
    console.log('  - Direct connection to Supabase Postgres');
  } else {
    logWarn('Unknown host type - treating as remote Postgres');
  }

  // Step 4: Check for potential issues
  console.log('');
  logInfo('Checking for potential issues...');
  let hasWarnings = false;

  if (parsed.passwordHasSpecialChars) {
    logWarn('Password may contain special chars (@, :, /, #, ?)');
    console.log('  Ensure they are URL-encoded in DATABASE_URL');
    console.log('  Example: @ -> %40, : -> %3A, / -> %2F');
    hasWarnings = true;
  }

  if (!parsed.hasPassword && !parsed.looksLikeLocalhost) {
    logWarn('No password detected for remote host');
    hasWarnings = true;
  }

  if (parsed.looksLikeSupabasePooler && parsed.sslmode === 'disable') {
    logWarn('sslmode=disable with Supabase Pooler may fail');
    console.log('  Supabase requires SSL for pooler connections');
    hasWarnings = true;
  }

  if (!hasWarnings) {
    logOk('No obvious issues detected');
  }

  // Step 5: Determine SSL config
  console.log('');
  logInfo('Determining SSL configuration...');
  const sslConfig = getSslConfig(parsed);
  console.log(`  SSL: ${sslConfig.ssl ? 'enabled' : 'disabled'}`);
  if (sslConfig.ssl) {
    console.log(`  rejectUnauthorized: ${sslConfig.ssl.rejectUnauthorized}`);
  }
  console.log(`  Reason: ${sslConfig.reason}`);

  // Step 6: TCP reachability test (DEV_014)
  console.log('');
  logInfo('Testing TCP connectivity...');
  const port = parseInt(parsed.port, 10) || 5432;
  const tcpResult = await testTcpConnectivity(parsed.host, port, 5000);

  if (tcpResult.ok) {
    logOk(`TCP port ${port} is reachable (${tcpResult.latencyMs}ms)`);
  } else {
    logError(`TCP port ${port} is NOT reachable (${tcpResult.error})`);

    // Try alternate port for Supabase
    if (parsed.looksLikeSupabasePooler || parsed.looksLikeSupabaseDirect) {
      const altPort = port === 5432 ? 6543 : 5432;
      console.log(`  Trying alternate port ${altPort}...`);
      const altResult = await testTcpConnectivity(parsed.host, altPort, 5000);
      if (altResult.ok) {
        logWarn(`Port ${altPort} IS reachable - you may need to change the port in DATABASE_URL`);
      } else {
        logError(`Port ${altPort} also not reachable`);
      }
    }

    console.log('');
    logInfo('Network troubleshooting:');
    console.log('  - Check if you are on VPN (try disabling)');
    console.log('  - Check Supabase Dashboard > Settings > Database > Network Restrictions');
    console.log('  - If IP allowlist is enabled, add your current IP');
    console.log('  - Get your IP: curl -s ifconfig.me');
    console.log('');
    process.exit(3);
  }

  // Step 7: Attempt connection
  console.log('');
  logInfo('Attempting database connection...');

  const poolConfig = getPoolConfig(parsed, sslConfig);
  // Add password from original URL
  try {
    const url = new URL(dbUrl);
    poolConfig.password = url.password;
  } catch {
    // If URL parsing fails, try to use the full connection string
    // This is a fallback
  }

  const pool = new Pool(poolConfig);

  const startTime = Date.now();
  try {
    const result = await pool.query('SELECT 1 AS ok, current_database() AS db, current_user AS user');
    const latency = Date.now() - startTime;

    logOk(`Connection successful! (${latency}ms)`);
    console.log(`  Database: ${result.rows[0].db}`);
    console.log(`  User:     ${result.rows[0].user}`);

    // Quick sanity: check if trapper schema exists
    console.log('');
    logInfo('Checking for trapper schema...');
    try {
      const schemaCheck = await pool.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.schemata WHERE schema_name = 'trapper'
        ) AS exists
      `);
      if (schemaCheck.rows[0].exists) {
        logOk('trapper schema exists');
      } else {
        logWarn('trapper schema not found (may need to run migrations)');
      }
    } catch (e) {
      logWarn(`Could not check schema: ${e.message}`);
    }

    await pool.end();

    console.log('');
    console.log('========================================');
    console.log(`  ${GREEN}DB CONNECTION OK${NC}`);
    console.log('========================================');
    console.log('');
    process.exit(0);

  } catch (error) {
    const latency = Date.now() - startTime;
    logError(`Connection failed after ${latency}ms`);
    console.log('');

    // Analyze the error
    console.log('Error details:');
    console.log(`  Name:    ${error.name}`);
    console.log(`  Code:    ${error.code || '(none)'}`);
    console.log(`  Message: ${error.message}`);

    // Provide specific guidance based on error type
    console.log('');
    logInfo('Troubleshooting suggestions:');

    if (error.code === 'ECONNREFUSED') {
      console.log('  - Database server is not running or not accepting connections');
      console.log('  - Check if the host and port are correct');
      if (parsed.looksLikeLocalhost) {
        console.log('  - For local Postgres: sudo service postgresql start');
      }
    } else if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN') {
      console.log('  - DNS lookup failed - hostname could not be resolved');
      console.log('  - Check your network connection');
      console.log('  - Verify the host in DATABASE_URL is correct');
    } else if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
      console.log('  - Connection timed out');
      console.log('');
      console.log('  IMPORTANT: TCP was reachable but PostgreSQL connection timed out.');
      console.log('  This is the classic symptom of Supabase Network Restrictions.');
      console.log('');
      console.log('  To fix:');
      console.log('    1. Go to Supabase Dashboard > Settings > Database');
      console.log('    2. Scroll to "Network Restrictions"');
      console.log('    3. Either:');
      console.log('       a) Disable "Enable network restrictions" (easiest for dev)');
      console.log('       b) Add your IP to the allowlist (more secure)');
      console.log('');
      console.log('  Get your IP: curl -s ifconfig.me');
      console.log('');
      if (parsed.looksLikeSupabaseDirect) {
        console.log('  Also: You are using direct connection (5432).');
        console.log('  Try Supabase Pooler URL (port 6543) from Dashboard.');
      }
      console.log('  - Check if VPN is affecting your IP');
    } else if (error.code === '28P01' || error.code === '28000' || error.message.includes('auth')) {
      console.log('  - Authentication failed');
      console.log('  - Check username and password are correct');
      console.log('  - For Supabase pooler, user should be: postgres.[project-ref]');
      if (parsed.passwordHasSpecialChars) {
        console.log('  - Your password has special chars - ensure they are URL-encoded');
      }
    } else if (error.message.includes('SSL') || error.message.includes('ssl')) {
      console.log('  - SSL/TLS handshake failed');
      console.log('  - Try adding ?sslmode=require to DATABASE_URL');
      if (parsed.looksLikeSupabasePooler) {
        console.log('  - Supabase pooler requires SSL');
      }
    } else if (error.message.includes('handshake')) {
      console.log('  - Connection handshake failed');
      if (parsed.looksLikeSupabasePooler) {
        console.log('  - For Supabase Pooler: ensure you copied the full connection string');
        console.log('  - User format should be: postgres.[project-ref]');
        console.log('  - Password should be your Supabase DB password');
      }
    }

    await pool.end();

    console.log('');
    console.log('========================================');
    console.log(`  ${RED}DB CONNECTION FAILED${NC}`);
    console.log('========================================');
    console.log('');
    process.exit(3);
  }
}

// Run
runDiagnostics().catch(e => {
  logError(`Unexpected error: ${e.message}`);
  process.exit(1);
});
