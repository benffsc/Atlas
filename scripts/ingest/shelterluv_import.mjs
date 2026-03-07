#!/usr/bin/env node

/**
 * ShelterLuv Data Import Script (Data Engine Version)
 *
 * Imports Animals, People, and Outcomes from ShelterLuv Excel exports.
 * Uses the Data Engine pipeline for proper identity resolution.
 *
 * Usage:
 *   node scripts/ingest/shelterluv_import.mjs --all
 *   node scripts/ingest/shelterluv_import.mjs --animals /path/to/animals.xlsx
 *
 * Options:
 *   --dry-run     Only count records, don't import
 *   --limit N     Process only first N records
 *   --process     Run data engine processing after staging
 */

import XLSX from "xlsx";
import pg from "pg";
import crypto from "crypto";
import { parseArgs } from "util";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const SOURCE_SYSTEM = "shelterluv";

// Default file paths (from today's ShelterLuv export)
const DEFAULT_PEOPLE_FILE = "/Users/benmisdiaz/Downloads/custom-report-report-2026-01-19-050101.xlsx";
const DEFAULT_ANIMALS_FILE = "/Users/benmisdiaz/Downloads/custom-report-report-2026-01-19-050129.xlsx";
const DEFAULT_OUTCOMES_FILE = "/Users/benmisdiaz/Downloads/custom-report-report-2026-01-19-050159.xlsx";

// Parse command line arguments
const { values: args } = parseArgs({
  allowPositionals: true,
  options: {
    animals: { type: "string" },
    people: { type: "string" },
    outcomes: { type: "string" },
    all: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    limit: { type: "string" },
    process: { type: "boolean", default: false },
    help: { type: "boolean", short: "h" },
  },
});

if (args.help) {
  console.log(`
ShelterLuv Data Import Script (Data Engine Version)

Usage:
  node scripts/ingest/shelterluv_import.mjs --all
  node scripts/ingest/shelterluv_import.mjs --animals /path/to/animals.xlsx

Options:
  --dry-run     Only count records, don't import
  --limit N     Process only first N records
  --process     Run data engine processing after staging
  --help, -h    Show this help message
`);
  process.exit(0);
}

/**
 * Read Excel file and return array of objects
 */
function readExcel(filePath) {
  console.log(`Reading ${filePath}...`);
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(sheet);
  console.log(`  Found ${data.length} rows`);
  return data;
}

/**
 * Generate row hash for deduplication
 */
function generateRowHash(payload) {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/**
 * Stage a single record into staged_records
 */
async function stageRecord(client, sourceTable, sourceRowId, payload) {
  const rowHash = generateRowHash(payload);

  // Check if already staged (idempotent)
  const existing = await client.query(
    `SELECT id FROM ops.staged_records
     WHERE source_system = $1 AND source_table = $2 AND source_row_id = $3`,
    [SOURCE_SYSTEM, sourceTable, sourceRowId]
  );

  if (existing.rows.length > 0) {
    return { staged: false, reason: "already_exists" };
  }

  await client.query(
    `INSERT INTO ops.staged_records
     (source_system, source_table, source_row_id, row_hash, payload)
     VALUES ($1, $2, $3, $4, $5)`,
    [SOURCE_SYSTEM, sourceTable, sourceRowId, rowHash, payload]
  );

  return { staged: true };
}

/**
 * Stage people records
 */
async function stagePeople(client, records, limit) {
  console.log("\n=== Staging People ===");

  const toProcess = limit ? records.slice(0, limit) : records;
  console.log(`Staging ${toProcess.length} of ${records.length} records...`);

  let staged = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const p = toProcess[i];

    if (i > 0 && i % 500 === 0) {
      console.log(`  Progress: ${i}/${toProcess.length} (${staged} staged, ${skipped} skipped)`);
    }

    try {
      const personId = p["Person ID"];
      if (!personId) {
        skipped++;
        continue;
      }

      // Skip if no identifiable info
      if (!p["Primary Email"] && !p["Primary Phone"] && !p.Name) {
        skipped++;
        continue;
      }

      const result = await stageRecord(
        client,
        "people",
        `sl_person_${personId}`,
        p
      );

      if (result.staged) {
        staged++;
      } else {
        skipped++;
      }
    } catch (error) {
      console.error(`  Error staging person ${p["Person ID"]}:`, error.message);
      errors++;
    }
  }

  console.log(`  Complete: ${staged} staged, ${skipped} skipped, ${errors} errors`);
  return { staged, skipped, errors };
}

