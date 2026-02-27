#!/usr/bin/env npx tsx
/**
 * ClinicHQ Notes Ingestion Script
 *
 * Ingests scraped ClinicHQ client accounts with quick notes and long notes.
 * Matches to existing clinic_accounts by client_id, email, phone, or display_name.
 * Creates new clinic_accounts for unmatched records.
 *
 * Usage:
 *   source apps/web/.env.local && npx tsx scripts/ingest-v2/clinichq_notes_ingest.ts \
 *     --csv "/path/to/clinichq_people_notes.csv" \
 *     [--dry-run] \
 *     [--batch-size 100]
 */

import * as fs from "fs";
import * as path from "path";
import { parseArgs } from "util";
import { parse } from "csv-parse/sync";
import { Pool, QueryResultRow } from "pg";

// ============================================================================
// Configuration
// ============================================================================

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL environment variable.");
  console.error("");
  console.error("Run with:");
  console.error("  source apps/web/.env.local && npx tsx scripts/ingest-v2/clinichq_notes_ingest.ts ...");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on("error", (err) => {
  console.error("Database pool error:", err);
});

// ============================================================================
// Database Helper Functions
// ============================================================================

async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const client = await pool.connect();
  try {
    const result = await client.query<T>(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
}

async function queryOne<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] || null;
}

// ============================================================================
// Types
// ============================================================================

interface CsvRow {
  client_id: string;
  "Client Name": string;
  "Cell Phone": string;
  "Other Phone": string;
  "Email": string;
  "Address": string;
  "Quick Notes": string;
  "Tags": string;
  "Long Notes": string;
}

interface Stats {
  total: number;
  processed: number;
  updated: number;
  created: number;
  skipped: number;
  noNotes: number;
  errors: number;
  lastError?: string;
}

// ============================================================================
// Main Processing
// ============================================================================

