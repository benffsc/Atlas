#!/usr/bin/env node
/**
 * Appointment Notes Parser Script
 * ================================
 *
 * Parses medical_notes from sot_appointments to extract colony size
 * estimates and cat observations.
 *
 * Appointments often have notes like:
 * - "Colony of ~15 cats"
 * - "Owner says about 20 cats at location"
 * - "3 cats already eartipped"
 * - "Feral colony, 10+ cats"
 *
 * PREREQUISITES:
 * - Run MIG_267 first (adds 'appointment_notes_parse' to colony_source_confidence)
 *
 * Usage:
 *   node scripts/ingest/parse_appointment_notes.mjs [--dry-run] [--limit N] [--verbose]
 */

import pg from 'pg';

const { Pool } = pg;

// ANSI colors
const green = '\x1b[32m';
const yellow = '\x1b[33m';
const red = '\x1b[31m';
const cyan = '\x1b[36m';
const bold = '\x1b[1m';
const dim = '\x1b[2m';
const reset = '\x1b[0m';

// Configuration
const SOURCE_TYPE = 'appointment_notes_parse';
const SOURCE_SYSTEM = 'notes_parser';

// Regex patterns for extraction (same patterns as request notes parser)
const PATTERNS = {
  // Cat count patterns - prioritized by specificity
  colonySize: [
    // "colony of 15" or "colony of about 15"
    /colony\s+of\s+(?:about\s+)?(\d{1,3})/gi,
    // "feeds 20 cats" or "feeding 15"
    /feeds?\s+(?:about\s+)?(\d{1,3})(?:\s+cats?)?/gi,
    // "about 20 cats" or "approximately 15 cats"
    /(?:about|approximately|around|roughly|~)\s*(\d{1,3})\s*(?:cats?|felines?)/gi,
    // "has 15 cats" or "there are 20 cats"
    /(?:has|there\s+are|there's|sees?)\s+(?:about\s+)?(\d{1,3})\s*(?:cats?|felines?)/gi,
    // "20 cats total" or "15 cats at location"
    /(\d{1,3})\s*cats?\s+(?:total|at\s+(?:the\s+)?(?:location|site|property))/gi,
    // "estimated 15" or "estimate: 20"
    /estimat(?:ed?|e[ds]?)[:\s]+(\d{1,3})/gi,
    // "10+ cats" or "15+ feral"
    /(\d{1,3})\+\s*(?:cats?|feral|community)/gi,
    // "feral colony, 10 cats"
    /(?:feral|community)\s+colony[,\s]+(\d{1,3})/gi,
    // "large colony 20" or "small colony 5"
    /(?:large|small|medium)\s+colony\s+(?:of\s+)?(\d{1,3})/gi,
  ],

  // TNR/altered count patterns
  tnrCount: [
    // "10 cats TNR'd" or "TNR'd 5 cats"
    /(\d{1,3})\s*(?:cats?|adults?|kittens?)?\s*(?:were\s+)?(?:TNR'?d|fixed|altered|spayed|neutered)/gi,
    /(?:TNR'?d|fixed|altered|spayed|neutered)\s+(\d{1,3})\s*(?:cats?|adults?|kittens?)?/gi,
    // "already fixed 5" or "5 already fixed"
    /(\d{1,3})\s+already\s+(?:fixed|altered|tnr)/gi,
    /already\s+(?:fixed|altered|tnr'?d?)\s+(\d{1,3})/gi,
  ],

  // Eartip observation patterns
  eartipCount: [
    // "saw 5 eartipped" or "5 with ear tips"
    /(\d{1,3})\s*(?:with\s+)?ear[\s-]?tip(?:ped|s)?/gi,
    /ear[\s-]?tip(?:ped|s)?\s*[:\s]+(\d{1,3})/gi,
    // "3 already tipped"
    /(\d{1,3})\s+already\s+(?:ear[\s-]?)?tipped/gi,
    // "tipped 5" or "eartipped: 3"
    /(?:ear[\s-]?)?tipped[:\s]+(\d{1,3})/gi,
  ],

  // Remaining/unaltered patterns
  remainingCount: [
    // "3 remaining" or "~5 left"
    /(\d{1,3})\s*(?:cats?\s+)?(?:remaining|left|still\s+need)/gi,
    /(?:remaining|left)[:\s]+(\d{1,3})/gi,
    // "need to fix 5 more"
    /need\s+(?:to\s+)?(?:fix|trap|tnr)\s+(\d{1,3})/gi,
    // "3 unfixed" or "5 unaltered"
    /(\d{1,3})\s*(?:un(?:fixed|altered|spayed|neutered))/gi,
  ],

  // Colony complete signals
  colonyComplete: [
    /colony\s+(?:is\s+)?(?:now\s+)?complete/gi,
    /all\s+(?:cats?\s+)?(?:are\s+)?(?:fixed|altered|tnr)/gi,
    /100%\s*(?:fixed|altered|complete)/gi,
    /no\s+(?:more\s+)?(?:unfixed|unaltered)\s+cats/gi,
  ],
};

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes('--dry-run'),
    verbose: args.includes('--verbose') || args.includes('-v'),
    limit: args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : null,
    help: args.includes('--help') || args.includes('-h'),
  };
}

// Extract numbers from text using patterns
function extractNumbers(text, patterns) {
  const numbers = new Set();
  for (const pattern of patterns) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const num = parseInt(match[1]);
      if (num > 0 && num <= 200) { // Sanity check: reasonable colony sizes
        numbers.add(num);
      }
    }
  }
  return Array.from(numbers);
}

