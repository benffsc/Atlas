#!/usr/bin/env node
/**
 * Master List Import Script
 *
 * Imports clinic day master list Excel files into clinic_day_entries.
 * Parses the client name to extract owner, trapper, and cat name.
 * Matches entries to ClinicHQ appointments.
 *
 * Usage:
 *   node scripts/ingest/master_list_import.mjs --file "Master List January 5, 2026.xlsx" --date 2026-01-05
 *   node scripts/ingest/master_list_import.mjs --file "..." --dry-run
 *
 * Or with manual env:
 *   set -a && source .env && set +a
 *   node scripts/ingest/master_list_import.mjs ...
 */

import { readFileSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import xlsx from "xlsx";

// Load .env file from project root
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "../../.env");
try {
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx);
        let value = trimmed.slice(eqIdx + 1);
        // Remove surrounding quotes
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  }
} catch {
  // .env file not found, rely on pre-set environment
}

const { Pool } = pg;

// Parse command line arguments
const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
};
const hasFlag = (name) => args.includes(`--${name}`);

const filePath = getArg("file");
const clinicDate = getArg("date");
const dryRun = hasFlag("dry-run");
const verbose = hasFlag("verbose");

if (!filePath) {
  console.error("Usage: node master_list_import.mjs --file <path> [--date YYYY-MM-DD] [--dry-run] [--verbose]");
  console.error("\nIf --date is not provided, will try to extract from filename.");
  process.exit(1);
}

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/**
 * Extract owner name from client name field
 * "Nina Van Sweden - Trp Crystal" → "Nina Van Sweden"
 * 'Paulina Binsfeld "Pumpkin" (drop off for dental)' → "Paulina Binsfeld"
 */
function extractOwnerName(clientName) {
  if (!clientName) return null;

  let name = clientName
    // Remove trapper suffix
    .replace(/\s*-\s*Trp\s+.+$/i, "")
    // Remove cat name in double quotes
    .replace(/"[^"]+"/g, "")
    // Remove cat name in single quote + double quote (typo pattern)
    .replace(/'[^"']+"/g, "")
    // Remove parenthetical notes
    .replace(/\s*\([^)]+\)/g, "")
    .trim();

  return name || null;
}

/**
 * Extract trapper name from client name field
 * "Nina Van Sweden - Trp Crystal" → "Crystal"
 * "Carlos Lopez - Trp Marin Friends of Ferals" → "Marin Friends of Ferals"
 * "Anytime Fitness - Trp Crystal (recheck pinnectomy)" → "Crystal"
 * "Old Stony Pt - Trp Moria - call 707-291-1226" → "Moria"
 */
