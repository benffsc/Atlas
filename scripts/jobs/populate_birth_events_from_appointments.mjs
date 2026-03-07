#!/usr/bin/env node
/**
 * Populate Birth Events from Appointments
 * ========================================
 *
 * Creates birth events from clinic appointments where:
 * - is_lactating = true -> Mother gave birth ~4-8 weeks before appointment
 * - is_pregnant = true -> Mother expected to give birth ~4-8 weeks after appointment
 *
 * This populates the cat_birth_events table for Beacon population modeling.
 *
 * Usage:
 *   node scripts/jobs/populate_birth_events_from_appointments.mjs [--dry-run] [--limit N]
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
const bold = '\x1b[1m';
const reset = '\x1b[0m';

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes('--dry-run'),
    limit: args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : null,
    help: args.includes('--help') || args.includes('-h'),
  };
}

async function main() {
  const options = parseArgs();

  if (options.help) {
    console.log(`
${bold}Populate Birth Events from Appointments${reset}

Usage: node scripts/jobs/populate_birth_events_from_appointments.mjs [options]

Options:
  --dry-run    Preview without saving to database
  --limit N    Process up to N appointments
  --help       Show this help

Environment:
  DATABASE_URL     Postgres connection string
`);
    process.exit(0);
  }

  console.log(`\n${bold}Populate Birth Events from Appointments${reset}`);
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
    // Get lactating appointments that don't already have birth events
    const lactatingQuery = `
      SELECT DISTINCT ON (a.cat_id)
        a.appointment_id,
        a.appointment_date,
        a.cat_id,
        c.display_name as cat_name,
        c.sex,
        a.medical_notes,
        a.is_pregnant,
        a.is_lactating,
        -- Try to find the place via cat's existing place relationships
        (
          SELECT cpr.place_id
          FROM sot.cat_place_relationships cpr
          WHERE cpr.cat_id = a.cat_id
          ORDER BY cpr.created_at DESC
          LIMIT 1
        ) as inferred_place_id
      FROM ops.appointments a
      JOIN sot.cats c ON c.cat_id = a.cat_id
      LEFT JOIN ops.cat_birth_events be ON be.mother_cat_id = a.cat_id
      WHERE a.is_lactating = true
        AND c.sex = 'Female'
        AND be.birth_event_id IS NULL  -- No birth event yet for this mother
      ORDER BY a.cat_id, a.appointment_date DESC
      ${options.limit ? `LIMIT ${options.limit}` : ''}
    `;

    const result = await pool.query(lactatingQuery);

    console.log(`${cyan}Found:${reset} ${result.rows.length} lactating mothers without birth events\n`);

    if (result.rows.length === 0) {
      console.log(`${green}All lactating appointments already have birth events!${reset}`);
      return;
    }

    const stats = {
      processed: 0,
      created: 0,
      skipped: 0,
      errors: 0,
    };

    for (const row of result.rows) {
      stats.processed++;
      process.stdout.write(`  [${stats.processed}/${result.rows.length}] ${row.cat_name || 'Unknown'} `);

      // Estimate birth date: lactating = gave birth ~4-8 weeks ago
      // Use 6 weeks as midpoint
      const appointmentDate = new Date(row.appointment_date);
      const estimatedBirthDate = new Date(appointmentDate);
      estimatedBirthDate.setDate(estimatedBirthDate.getDate() - 42); // 6 weeks before

      // Determine birth precision based on notes
      let precision = 'estimated';
      let kittenCount = null;
      const notes = (row.medical_notes || '').toLowerCase();

      // Try to extract kitten info from notes
      if (notes.includes('kittens older') || notes.includes('weaning')) {
        // Kittens are older, birth was earlier
        estimatedBirthDate.setDate(estimatedBirthDate.getDate() - 14); // Adjust earlier
      }

      // Look for kitten count mentions
      const countMatch = notes.match(/(\d+)\s*kitten/);
      if (countMatch) {
        kittenCount = parseInt(countMatch[1]);
      }

      if (options.dryRun) {
        console.log(`${green}would create${reset} birth ~${estimatedBirthDate.toISOString().split('T')[0]}`);
      } else {
        try {
          // Insert directly - tracking the mother's litter (no individual kitten cat_id)
          const insertResult = await pool.query(`
            INSERT INTO ops.cat_birth_events (
              cat_id,
              mother_cat_id,
              birth_date,
              birth_date_precision,
              birth_year,
              birth_month,
              birth_season,
              place_id,
              kitten_count_in_litter,
              source_system,
              source_record_id,
              reported_by,
              notes
            ) VALUES (
              NULL,  -- No individual kitten, this is a litter-level record
              $1,    -- mother_cat_id
              $2,    -- birth_date
              $3,
              EXTRACT(YEAR FROM $2::date)::int,
              EXTRACT(MONTH FROM $2::date)::int,
              CASE
                WHEN EXTRACT(MONTH FROM $2::date) IN (3,4,5) THEN 'spring'
                WHEN EXTRACT(MONTH FROM $2::date) IN (6,7,8) THEN 'summer'
                WHEN EXTRACT(MONTH FROM $2::date) IN (9,10,11) THEN 'fall'
                ELSE 'winter'
              END,
              $4,    -- place_id
              $5,    -- kitten_count
              'atlas_clinic',
              $6,    -- source_record_id (appointment_id)
              'System',
              $7     -- notes
            )
            ON CONFLICT DO NOTHING
            RETURNING birth_event_id
          `, [
            row.cat_id,  // mother
            estimatedBirthDate,
            precision,
            row.inferred_place_id,
            kittenCount,
            row.appointment_id,
            `Inferred from lactating appointment on ${row.appointment_date}. ${row.medical_notes || ''}`
          ]);

          if (insertResult.rows.length > 0) {
            console.log(`${green}created${reset} birth ~${estimatedBirthDate.toISOString().split('T')[0]}`);
            stats.created++;
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

    // Now handle pregnant appointments (expected future births)
    const pregnantQuery = `
      SELECT DISTINCT ON (a.cat_id)
        a.appointment_id,
        a.appointment_date,
        a.cat_id,
        c.display_name as cat_name,
        a.medical_notes,
        (
          SELECT cpr.place_id
          FROM sot.cat_place_relationships cpr
          WHERE cpr.cat_id = a.cat_id
          ORDER BY cpr.created_at DESC
          LIMIT 1
        ) as inferred_place_id
      FROM ops.appointments a
      JOIN sot.cats c ON c.cat_id = a.cat_id
      LEFT JOIN ops.cat_birth_events be ON be.mother_cat_id = a.cat_id
      WHERE a.is_pregnant = true
        AND a.is_lactating = false  -- Not yet given birth at this appointment
        AND c.sex = 'Female'
        AND be.birth_event_id IS NULL
        AND a.appointment_date <= CURRENT_DATE - INTERVAL '60 days'  -- Old enough that birth should have happened
      ORDER BY a.cat_id, a.appointment_date DESC
      ${options.limit ? `LIMIT ${options.limit}` : ''}
    `;

    const pregnantResult = await pool.query(pregnantQuery);

    console.log(`\n${cyan}Found:${reset} ${pregnantResult.rows.length} pregnant mothers (past due) without birth events\n`);

    for (const row of pregnantResult.rows) {
      stats.processed++;
      process.stdout.write(`  [${stats.processed}] ${row.cat_name || 'Unknown'} (pregnant) `);

      // Estimate birth date: pregnant = gave birth ~60 days after appointment
      const appointmentDate = new Date(row.appointment_date);
      const estimatedBirthDate = new Date(appointmentDate);
      estimatedBirthDate.setDate(estimatedBirthDate.getDate() + 60);

      // Cap at today if estimated is in future
      const today = new Date();
      if (estimatedBirthDate > today) {
        estimatedBirthDate.setTime(today.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
      }

      if (options.dryRun) {
        console.log(`${green}would create${reset} birth ~${estimatedBirthDate.toISOString().split('T')[0]}`);
      } else {
        try {
          const insertResult = await pool.query(`
            INSERT INTO ops.cat_birth_events (
              cat_id,
              mother_cat_id,
              birth_date,
              birth_date_precision,
              birth_year,
              birth_month,
              birth_season,
              place_id,
              source_system,
              source_record_id,
              reported_by,
              notes
            ) VALUES (
              NULL,
              $1,
              $2,
              'estimated',
              EXTRACT(YEAR FROM $2::date)::int,
              EXTRACT(MONTH FROM $2::date)::int,
              CASE
                WHEN EXTRACT(MONTH FROM $2::date) IN (3,4,5) THEN 'spring'
                WHEN EXTRACT(MONTH FROM $2::date) IN (6,7,8) THEN 'summer'
                WHEN EXTRACT(MONTH FROM $2::date) IN (9,10,11) THEN 'fall'
                ELSE 'winter'
              END,
              $3,
              'atlas_clinic',
              $4,
              'System',
              $5
            )
            ON CONFLICT DO NOTHING
            RETURNING birth_event_id
          `, [
            row.cat_id,
            estimatedBirthDate,
            row.inferred_place_id,
            row.appointment_id,
            `Inferred from pregnant appointment on ${row.appointment_date}. ${row.medical_notes || ''}`
          ]);

          if (insertResult.rows.length > 0) {
            console.log(`${green}created${reset}`);
            stats.created++;
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

    // Check total birth events now
    const countResult = await pool.query(`SELECT COUNT(*) as count FROM ops.cat_birth_events`);
    console.log(`\n${cyan}Total birth events now:${reset} ${countResult.rows[0].count}`);

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
