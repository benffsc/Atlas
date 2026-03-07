#!/usr/bin/env node
/**
 * Intake Situation Parser Script
 * ================================
 *
 * Parses situation_description from web_intake_submissions
 * to extract colony size estimates and other useful data.
 *
 * This is a HIGH VALUE source - requesters describe their situation in detail,
 * often providing:
 * - Cat counts and colony sizes
 * - Feeding information
 * - Duration of colony presence
 * - Urgency signals (kittens, pregnant, injured)
 *
 * PREREQUISITES:
 * - Run MIG_267 first (adds 'intake_situation_parse' to colony_source_confidence)
 *
 * Usage:
 *   node scripts/ingest/parse_intake_situation.mjs [--dry-run] [--limit N] [--verbose]
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
const SOURCE_TYPE = 'intake_situation_parse';
const SOURCE_SYSTEM = 'intake_parser';

// Regex patterns for extraction
const PATTERNS = {
  // Cat count patterns - requesters often use casual language
  catCount: [
    // "I see 5 cats" or "there are about 20 cats"
    /(?:i\s+)?(?:see|have|feed|there\s+(?:are|is)|spotted|counted)\s+(?:about\s+|around\s+|approximately\s+|roughly\s+)?(\d{1,3})\s*(?:cats?|felines?|strays?)/gi,
    // "5 cats" at start of description or after punctuation
    /(?:^|[.!?]\s+)(\d{1,3})\s*(?:cats?|felines?|strays?)/gim,
    // "colony of 15" or "a colony with 20"
    /colony\s+(?:of\s+|with\s+)?(?:about\s+)?(\d{1,3})/gi,
    // "20 or so cats" or "maybe 15 cats"
    /(?:maybe|probably|about|around)\s+(\d{1,3})\s*(?:\s+or\s+so)?\s*(?:cats?|felines?|strays?)/gi,
    // "feeding 10" or "I feed about 15"
    /(?:i\s+)?feed(?:ing)?\s+(?:about\s+)?(\d{1,3})/gi,
    // "between 5-10 cats" - take upper bound
    /between\s+\d{1,2}\s*[-–]\s*(\d{1,3})\s*(?:cats?)?/gi,
    // "5-10 cats" - take upper bound
    /(\d{1,2})\s*[-–]\s*(\d{1,3})\s*(?:cats?|felines?|strays?)/gi,
  ],

  // Kitten-specific patterns
  kittenCount: [
    /(\d{1,2})\s*kittens?/gi,
    /kittens?[:\s]+(\d{1,2})/gi,
    /litter\s+of\s+(\d{1,2})/gi,
  ],

  // Already fixed/eartipped patterns
  fixedCount: [
    /(\d{1,3})\s*(?:are\s+)?(?:already\s+)?(?:fixed|altered|spayed|neutered|ear[\s-]?tipped)/gi,
    /(?:fixed|altered|spayed|neutered|ear[\s-]?tipped)\s*[:\s]+(\d{1,3})/gi,
  ],

  // Unfixed/need help patterns
  unfixedCount: [
    /(\d{1,3})\s*(?:are\s+)?(?:un(?:fixed|altered|spayed|neutered)|need(?:s?\s+to\s+be)?\s+(?:fixed|altered))/gi,
    /(?:still\s+)?need\s+(?:to\s+)?(?:fix|alter|spay|neuter)\s+(\d{1,3})/gi,
  ],

  // Urgency signals
  urgency: {
    pregnant: /pregnant|expecting|having\s+babies|about\s+to\s+give\s+birth/gi,
    nursing: /nursing|lactating|with\s+babies|feeding\s+kittens/gi,
    kittens: /kitten|babies|young\s+ones|litter/gi,
    injured: /injur(?:ed|y)|hurt|limping|wound|sick|ill|not\s+well/gi,
    urgent: /urgent|emergency|asap|immediately|desperate|please\s+help/gi,
  },

  // Feeding behavior
  feedingFrequency: [
    /feed(?:ing)?\s+(?:them\s+)?(?:every\s+)?day|daily/gi,
    /feed(?:ing)?\s+(?:them\s+)?(?:a\s+)?(?:few\s+)?times\s+(?:a\s+)?(?:day|week)/gi,
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
  const numbers = [];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      // Handle range patterns (take the larger number)
      if (match[2]) {
        const num = parseInt(match[2]);
        if (num > 0 && num <= 200) numbers.push(num);
      } else {
        const num = parseInt(match[1]);
        if (num > 0 && num <= 200) numbers.push(num);
      }
    }
  }
  return numbers;
}

// Check if any patterns match
function hasMatch(text, pattern) {
  pattern.lastIndex = 0;
  return pattern.test(text);
}

// Parse situation description
function parseSituation(text) {
  if (!text || typeof text !== 'string') return null;

  const result = {
    totalCats: null,
    kittenCount: null,
    fixedCount: null,
    unfixedCount: null,
    urgencySignals: [],
    feedsDaily: false,
    confidence: 'low',
    matchedPatterns: [],
  };

  // Extract counts
  const catCounts = extractNumbers(text, PATTERNS.catCount);
  const kittenCounts = extractNumbers(text, PATTERNS.kittenCount);
  const fixedCounts = extractNumbers(text, PATTERNS.fixedCount);
  const unfixedCounts = extractNumbers(text, PATTERNS.unfixedCount);

  // Use largest cat count found (requesters often mention same count multiple times)
  if (catCounts.length > 0) {
    result.totalCats = Math.max(...catCounts);
    result.matchedPatterns.push('catCount');
    result.confidence = 'medium';
  }

  // Kitten count
  if (kittenCounts.length > 0) {
    result.kittenCount = Math.max(...kittenCounts);
    result.matchedPatterns.push('kittenCount');
  }

  // Fixed count
  if (fixedCounts.length > 0) {
    result.fixedCount = Math.max(...fixedCounts);
    result.matchedPatterns.push('fixedCount');
    result.confidence = 'medium';
  }

  // Unfixed count
  if (unfixedCounts.length > 0) {
    result.unfixedCount = Math.max(...unfixedCounts);
    result.matchedPatterns.push('unfixedCount');
  }

  // Check urgency signals
  for (const [signal, pattern] of Object.entries(PATTERNS.urgency)) {
    if (hasMatch(text, pattern)) {
      result.urgencySignals.push(signal);
    }
  }
  if (result.urgencySignals.length > 0) {
    result.matchedPatterns.push('urgency:' + result.urgencySignals.join(','));
  }

  // Check feeding frequency
  for (const pattern of PATTERNS.feedingFrequency) {
    if (hasMatch(text, pattern)) {
      result.feedsDaily = true;
      result.matchedPatterns.push('feedsDaily');
      break;
    }
  }

  // Boost confidence if multiple data points
  if (result.matchedPatterns.length >= 3) {
    result.confidence = 'high';
  } else if (result.matchedPatterns.length >= 2) {
    result.confidence = 'medium';
  }

  // Only return if we found something useful
  if (result.matchedPatterns.length === 0) return null;

  return result;
}

async function main() {
  const options = parseArgs();

  if (options.help) {
    console.log(`
${bold}Intake Situation Parser Script${reset}

Usage: node scripts/ingest/parse_intake_situation.mjs [options]

Options:
  --dry-run    Preview changes without writing to database
  --verbose    Show detailed parsing results
  --limit N    Process only first N submissions
  --help       Show this help

Prerequisites:
  1. Run MIG_267 (adds 'intake_situation_parse' source_type)

This script parses:
  - web_intake_submissions.situation_description
`);
    process.exit(0);
  }

  console.log(`\n${bold}Intake Situation Parser${reset}`);
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

    // Load intake submissions with situation descriptions
    console.log(`${cyan}Loading intake submissions with situation descriptions...${reset}`);
    let query = `
      SELECT
        s.submission_id,
        s.place_id,
        s.situation_description,
        s.submitted_at,
        p.display_name as place_name
      FROM ops.intake_submissions s
      LEFT JOIN sot.places p ON p.place_id = s.place_id
      WHERE s.place_id IS NOT NULL
        AND s.situation_description IS NOT NULL
        AND TRIM(s.situation_description) != ''
    `;
    if (options.limit) {
      query += ` LIMIT ${options.limit}`;
    }

    const submissionsResult = await pool.query(query);
    console.log(`${cyan}Loaded:${reset} ${submissionsResult.rowCount} submissions with situation descriptions`);

    // Stats
    const stats = {
      total: submissionsResult.rowCount,
      parsed: 0,
      withCatCount: 0,
      withKittenCount: 0,
      withFixedCount: 0,
      withUrgency: 0,
      inserted: 0,
      skipped_duplicate: 0,
      skipped_no_data: 0,
      errors: 0,
    };

    // Process submissions
    console.log(`\n${cyan}Parsing situation descriptions...${reset}\n`);

    for (let i = 0; i < submissionsResult.rows.length; i++) {
      const submission = submissionsResult.rows[i];

      if ((i + 1) % 100 === 0) {
        console.log(`  Processed ${i + 1}/${stats.total}...`);
      }

      try {
        // Parse situation description
        const parsed = parseSituation(submission.situation_description);

        if (!parsed) {
          stats.skipped_no_data++;
          continue;
        }

        stats.parsed++;
        if (parsed.totalCats) stats.withCatCount++;
        if (parsed.kittenCount) stats.withKittenCount++;
        if (parsed.fixedCount) stats.withFixedCount++;
        if (parsed.urgencySignals.length > 0) stats.withUrgency++;

        if (options.verbose) {
          console.log(`\n${dim}─────────────────────────────────────${reset}`);
          console.log(`${cyan}Submission:${reset} ${submission.submission_id}`);
          console.log(`${cyan}Place:${reset} ${submission.place_name || 'Unknown'}`);
          console.log(`${cyan}Parsed:${reset}`, parsed);
          if (submission.situation_description.length < 300) {
            console.log(`${cyan}Situation:${reset} ${submission.situation_description}`);
          } else {
            console.log(`${cyan}Situation:${reset} ${submission.situation_description.substring(0, 300)}...`);
          }
        }

        if (options.dryRun) continue;

        // Create source_record_id for deduplication
        const sourceRecordId = `intake_situation_${submission.submission_id}`;

        // Check for existing estimate from this source
        const existingEstimate = await pool.query(`
          SELECT 1 FROM sot.place_colony_estimates
          WHERE source_system = $1 AND source_record_id = $2
        `, [SOURCE_SYSTEM, sourceRecordId]);

        if (existingEstimate.rowCount > 0) {
          stats.skipped_duplicate++;
          continue;
        }

        // Only insert if we have a cat count
        if (!parsed.totalCats && !parsed.kittenCount) {
          stats.skipped_no_data++;
          continue;
        }

        // Build notes summary
        const notesParts = [`Patterns: ${parsed.matchedPatterns.join(', ')}`];
        if (parsed.urgencySignals.length > 0) {
          notesParts.push(`Urgency: ${parsed.urgencySignals.join(', ')}`);
        }
        notesParts.push(`Confidence: ${parsed.confidence}`);
        const notesSummary = notesParts.join('. ');

        // Insert colony estimate
        await pool.query(`
          INSERT INTO sot.place_colony_estimates (
            place_id,
            total_cats,
            kitten_count,
            altered_count,
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
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          ON CONFLICT (source_system, source_record_id) DO NOTHING
        `, [
          submission.place_id,
          parsed.totalCats,
          parsed.kittenCount,
          parsed.fixedCount,
          parsed.unfixedCount,
          SOURCE_TYPE,
          'intake_submission',
          submission.submission_id,
          submission.submitted_at ? new Date(submission.submitted_at) : null,
          true, // Requester is reporting their own situation
          notesSummary,
          parsed.confidence,
          SOURCE_SYSTEM,
          sourceRecordId,
        ]);

        stats.inserted++;

      } catch (err) {
        stats.errors++;
        if (stats.errors <= 5) {
          console.error(`${red}Error processing submission ${submission.submission_id}:${reset} ${err.message}`);
        }
      }
    }

    // Summary
    console.log(`\n${'═'.repeat(50)}`);
    console.log(`${bold}Parse Summary${reset}`);
    console.log(`${'═'.repeat(50)}`);
    console.log(`${cyan}Total submissions:${reset}   ${stats.total}`);
    console.log(`${green}Successfully parsed:${reset} ${stats.parsed}`);
    console.log(`  - With cat count:    ${stats.withCatCount}`);
    console.log(`  - With kitten count: ${stats.withKittenCount}`);
    console.log(`  - With fixed count:  ${stats.withFixedCount}`);
    console.log(`  - With urgency:      ${stats.withUrgency}`);
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