async function processRow(
  row: CsvRow,
  stats: Stats,
  dryRun: boolean
): Promise<void> {
  const clientId = row.client_id ? parseInt(row.client_id, 10) : null;
  const name = row["Client Name"]?.trim() || null;
  const cellPhone = row["Cell Phone"]?.trim() || null;
  const otherPhone = row["Other Phone"]?.trim() || null;
  const email = row["Email"]?.trim() || null;
  const address = row["Address"]?.trim() || null;
  const quickNotes = row["Quick Notes"]?.trim() || null;
  const tags = row["Tags"]?.trim() || null;
  const longNotes = row["Long Notes"]?.trim() || null;

  // Skip if no meaningful data
  if (!clientId && !name) {
    stats.skipped++;
    return;
  }

  // Track records with no notes (still process them to link clinichq_client_id)
  if (!quickNotes && !longNotes && !tags) {
    stats.noNotes++;
  }

  if (dryRun) {
    stats.processed++;
    return;
  }

  try {
    const result = await queryOne<{ account_id: string; action: string }>(`
      SELECT * FROM ops.upsert_clinichq_notes(
        p_clinichq_client_id := $1,
        p_name := $2,
        p_email := $3,
        p_cell_phone := $4,
        p_other_phone := $5,
        p_address := $6,
        p_quick_notes := $7,
        p_long_notes := $8,
        p_tags := $9
      )
    `, [
      clientId,
      name,
      email,
      cellPhone,
      otherPhone,
      address,
      quickNotes,
      longNotes,
      tags,
    ]);

    if (result) {
      if (result.action === "updated") stats.updated++;
      else if (result.action === "created") stats.created++;
      else if (result.action === "skipped") stats.skipped++;
    }

    stats.processed++;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    stats.errors++;
    stats.lastError = `Row ${stats.total}: ${errorMsg}`;
    throw err;
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const { values } = parseArgs({
    options: {
      "csv": { type: "string" },
      "dry-run": { type: "boolean", default: false },
      "batch-size": { type: "string", default: "100" },
    },
  });

  const csvPath = values["csv"];
  const dryRun = values["dry-run"] || false;
  const batchSize = parseInt(values["batch-size"] || "100", 10);

  if (!csvPath) {
    console.error("Usage: npx tsx scripts/ingest-v2/clinichq_notes_ingest.ts \\");
    console.error("  --csv '/path/to/clinichq_people_notes.csv' \\");
    console.error("  [--dry-run] [--batch-size 100]");
    process.exit(1);
  }

  console.log("=".repeat(60));
  console.log("ClinicHQ Notes Ingestion");
  console.log("=".repeat(60));
  console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`CSV: ${csvPath}`);
  console.log(`Batch size: ${batchSize}`);
  console.log(`Database: ${DATABASE_URL?.substring(0, 50)}...`);
  console.log("");

  // Test database connection
  console.log("Testing database connection...");
  try {
    const test = await queryOne<{ version: string }>("SELECT version()");
    console.log(`Connected: ${test?.version?.substring(0, 50)}...`);
  } catch (err) {
    console.error("Database connection failed:", err);
    process.exit(1);
  }

  // Verify the upsert function exists
  console.log("\nVerifying ops.upsert_clinichq_notes exists...");
  try {
    const fnCheck = await queryOne<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'ops' AND p.proname = 'upsert_clinichq_notes'
      ) as exists
    `);
    if (!fnCheck?.exists) {
      console.error("ERROR: ops.upsert_clinichq_notes function not found!");
      console.error("Run the migration first: MIG_2550__clinichq_client_notes.sql");
      process.exit(1);
    }
    console.log("  Function exists");
  } catch (err) {
    console.error("Error checking function:", err);
    process.exit(1);
  }

  // Read and parse CSV
  console.log("\nReading CSV...");
  if (!fs.existsSync(csvPath)) {
    console.error(`File not found: ${csvPath}`);
    process.exit(1);
  }

  const csvContent = fs.readFileSync(csvPath, "utf-8");
  const rows: CsvRow[] = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
  });

  console.log(`  ${rows.length} records found`);

  // Analyze data
  let hasQuickNotes = 0;
  let hasLongNotes = 0;
  let hasAnyNotes = 0;
  let hasEmail = 0;
  let hasPhone = 0;

  for (const row of rows) {
    if (row["Quick Notes"]?.trim()) hasQuickNotes++;
    if (row["Long Notes"]?.trim()) hasLongNotes++;
    if (row["Quick Notes"]?.trim() || row["Long Notes"]?.trim() || row["Tags"]?.trim()) hasAnyNotes++;
    if (row["Email"]?.trim()) hasEmail++;
    if (row["Cell Phone"]?.trim() || row["Other Phone"]?.trim()) hasPhone++;
  }

  console.log("\nData Analysis:");
  console.log(`  Has Quick Notes: ${hasQuickNotes} (${((hasQuickNotes / rows.length) * 100).toFixed(1)}%)`);
  console.log(`  Has Long Notes: ${hasLongNotes} (${((hasLongNotes / rows.length) * 100).toFixed(1)}%)`);
  console.log(`  Has ANY notes: ${hasAnyNotes} (${((hasAnyNotes / rows.length) * 100).toFixed(1)}%)`);
  console.log(`  Has Email: ${hasEmail} (${((hasEmail / rows.length) * 100).toFixed(1)}%)`);
  console.log(`  Has Phone: ${hasPhone} (${((hasPhone / rows.length) * 100).toFixed(1)}%)`);

  // Initialize stats
  const stats: Stats = {
    total: rows.length,
    processed: 0,
    updated: 0,
    created: 0,
    skipped: 0,
    noNotes: 0,
    errors: 0,
  };

  // Process rows
  console.log("\nProcessing...");
  const startTime = Date.now();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    try {
      await processRow(row, stats, dryRun);
    } catch (err) {
      // Error already logged in processRow
      // Continue processing
    }

    // Progress update
    if ((i + 1) % batchSize === 0 || i === rows.length - 1) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const rate = (stats.processed / parseFloat(elapsed)).toFixed(1);
      const pct = ((i + 1) / rows.length * 100).toFixed(1);

      console.log("");
      console.log(`[${new Date().toISOString()}] Progress: ${i + 1}/${rows.length} (${pct}%)`);
      console.log(`  Elapsed: ${elapsed}s | Rate: ${rate} rows/s`);
      console.log(`  Updated: ${stats.updated} | Created: ${stats.created} | Skipped: ${stats.skipped}`);
      console.log(`  No notes (but linked ID): ${stats.noNotes}`);
      console.log(`  Errors: ${stats.errors}`);
      if (stats.lastError) console.log(`  Last error: ${stats.lastError}`);

      // Save progress file for tracking
      const progressFile = path.join(path.dirname(csvPath), ".notes_ingest_progress.json");
      fs.writeFileSync(progressFile, JSON.stringify({
        lastProcessed: i,
        timestamp: new Date().toISOString(),
        stats,
      }, null, 2));
    }
  }

  // Final stats
  console.log("\n" + "=".repeat(60));
  console.log("COMPLETE");
  console.log("=".repeat(60));
  console.log(JSON.stringify(stats, null, 2));

  // Gap analysis
  if (!dryRun) {
    console.log("\n" + "=".repeat(60));
    console.log("Gap Analysis");
    console.log("=".repeat(60));

    // Newly created accounts (gaps we filled)
    const newAccounts = await queryOne<{ count: string }>(`
      SELECT COUNT(*) as count FROM ops.clinic_accounts
      WHERE clinichq_client_id IS NOT NULL
      AND created_at > NOW() - INTERVAL '1 hour'
    `);
    console.log(`\nNew accounts created (gaps filled): ${newAccounts?.count || 0}`);

    // Accounts with notes now
    const withNotes = await queryOne<{ count: string }>(`
      SELECT COUNT(*) as count FROM ops.clinic_accounts
      WHERE (quick_notes IS NOT NULL OR long_notes IS NOT NULL)
    `);
    console.log(`Total accounts with notes: ${withNotes?.count || 0}`);

    // Accounts with clinichq_client_id
    const withClientId = await queryOne<{ count: string }>(`
      SELECT COUNT(*) as count FROM ops.clinic_accounts
      WHERE clinichq_client_id IS NOT NULL
    `);
    console.log(`Total accounts with clinichq_client_id: ${withClientId?.count || 0}`);
  }

  // Cleanup
  await pool.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