function extractTrapperName(clientName) {
  if (!clientName) return null;

  // Match "- Trp " followed by name (until parenthesis, quote, "call", "-", or end)
  const match = clientName.match(/-\s*Trp\s+([^"(-]+?)(?:\s*["(-]|\s+call\s|\s*$)/i);
  if (match) {
    return match[1].trim();
  }
  return null;
}

/**
 * Extract cat name from quotes in client name field
 * 'Paulina Binsfeld "Pumpkin"' → "Pumpkin"
 * "Old Stony Point ""Pugsley"" (neuter)" → "Pugsley"
 * "Peyton Sargis 'Raider"" → "Raider"
 */
function extractCatName(clientName) {
  if (!clientName) return null;

  // Handle various quote patterns: "name", ""name"", 'name", etc.
  // First try double quotes
  let match = clientName.match(/"+"?([^"']+)"+"?/);
  if (match) {
    return match[1].trim();
  }
  // Try single quote followed by double quote (typo pattern)
  match = clientName.match(/'([^"']+)"/);
  if (match) {
    return match[1].trim();
  }
  return null;
}

/**
 * Extract date from filename
 * "Master List January 19, 2026.xlsx" → "2026-01-19"
 */
function extractDateFromFilename(filename) {
  // Try "Month Day, Year" pattern
  const monthNames = {
    january: "01", february: "02", march: "03", april: "04",
    may: "05", june: "06", july: "07", august: "08",
    september: "09", october: "10", november: "11", december: "12"
  };

  const match = filename.match(/(\w+)\s+(\d{1,2}),?\s+(\d{4})/i);
  if (match) {
    const [, month, day, year] = match;
    const monthNum = monthNames[month.toLowerCase()];
    if (monthNum) {
      return `${year}-${monthNum}-${day.padStart(2, "0")}`;
    }
  }

  return null;
}

/**
 * Parse master list Excel file
 */
function parseMasterList(filePath) {
  const workbook = xlsx.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  // Convert to array of arrays to handle the non-standard format
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  const entries = [];
  let headerRowIndex = -1;

  // Find the header row (contains "Client Name")
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const row = rows[i];
    if (row && row.some((cell) => String(cell).includes("Client Name"))) {
      headerRowIndex = i;
      break;
    }
  }

  if (headerRowIndex === -1) {
    console.error("Could not find header row with 'Client Name'");
    return { entries: [], date: null };
  }

  // Extract date from first row if present
  let extractedDate = null;
  if (rows[0] && rows[0].length > 0) {
    // Date might be in column E (index 4) based on the structure
    for (const cell of rows[0]) {
      if (cell && typeof cell === "string" && cell.match(/\d{1,2}-\w{3}-\d{2}/)) {
        // Format like "19-Jan-26"
        const parts = cell.match(/(\d{1,2})-(\w{3})-(\d{2})/);
        if (parts) {
          const monthMap = {
            jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
            jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12"
          };
          const [, day, mon, yr] = parts;
          const month = monthMap[mon.toLowerCase()];
          const year = parseInt(yr) > 50 ? `19${yr}` : `20${yr}`;
          extractedDate = `${year}-${month}-${day.padStart(2, "0")}`;
        }
      }
    }
  }

  // Parse header to get column indices
  const header = rows[headerRowIndex];
  const colIndex = {};
  header.forEach((cell, idx) => {
    const cellStr = String(cell).trim();
    if (cellStr === "F") colIndex.F = idx;
    else if (cellStr === "M") colIndex.M = idx;
    else if (cellStr === "A/W" || cellStr === "A") colIndex.AW = idx;
    else if (cellStr === "#") colIndex.num = idx;
    else if (cellStr.includes("Client Name")) colIndex.clientName = idx;
    else if (cellStr === "Test") colIndex.test = idx;
    else if (cellStr === "Result") colIndex.result = idx;
    else if (cellStr === "$") colIndex.fee = idx;
    else if (cellStr === "MISCELLANEOUS") colIndex.misc = idx;
    else if (cellStr === "Status") colIndex.status = idx;
  });

  if (colIndex.clientName === undefined) {
    console.error("Could not find Client Name column");
    return { entries: [], date: extractedDate };
  }

  // Process data rows
  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const lineNum = row[colIndex.num];
    const clientName = String(row[colIndex.clientName] || "").trim();

    // Skip empty rows or summary rows
    if (!clientName || !lineNum) continue;
    // Skip if line number is not a number (summary row)
    if (isNaN(parseInt(lineNum))) continue;

    const fValue = String(row[colIndex.F] || "").trim();
    const mValue = String(row[colIndex.M] || "").trim();
    const awValue = String(row[colIndex.AW] || "").trim();

    const entry = {
      line_number: parseInt(lineNum),
      raw_client_name: clientName,

      // Sex determination (1 or x indicates sex)
      is_female: fValue === "1" || fValue === "x" || fValue.toLowerCase() === "x",
      is_male: mValue === "1" || mValue === "x" || mValue.toLowerCase() === "x",

      // Alteration (only "1" counts)
      was_altered: fValue === "1" || mValue === "1",
      female_altered: fValue === "1",
      male_altered: mValue === "1",

      // Special visit types
      is_walkin: awValue.toUpperCase() === "W",
      is_already_altered: awValue.toUpperCase() === "A",

      // Other fields
      fee_code: String(row[colIndex.fee] || "").trim() || null,
      notes: String(row[colIndex.misc] || "").trim() || null,
      status: String(row[colIndex.status] || "").trim() || null,
      test_requested: String(row[colIndex.test] || "").trim() || null,
      test_result: String(row[colIndex.result] || "").trim() || null,

      // Extracted fields
      parsed_owner_name: extractOwnerName(clientName),
      parsed_trapper_alias: extractTrapperName(clientName),
      parsed_cat_name: extractCatName(clientName),
    };

    entries.push(entry);
  }

  return { entries, date: extractedDate };
}

/**
 * Get or create clinic day
 */
async function getOrCreateClinicDay(date) {
  // Check if exists
  const existing = await pool.query(
    `SELECT clinic_day_id FROM ops.clinic_days WHERE clinic_date = $1`,
    [date]
  );

  if (existing.rows.length > 0) {
    return existing.rows[0].clinic_day_id;
  }

  // Create new
  const result = await pool.query(
    `INSERT INTO ops.clinic_days (clinic_date, clinic_type)
     VALUES ($1, ops.get_default_clinic_type($1))
     RETURNING clinic_day_id`,
    [date]
  );

  return result.rows[0].clinic_day_id;
}

/**
 * Resolve trapper alias to person_id
 */
async function resolveTrapperAlias(alias) {
  if (!alias) return null;

  const result = await pool.query(
    `SELECT ops.resolve_trapper_alias($1) as person_id`,
    [alias]
  );

  return result.rows[0]?.person_id || null;
}

/**
 * Insert clinic day entry
 */
async function insertEntry(clinicDayId, entry) {
  // Resolve trapper alias
  const trapperPersonId = await resolveTrapperAlias(entry.parsed_trapper_alias);

  const result = await pool.query(
    `INSERT INTO ops.clinic_day_entries (
      clinic_day_id,
      line_number,
      source_description,
      raw_client_name,
      parsed_owner_name,
      parsed_cat_name,
      parsed_trapper_alias,
      trapper_person_id,
      cat_count,
      female_count,
      male_count,
      was_altered,
      is_walkin,
      is_already_altered,
      fee_code,
      notes,
      status,
      source_system
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
    RETURNING entry_id`,
    [
      clinicDayId,
      entry.line_number,
      entry.raw_client_name,  // source_description = raw name
      entry.raw_client_name,
      entry.parsed_owner_name,
      entry.parsed_cat_name,
      entry.parsed_trapper_alias,
      trapperPersonId,
      1,  // Each row is 1 cat
      entry.is_female ? 1 : 0,
      entry.is_male ? 1 : 0,
      entry.was_altered,
      entry.is_walkin,
      entry.is_already_altered,
      entry.fee_code,
      entry.notes,
      entry.status === "DNC" ? "completed" : "completed",
      "master_list"
    ]
  );

  return result.rows[0].entry_id;
}

/**
 * Run matching after import
 */
async function runMatching(date) {
  const result = await pool.query(
    `SELECT * FROM ops.apply_master_list_matches($1, 'medium')`,
    [date]
  );

  return result.rows[0];
}

/**
 * Main function
 */
async function main() {
  console.log(`\n=== Master List Import ===`);
  console.log(`File: ${filePath}`);

  // Resolve file path
  const resolvedPath = resolve(filePath);

  // Parse the Excel file
  console.log(`\nParsing Excel file...`);
  const { entries, date: extractedDate } = parseMasterList(resolvedPath);

  // Determine clinic date
  let targetDate = clinicDate;
  if (!targetDate) {
    targetDate = extractedDate || extractDateFromFilename(filePath);
  }

  if (!targetDate) {
    console.error("Could not determine clinic date. Please provide --date YYYY-MM-DD");
    process.exit(1);
  }

  console.log(`Clinic Date: ${targetDate}`);
  console.log(`Entries parsed: ${entries.length}`);

  // Show summary
  const summary = {
    females_altered: entries.filter((e) => e.female_altered).length,
    males_altered: entries.filter((e) => e.male_altered).length,
    walkin: entries.filter((e) => e.is_walkin).length,
    already_altered: entries.filter((e) => e.is_already_altered).length,
    with_trapper: entries.filter((e) => e.parsed_trapper_alias).length,
    with_cat_name: entries.filter((e) => e.parsed_cat_name).length,
  };

  console.log(`\nSummary:`);
  console.log(`  Females altered (F=1): ${summary.females_altered}`);
  console.log(`  Males altered (M=1): ${summary.males_altered}`);
  console.log(`  Wellness/walk-in: ${summary.walkin}`);
  console.log(`  Already altered: ${summary.already_altered}`);
  console.log(`  With trapper parsed: ${summary.with_trapper}`);
  console.log(`  With cat name: ${summary.with_cat_name}`);

  if (verbose) {
    console.log(`\nParsed entries:`);
    entries.slice(0, 10).forEach((e, i) => {
      console.log(`  ${i + 1}. ${e.parsed_owner_name || "(no owner)"}`);
      console.log(`     Trapper: ${e.parsed_trapper_alias || "-"}, Cat: ${e.parsed_cat_name || "-"}`);
      console.log(`     Altered: ${e.was_altered}, F: ${e.is_female}, M: ${e.is_male}`);
    });
    if (entries.length > 10) {
      console.log(`  ... and ${entries.length - 10} more`);
    }
  }

  if (dryRun) {
    console.log(`\n[DRY RUN] No changes made to database.`);
    await pool.end();
    return;
  }

  // Import to database
  console.log(`\nImporting to database...`);

  try {
    // Get or create clinic day
    const clinicDayId = await getOrCreateClinicDay(targetDate);
    console.log(`Clinic day ID: ${clinicDayId}`);

    // Check for existing entries
    const existing = await pool.query(
      `SELECT COUNT(*) as count FROM ops.clinic_day_entries WHERE clinic_day_id = $1`,
      [clinicDayId]
    );

    if (existing.rows[0].count > 0) {
      console.log(`\nWarning: ${existing.rows[0].count} entries already exist for this date.`);
      console.log(`Skipping import to avoid duplicates. Delete existing entries first if you want to reimport.`);
      await pool.end();
      return;
    }

    // Insert entries
    let inserted = 0;
    let trappersResolved = 0;

    for (const entry of entries) {
      const entryId = await insertEntry(clinicDayId, entry);
      inserted++;

      // Check if trapper was resolved
      if (entry.parsed_trapper_alias) {
        const trapperPersonId = await resolveTrapperAlias(entry.parsed_trapper_alias);
        if (trapperPersonId) trappersResolved++;
      }
    }

    console.log(`Inserted: ${inserted} entries`);
    console.log(`Trappers resolved: ${trappersResolved}/${summary.with_trapper}`);

    // Run matching
    console.log(`\nRunning appointment matching...`);
    const matchResult = await runMatching(targetDate);

    console.log(`Matched: ${matchResult.entries_matched} entries`);
    console.log(`  High confidence: ${matchResult.high_confidence}`);
    console.log(`  Medium confidence: ${matchResult.medium_confidence}`);
    console.log(`  Low confidence: ${matchResult.low_confidence}`);

    console.log(`\nImport complete!`);

  } catch (error) {
    console.error(`Error during import:`, error);
    process.exit(1);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
