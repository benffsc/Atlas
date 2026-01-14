#!/usr/bin/env node
/**
 * smart_match_intake.mjs
 *
 * Cross-references intake submissions with existing People records
 * to suggest Place linkages for addresses that didn't geocode well.
 *
 * Matching strategy:
 *   1. Email exact match (normalized)
 *   2. Phone match (normalized)
 *   3. Name fuzzy match (Levenshtein)
 *
 * Philosophy:
 *   - Suggestions only, never auto-link to SoT
 *   - Preserve data provenance for audit trail
 *   - Flag confidence levels for staff review
 *
 * Usage:
 *   set -a && source .env && set +a
 *   node scripts/ingest/smart_match_intake.mjs
 *   node scripts/ingest/smart_match_intake.mjs --apply  # Actually link matches
 */

import pg from 'pg';

const { Client } = pg;

// ============================================
// Argument Parsing
// ============================================

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    apply: false,
    verbose: false,
    limit: null,
    minConfidence: 0.7,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--apply':
        options.apply = true;
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      case '--limit':
        options.limit = parseInt(args[++i], 10);
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
    }
  }

  return options;
}

function printUsage() {
  console.log(`
Smart Match Intake Submissions

Cross-references intake submissions with existing People records
to find potential matches by email, phone, or name.

Usage:
  node scripts/ingest/smart_match_intake.mjs [options]

Options:
  --apply           Actually update matched_person_id (default: preview only)
  --limit <n>       Process at most n submissions
  --verbose, -v     Show detailed output
  --help, -h        Show this help

Environment:
  DATABASE_URL      PostgreSQL connection string (required)

Examples:
  # Preview matches without applying
  node scripts/ingest/smart_match_intake.mjs --verbose

  # Apply high-confidence matches
  node scripts/ingest/smart_match_intake.mjs --apply
`);
}

// ============================================
// Normalization Functions
// ============================================

function normalizeEmail(email) {
  if (!email) return null;
  return email.trim().toLowerCase();
}

function normalizePhone(phone) {
  if (!phone) return null;
  // Remove all non-digits
  const digits = phone.replace(/\D/g, '');
  // Handle US numbers
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits[0] === '1') return digits.slice(1);
  return digits.length >= 10 ? digits.slice(-10) : null;
}

