#!/usr/bin/env node
/**
 * Populate Mortality Events from Clinic Records
 * ==============================================
 *
 * Creates mortality events from clinic appointments where medical_notes indicate:
 * - "This animal died Post-operative"
 * - "Humanely euthanized"
 * - "Died at Petcare"
 * - Other death indicators
 *
 * This populates the cat_mortality_events table for Beacon survival modeling.
 *
 * Usage:
 *   node scripts/jobs/populate_mortality_from_clinic.mjs [--dry-run] [--limit N]
 *
 * Environment:
 *   DATABASE_URL - Postgres connection
 */

import pg from 'pg';

const { Pool } = pg;

// ANSI colors
const green = '\x1b[32m';
const yellow = '\x1b[33m';
const red = '\x1b[31m';
const cyan = '\x1b[36m';
const dim = '\x1b[2m';
const bold = '\x1b[1m';
const reset = '\x1b[0m';

// Death patterns and their causes
const DEATH_PATTERNS = [
  { pattern: /humanely\s+euthanized/i, cause: 'euthanasia', precision: 'exact' },
  { pattern: /euthanasia\s+(recommended|performed)/i, cause: 'euthanasia', precision: 'exact' },
  { pattern: /this\s+animal\s+died\s+post-?operative/i, cause: 'other', precision: 'exact' },
  { pattern: /died\s+(at|during|after)\s+(petcare|surgery|recovery)/i, cause: 'other', precision: 'exact' },
  { pattern: /hbc|hit\s+by\s+car/i, cause: 'vehicle', precision: 'estimated' },
  { pattern: /found\s+dead/i, cause: 'unknown', precision: 'estimated' },
  { pattern: /roadkill/i, cause: 'vehicle', precision: 'estimated' },
  { pattern: /passed\s+away/i, cause: 'unknown', precision: 'estimated' },
];

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes('--dry-run'),
    limit: args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : null,
    help: args.includes('--help') || args.includes('-h'),
  };
}

function detectDeathInfo(notes) {
  if (!notes) return null;
  const lowerNotes = notes.toLowerCase();

  for (const { pattern, cause, precision } of DEATH_PATTERNS) {
    if (pattern.test(notes)) {
      return { cause, precision };
    }
  }

  // Generic death detection
  if (lowerNotes.includes('died') || lowerNotes.includes('deceased') || lowerNotes.includes('dead')) {
    return { cause: 'unknown', precision: 'estimated' };
  }

  return null;
}

function extractDeathDate(notes, appointmentDate) {
  // Try to find a date in the notes
  // Pattern: MM/DD/YY or MM/DD/YYYY
  const dateMatch = notes.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (dateMatch) {
    const [, month, day, year] = dateMatch;
    const fullYear = year.length === 2 ? (parseInt(year) > 50 ? 1900 + parseInt(year) : 2000 + parseInt(year)) : parseInt(year);
    const parsedDate = new Date(fullYear, parseInt(month) - 1, parseInt(day));
    if (!isNaN(parsedDate.getTime())) {
      return parsedDate;
    }
  }

  // Default to appointment date
  return new Date(appointmentDate);
}

