#!/usr/bin/env node

/**
 * Parse Mortality Data from Notes
 *
 * Extracts death/mortality indicators from various note sources:
 * - KML historical data (233 mortality mentions identified)
 * - Request notes (internal_notes, notes, legacy_notes)
 * - Appointment notes (medical_notes)
 * - Intake submissions (situation_description)
 *
 * This data feeds into Beacon's Vortex population model for:
 * - Survival rate calculations by age category
 * - Seasonal mortality patterns
 * - Death cause analysis
 *
 * Data Flow:
 * 1. Parse notes for mortality patterns
 * 2. Match to existing cats when possible (via place/microchip)
 * 3. Insert into cat_mortality_events table
 * 4. Update sot_cats.is_deceased when cat identified
 *
 * Usage:
 *   node scripts/ingest/parse_mortality_notes.mjs --dry-run
 *   node scripts/ingest/parse_mortality_notes.mjs
 *   node scripts/ingest/parse_mortality_notes.mjs --verbose
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

// Mortality patterns to detect
const PATTERNS = {
  // Direct death mentions
  died: [
    /\b(?:cat|kitten|she|he|it)\s+died\b/i,
    /\bdied\s+(?:from|of|after|during)\b/i,
    /\bpassed\s+away\b/i,
    /\bfound\s+dead\b/i,
    /\bdeceased\b/i,
    /\bdeath\b/i,
    /\bRIP\b/i,
  ],
  // Hit by car / vehicle
  vehicle: [
    /\bhit\s+by\s+(?:a\s+)?car\b/i,
    /\bhit\s+by\s+(?:a\s+)?vehicle\b/i,
    /\bHBC\b/, // Hit By Car medical abbreviation
    /\brun\s+over\b/i,
    /\bstruck\s+by\s+(?:a\s+)?(?:car|vehicle|truck)\b/i,
    /\bvehicle\s+(?:hit|struck|killed)\b/i,
    /\bcar\s+accident\b/i,
  ],
  // Predator attack
  predator: [
    /\bpredator\b/i,
    /\b(?:killed|attacked)\s+by\s+(?:a\s+)?(?:dog|coyote|fox|hawk|owl|eagle)\b/i,
    /\bcoyote\s+(?:attack|killed|got)\b/i,
    /\bdog\s+(?:attack|killed|got)\b/i,
  ],
  // Disease/illness
  disease: [
    /\bFeLV\s+positive\s+(?:and\s+)?(?:died|euthanized|pts)\b/i,
    /\bFIV\s+positive\s+(?:and\s+)?(?:died|euthanized|pts)\b/i,
    /\bdied\s+(?:from|of)\s+(?:FeLV|FIV|disease|illness|infection)\b/i,
    /\bviral\s+(?:infection|disease)\b/i,
    /\bterminal\s+illness\b/i,
  ],
  // Euthanasia
  euthanasia: [
    /\beuthanized\b/i,
    /\beuthanasia\b/i,
    /\bPTS\b/, // Put To Sleep
    /\bput\s+(?:to\s+sleep|down)\b/i,
    /\bhumane\s+euthanasia\b/i,
  ],
  // Injury
  injury: [
    /\bdied\s+(?:from|of)\s+(?:injuries?|wounds?|trauma)\b/i,
    /\bfatal\s+(?:injury|wound|trauma)\b/i,
    /\bmortally\s+wounded\b/i,
  ],
  // Starvation/neglect
  starvation: [
    /\bstarved?\b/i,
    /\bstarvation\b/i,
    /\bemaciated\s+(?:and\s+)?died\b/i,
    /\bmalnutrition\b/i,
  ],
  // Weather
  weather: [
    /\bfroze\s+to\s+death\b/i,
    /\bhypothermia\b/i,
    /\bheat\s+stroke\b/i,
    /\bdied\s+(?:from|of|in)\s+(?:cold|heat|fire|flood)\b/i,
  ],
  // Natural causes
  natural: [
    /\bnatural\s+causes\b/i,
    /\bold\s+age\b/i,
    /\bdied\s+(?:peacefully|naturally)\b/i,
  ],
  // Generic mortality mentions (fallback)
  unknown: [
    /\bmortality\b/i,
    /\blost\s+(?:the\s+)?(?:cat|kitten)\b/i,
    /\bno\s+longer\s+(?:around|alive|with\s+us)\b/i,
    /\b(?:cat|kitten)\s+(?:is\s+)?gone\b/i,
  ],
};

// Date extraction patterns
const DATE_PATTERNS = [
  // MM/DD/YYYY or MM-DD-YYYY
  /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/,
  // Month DD, YYYY
  /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/i,
  // DD Month YYYY
  /(\d{1,2})(?:st|nd|rd|th)?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*,?\s+(\d{4})/i,
];

// Kitten detection for age category
const KITTEN_PATTERNS = [
  /\bkitten\b/i,
  /\byoung\s+cat\b/i,
  /\b\d+\s*(?:week|wk)s?\s+old\b/i,
  /\b(?:baby|babies)\b/i,
];

/**
 * Detect mortality type from text
 */