// Check if any patterns match
function hasMatch(text, patterns) {
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) return true;
  }
  return false;
}

// Parse notes and extract colony data
function parseNotes(text) {
  if (!text || typeof text !== 'string') return null;

  const result = {
    totalCats: null,
    alteredCount: null,
    eartipCount: null,
    remainingCount: null,
    isColonyComplete: false,
    confidence: 'low',
    matchedPatterns: [],
  };

  // Extract counts
  const colonySizes = extractNumbers(text, PATTERNS.colonySize);
  const tnrCounts = extractNumbers(text, PATTERNS.tnrCount);
  const eartipCounts = extractNumbers(text, PATTERNS.eartipCount);
  const remainingCounts = extractNumbers(text, PATTERNS.remainingCount);

  // Use largest colony size found (most likely to be total)
  if (colonySizes.length > 0) {
    result.totalCats = Math.max(...colonySizes);
    result.matchedPatterns.push('colonySize');
    result.confidence = 'medium';
  }

  // Use largest TNR count
  if (tnrCounts.length > 0) {
    result.alteredCount = Math.max(...tnrCounts);
    result.matchedPatterns.push('tnrCount');
    result.confidence = 'medium';
  }

  // Eartip observations
  if (eartipCounts.length > 0) {
    result.eartipCount = Math.max(...eartipCounts);
    result.matchedPatterns.push('eartipCount');
    result.confidence = 'high'; // Eartip data is valuable
  }

  // Remaining count
  if (remainingCounts.length > 0) {
    result.remainingCount = Math.max(...remainingCounts);
    result.matchedPatterns.push('remainingCount');
  }

  // Check colony complete status
  if (hasMatch(text, PATTERNS.colonyComplete)) {
    result.isColonyComplete = true;
    result.matchedPatterns.push('colonyComplete');
    result.confidence = 'high';
  }

  // Only return if we found something useful
  if (result.matchedPatterns.length === 0) return null;

  return result;
}

