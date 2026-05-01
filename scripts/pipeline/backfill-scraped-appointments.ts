#!/usr/bin/env npx tsx
/**
 * Backfill ops.appointments from ClinicHQ scraped appointment data.
 *
 * Modes:
 *   medical-notes  — UPDATE medical_notes where DB is NULL (Issue 2)
 *   enrichment     — UPDATE weight, age, ownership_type, animal_quick_notes, trapper_name (Issue 3)
 *   trapper-staging — Populate ops.scrape_trapper_staging with distinct trapper names (Issue 4)
 *   all            — Run all modes sequentially
 *
 * Join: CSV record_id = ops.appointments.source_record_id (ClinicHQ numeric ID)
 * Safety: Only UPDATE where DB value is NULL/empty (never overwrite existing data)
 *
 * Usage:
 *   source apps/web/.env.local && npx tsx scripts/pipeline/backfill-scraped-appointments.ts \
 *     --csv "/path/to/clinichq_appointments_medical_merged.csv" \
 *     --mode medical-notes \
 *     [--dry-run] [--batch-size 500]
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
  console.error("Missing DATABASE_URL. Run: source apps/web/.env.local first");
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

type Mode = "medical-notes" | "enrichment" | "trapper-staging" | "all";

// ============================================================================
// DB helpers
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

async function execute(sql: string, params: unknown[] = []): Promise<number> {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result.rowCount || 0;
  } finally {
    client.release();
  }
}

// ============================================================================
// CSV types
// ============================================================================

interface ApptCsvRow {
  record_id: string;
  client_id: string;
  appointment_date: string;
  animal_name: string;
  animal_id: string;
  animal_type: string;
  animal_age: string;
  animal_trapper: string;
  animal_quick_notes: string;
  weight: string;
  microchip: string;
  internal_medical_notes: string;
  vet_notes: string;
  animal_heading_raw: string;
}

// ============================================================================
// Appointment Matching
// ============================================================================

/**
 * Extract appointment number from animal_heading_raw like "Lotus 981020053774577 (24-3769)"
 */
function extractApptNumber(heading: string | undefined): string | null {
  if (!heading) return null;
  const m = heading.match(/\((\d{2}-\d+)\)/);
  if (m && m[1] !== "0") return m[1];
  return null;
}

/**
 * Extract clean microchip from field like "981020053774577 (PetLink) Pending"
 */
function extractMicrochip(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "---") return null;
  const m = trimmed.match(/^(\d{9,15})/);
  return m ? m[1] : null;
}

/**
 * Parse CSV date like "Oct 09, 2024" → "2024-10-09"
 */
function parseCsvDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const d = new Date(raw.trim());
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Find ops.appointments.appointment_id using multi-strategy join:
 * 1. appointment_number + appointment_date (most reliable)
 * 2. clinichq_appointment_id = 'YYYY-MM-DD_microchip' (covers no-number rows)
 */
async function findAppointmentId(row: ApptCsvRow): Promise<string | null> {
  const apptNumber = extractApptNumber(row.animal_heading_raw);
  const isoDate = parseCsvDate(row.appointment_date);
  const microchip = extractMicrochip(row.microchip);

  if (!isoDate) return null;

  // Strategy 1: appointment_number + date
  if (apptNumber) {
    const result = await queryOne<{ appointment_id: string }>(
      `SELECT appointment_id FROM ops.appointments
       WHERE appointment_number = $1 AND appointment_date = $2::DATE
         AND source_system = 'clinichq'
       LIMIT 1`,
      [apptNumber, isoDate]
    );
    if (result) return result.appointment_id;
  }

  // Strategy 2: clinichq_appointment_id = 'YYYY-MM-DD_microchip'
  if (microchip) {
    const chqId = `${isoDate}_${microchip}`;
    const result = await queryOne<{ appointment_id: string }>(
      `SELECT appointment_id FROM ops.appointments
       WHERE clinichq_appointment_id = $1
         AND source_system = 'clinichq'
       LIMIT 1`,
      [chqId]
    );
    if (result) return result.appointment_id;
  }

  return null;
}

// ============================================================================
// Parsers
// ============================================================================

/**
 * Parse weight like "7.82 lbs" or "7 lbs" → number. Returns null for "[no weight set]" etc.
 */