/**
 * Stage animal records
 */
async function stageAnimals(client, records, limit) {
  console.log("\n=== Staging Animals ===");

  const toProcess = limit ? records.slice(0, limit) : records;
  console.log(`Staging ${toProcess.length} of ${records.length} records...`);

  let staged = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const a = toProcess[i];

    if (i > 0 && i % 500 === 0) {
      console.log(`  Progress: ${i}/${toProcess.length} (${staged} staged, ${skipped} skipped)`);
    }

    try {
      // Skip non-cats
      if (a.Species && a.Species.toLowerCase() !== "cat") {
        skipped++;
        continue;
      }

      const animalId = a["Animal ID"];
      if (!animalId) {
        skipped++;
        continue;
      }

      const result = await stageRecord(
        client,
        "animals",
        `sl_animal_${animalId}`,
        a
      );

      if (result.staged) {
        staged++;
      } else {
        skipped++;
      }
    } catch (error) {
      console.error(`  Error staging animal ${a["Animal ID"]}:`, error.message);
      errors++;
    }
  }

  console.log(`  Complete: ${staged} staged, ${skipped} skipped, ${errors} errors`);
  return { staged, skipped, errors };
}

/**
 * Stage outcome records
 */
async function stageOutcomes(client, records, limit) {
  console.log("\n=== Staging Outcomes ===");

  const toProcess = limit ? records.slice(0, limit) : records;
  console.log(`Staging ${toProcess.length} of ${records.length} records...`);

  let staged = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const o = toProcess[i];

    if (i > 0 && i % 500 === 0) {
      console.log(`  Progress: ${i}/${toProcess.length} (${staged} staged, ${skipped} skipped)`);
    }

    try {
      // Create a unique ID from outcome fields
      const outcomeId = o["Outcome ID"] || o["Animal ID"] + "_" + (o["Outcome Date"] || i);
      if (!outcomeId) {
        skipped++;
        continue;
      }

      const result = await stageRecord(
        client,
        "outcomes",
        `sl_outcome_${outcomeId}`,
        o
      );

      if (result.staged) {
        staged++;
      } else {
        skipped++;
      }
    } catch (error) {
      console.error(`  Error staging outcome:`, error.message);
      errors++;
    }
  }

  console.log(`  Complete: ${staged} staged, ${skipped} skipped, ${errors} errors`);
  return { staged, skipped, errors };
}

/**
 * Queue data engine processing for staged records
 */
async function queueProcessing(client, sourceTable) {
  console.log(`\nQueuing data engine processing for ${sourceTable}...`);

  const result = await client.query(
    `INSERT INTO ops.processing_jobs
     (source_system, source_table, trigger_type, priority)
     VALUES ($1, $2, 'manual_import', 10)
     ON CONFLICT DO NOTHING
     RETURNING job_id`,
    [SOURCE_SYSTEM, sourceTable]
  );

  if (result.rows.length > 0) {
    console.log(`  Created job: ${result.rows[0].job_id}`);
    return result.rows[0].job_id;
  } else {
    console.log(`  Job already exists for ${sourceTable}`);
    return null;
  }
}

/**
 * Run data engine processing
 */
async function runProcessing(client, batchSize = 500) {
  console.log("\n=== Running Data Engine Processing ===");

  const result = await client.query(
    `SELECT * FROM ops.data_engine_process_batch($1, NULL, $2, NULL)`,
    [SOURCE_SYSTEM, batchSize]
  );

  const stats = result.rows[0]?.data_engine_process_batch;
  console.log("Processing results:", stats);
  return stats;
}

/**
 * Main function
 */
