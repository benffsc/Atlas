#!/usr/bin/env node
// Simple script to run SQL migrations via pg

import fs from 'fs';
import pg from 'pg';

const { Pool } = pg;

const migrationFile = process.argv[2];

if (!migrationFile) {
  console.error('Usage: node scripts/run-migration.mjs <migration-file.sql>');
  process.exit(1);
}

const sql = fs.readFileSync(migrationFile, 'utf8');

// Remove psql-specific commands like \echo
const cleanSql = sql
  .split('\n')
  .filter(line => !line.trim().startsWith('\\echo'))
  .join('\n');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    console.log(`Running migration: ${migrationFile}`);
    await client.query(cleanSql);
    console.log('Migration complete!');
  } catch (err) {
    console.error('Migration error:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(() => process.exit(1));