function parseWeight(raw: string | undefined): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.includes("no weight")) return null;
  const match = trimmed.match(/^([\d.]+)\s*lbs?$/i);
  if (!match) return null;
  const val = parseFloat(match[1]);
  return isNaN(val) || val <= 0 || val > 50 ? null : val;
}

/**
 * Parse age like "2 years, 0 months" or "0 years, 6.5 months" → { years, months }
 */
function parseAge(raw: string | undefined): { years: number; months: number } | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d+)\s*years?,\s*([\d.]+)\s*months?$/i);
  if (!match) return null;
  const years = parseInt(match[1], 10);
  const months = Math.round(parseFloat(match[2]));
  if (isNaN(years) || isNaN(months)) return null;
  return { years, months };
}

/**
 * Map animal_type to normalized ownership_type.
 * Strips "[no weight set]" suffix and "-" suffix.
 */
function mapOwnershipType(raw: string | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/\s*\[no weight set\]\s*/i, "")
    .replace(/\s*-\s*$/, "")
    .trim();
  if (!cleaned) return null;

  const map: Record<string, string> = {
    "Community Cat (Feral)": "community_cat",
    "Community Cat (Friendly)": "community_cat_friendly",
    "Owned": "owned",
    "Pet": "owned",
    "Foster": "foster",
    "Shelter": "shelter",
    "Misc 1": "misc",
    "Misc 2": "misc",
    "Misc 3": "misc",
  };

  return map[cleaned] || null;
}

// ============================================================================
// Mode 1: Medical Notes
// ============================================================================

// Collects unmatched CSV rows across modes for preservation
const unmatchedRows: { record_id: string; client_id: string; appointment_date: string; animal_name: string; mode: string }[] = [];

async function backfillMedicalNotes(
  rows: ApptCsvRow[],
  dryRun: boolean
): Promise<{ updated: number; skipped: number; noMatch: number; errors: number }> {
  const stats = { updated: 0, skipped: 0, noMatch: 0, errors: 0 };

  // Deduplicate by record_id (CSV has a few dupes)
  const seen = new Set<string>();
  const uniqueRows: ApptCsvRow[] = [];
  for (const row of rows) {
    if (!seen.has(row.record_id)) {
      seen.add(row.record_id);
      uniqueRows.push(row);
    }
  }

  const withNotes = uniqueRows.filter(
    (r) => r.internal_medical_notes?.trim()
  );
  console.log(
    `  ${uniqueRows.length} unique record_ids, ${withNotes.length} with medical_notes`
  );

  for (let i = 0; i < withNotes.length; i++) {
    const row = withNotes[i];
    try {
      if (dryRun) {
        stats.updated++;
        continue;
      }

      const appointmentId = await findAppointmentId(row);
      if (!appointmentId) {
        stats.noMatch++;
        unmatchedRows.push({
          record_id: row.record_id,
          client_id: row.client_id,
          appointment_date: row.appointment_date,
          animal_name: row.animal_name,
          mode: "medical-notes",
        });
        continue;
      }

      const result = await execute(
        `UPDATE ops.appointments
         SET medical_notes = $2, updated_at = NOW()
         WHERE appointment_id = $1
           AND (medical_notes IS NULL OR medical_notes = '')`,
        [appointmentId, row.internal_medical_notes.trim()]
      );

      if (result > 0) {
        stats.updated++;
      } else {
        stats.skipped++; // already has notes
      }
    } catch (err) {
      stats.errors++;
      if (stats.errors <= 5) {
        console.error(
          `  Error on record_id=${row.record_id}: ${err instanceof Error ? err.message : err}`
        );
      }
    }

    if ((i + 1) % 1000 === 0) {
      console.log(
        `  Progress: ${i + 1}/${withNotes.length} — updated=${stats.updated} skipped=${stats.skipped} noMatch=${stats.noMatch}`
      );
    }
  }

  return stats;
}

// ============================================================================
// Mode 2: Enrichment (weight, age, ownership_type, animal_quick_notes, trapper_name)
// ============================================================================

