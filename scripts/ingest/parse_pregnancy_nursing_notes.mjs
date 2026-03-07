#!/usr/bin/env node

/**
 * Parse Pregnancy/Nursing Data from Appointment Notes
 *
 * Extracts reproduction indicators from clinic appointment notes:
 * - Pregnant females (can estimate litter timing)
 * - Lactating/nursing females (indicates recent birth)
 * - In-heat females (breeding activity)
 *
 * This data feeds into Beacon's Vortex population model for:
 * - Birth rate estimation
 * - Seasonal breeding patterns
 * - Kitten surge prediction
 *
 * Data Sources:
 * - sot_appointments.internal_notes
 * - sot_appointments.medical_notes
 * - cat_vitals (already has is_pregnant, is_lactating, is_in_heat)
 *
 * Usage:
 *   node scripts/ingest/parse_pregnancy_nursing_notes.mjs --dry-run
 *   node scripts/ingest/parse_pregnancy_nursing_notes.mjs
 */

import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
});

const DRY_RUN = process.argv.includes("--dry-run");
const VERBOSE = process.argv.includes("--verbose");

// Patterns for extracting pregnancy/nursing indicators
const PATTERNS = {
  pregnant: [
    /\bpregnant\b/i,
    /\bgravid\b/i,
    /\bexpecting\b/i,
    /\bwith\s+kittens?\b/i,
    /\bpreg\b/i,
    /\bpg\b/i, // Common abbreviation
  ],
  lactating: [
    /\blactating\b/i,
    /\bnursing\b/i,
    /\bwith\s+litter\b/i,
    /\bfeeding\s+kittens?\b/i,
    /\bmilk\s+present\b/i,
    /\bactive\s+mammary\b/i,
    /\bmammary\s+glands?\s+enlarged\b/i,
  ],
  in_heat: [
    /\bin\s+heat\b/i,
    /\bestrus\b/i,
    /\bcalling\b/i,
    /\brolling\b/i,
    /\blordo(sis|tic)\b/i,
  ],
  kittens_mentioned: [
    /(\d+)\s+kittens?\b/i,
    /\blitter\s+of\s+(\d+)/i,
    /\bhad\s+(\d+)\s+kittens?\b/i,
  ],
  recent_birth: [
    /\bjust\s+(had|gave birth|delivered)\b/i,
    /\brecent(ly)?\s+(gave birth|delivered|had kittens)\b/i,
    /\bpost-?partum\b/i,
    /\bpp\b/i, // Post-partum abbreviation
  ],
};

/**
 * Parse notes text for reproduction indicators
 */
function parseReproductionIndicators(notes) {
  if (!notes || typeof notes !== "string") {
    return null;
  }

  const result = {
    is_pregnant: false,
    is_lactating: false,
    is_in_heat: false,
    kitten_count: null,
    recent_birth: false,
    raw_matches: [],
  };

  // Check pregnant patterns
  for (const pattern of PATTERNS.pregnant) {
    if (pattern.test(notes)) {
      result.is_pregnant = true;
      result.raw_matches.push(`pregnant: ${notes.match(pattern)?.[0]}`);
      break;
    }
  }

  // Check lactating patterns
  for (const pattern of PATTERNS.lactating) {
    if (pattern.test(notes)) {
      result.is_lactating = true;
      result.raw_matches.push(`lactating: ${notes.match(pattern)?.[0]}`);
      break;
    }
  }

  // Check in heat patterns
  for (const pattern of PATTERNS.in_heat) {
    if (pattern.test(notes)) {
      result.is_in_heat = true;
      result.raw_matches.push(`in_heat: ${notes.match(pattern)?.[0]}`);
      break;
    }
  }

  // Check for kitten count mentions
  for (const pattern of PATTERNS.kittens_mentioned) {
    const match = notes.match(pattern);
    if (match && match[1]) {
      const count = parseInt(match[1], 10);
      if (count > 0 && count <= 12) {
        // Reasonable litter size
        result.kitten_count = count;
        result.raw_matches.push(`kittens: ${match[0]}`);
        break;
      }
    }
  }

  // Check for recent birth indicators
  for (const pattern of PATTERNS.recent_birth) {
    if (pattern.test(notes)) {
      result.recent_birth = true;
      result.raw_matches.push(`recent_birth: ${notes.match(pattern)?.[0]}`);
      break;
    }
  }

  // Only return if we found something
  if (
    result.is_pregnant ||
    result.is_lactating ||
    result.is_in_heat ||
    result.kitten_count ||
    result.recent_birth
  ) {
    return result;
  }

  return null;
}

