#!/usr/bin/env node
/**
 * Request Notes Parser Script
 * ============================
 *
 * Parses internal_notes, notes, and legacy_notes from sot_requests
 * to extract colony size estimates and eartip observations.
 *
 * Patterns extracted:
 * - Cat counts: "~3 males", "about 20 cats", "colony of 8", "feeds 15"
 * - Eartip observations: "saw 5 eartipped", "3 with ear tips"
 * - Colony status: "colony complete", "all fixed", "3 remaining"
 *
 * PREREQUISITES:
 * - colony_source_confidence removed in v2 — no prerequisite needed
 *
 * Usage:
 *   node scripts/ingest/parse_request_notes_estimates.mjs [--dry-run] [--limit N] [--verbose]
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
const SOURCE_TYPE = 'internal_notes_parse';
const SOURCE_SYSTEM = 'notes_parser';

// Regex patterns for extraction
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

  // Use largest TNR count (sum if multiple distinct mentions)
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
${bold}Request Notes Parser Script${reset}

Usage: node scripts/ingest/parse_request_notes_estimates.mjs [options]

Options:
  --dry-run    Preview changes without writing to database
  --verbose    Show detailed parsing results
  --limit N    Process only first N requests
  --help       Show this help

Prerequisites:
  1. Run MIG_267 (adds 'internal_notes_parse' source_type)

This script parses:
  - sot_requests.notes (case information)
  - sot_requests.internal_notes (staff working notes)
  - sot_requests.legacy_notes (Airtable migration notes)
`);
    process.exit(0);
  }

  console.log(`\n${bold}Request Notes Parser${reset}`);
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
    // Load requests with notes
    console.log(`${cyan}Loading requests with notes...${reset}`);
    let query = `
      SELECT
        r.request_id,
        r.place_id,
        r.notes,
        r.internal_notes,
        r.legacy_notes,
        r.source_created_at,
        p.display_name as place_name
      FROM ops.requests r
      LEFT JOIN sot.places p ON p.place_id = r.place_id
      WHERE r.place_id IS NOT NULL
        AND (r.notes IS NOT NULL OR r.internal_notes IS NOT NULL OR r.legacy_notes IS NOT NULL)
    `;
    if (options.limit) {
      query += ` LIMIT ${options.limit}`;
    }

    const requestsResult = await pool.query(query);
    console.log(`${cyan}Loaded:${reset} ${requestsResult.rowCount} requests with notes`);

    // Stats
    const stats = {
      total: requestsResult.rowCount,
      parsed: 0,
      withColonySize: 0,
      withTnrCount: 0,
      withEartipCount: 0,
      inserted: 0,
      skipped_duplicate: 0,
      skipped_no_data: 0,
      errors: 0,
    };

    // Process requests
    console.log(`\n${cyan}Parsing notes...${reset}\n`);

    for (let i = 0; i < requestsResult.rows.length; i++) {
      const request = requestsResult.rows[i];

      if ((i + 1) % 100 === 0) {
        console.log(`  Processed ${i + 1}/${stats.total}...`);
      }

      try {
        // Combine all notes fields
        const allNotes = [
          request.notes,
          request.internal_notes,
          request.legacy_notes,
        ].filter(Boolean).join('\n\n');

        // Parse notes
        const parsed = parseNotes(allNotes);

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
          console.log(`${cyan}Request:${reset} ${request.request_id}`);
          console.log(`${cyan}Place:${reset} ${request.place_name || 'Unknown'}`);
          console.log(`${cyan}Parsed:${reset}`, parsed);
          if (allNotes.length < 200) {
            console.log(`${cyan}Notes:${reset} ${allNotes}`);
          }
        }

        if (options.dryRun) continue;

        // Create source_record_id for deduplication
        const sourceRecordId = `request_notes_${request.request_id}`;

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
          request.place_id,
          parsed.totalCats,
          parsed.alteredCount,
          parsed.eartipCount,
          parsed.totalCats, // Use colony size as total observed
          parsed.remainingCount,
          SOURCE_TYPE,
          'request',
          request.request_id,
          request.source_created_at ? new Date(request.source_created_at) : null,
          false, // Parsed from notes, not firsthand
          notesSummary,
          parsed.confidence,
          SOURCE_SYSTEM,
          sourceRecordId,
        ]);

        stats.inserted++;

      } catch (err) {
        stats.errors++;
        if (stats.errors <= 5) {
          console.error(`${red}Error processing request ${request.request_id}:${reset} ${err.message}`);
        }
      }
    }

    // Summary
    console.log(`\n${'═'.repeat(50)}`);
    console.log(`${bold}Parse Summary${reset}`);
    console.log(`${'═'.repeat(50)}`);
    console.log(`${cyan}Total requests:${reset}      ${stats.total}`);
    console.log(`${green}Successfully parsed:${reset} ${stats.parsed}`);
    console.log(`  - With colony size:  ${stats.withColonySize}`);
    console.log(`  - With TNR count:    ${stats.withTnrCount}`);
    console.log(`  - With eartip count: ${stats.withEartipCount}`);
    console.log(`${green}Estimates inserted:${reset}  ${stats.inserted}`);
    console.log(`${yellow}Skipped (no data):${reset}   ${stats.skipped_no_data}`);
    console.log(`${yellow}Skipped (duplicate):${reset} ${stats.skipped_duplicate}`);
    if (stats.errors > 0) {
      console.log(`${red}Errors:${reset}              ${stats.errors}`);
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