async function backfillEnrichment(
  rows: ApptCsvRow[],
  dryRun: boolean
): Promise<{
  weightUpdated: number;
  ageUpdated: number;
  ownershipUpdated: number;
  quickNotesUpdated: number;
  trapperUpdated: number;
  noMatch: number;
  errors: number;
}> {
  const stats = {
    weightUpdated: 0,
    ageUpdated: 0,
    ownershipUpdated: 0,
    quickNotesUpdated: 0,
    trapperUpdated: 0,
    noMatch: 0,
    errors: 0,
  };

  // Deduplicate
  const seen = new Set<string>();
  const uniqueRows: ApptCsvRow[] = [];
  for (const row of rows) {
    if (!seen.has(row.record_id)) {
      seen.add(row.record_id);
      uniqueRows.push(row);
    }
  }

  console.log(`  ${uniqueRows.length} unique record_ids to enrich`);

  for (let i = 0; i < uniqueRows.length; i++) {
    const row = uniqueRows[i];
    const weight = parseWeight(row.weight);
    const age = parseAge(row.animal_age);
    const ownershipType = mapOwnershipType(row.animal_type);
    const quickNotes = row.animal_quick_notes?.trim() || null;
    const trapperName = row.animal_trapper?.trim() || null;

    // Skip if nothing to update
    if (!weight && !age && !ownershipType && !quickNotes && !trapperName) {
      continue;
    }

    try {
      if (dryRun) {
        if (weight) stats.weightUpdated++;
        if (age) stats.ageUpdated++;
        if (ownershipType) stats.ownershipUpdated++;
        if (quickNotes) stats.quickNotesUpdated++;
        if (trapperName) stats.trapperUpdated++;
        continue;
      }

      const appointmentId = await findAppointmentId(row);
      if (!appointmentId) {
        stats.noMatch++;
        unmatchedRows.push({
          record_id: row.record_id,
          client_id: row.client_id,
          appointment_date: row.appointment_date,
          animal_name: row.animal_name,
          mode: "enrichment",
        });
        continue;
      }

      // Build dynamic SET clause — only update NULL/empty fields
      const sets: string[] = [];
      const params: unknown[] = [appointmentId]; // $1 = appointment_id
      let paramIdx = 2;

      if (weight !== null) {
        sets.push(
          `cat_weight_lbs = CASE WHEN cat_weight_lbs IS NULL THEN $${paramIdx} ELSE cat_weight_lbs END`
        );
        params.push(weight);
        paramIdx++;
      }
      if (age) {
        sets.push(
          `cat_age_years = CASE WHEN cat_age_years IS NULL THEN $${paramIdx} ELSE cat_age_years END`
        );
        params.push(age.years);
        paramIdx++;
        sets.push(
          `cat_age_months = CASE WHEN cat_age_months IS NULL THEN $${paramIdx} ELSE cat_age_months END`
        );
        params.push(age.months);
        paramIdx++;
      }
      if (ownershipType) {
        sets.push(
          `ownership_type = CASE WHEN ownership_type IS NULL OR ownership_type = '' THEN $${paramIdx} ELSE ownership_type END`
        );
        params.push(ownershipType);
        paramIdx++;
      }
      if (quickNotes) {
        sets.push(
          `animal_quick_notes = CASE WHEN animal_quick_notes IS NULL THEN $${paramIdx} ELSE animal_quick_notes END`
        );
        params.push(quickNotes);
        paramIdx++;
      }
      if (trapperName) {
        sets.push(
          `trapper_name = CASE WHEN trapper_name IS NULL THEN $${paramIdx} ELSE trapper_name END`
        );
        params.push(trapperName);
        paramIdx++;
      }

      sets.push("updated_at = NOW()");

      const result = await execute(
        `UPDATE ops.appointments
         SET ${sets.join(", ")}
         WHERE appointment_id = $1`,
        params
      );

      if (result > 0) {
        if (weight) stats.weightUpdated++;
        if (age) stats.ageUpdated++;
        if (ownershipType) stats.ownershipUpdated++;
        if (quickNotes) stats.quickNotesUpdated++;
        if (trapperName) stats.trapperUpdated++;
      }
    } catch (err) {
      stats.errors++;
      if (stats.errors <= 5) {
        console.error(
          `  Error on record_id=${row.record_id}: ${err instanceof Error ? err.message : err}`
        );
      }
    }

    if ((i + 1) % 2000 === 0) {
      console.log(
        `  Progress: ${i + 1}/${uniqueRows.length} — ` +
          `weight=${stats.weightUpdated} age=${stats.ageUpdated} ` +
          `type=${stats.ownershipUpdated} notes=${stats.quickNotesUpdated} ` +
          `trapper=${stats.trapperUpdated} noMatch=${stats.noMatch}`
      );
    }
  }

  return stats;
}