function detectMortalityType(text) {
  if (!text) return null;

  // Check specific causes first (more specific = higher priority)
  const causeOrder = [
    "vehicle",
    "predator",
    "disease",
    "euthanasia",
    "injury",
    "starvation",
    "weather",
    "natural",
    "died", // Generic death
    "unknown",
  ];

  for (const cause of causeOrder) {
    const patterns = PATTERNS[cause];
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        // Map 'died' to 'unknown' for death_cause enum
        const deathCause = cause === "died" ? "unknown" : cause;
        const match = text.match(pattern)?.[0];
        return { cause: deathCause, match };
      }
    }
  }

  return null;
}

/**
 * Extract date from text
 */
function extractDate(text) {
  if (!text) return null;

  for (const pattern of DATE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      try {
        // Parse different formats
        if (match[0].includes("/") || match[0].includes("-")) {
          const [, m, d, y] = match;
          const year = y.length === 2 ? `20${y}` : y;
          return `${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
        } else {
          // Month name format
          const monthMap = {
            jan: "01",
            feb: "02",
            mar: "03",
            apr: "04",
            may: "05",
            jun: "06",
            jul: "07",
            aug: "08",
            sep: "09",
            oct: "10",
            nov: "11",
            dec: "12",
          };
          const month = monthMap[match[1].toLowerCase().slice(0, 3)];
          if (month) {
            const day = match[2].padStart(2, "0");
            const year = match[3];
            return `${year}-${month}-${day}`;
          }
        }
      } catch {
        // Invalid date, continue
      }
    }
  }

  return null;
}

/**
 * Determine age category from text
 */
function detectAgeCategory(text) {
  if (!text) return "adult"; // Default

  // Check for kitten indicators
  for (const pattern of KITTEN_PATTERNS) {
    if (pattern.test(text)) {
      return "kitten";
    }
  }

  // Check for senior indicators
  if (/\bold\s+(?:cat|male|female)\b/i.test(text) || /\bsenior\b/i.test(text)) {
    return "senior";
  }

  return "adult";
}

async function main() {
  console.log("=".repeat(60));
  console.log("Mortality Notes Parser");
  console.log("=".repeat(60));
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  console.log("");

  const stats = {
    sources_scanned: {
      colony_estimates: 0,
      requests: 0,
      appointments: 0,
      intake: 0,
    },
    mortality_found: 0,
    by_cause: {},
    with_date: 0,
    events_created: 0,
    cats_updated: 0,
    errors: [],
  };

  try {
    // First check if mortality events table exists
    const tableCheck = await pool.query(`
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'trapper'
      AND table_name = 'cat_mortality_events'
    `);

    if (tableCheck.rows.length === 0) {
      console.log("ERROR: cat_mortality_events table does not exist.");
      console.log("Please run MIG_290__cat_mortality_events.sql first.");
      process.exit(1);
    }

    // ============================================
    // 1. Parse KML/legacy_mymaps colony estimates
    // ============================================
    console.log("Scanning KML historical notes...");

    const kmlSql = `
      SELECT
        estimate_id,
        place_id,
        notes,
        observation_date,
        total_cats,
        source_system,
        source_record_id
      FROM sot.place_colony_estimates
      WHERE source_type = 'legacy_mymaps'
        AND notes IS NOT NULL
        AND notes != ''
      LIMIT 5000
    `;

    const { rows: kmlRows } = await pool.query(kmlSql);
    stats.sources_scanned.colony_estimates = kmlRows.length;
    console.log(`  Found ${kmlRows.length} KML records with notes`);

    for (const row of kmlRows) {
      const mortality = detectMortalityType(row.notes);
      if (mortality) {
        stats.mortality_found++;
        stats.by_cause[mortality.cause] = (stats.by_cause[mortality.cause] || 0) + 1;

        const deathDate = extractDate(row.notes) || row.observation_date;
        if (deathDate) stats.with_date++;

        const ageCategory = detectAgeCategory(row.notes);

        if (VERBOSE) {
          console.log(`  [KML] Place ${row.place_id}: ${mortality.cause}`);
          console.log(`    Match: "${mortality.match}"`);
          console.log(`    Date: ${deathDate || "unknown"}`);
          console.log(`    Notes: ${row.notes.slice(0, 100)}...`);
        }

        if (!DRY_RUN) {
          try {
            // Create mortality event without specific cat (place-level observation)
            const insertSql = `
              INSERT INTO ops.cat_mortality_events (
                cat_id,
                place_id,
                death_date,
                death_date_precision,
                death_cause,
                death_age_category,
                reported_by,
                source_system,
                source_record_id,
                notes
              ) VALUES (
                NULL,  -- No specific cat identified
                $1,
                $2::DATE,
                'estimated',
                $3,
                $4,
                'notes_parser',
                'legacy_mymaps',
                $5,
                $6
              )
              ON CONFLICT DO NOTHING
              RETURNING mortality_event_id
            `;

            const result = await pool.query(insertSql, [
              row.place_id,
              deathDate,
              mortality.cause,
              ageCategory,
              row.estimate_id,
              `Extracted from KML: "${mortality.match}" - ${row.notes.slice(0, 200)}`,
            ]);

            if (result.rows.length > 0) {
              stats.events_created++;
            }
          } catch (err) {
            stats.errors.push(`KML ${row.estimate_id}: ${err.message}`);
          }
        }
      }
    }

    // ============================================
    // 2. Parse request notes
    // ============================================
    console.log("\nScanning request notes...");

    const requestsSql = `
      SELECT
        r.request_id,
        r.place_id,
        r.notes,
        r.internal_notes,
        r.legacy_notes,
        r.source_created_at,
        r.resolved_at
      FROM ops.requests r
      WHERE (r.notes IS NOT NULL OR r.internal_notes IS NOT NULL OR r.legacy_notes IS NOT NULL)
        AND r.place_id IS NOT NULL
      LIMIT 5000
    `;

    const { rows: requestRows } = await pool.query(requestsSql);
    stats.sources_scanned.requests = requestRows.length;
    console.log(`  Found ${requestRows.length} requests with notes`);

    for (const row of requestRows) {
      const combinedNotes = [row.notes, row.internal_notes, row.legacy_notes]
        .filter(Boolean)
        .join(" ");

      const mortality = detectMortalityType(combinedNotes);
      if (mortality) {
        stats.mortality_found++;
        stats.by_cause[mortality.cause] = (stats.by_cause[mortality.cause] || 0) + 1;

        const deathDate =
          extractDate(combinedNotes) ||
          row.resolved_at ||
          row.source_created_at;
        if (deathDate) stats.with_date++;

        const ageCategory = detectAgeCategory(combinedNotes);

        if (VERBOSE) {
          console.log(`  [Request] ${row.request_id}: ${mortality.cause}`);
          console.log(`    Match: "${mortality.match}"`);
        }

        if (!DRY_RUN) {
          try {
            const insertSql = `
              INSERT INTO ops.cat_mortality_events (
                cat_id,
                place_id,
                death_date,
                death_date_precision,
                death_cause,
                death_age_category,
                reported_by,
                source_system,
                source_record_id,
                notes
              ) VALUES (
                NULL,
                $1,
                $2::DATE,
                'estimated',
                $3,
                $4,
                'notes_parser',
                'atlas_ui',
                $5,
                $6
              )
              ON CONFLICT DO NOTHING
              RETURNING mortality_event_id
            `;

            const result = await pool.query(insertSql, [
              row.place_id,
              deathDate,
              mortality.cause,
              ageCategory,
              row.request_id,
              `Extracted from request notes: "${mortality.match}"`,
            ]);

            if (result.rows.length > 0) {
              stats.events_created++;
            }
          } catch (err) {
            stats.errors.push(`Request ${row.request_id}: ${err.message}`);
          }
        }
      }
    }

    // ============================================
    // 3. Parse appointment notes (cat-specific)
    // ============================================
    console.log("\nScanning appointment notes...");

    const appointmentsSql = `
      SELECT
        a.appointment_id,
        a.cat_id,
        a.medical_notes,
        a.internal_notes,
        a.appointment_date,
        c.display_name AS cat_name,
        cpr.place_id
      FROM ops.appointments a
      JOIN sot.cats c ON c.cat_id = a.cat_id
      LEFT JOIN sot.cat_place_relationships cpr ON cpr.cat_id = a.cat_id
      WHERE (a.medical_notes IS NOT NULL OR a.internal_notes IS NOT NULL)
        AND a.cat_id IS NOT NULL
      LIMIT 5000
    `;

    const { rows: appointmentRows } = await pool.query(appointmentsSql);
    stats.sources_scanned.appointments = appointmentRows.length;
    console.log(`  Found ${appointmentRows.length} appointments with notes`);

    for (const row of appointmentRows) {
      const combinedNotes = [row.medical_notes, row.internal_notes]
        .filter(Boolean)
        .join(" ");

      const mortality = detectMortalityType(combinedNotes);
      if (mortality) {
        stats.mortality_found++;
        stats.by_cause[mortality.cause] = (stats.by_cause[mortality.cause] || 0) + 1;

        const deathDate = extractDate(combinedNotes) || row.appointment_date;
        if (deathDate) stats.with_date++;

        const ageCategory = detectAgeCategory(combinedNotes);

        if (VERBOSE) {
          console.log(
            `  [Appointment] Cat ${row.cat_name || row.cat_id}: ${mortality.cause}`
          );
          console.log(`    Match: "${mortality.match}"`);
        }

        if (!DRY_RUN) {
          try {
            // Check if cat already marked as deceased
            const catCheck = await pool.query(
              `SELECT is_deceased FROM sot.cats WHERE cat_id = $1`,
              [row.cat_id]
            );

            if (catCheck.rows[0]?.is_deceased) {
              // Already marked, skip
              continue;
            }

            // Create mortality event WITH specific cat
            const insertSql = `
              INSERT INTO ops.cat_mortality_events (
                cat_id,
                place_id,
                death_date,
                death_date_precision,
                death_cause,
                death_age_category,
                reported_by,
                source_system,
                source_record_id,
                notes
              ) VALUES (
                $1,
                $2,
                $3::DATE,
                'estimated',
                $4,
                $5,
                'notes_parser',
                'clinichq',
                $6,
                $7
              )
              ON CONFLICT DO NOTHING
              RETURNING mortality_event_id
            `;

            const result = await pool.query(insertSql, [
              row.cat_id,
              row.place_id,
              deathDate,
              mortality.cause,
              ageCategory,
              row.appointment_id,
              `Extracted from appointment notes: "${mortality.match}"`,
            ]);

            if (result.rows.length > 0) {
              stats.events_created++;

              // Update cat as deceased
              await pool.query(
                `UPDATE sot.cats
                 SET is_deceased = TRUE, deceased_date = $2
                 WHERE cat_id = $1`,
                [row.cat_id, deathDate]
              );
              stats.cats_updated++;
            }
          } catch (err) {
            stats.errors.push(`Appointment ${row.appointment_id}: ${err.message}`);
          }
        }
      }
    }

    // ============================================
    // 4. Parse intake submissions
    // ============================================
    console.log("\nScanning intake submissions...");

    const intakeSql = `
      SELECT
        submission_id,
        matched_place_id,
        situation_description,
        created_at
      FROM ops.intake_submissions
      WHERE situation_description IS NOT NULL
        AND situation_description != ''
      LIMIT 5000
    `;

    const { rows: intakeRows } = await pool.query(intakeSql);
    stats.sources_scanned.intake = intakeRows.length;
    console.log(`  Found ${intakeRows.length} intake submissions with situation`);

    for (const row of intakeRows) {
      const mortality = detectMortalityType(row.situation_description);
      if (mortality) {
        stats.mortality_found++;
        stats.by_cause[mortality.cause] = (stats.by_cause[mortality.cause] || 0) + 1;

        const deathDate = extractDate(row.situation_description) || row.created_at;
        if (deathDate) stats.with_date++;

        const ageCategory = detectAgeCategory(row.situation_description);

        if (VERBOSE) {
          console.log(`  [Intake] ${row.submission_id}: ${mortality.cause}`);
          console.log(`    Match: "${mortality.match}"`);
        }

        if (!DRY_RUN && row.matched_place_id) {
          try {
            const insertSql = `
              INSERT INTO ops.cat_mortality_events (
                cat_id,
                place_id,
                death_date,
                death_date_precision,
                death_cause,
                death_age_category,
                reported_by,
                source_system,
                source_record_id,
                notes
              ) VALUES (
                NULL,
                $1,
                $2::DATE,
                'estimated',
                $3,
                $4,
                'notes_parser',
                'web_intake',
                $5,
                $6
              )
              ON CONFLICT DO NOTHING
              RETURNING mortality_event_id
            `;

            const result = await pool.query(insertSql, [
              row.matched_place_id,
              deathDate,
              mortality.cause,
              ageCategory,
              row.submission_id,
              `Extracted from intake: "${mortality.match}"`,
            ]);

            if (result.rows.length > 0) {
              stats.events_created++;
            }
          } catch (err) {
            stats.errors.push(`Intake ${row.submission_id}: ${err.message}`);
          }
        }
      }
    }

    // Print summary
    console.log("\n" + "=".repeat(60));
    console.log("SUMMARY");
    console.log("=".repeat(60));
    console.log("\nSources Scanned:");
    console.log(`  KML/Legacy:       ${stats.sources_scanned.colony_estimates}`);
    console.log(`  Requests:         ${stats.sources_scanned.requests}`);
    console.log(`  Appointments:     ${stats.sources_scanned.appointments}`);
    console.log(`  Intake:           ${stats.sources_scanned.intake}`);

    console.log(`\nMortality Mentions: ${stats.mortality_found}`);
    console.log(`  With Date:        ${stats.with_date}`);

    console.log("\nBy Cause:");
    for (const [cause, count] of Object.entries(stats.by_cause).sort(
      (a, b) => b[1] - a[1]
    )) {
      console.log(`  ${cause.padEnd(15)} ${count}`);
    }

    if (!DRY_RUN) {
      console.log("\nRecords Created:");
      console.log(`  Mortality events: ${stats.events_created}`);
      console.log(`  Cats updated:     ${stats.cats_updated}`);
    } else {
      console.log("\n(DRY RUN - no changes made)");
    }

    if (stats.errors.length > 0) {
      console.log(`\nErrors: ${stats.errors.length}`);
      stats.errors.slice(0, 5).forEach((e) => console.log(`  - ${e}`));
    }

    console.log("\n" + "=".repeat(60));
  } catch (error) {
    console.error("Fatal error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