async function main() {
  const client = await pool.connect();
  const limit = args.limit ? parseInt(args.limit, 10) : null;

  try {
    console.log("=".repeat(60));
    console.log("  SHELTERLUV DATA IMPORT (Data Engine Pipeline)");
    console.log("=".repeat(60));

    if (args["dry-run"]) {
      console.log("\n[DRY RUN MODE - No data will be modified]");
    }

    // Determine files to process
    const peopleFile = args.people || (args.all ? DEFAULT_PEOPLE_FILE : null);
    const animalsFile = args.animals || (args.all ? DEFAULT_ANIMALS_FILE : null);
    const outcomesFile = args.outcomes || (args.all ? DEFAULT_OUTCOMES_FILE : null);

    if (!peopleFile && !animalsFile && !outcomesFile && !args.process) {
      console.log("\nNo files specified. Use --people, --animals, --outcomes, or --all");
      console.log("Use --help for usage information.");
      process.exit(1);
    }

    // Get initial counts
    const initialCounts = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM ops.staged_records WHERE source_system = 'shelterluv') as staged,
        (SELECT COUNT(*) FROM sot.cats WHERE data_source = 'shelterluv') as cats,
        (SELECT COUNT(*) FROM sot.people WHERE data_source = 'shelterluv') as people
    `);

    console.log(`\nInitial ShelterLuv records in database:`);
    console.log(`  Staged: ${initialCounts.rows[0].staged}`);
    console.log(`  Cats: ${initialCounts.rows[0].cats}`);
    console.log(`  People: ${initialCounts.rows[0].people}`);

    // Stage files
    const stagingStats = {};

    if (!args["dry-run"]) {
      if (peopleFile) {
        const people = readExcel(peopleFile);
        stagingStats.people = await stagePeople(client, people, limit);
        await queueProcessing(client, "people");
      }

      if (animalsFile) {
        const animals = readExcel(animalsFile);
        stagingStats.animals = await stageAnimals(client, animals, limit);
        await queueProcessing(client, "animals");
      }

      if (outcomesFile) {
        const outcomes = readExcel(outcomesFile);
        stagingStats.outcomes = await stageOutcomes(client, outcomes, limit);
        await queueProcessing(client, "outcomes");
      }

    } else {
      // Dry run - just count records
      if (peopleFile) {
        const people = readExcel(peopleFile);
        const withIdentifiers = people.filter(p => p["Primary Email"] || p["Primary Phone"] || p.Name);
        console.log(`\nWould stage ${limit ? Math.min(withIdentifiers.length, limit) : withIdentifiers.length} people records`);
      }
      if (animalsFile) {
        const animals = readExcel(animalsFile);
        const cats = animals.filter(a => !a.Species || a.Species.toLowerCase() === "cat");
        console.log(`\nWould stage ${limit ? Math.min(cats.length, limit) : cats.length} animal records (${cats.length} cats)`);
      }
      if (outcomesFile) {
        const outcomes = readExcel(outcomesFile);
        console.log(`\nWould stage ${limit ? Math.min(outcomes.length, limit) : outcomes.length} outcome records`);
      }
    }

    // Run processing if requested (can run standalone with --process)
    if (args.process && !args["dry-run"]) {
      await runProcessing(client);
    }

    // Get final counts
    const finalCounts = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM ops.staged_records WHERE source_system = 'shelterluv') as staged,
        (SELECT COUNT(*) FROM sot.cats WHERE data_source = 'shelterluv') as cats,
        (SELECT COUNT(*) FROM sot.people WHERE data_source = 'shelterluv') as people
    `);

    // Summary
    console.log("\n" + "=".repeat(60));
    console.log("  IMPORT COMPLETE");
    console.log("=".repeat(60));

    console.log(`
Final ShelterLuv records in database:
  Staged: ${finalCounts.rows[0].staged} (${parseInt(finalCounts.rows[0].staged) - parseInt(initialCounts.rows[0].staged)} new)
  Cats:   ${finalCounts.rows[0].cats} (${parseInt(finalCounts.rows[0].cats) - parseInt(initialCounts.rows[0].cats)} new)
  People: ${finalCounts.rows[0].people} (${parseInt(finalCounts.rows[0].people) - parseInt(initialCounts.rows[0].people)} new)
`);

    if (!args["dry-run"] && !args.process) {
      console.log("To process staged records through the Data Engine, run:");
      console.log("  node scripts/ingest/shelterluv_import.mjs --process");
      console.log("");
      console.log("Or process interactively:");
      console.log("  SELECT * FROM ops.data_engine_process_batch('shelterluv', NULL, 500, NULL);");
    }

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Import failed:", error);
  process.exit(1);
});