function normalizeName(name) {
  if (!name) return null;
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

// Simple Levenshtein distance for name matching
function levenshtein(a, b) {
  if (!a || !b) return Infinity;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

function nameSimilarity(name1, name2) {
  if (!name1 || !name2) return 0;
  const n1 = normalizeName(name1);
  const n2 = normalizeName(name2);
  const maxLen = Math.max(n1.length, n2.length);
  if (maxLen === 0) return 0;
  const dist = levenshtein(n1, n2);
  return 1 - (dist / maxLen);
}

// ============================================
// Database Queries
// ============================================

async function getUnmatchedSubmissions(client, options) {
  const limitClause = options.limit ? `LIMIT ${options.limit}` : '';

  const sql = `
    SELECT
      submission_id,
      first_name,
      last_name,
      email,
      phone,
      cats_address,
      cats_city,
      geo_confidence,
      geo_formatted_address,
      matched_person_id
    FROM trapper.web_intake_submissions
    WHERE matched_person_id IS NULL
      AND (email IS NOT NULL OR phone IS NOT NULL)
    ORDER BY submitted_at DESC
    ${limitClause}
  `;

  const result = await client.query(sql);
  return result.rows;
}

async function findPersonByEmail(client, email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  const sql = `
    SELECT DISTINCT
      p.person_id,
      p.display_name,
      pi.id_value_norm as matched_email,
      'email' as match_type
    FROM trapper.sot_people p
    JOIN trapper.person_identifiers pi ON p.person_id = pi.person_id
    WHERE pi.id_type = 'email'
      AND pi.id_value_norm = $1
      AND p.merged_into_person_id IS NULL
    LIMIT 5
  `;

  const result = await client.query(sql, [normalized]);
  return result.rows;
}

async function findPersonByPhone(client, phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;

  const sql = `
    SELECT DISTINCT
      p.person_id,
      p.display_name,
      pi.id_value_norm as matched_phone,
      'phone' as match_type
    FROM trapper.sot_people p
    JOIN trapper.person_identifiers pi ON p.person_id = pi.person_id
    WHERE pi.id_type = 'phone'
      AND pi.id_value_norm = $1
      AND p.merged_into_person_id IS NULL
    LIMIT 5
  `;

  const result = await client.query(sql, [normalized]);
  return result.rows;
}

async function getPersonPlaces(client, personId) {
  const sql = `
    SELECT
      pl.place_id,
      pl.formatted_address,
      ppr.role
    FROM trapper.person_place_relationships ppr
    JOIN trapper.places pl ON ppr.place_id = pl.place_id
    WHERE ppr.person_id = $1
    LIMIT 10
  `;

  const result = await client.query(sql, [personId]);
  return result.rows;
}

async function getPersonRequests(client, personId) {
  const sql = `
    SELECT
      r.request_id,
      r.status,
      r.priority,
      r.created_at,
      pl.formatted_address
    FROM trapper.sot_requests r
    LEFT JOIN trapper.places pl ON r.place_id = pl.place_id
    WHERE r.requester_person_id = $1
    ORDER BY r.created_at DESC
    LIMIT 5
  `;

  const result = await client.query(sql, [personId]);
  return result.rows;
}

async function updateMatchedPerson(client, submissionId, personId, matchDetails) {
  const sql = `
    UPDATE trapper.web_intake_submissions
    SET
      matched_person_id = $1,
      review_notes = COALESCE(review_notes, '') || $2,
      updated_at = NOW()
    WHERE submission_id = $3
  `;

  const note = `\n[Auto-matched to ${matchDetails.display_name} via ${matchDetails.match_type}]`;
  await client.query(sql, [personId, note, submissionId]);
}

// ============================================
// Main Processing
// ============================================

async function main() {
  const options = parseArgs();

  console.log('\nSmart Match Intake Submissions');
  console.log('='.repeat(50));

  if (!process.env.DATABASE_URL) {
    console.error('Error: DATABASE_URL not set');
    process.exit(1);
  }

  console.log(`Mode: ${options.apply ? 'APPLY' : 'PREVIEW'}`);

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  console.log('Connected to database');

  // Get unmatched submissions
  const submissions = await getUnmatchedSubmissions(client, options);
  console.log(`\nFound ${submissions.length} unmatched submissions with contact info\n`);

  if (submissions.length === 0) {
    await client.end();
    return;
  }

  const stats = {
    total: submissions.length,
    emailMatches: 0,
    phoneMatches: 0,
    nameMatches: 0,
    noMatch: 0,
    multipleMatches: 0,
    applied: 0,
  };

  const matches = [];

  for (const sub of submissions) {
    const fullName = `${sub.first_name || ''} ${sub.last_name || ''}`.trim();

    // Try email match first (highest confidence)
    let personMatches = await findPersonByEmail(client, sub.email);
    let matchType = 'email';

    // If no email match, try phone
    if (!personMatches || personMatches.length === 0) {
      personMatches = await findPersonByPhone(client, sub.phone);
      matchType = 'phone';
    }

    if (!personMatches || personMatches.length === 0) {
      stats.noMatch++;
      continue;
    }

    if (personMatches.length > 1) {
      stats.multipleMatches++;
      if (options.verbose) {
        console.log(`  [!] Multiple matches for "${fullName}" (${sub.email || sub.phone})`);
        personMatches.forEach(pm => {
          console.log(`      - ${pm.display_name} (${pm.person_id})`);
        });
      }
      continue;
    }

    const person = personMatches[0];

    // Get their places and requests
    const places = await getPersonPlaces(client, person.person_id);
    const requests = await getPersonRequests(client, person.person_id);

    if (matchType === 'email') stats.emailMatches++;
    else stats.phoneMatches++;

    const matchInfo = {
      submission_id: sub.submission_id,
      intake_name: fullName,
      intake_email: sub.email,
      intake_phone: sub.phone,
      intake_address: sub.cats_address,
      geo_confidence: sub.geo_confidence,
      person_id: person.person_id,
      person_name: person.display_name,
      match_type: matchType,
      places: places,
      requests: requests,
    };

    matches.push(matchInfo);

    if (options.verbose) {
      console.log(`  [✓] ${fullName} → ${person.display_name} (via ${matchType})`);
      console.log(`      Address: ${sub.cats_address}`);
      if (places.length > 0) {
        console.log(`      Known places:`);
        places.slice(0, 3).forEach(pl => {
          console.log(`        - ${pl.formatted_address}`);
        });
      }
      if (requests.length > 0) {
        console.log(`      Has ${requests.length} request(s)`);
      }
      console.log('');
    }

    // Apply match if requested
    if (options.apply) {
      await updateMatchedPerson(client, sub.submission_id, person.person_id, {
        display_name: person.display_name,
        match_type: matchType,
      });
      stats.applied++;
    }
  }

  await client.end();

  // Print summary
  console.log('\nSummary');
  console.log('-'.repeat(50));
  console.log(`  Total processed:     ${stats.total}`);
  console.log(`  Email matches:       ${stats.emailMatches}`);
  console.log(`  Phone matches:       ${stats.phoneMatches}`);
  console.log(`  Multiple matches:    ${stats.multipleMatches} (skipped)`);
  console.log(`  No match:            ${stats.noMatch}`);

  if (options.apply) {
    console.log(`  Applied:             ${stats.applied}`);
  }

  // Show match rate
  const matchRate = ((stats.emailMatches + stats.phoneMatches) / stats.total * 100).toFixed(1);
  console.log(`\n  Match rate:          ${matchRate}%`);

  // Show sample matches if not verbose
  if (!options.verbose && matches.length > 0) {
    console.log('\nSample matches (use --verbose to see all):');
    matches.slice(0, 5).forEach(m => {
      console.log(`  ${m.intake_name} → ${m.person_name} (${m.match_type})`);
    });
    if (matches.length > 5) {
      console.log(`  ... and ${matches.length - 5} more`);
    }
  }

  if (!options.apply && matches.length > 0) {
    console.log('\nRun with --apply to link matched submissions to People records.');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