async function main() {
  const options = parseArgs();

  if (options.help) {
    console.log(`
${bold}Appointment Notes Parser Script${reset}

Usage: node scripts/ingest/parse_appointment_notes.mjs [options]

Options:
  --dry-run    Preview changes without writing to database
  --verbose    Show detailed parsing results
  --limit N    Process only first N appointments
  --help       Show this help

Prerequisites:
  1. Run MIG_267 (adds 'appointment_notes_parse' source_type)

This script parses:
  - sot_appointments.medical_notes (from ClinicHQ Internal Medical Notes)
`);
    process.exit(0);
  }

  console.log(`\n${bold}Appointment Notes Parser${reset}`);
  console.log('═'.repeat(50));

  if (options.dryRun) {
    console.log(`${yellow}DRY RUN MODE - No changes will be made${reset}\n`);
  }

  if (!process.env.DATABASE_URL) {
    console.error(`${red}Error:${reset} DATABASE_URL not set`);
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // Check if source_type exists
    const sourceCheck = await pool.query(
      `SELECT 1 FROM ops.colony_source_confidence WHERE source_type = $1`,
      [SOURCE_TYPE]
    );
    if (sourceCheck.rowCount === 0) {
      console.error(`${red}Error:${reset} source_type '${SOURCE_TYPE}' not in colony_source_confidence`);
      console.error(`Run MIG_267 first to add it.`);
      process.exit(1);
    }

    // Load appointments with medical_notes and place_id
    console.log(`${cyan}Loading appointments with medical notes and place links...${reset}`);
    let query = `
      SELECT
        a.appointment_id,
        a.place_id,
        a.cat_id,
        a.medical_notes,
        a.appointment_date,
        p.display_name as place_name,
        c.display_name as cat_name
      FROM ops.appointments a
      LEFT JOIN sot.places p ON p.place_id = a.place_id
      LEFT JOIN sot.cats c ON c.cat_id = a.cat_id
      WHERE a.place_id IS NOT NULL
        AND a.medical_notes IS NOT NULL
        AND a.medical_notes != ''
        AND LENGTH(a.medical_notes) > 10
    `;
    if (options.limit) {
      query += ` LIMIT ${options.limit}`;
    }

    const appointmentsResult = await pool.query(query);
    console.log(`${cyan}Loaded:${reset} ${appointmentsResult.rowCount} appointments with notes`);

    // Stats
    const stats = {
      total: appointmentsResult.rowCount,
      parsed: 0,
      withColonySize: 0,
      withTnrCount: 0,
      withEartipCount: 0,
      inserted: 0,
      skipped_duplicate: 0,
      skipped_no_data: 0,
      errors: 0,
    };

    // Process appointments
    console.log(`\n${cyan}Parsing notes...${reset}\n`);

    for (let i = 0; i < appointmentsResult.rows.length; i++) {
      const appointment = appointmentsResult.rows[i];

      if ((i + 1) % 100 === 0) {
        console.log(`  Processed ${i + 1}/${stats.total}...`);
      }

      try {
        // Parse notes
        const parsed = parseNotes(appointment.medical_notes);

        if (!parsed) {
          stats.skipped_no_data++;
          continue;
        }

        stats.parsed++;
        if (parsed.totalCats) stats.withColonySize++;
        if (parsed.alteredCount) stats.withTnrCount++;
        if (parsed.eartipCount) stats.withEartipCount++;

        if (options.verbose) {
          console.log(`\n${dim}─────────────────────────────────────${reset}`);
          console.log(`${cyan}Appointment:${reset} ${appointment.appointment_id}`);
          console.log(`${cyan}Place:${reset} ${appointment.place_name || 'Unknown'}`);
          console.log(`${cyan}Cat:${reset} ${appointment.cat_name || 'Unknown'}`);
          console.log(`${cyan}Parsed:${reset}`, parsed);
          if (appointment.medical_notes.length < 200) {
            console.log(`${cyan}Notes:${reset} ${appointment.medical_notes}`);
          }
        }

        if (options.dryRun) continue;

        // Create source_record_id for deduplication
        const sourceRecordId = `appointment_notes_${appointment.appointment_id}`;

        // Check for existing estimate from this source
        const existingEstimate = await pool.query(`
          SELECT 1 FROM sot.place_colony_estimates
          WHERE source_system = $1 AND source_record_id = $2
        `, [SOURCE_SYSTEM, sourceRecordId]);

        if (existingEstimate.rowCount > 0) {
          stats.skipped_duplicate++;
          continue;
        }

        // Only insert if we have actual counts
        if (!parsed.totalCats && !parsed.alteredCount && !parsed.eartipCount) {
          stats.skipped_no_data++;
          continue;
        }

        // Build notes summary
        const notesSummary = `Patterns: ${parsed.matchedPatterns.join(', ')}. ` +
          `Confidence: ${parsed.confidence}` +
          (parsed.isColonyComplete ? '. Colony marked complete.' : '');

        // Insert colony estimate
        await pool.query(`
          INSERT INTO sot.place_colony_estimates (
            place_id,
            total_cats,
            altered_count,
            eartip_count_observed,
            total_cats_observed,
            unaltered_count,
            source_type,
            source_entity_type,
            source_entity_id,
            observation_date,
            is_firsthand,
            notes,
            reporter_confidence,
            source_system,
            source_record_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
          ON CONFLICT (source_system, source_record_id) DO NOTHING
        `, [
          appointment.place_id,
          parsed.totalCats,
          parsed.alteredCount,
          parsed.eartipCount,
          parsed.totalCats, // Use colony size as total observed
          parsed.remainingCount,
          SOURCE_TYPE,
          'appointment',
          appointment.appointment_id,
          appointment.appointment_date,
          true, // Appointment notes are firsthand observations from clinic
          notesSummary,
          parsed.confidence,
          SOURCE_SYSTEM,
          sourceRecordId,
        ]);

        stats.inserted++;

      } catch (err) {
        stats.errors++;
        if (stats.errors <= 5) {
          console.error(`${red}Error processing appointment ${appointment.appointment_id}:${reset} ${err.message}`);
        }
      }
    }

    // Summary
    console.log(`\n${'═'.repeat(50)}`);
    console.log(`${bold}Parse Summary${reset}`);
    console.log(`${'═'.repeat(50)}`);
    console.log(`${cyan}Total appointments:${reset}   ${stats.total}`);
    console.log(`${green}Successfully parsed:${reset}  ${stats.parsed}`);
    console.log(`  - With colony size:   ${stats.withColonySize}`);
    console.log(`  - With TNR count:     ${stats.withTnrCount}`);
    console.log(`  - With eartip count:  ${stats.withEartipCount}`);
    console.log(`${green}Estimates inserted:${reset}   ${stats.inserted}`);
    console.log(`${yellow}Skipped (no data):${reset}    ${stats.skipped_no_data}`);
    console.log(`${yellow}Skipped (duplicate):${reset}  ${stats.skipped_duplicate}`);
    if (stats.errors > 0) {
      console.log(`${red}Errors:${reset}               ${stats.errors}`);
    }

    if (options.dryRun) {
      console.log(`\n${yellow}DRY RUN - No changes were made${reset}`);
      console.log(`Run without --dry-run to insert estimates.`);
    }

  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error(`${red}Fatal error:${reset}`, err);
  process.exit(1);
});
