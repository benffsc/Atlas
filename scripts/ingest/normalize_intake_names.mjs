#!/usr/bin/env node
/**
 * normalize_intake_names.mjs
 *
 * Normalizes capitalization in intake submissions.
 * - ALL CAPS -> Title Case
 * - all lower -> Title Case
 * - MiXeD -> Left as-is (user intended it)
 *
 * This ensures clean data when feeding legacy data into the new pipeline.
 *
 * Usage:
 *   set -a && source .env && set +a
 *   node scripts/ingest/normalize_intake_names.mjs
 *   node scripts/ingest/normalize_intake_names.mjs --dry-run
 */

import pg from 'pg';

const { Client } = pg;

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes('--dry-run'),
    verbose: args.includes('--verbose') || args.includes('-v'),
  };
}

// Normalize capitalization (JOHN SMITH -> John Smith)
function normalizeName(name) {
  if (!name) return name;

  // Check if it's all caps or all lower (ignoring non-letters)
  const letters = name.replace(/[^a-zA-Z]/g, '');
  if (letters.length === 0) return name;

  const isAllCaps = letters === letters.toUpperCase();
  const isAllLower = letters === letters.toLowerCase();

  if (!isAllCaps && !isAllLower) {
    return name; // Mixed case, user intended it
  }

  return name
    .toLowerCase()
    .split(' ')
    .map(word => {
      if (word.length === 0) return word;
      // Handle initials like "p.k." -> "P.K."
      if (/^[a-z]\.([a-z]\.)*$/i.test(word)) {
        return word.toUpperCase();
      }
      // Handle hyphenated names
      if (word.includes('-')) {
        return word.split('-').map(part =>
          part.charAt(0).toUpperCase() + part.slice(1)
        ).join('-');
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

async function main() {
  const options = parseArgs();

  console.log('\nNormalize Intake Names');
  console.log('='.repeat(50));
  console.log(`Mode: ${options.dryRun ? 'DRY RUN' : 'LIVE'}`);

  if (!process.env.DATABASE_URL) {
    console.error('Error: DATABASE_URL not set');
    process.exit(1);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  console.log('Connected to database\n');

  // Get submissions with names to normalize
  const result = await client.query(`
    SELECT submission_id, first_name, last_name
    FROM trapper.web_intake_submissions
    WHERE first_name IS NOT NULL OR last_name IS NOT NULL
  `);

  const submissions = result.rows;
  console.log(`Found ${submissions.length} submissions to check\n`);

  const stats = {
    total: submissions.length,
    normalized: 0,
    unchanged: 0,
  };

  const changes = [];

  for (const sub of submissions) {
    const newFirst = normalizeName(sub.first_name);
    const newLast = normalizeName(sub.last_name);

    if (newFirst !== sub.first_name || newLast !== sub.last_name) {
      stats.normalized++;

      const change = {
        submission_id: sub.submission_id,
        old: `${sub.first_name} ${sub.last_name}`,
        new: `${newFirst} ${newLast}`,
      };
      changes.push(change);

      if (options.verbose) {
        console.log(`  "${sub.first_name} ${sub.last_name}" → "${newFirst} ${newLast}"`);
      }

      if (!options.dryRun) {
        await client.query(`
          UPDATE trapper.web_intake_submissions
          SET first_name = $1, last_name = $2, updated_at = NOW()
          WHERE submission_id = $3
        `, [newFirst, newLast, sub.submission_id]);
      }
    } else {
      stats.unchanged++;
    }
  }

  await client.end();

  console.log('\nSummary');
  console.log('-'.repeat(50));
  console.log(`  Total checked:   ${stats.total}`);
  console.log(`  Normalized:      ${stats.normalized}`);
  console.log(`  Unchanged:       ${stats.unchanged}`);

  if (!options.verbose && changes.length > 0) {
    console.log('\nSample normalizations:');
    changes.slice(0, 10).forEach(c => {
      console.log(`  "${c.old}" → "${c.new}"`);
    });
    if (changes.length > 10) {
      console.log(`  ... and ${changes.length - 10} more`);
    }
  }

  if (options.dryRun) {
    console.log('\nDry run complete. Run without --dry-run to apply changes.');
  } else {
    console.log('\nNormalization complete.');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
