#!/usr/bin/env node
/**
 * smoke_db.mjs - Atlas Database Smoke Test
 *
 * Verifies:
 * 1. DATABASE_URL is set
 * 2. Can connect to database
 * 3. PostGIS extension enabled
 * 4. Required schemas exist
 * 5. Required tables exist
 *
 * Usage:
 *   set -a && source .env && set +a
 *   ./scripts/smoke_db.mjs
 *
 * Or with node:
 *   node scripts/smoke_db.mjs
 */

import pg from 'pg';

const { Client } = pg;

// ANSI colors for output
const green = '\x1b[32m';
const red = '\x1b[31m';
const yellow = '\x1b[33m';
const cyan = '\x1b[36m';
const reset = '\x1b[0m';
const bold = '\x1b[1m';

const PASS = `${green}✓${reset}`;
const FAIL = `${red}✗${reset}`;
const WARN = `${yellow}!${reset}`;

// Required items
const REQUIRED_EXTENSIONS = ['postgis', 'pg_trgm'];
const REQUIRED_SCHEMAS = ['trapper'];
const REQUIRED_TABLES = [
  'ops.staged_records',
  'ops.appointment_requests',
  'ops.clinichq_upcoming_appointments',
  'ops.data_issues',
];

let client = null;
let exitCode = 0;

function log(status, message) {
  console.log(`  ${status} ${message}`);
}

function header(title) {
  console.log(`\n${cyan}${bold}${title}${reset}`);
  console.log('─'.repeat(50));
}

async function checkDatabaseUrl() {
  header('1. Environment Check');

  const dbUrl = process.env.DATABASE_URL;

  if (!dbUrl) {
    log(FAIL, 'DATABASE_URL not set');
    console.log(`\n${red}Fix:${reset} Load your .env file first:`);
    console.log('  set -a && source .env && set +a');
    return false;
  }

  // Parse URL to show connection info (without password)
  try {
    const url = new URL(dbUrl);
    log(PASS, `DATABASE_URL set (${url.hostname}:${url.port || 5432})`);

    // Check if using pooler vs direct
    if (url.port === '6543') {
      log(WARN, 'Using pooler port (6543). For local dev, consider direct port (5432)');
    } else if (url.port === '5432') {
      log(PASS, 'Using direct port (5432) - good for local development');
    }

    return true;
  } catch (e) {
    log(FAIL, 'DATABASE_URL is not a valid URL');
    return false;
  }
}

async function connectToDatabase() {
  header('2. Database Connection');

  client = new Client({ connectionString: process.env.DATABASE_URL });

  try {
    await client.connect();
    log(PASS, 'Connected to database');

    // Get server version
    const result = await client.query('SELECT version()');
    const version = result.rows[0].version.split(' ').slice(0, 2).join(' ');
    log(PASS, `Server: ${version}`);

    return true;
  } catch (e) {
    log(FAIL, `Connection failed: ${e.message}`);

    if (e.message.includes('timeout')) {
      console.log(`\n${yellow}Possible causes:${reset}`);
      console.log('  - Supabase Network Restrictions blocking your IP');
      console.log('  - Check: Supabase Dashboard → Settings → Database → Network Restrictions');
    } else if (e.message.includes('password')) {
      console.log(`\n${yellow}Fix:${reset} Check DATABASE_URL password in .env`);
    }

    return false;
  }
}

async function checkExtensions() {
  header('3. Extensions');

  const result = await client.query(`
    SELECT extname, extversion
    FROM pg_extension
    WHERE extname = ANY($1)
  `, [REQUIRED_EXTENSIONS]);

  const installed = new Set(result.rows.map(r => r.extname));
  let allPass = true;

  for (const ext of REQUIRED_EXTENSIONS) {
    if (installed.has(ext)) {
      const version = result.rows.find(r => r.extname === ext)?.extversion;
      log(PASS, `${ext} (${version})`);
    } else {
      log(FAIL, `${ext} - NOT INSTALLED`);
      allPass = false;
    }
  }

  if (!allPass) {
    console.log(`\n${yellow}Fix:${reset} Run bootstrap migration:`);
    console.log('  psql "$DATABASE_URL" -f sql/migrations/MIG_001__atlas_bootstrap.sql');
  }

  return allPass;
}