async function main() {
  console.log("=".repeat(60));
  console.log("Pregnancy/Nursing Notes Parser");
  console.log("=".repeat(60));
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  console.log("");

  const stats = {
    appointments_scanned: 0,
    with_indicators: 0,
    pregnant_found: 0,
    lactating_found: 0,
    in_heat_found: 0,
    with_kitten_count: 0,
    vitals_updated: 0,
    vitals_created: 0,
    birth_events_created: 0,
    errors: [],
  };

  try {
    // Get appointments with notes that haven't been fully parsed
    // Focus on female cats (spays) where we might find reproduction data
    const appointmentsSql = `
      SELECT
        a.appointment_id,
        a.cat_id,
        a.appointment_date,
        a.internal_notes,
        a.medical_notes,
        a.is_spay,
        c.display_name AS cat_name,
        c.sex,
        -- Check if we already have vitals for this appointment
        EXISTS (
          SELECT 1 FROM ops.cat_vitals cv
          WHERE cv.cat_id = a.cat_id
            AND cv.recorded_at::DATE = a.appointment_date::DATE
        ) AS has_vitals
      FROM ops.appointments a
      JOIN sot.cats c ON c.cat_id = a.cat_id
      WHERE a.is_spay = TRUE
        AND (a.internal_notes IS NOT NULL OR a.medical_notes IS NOT NULL)
        AND a.appointment_date >= '2020-01-01'
      ORDER BY a.appointment_date DESC
      LIMIT 5000
    `;

    const { rows: appointments } = await pool.query(appointmentsSql);
    stats.appointments_scanned = appointments.length;

    console.log(`Scanning ${appointments.length} spay appointments with notes...`);
    console.log("");

    for (const appt of appointments) {
      const combinedNotes = [appt.internal_notes, appt.medical_notes]
        .filter(Boolean)
        .join(" ");

      const indicators = parseReproductionIndicators(combinedNotes);

      if (indicators) {
        stats.with_indicators++;

        if (indicators.is_pregnant) stats.pregnant_found++;
        if (indicators.is_lactating) stats.lactating_found++;
        if (indicators.is_in_heat) stats.in_heat_found++;
        if (indicators.kitten_count) stats.with_kitten_count++;

        if (VERBOSE) {
          console.log(
            `[${appt.appointment_date?.toISOString().split("T")[0]}] ${appt.cat_name || "Unknown"}`
          );
          console.log(`  Indicators: ${JSON.stringify(indicators)}`);
          console.log(`  Notes snippet: ${combinedNotes.slice(0, 100)}...`);
          console.log("");
        }

        if (!DRY_RUN) {
          try {
            // Update or create vitals record
            if (appt.has_vitals) {
              // Update existing vitals
              const updateSql = `
                UPDATE ops.cat_vitals
                SET
                  is_pregnant = COALESCE(is_pregnant, $1),
                  is_lactating = COALESCE(is_lactating, $2),
                  is_in_heat = COALESCE(is_in_heat, $3),
                  updated_at = NOW()
                WHERE cat_id = $4
                  AND recorded_at::DATE = $5::DATE
                  AND (
                    (is_pregnant IS NULL AND $1 = TRUE) OR
                    (is_lactating IS NULL AND $2 = TRUE) OR
                    (is_in_heat IS NULL AND $3 = TRUE)
                  )
              `;
              const result = await pool.query(updateSql, [
                indicators.is_pregnant,
                indicators.is_lactating,
                indicators.is_in_heat,
                appt.cat_id,
                appt.appointment_date,
              ]);
              if (result.rowCount > 0) {
                stats.vitals_updated++;
              }
            } else {
              // Create new vitals record
              const insertSql = `
                INSERT INTO ops.cat_vitals (
                  cat_id,
                  recorded_at,
                  is_pregnant,
                  is_lactating,
                  is_in_heat,
                  source_system,
                  source_record_id
                ) VALUES ($1, $2, $3, $4, $5, 'notes_parser', $6)
                ON CONFLICT DO NOTHING
              `;
              const result = await pool.query(insertSql, [
                appt.cat_id,
                appt.appointment_date,
                indicators.is_pregnant,
                indicators.is_lactating,
                indicators.is_in_heat,
                appt.appointment_id,
              ]);
              if (result.rowCount > 0) {
                stats.vitals_created++;
              }
            }

            // If lactating with kitten count, consider creating birth event
            if (
              (indicators.is_lactating || indicators.recent_birth) &&
              indicators.kitten_count &&
              appt.cat_id
            ) {
              // Check if birth event already exists for this cat around this time
              const birthCheckSql = `
                SELECT 1 FROM ops.cat_birth_events
                WHERE mother_cat_id = $1
                  AND birth_date BETWEEN $2::DATE - INTERVAL '60 days' AND $2::DATE
                LIMIT 1
              `;
              const { rows: existingBirth } = await pool.query(birthCheckSql, [
                appt.cat_id,
                appt.appointment_date,
              ]);

              if (existingBirth.length === 0) {
                // Create birth event (estimate birth ~30 days before lactating observation)
                const estimatedBirthDate = new Date(appt.appointment_date);
                estimatedBirthDate.setDate(estimatedBirthDate.getDate() - 30);

                const birthSql = `
                  INSERT INTO ops.cat_birth_events (
                    mother_cat_id,
                    birth_date,
                    birth_date_precision,
                    kitten_count_in_litter,
                    source_system,
                    source_record_id,
                    notes
                  ) VALUES ($1, $2, 'estimated', $3, 'notes_parser', $4, $5)
                  ON CONFLICT DO NOTHING
                `;
                const result = await pool.query(birthSql, [
                  appt.cat_id,
                  estimatedBirthDate,
                  indicators.kitten_count,
                  appt.appointment_id,
                  `Inferred from appointment notes: ${indicators.raw_matches.join(", ")}`,
                ]);
                if (result.rowCount > 0) {
                  stats.birth_events_created++;
                }
              }
            }
          } catch (err) {
            stats.errors.push(
              `Appointment ${appt.appointment_id}: ${err.message}`
            );
          }
        }
      }
    }

    // Print summary
    console.log("=".repeat(60));
    console.log("SUMMARY");
    console.log("=".repeat(60));
    console.log(`Appointments scanned:    ${stats.appointments_scanned}`);
    console.log(`With reproduction data:  ${stats.with_indicators}`);
    console.log("");
    console.log("Indicators Found:");
    console.log(`  Pregnant:              ${stats.pregnant_found}`);
    console.log(`  Lactating/Nursing:     ${stats.lactating_found}`);
    console.log(`  In Heat:               ${stats.in_heat_found}`);
    console.log(`  With kitten count:     ${stats.with_kitten_count}`);
    console.log("");

    if (!DRY_RUN) {
      console.log("Records Modified:");
      console.log(`  Vitals updated:        ${stats.vitals_updated}`);
      console.log(`  Vitals created:        ${stats.vitals_created}`);
      console.log(`  Birth events created:  ${stats.birth_events_created}`);
    } else {
      console.log("(DRY RUN - no changes made)");
    }

    if (stats.errors.length > 0) {
      console.log("");
      console.log(`Errors: ${stats.errors.length}`);
      stats.errors.slice(0, 5).forEach((e) => console.log(`  - ${e}`));
    }

    console.log("");
    console.log("=".repeat(60));
  } catch (error) {
    console.error("Fatal error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
