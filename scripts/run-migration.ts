/**
 * Quick migration runner for V2 schema fixes
 * Usage: npx tsx scripts/run-migration.ts
 */

import { Pool } from "pg";
import * as fs from "fs";
import * as path from "path";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("DATABASE_URL not set. Run with: npx tsx scripts/run-migration.ts");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
});

async function runMigration() {
  const sqlPath = path.join(__dirname, "../sql/schema/v2/MIG_2006__fix_v2_schema_for_clinichq_route_supabase.sql");
  const sql = fs.readFileSync(sqlPath, "utf-8");

  console.log("Running MIG_2006...");
  console.log("");

  // Split by semicolons and run each statement
  const statements = sql
    .split(";")
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith("--"));

  for (const stmt of statements) {
    try {
      console.log(`Executing: ${stmt.substring(0, 80)}...`);
      const result = await pool.query(stmt);
      if (result.rows?.length > 0) {
        console.table(result.rows);
      }
      console.log("✓ Done\n");
    } catch (err: any) {
      // Some errors are OK (like "column already exists")
      if (err.message.includes("already exists") || err.message.includes("does not exist")) {
        console.log(`⚠ Skipped: ${err.message.substring(0, 80)}\n`);
      } else {
        console.error(`✗ Error: ${err.message}\n`);
      }
    }
  }

  await pool.end();
  console.log("Migration complete!");
}

runMigration().catch(console.error);