// ============================================================================
// Mode 3: Trapper Staging
// ============================================================================

async function stageTrapperNames(
  rows: ApptCsvRow[],
  dryRun: boolean
): Promise<{ distinct: number; inserted: number }> {
  // Count distinct trapper names and their appointment counts
  const trapperCounts = new Map<string, number>();
  for (const row of rows) {
    const name = row.animal_trapper?.trim();
    if (name) {
      trapperCounts.set(name, (trapperCounts.get(name) || 0) + 1);
    }
  }

  console.log(`  ${trapperCounts.size} distinct trapper names across ${
    Array.from(trapperCounts.values()).reduce((a, b) => a + b, 0)
  } appointments`);

  if (dryRun) {
    for (const [name, count] of Array.from(trapperCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)) {
      console.log(`    ${count.toString().padStart(4)} — ${name}`);
    }
    return { distinct: trapperCounts.size, inserted: 0 };
  }

  // Verify staging table exists
  const tableExists = await queryOne<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'ops' AND table_name = 'scrape_trapper_staging'
    ) AS exists
  `);

  if (!tableExists?.exists) {
    console.error("ERROR: ops.scrape_trapper_staging does not exist!");
    console.error("Run MIG_3114 first.");
    return { distinct: trapperCounts.size, inserted: 0 };
  }

  // Clear existing staging data and re-insert
  await execute("DELETE FROM ops.scrape_trapper_staging");

  let inserted = 0;
  for (const [name, count] of trapperCounts) {
    await execute(
      `INSERT INTO ops.scrape_trapper_staging (trapper_name, appointment_count)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [name, count]
    );
    inserted++;
  }

  // Auto-match high-confidence exact name matches against known trappers
  const autoMatched = await execute(`
    UPDATE ops.scrape_trapper_staging s
    SET matched_person_id = p.person_id,
        match_confidence = 'high',
        match_method = 'exact_name_trapper_profile',
        reviewed_at = NOW(),
        reviewed_by = 'auto_backfill'
    FROM sot.people p
    JOIN sot.trapper_profiles tp ON tp.person_id = p.person_id
    WHERE LOWER(TRIM(p.display_name)) = LOWER(TRIM(s.trapper_name))
      AND p.merged_into_person_id IS NULL
      AND s.matched_person_id IS NULL
  `);

  console.log(`  Auto-matched ${autoMatched} trappers via exact name + trapper_profiles`);

  // Show results
  const summary = await query<{
    trapper_name: string;
    appointment_count: number;
    match_confidence: string | null;
    matched_display_name: string | null;
  }>(`
    SELECT s.trapper_name, s.appointment_count, s.match_confidence,
           p.display_name AS matched_display_name
    FROM ops.scrape_trapper_staging s
    LEFT JOIN sot.people p ON p.person_id = s.matched_person_id
    ORDER BY s.appointment_count DESC
    LIMIT 30
  `);

  console.log("\n  Top trapper names:");
  for (const r of summary) {
    const status = r.match_confidence
      ? `MATCHED → ${r.matched_display_name} (${r.match_confidence})`
      : "UNMATCHED";
    console.log(
      `    ${r.appointment_count.toString().padStart(4)} — ${r.trapper_name} [${status}]`
    );
  }

  return { distinct: trapperCounts.size, inserted };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const { values } = parseArgs({
    options: {
      csv: { type: "string" },
      mode: { type: "string", default: "all" },
      "dry-run": { type: "boolean", default: false },
      "batch-size": { type: "string", default: "500" },
    },
  });

  const csvPath = values["csv"];
  const mode = (values["mode"] || "all") as Mode;
  const dryRun = values["dry-run"] || false;

  if (!csvPath) {
    console.error("Usage: npx tsx scripts/pipeline/backfill-scraped-appointments.ts \\");
    console.error('  --csv "/path/to/clinichq_appointments_medical_merged.csv" \\');
    console.error("  --mode medical-notes|enrichment|trapper-staging|all \\");
    console.error("  [--dry-run]");
    process.exit(1);
  }

  const validModes: Mode[] = ["medical-notes", "enrichment", "trapper-staging", "all"];
  if (!validModes.includes(mode)) {
    console.error(`Invalid mode: ${mode}. Must be one of: ${validModes.join(", ")}`);
    process.exit(1);
  }

  console.log("=".repeat(60));
  console.log("ClinicHQ Scraped Appointment Backfill");
  console.log("=".repeat(60));
  console.log(`Mode:     ${mode}`);
  console.log(`Dry run:  ${dryRun}`);
  console.log(`CSV:      ${csvPath}`);
  console.log("");

  // Test DB connection
  console.log("Testing database connection...");
  const test = await queryOne<{ version: string }>("SELECT version()");
  console.log(`Connected: ${test?.version?.substring(0, 50)}...`);

  // Read CSV
  console.log("\nReading CSV...");
  if (!fs.existsSync(csvPath)) {
    console.error(`File not found: ${csvPath}`);
    process.exit(1);
  }

  const csvContent = fs.readFileSync(csvPath, "utf-8");
  const rows: ApptCsvRow[] = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
  });
  console.log(`  ${rows.length} rows loaded`);

  const startTime = Date.now();

  // Run modes
  if (mode === "medical-notes" || mode === "all") {
    console.log("\n" + "=".repeat(60));
    console.log("Mode: Medical Notes Backfill");
    console.log("=".repeat(60));
    const stats = await backfillMedicalNotes(rows, dryRun);
    console.log("\nResults:", JSON.stringify(stats, null, 2));
  }

  if (mode === "enrichment" || mode === "all") {
    console.log("\n" + "=".repeat(60));
    console.log("Mode: Appointment Enrichment");
    console.log("=".repeat(60));
    const stats = await backfillEnrichment(rows, dryRun);
    console.log("\nResults:", JSON.stringify(stats, null, 2));
  }

  if (mode === "trapper-staging" || mode === "all") {
    console.log("\n" + "=".repeat(60));
    console.log("Mode: Trapper Name Staging");
    console.log("=".repeat(60));
    const stats = await stageTrapperNames(rows, dryRun);
    console.log("\nResults:", JSON.stringify(stats, null, 2));
  }

  // Final verification
  if (!dryRun) {
    console.log("\n" + "=".repeat(60));
    console.log("Post-Backfill Verification");
    console.log("=".repeat(60));

    const coverage = await queryOne<{
      total: string;
      with_medical: string;
      with_weight: string;
      with_age: string;
      with_ownership: string;
      with_quick_notes: string;
      with_trapper: string;
    }>(`
      SELECT
        COUNT(*)::TEXT AS total,
        COUNT(*) FILTER (WHERE medical_notes IS NOT NULL AND medical_notes != '')::TEXT AS with_medical,
        COUNT(*) FILTER (WHERE cat_weight_lbs IS NOT NULL)::TEXT AS with_weight,
        COUNT(*) FILTER (WHERE cat_age_years IS NOT NULL OR cat_age_months IS NOT NULL)::TEXT AS with_age,
        COUNT(*) FILTER (WHERE ownership_type IS NOT NULL AND ownership_type != '')::TEXT AS with_ownership,
        COUNT(*) FILTER (WHERE animal_quick_notes IS NOT NULL)::TEXT AS with_quick_notes,
        COUNT(*) FILTER (WHERE trapper_name IS NOT NULL)::TEXT AS with_trapper
      FROM ops.appointments
    `);

    if (coverage) {
      console.log(`  Total appointments:      ${coverage.total}`);
      console.log(`  With medical_notes:      ${coverage.with_medical}`);
      console.log(`  With cat_weight_lbs:     ${coverage.with_weight}`);
      console.log(`  With age:                ${coverage.with_age}`);
      console.log(`  With ownership_type:     ${coverage.with_ownership}`);
      console.log(`  With animal_quick_notes: ${coverage.with_quick_notes}`);
      console.log(`  With trapper_name:       ${coverage.with_trapper}`);
    }
  }

  // Write unmatched rows to file for preservation
  if (unmatchedRows.length > 0 && !dryRun) {
    const unmatchedPath = path.join(
      path.dirname(csvPath),
      `unmatched_appointments_${new Date().toISOString().slice(0, 10)}.json`
    );
    fs.writeFileSync(unmatchedPath, JSON.stringify(unmatchedRows, null, 2));
    console.log(
      `\nWrote ${unmatchedRows.length} unmatched rows to:\n  ${unmatchedPath}`
    );
    console.log(
      "These are scraped appointments with no matching source_record_id in ops.appointments."
    );
    console.log(
      "Likely accounts with clinic records but no exported appointment data yet."
    );
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nCompleted in ${elapsed}s`);

  await pool.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