async function checkSchemas() {
  header('4. Schemas');

  const result = await client.query(`
    SELECT schema_name
    FROM information_schema.schemata
    WHERE schema_name = ANY($1)
  `, [REQUIRED_SCHEMAS]);

  const existing = new Set(result.rows.map(r => r.schema_name));
  let allPass = true;

  for (const schema of REQUIRED_SCHEMAS) {
    if (existing.has(schema)) {
      log(PASS, `Schema: ${schema}`);
    } else {
      log(FAIL, `Schema: ${schema} - NOT FOUND`);
      allPass = false;
    }
  }

  if (!allPass) {
    console.log(`\n${yellow}Fix:${reset} Run bootstrap migration:`);
    console.log('  psql "$DATABASE_URL" -f sql/migrations/MIG_001__atlas_bootstrap.sql');
  }

  return allPass;
}

async function checkTables() {
  header('5. Required Tables');

  let allPass = true;

  for (const fullName of REQUIRED_TABLES) {
    const [schema, table] = fullName.split('.');

    const result = await client.query(`
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = $1 AND table_name = $2
    `, [schema, table]);

    if (result.rows.length > 0) {
      // Get row count
      const countResult = await client.query(`SELECT COUNT(*)::int AS count FROM ${fullName}`);
      const count = countResult.rows[0].count;
      log(PASS, `${fullName} (${count} rows)`);
    } else {
      log(FAIL, `${fullName} - NOT FOUND`);
      allPass = false;
    }
  }

  if (!allPass) {
    console.log(`\n${yellow}Fix:${reset} Run bootstrap migration:`);
    console.log('  psql "$DATABASE_URL" -f sql/migrations/MIG_001__atlas_bootstrap.sql');
  }

  return allPass;
}

async function checkUniqueConstraints() {
  header('6. Idempotency Constraints');

  const criticalConstraints = [
    { table: 'ops.staged_records', constraint: 'staged_records_idempotency_key' },
    { table: 'ops.appointment_requests', constraint: 'appointment_requests_source_row_hash_key' },
    { table: 'ops.clinichq_upcoming_appointments', constraint: 'clinichq_upcoming_source_row_hash_key' },
  ];

  let allPass = true;

  for (const { table, constraint } of criticalConstraints) {
    const result = await client.query(`
      SELECT 1 FROM information_schema.table_constraints
      WHERE table_schema || '.' || table_name = $1
        AND constraint_name = $2
        AND constraint_type = 'UNIQUE'
    `, [table, constraint]);

    if (result.rows.length > 0) {
      log(PASS, `${constraint}`);
    } else {
      log(WARN, `${constraint} - NOT FOUND (re-run may create duplicates)`);
      // Not a failure, just a warning
    }
  }

  return allPass;
}

async function printSummary(results) {
  header('Summary');

  const passed = Object.values(results).filter(r => r === true).length;
  const total = Object.values(results).length;

  if (passed === total) {
    console.log(`\n${green}${bold}All checks passed! (${passed}/${total})${reset}`);
    console.log(`\n${cyan}Ready for ingest:${reset}`);
    console.log('  See docs/runbooks/FIRST_INGEST.md');
  } else {
    console.log(`\n${red}${bold}Some checks failed (${passed}/${total})${reset}`);
    console.log(`\n${cyan}What to do next:${reset}`);

    if (!results.dbUrl) {
      console.log('  1. Load environment: set -a && source .env && set +a');
    } else if (!results.connection) {
      console.log('  1. Check Supabase Network Restrictions (if using Supabase)');
      console.log('  2. Verify DATABASE_URL in .env');
    } else {
      console.log('  1. Run bootstrap: psql "$DATABASE_URL" -f sql/migrations/MIG_001__atlas_bootstrap.sql');
      console.log('  2. Re-run smoke test: ./scripts/smoke_db.mjs');
    }

    exitCode = 1;
  }
}

async function main() {
  console.log(`\n${bold}Atlas Database Smoke Test${reset}`);
  console.log('═'.repeat(50));

  const results = {};

  // Check DATABASE_URL
  results.dbUrl = await checkDatabaseUrl();
  if (!results.dbUrl) {
    await printSummary(results);
    process.exit(1);
  }

  // Connect to database
  results.connection = await connectToDatabase();
  if (!results.connection) {
    await printSummary(results);
    process.exit(1);
  }

  // Run remaining checks
  try {
    results.extensions = await checkExtensions();
    results.schemas = await checkSchemas();
    results.tables = await checkTables();
    results.constraints = await checkUniqueConstraints();
  } finally {
    if (client) {
      await client.end();
    }
  }

  await printSummary(results);
  process.exit(exitCode);
}

main().catch(e => {
  console.error(`${red}Unexpected error:${reset}`, e.message);
  process.exit(1);
});