async function main() {
  const options = parseArgs();

  if (options.help) {
    console.log(`
${bold}Populate Mortality Events from Clinic${reset}

Usage: node scripts/jobs/populate_mortality_from_clinic.mjs [options]

Options:
  --dry-run    Preview without saving to database
  --limit N    Process up to N appointments
  --help       Show this help

Environment:
  DATABASE_URL     Postgres connection string
`);
    process.exit(0);
  }

  console.log(`\n${bold}Populate Mortality Events from Clinic${reset}`);
  console.log('═'.repeat(50));

  if (options.dryRun) {
    console.log(`${yellow}DRY RUN MODE${reset}\n`);
  }

  if (!process.env.DATABASE_URL) {
    console.error(`${red}Error:${reset} DATABASE_URL not set`);
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // Get appointments with death mentions that don't already have mortality events
    const query = `
      SELECT DISTINCT ON (a.cat_id)
        a.appointment_id,
        a.appointment_date,
        a.cat_id,
        c.display_name as cat_name,
        c.sex,
        c.birth_year,
        a.medical_notes,
        -- Try to find place via cat's relationships
        (
          SELECT cpr.place_id
          FROM sot.cat_place_relationships cpr
          WHERE cpr.cat_id = a.cat_id
          ORDER BY cpr.created_at DESC
          LIMIT 1
        ) as inferred_place_id
      FROM ops.appointments a
      JOIN sot.cats c ON c.cat_id = a.cat_id
      LEFT JOIN ops.cat_mortality_events me ON me.cat_id = a.cat_id
      WHERE (
        LOWER(a.medical_notes) LIKE '%died%'
        OR LOWER(a.medical_notes) LIKE '%deceased%'
        OR LOWER(a.medical_notes) LIKE '%euthanized%'
        OR LOWER(a.medical_notes) LIKE '%euthanasia%'
        OR LOWER(a.medical_notes) LIKE '%hit by car%'
        OR LOWER(a.medical_notes) LIKE '%hbc%'
        OR LOWER(a.medical_notes) LIKE '%found dead%'
        OR LOWER(a.medical_notes) LIKE '%passed away%'
      )
        AND me.mortality_event_id IS NULL  -- No mortality event yet
      ORDER BY a.cat_id, a.appointment_date DESC
      ${options.limit ? `LIMIT ${options.limit}` : ''}
    `;

    const result = await pool.query(query);

    console.log(`${cyan}Found:${reset} ${result.rows.length} appointments with death mentions\n`);

    if (result.rows.length === 0) {
      console.log(`${green}All death mentions already have mortality events!${reset}`);
      return;
    }

    const stats = {
      processed: 0,
      created: 0,
      skipped: 0,
      errors: 0,
      byCause: {},
    };

    for (const row of result.rows) {
      stats.processed++;
      process.stdout.write(`  [${stats.processed}/${result.rows.length}] ${row.cat_name || 'Unknown'} `);

      const deathInfo = detectDeathInfo(row.medical_notes);
      if (!deathInfo) {
        console.log(`${yellow}skipped${reset} - no clear death indicator`);
        stats.skipped++;
        continue;
      }

      const deathDate = extractDeathDate(row.medical_notes, row.appointment_date);

      // Calculate age at death if we have birth year
      let ageMonths = null;
      if (row.birth_year) {
        // Estimate from birth year (assume mid-year birth)
        const yearsDiff = deathDate.getFullYear() - row.birth_year;
        if (yearsDiff >= 0) {
          ageMonths = yearsDiff * 12 + 6; // Add 6 months for mid-year estimate
        }
      }

      // Track by cause
      stats.byCause[deathInfo.cause] = (stats.byCause[deathInfo.cause] || 0) + 1;

      if (options.dryRun) {
        console.log(`${green}would create${reset} ${deathInfo.cause} on ${deathDate.toISOString().split('T')[0]}`);
      } else {
        try {
          const insertResult = await pool.query(`
            INSERT INTO ops.cat_mortality_events (
              cat_id,
              death_date,
              death_date_precision,
              death_year,
              death_month,
              death_cause,
              death_cause_notes,
              death_age_months,
              death_age_category,
              place_id,
              source_system,
              source_record_id,
              reported_by,
              notes
            ) VALUES (
              $1,    -- cat_id
              $2,    -- death_date
              $3,    -- precision
              EXTRACT(YEAR FROM $2::date)::int,
              EXTRACT(MONTH FROM $2::date)::int,
              $4,
              $5,    -- cause notes
              $6,    -- age months
              ops.get_age_category($6),
              $7,    -- place_id
              'atlas_clinic',
              $8,    -- appointment_id
              'System',
              $9     -- notes
            )
            ON CONFLICT (cat_id) DO NOTHING
            RETURNING mortality_event_id
          `, [
            row.cat_id,
            deathDate,
            deathInfo.precision,
            deathInfo.cause,
            `Detected from clinic notes: ${row.medical_notes.substring(0, 200)}`,
            ageMonths,
            row.inferred_place_id,
            row.appointment_id,
            `Inferred from appointment on ${row.appointment_date}. ${row.medical_notes.substring(0, 500)}`
          ]);

          if (insertResult.rows.length > 0) {
            console.log(`${green}created${reset} ${deathInfo.cause}`);
            stats.created++;

            // Also mark cat as deceased
            await pool.query(`
              UPDATE sot.cats
              SET is_deceased = true, deceased_date = $2, updated_at = NOW()
              WHERE cat_id = $1
            `, [row.cat_id, deathDate]);
          } else {
            console.log(`${yellow}skipped${reset} - already exists`);
            stats.skipped++;
          }
        } catch (err) {
          console.log(`${red}error${reset} - ${err.message}`);
          stats.errors++;
        }
      }
    }

    // Summary
    console.log(`\n${'═'.repeat(50)}`);
    console.log(`${bold}Summary${reset}`);
    console.log(`${'═'.repeat(50)}`);
    console.log(`${cyan}Processed:${reset}  ${stats.processed}`);
    console.log(`${green}Created:${reset}    ${stats.created}`);
    console.log(`${yellow}Skipped:${reset}    ${stats.skipped}`);
    if (stats.errors > 0) {
      console.log(`${red}Errors:${reset}     ${stats.errors}`);
    }

    // Breakdown by cause
    console.log(`\n${bold}By Cause:${reset}`);
    for (const [cause, count] of Object.entries(stats.byCause)) {
      console.log(`  ${cause}: ${count}`);
    }

    // Check total mortality events now
    const countResult = await pool.query(`SELECT COUNT(*) as count FROM ops.cat_mortality_events`);
    console.log(`\n${cyan}Total mortality events now:${reset} ${countResult.rows[0].count}`);

    if (options.dryRun) {
      console.log(`\n${yellow}DRY RUN - No changes saved${reset}`);
    }

  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error(`${red}Fatal error:${reset}`, err);
  process.exit(1);
});
