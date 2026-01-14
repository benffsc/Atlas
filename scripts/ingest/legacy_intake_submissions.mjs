#!/usr/bin/env node
/**
 * legacy_intake_submissions.mjs
 *
 * Ingests legacy Airtable appointment requests into trapper.web_intake_submissions
 * as legacy records (is_legacy=true). These skip auto-triage since they're already processed.
 *
 * Usage:
 *   set -a && source .env && set +a
 *   node scripts/ingest/legacy_intake_submissions.mjs --csv /path/to/file.csv
 *   node scripts/ingest/legacy_intake_submissions.mjs --csv /path/to/file.csv --dry-run
 */

import fs from 'fs';
import path from 'path';
import pg from 'pg';
import crypto from 'crypto';
import { parseCsvFile } from './_lib/csv_rfc4180.mjs';

const { Client } = pg;

// Default ingest path
const DEFAULT_INGEST_PATH = process.env.LOCAL_INGEST_PATH ||
  '/Users/benmisdiaz/Desktop/AI_Ingest';

// Column mappings from Airtable export to our schema
const COLUMN_MAP = {
  firstName: 'First Name',
  lastName: 'Last Name',
  email: 'Email',
  phone: 'Best phone number to reach you',
  requesterAddress: 'Your address',
  requesterCity: 'Your city',
  requesterZip: 'Your Zip Code',
  catsAddress: 'Clean Address (Cats)',  // Use cleaned version
  catsAddressRaw: 'Street address where cats are located',
  county: 'County',
  catCount: 'Estimated number of unowned/feral/stray cats',
  situationDescription: 'Describe the Situation',
  awarenessDuration: 'How long ago did you become aware of the cats?',
  confirmed: 'Have you confirmed that the cays are not owned?',
  beingFed: 'Is the cat(s) being fed?',
  medical: 'Does the cat(s) have any injuries or medical conditions?',
  hasKittens: 'Have you seen any kittens at this location?',
  kittenCount: 'Kitten #',
  hasAccess: 'Do you have legal access or permission to trap cats on the property?',
  referralSource: 'How did you hear about Forgotten Felines?',
  submittedAt: 'New Submitted',  // Use the new form submitted date
  legacySubmittedAt: 'Former Created Date',  // Fallback
  // Legacy fields to preserve
  legacyStatus: 'Status',
  legacySubmissionStatus: 'Submission Status',
  legacyAppointmentDate: 'Appointment Date',
  legacyNotes: 'Notes',
  recordId: 'recordid',
  media: 'Relevant Media',
};

// ============================================
// Argument Parsing
// ============================================

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    csvPath: null,
    dryRun: false,
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--csv':
        options.csvPath = args[++i];
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
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
Usage:
  node scripts/ingest/legacy_intake_submissions.mjs --csv /path/to/file.csv

Options:
  --csv <path>    Path to CSV file (required, or auto-finds in default location)
  --dry-run       Parse and validate only, don't write to DB
  --verbose, -v   Show detailed output
  --help, -h      Show this help

Environment:
  DATABASE_URL         Postgres connection string (required)
  LOCAL_INGEST_PATH    Default path for finding CSV files
`);
}

// ============================================
// Data transformation helpers
// ============================================

function parseDate(str) {
  if (!str || str === '') return null;

  // Handle formats like "1/8/2026 5:39pm" or "1/8/2026"
  const match = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (match) {
    const [, month, day, year] = match;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  return null;
}

function parseTimestamp(str) {
  if (!str || str === '') return null;

  // Handle formats like "1/8/2026 5:39pm"
  const match = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(am|pm)?/i);
  if (match) {
    const [, month, day, year, hour, minute, ampm] = match;
    let h = parseInt(hour);
    if (ampm?.toLowerCase() === 'pm' && h !== 12) h += 12;
    if (ampm?.toLowerCase() === 'am' && h === 12) h = 0;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${String(h).padStart(2, '0')}:${minute}:00`;
  }
  return null;
}

function parseInt10(str) {
  if (!str || str === '') return null;
  const n = parseInt(str, 10);
  return isNaN(n) ? null : n;
}

function yesNoToBool(str) {
  if (!str) return null;
  const lower = str.toLowerCase().trim();
  if (lower === 'yes') return true;
  if (lower === 'no') return false;
  return null;
}

function mapAwarenessDuration(str) {
  if (!str) return 'unknown';
  const lower = str.toLowerCase();
  if (lower.includes('week')) return 'under_1_week';
  if (lower.includes('month')) {
    if (lower.includes('4') || lower.includes('5') || lower.includes('6')) return '1_to_6_months';
    return 'under_1_month';
  }
  if (lower.includes('year')) return 'over_1_year';
  return 'unknown';
}

function mapOwnershipStatus(confirmed) {
  // Based on "Have you confirmed that the cays are not owned?"
  if (confirmed === true) return 'unknown_stray';
  if (confirmed === false) return 'unsure';
  return 'community_colony'; // Default assumption for this form
}

function createRowHash(row) {
  const key = [
    row[COLUMN_MAP.recordId] || '',
    row[COLUMN_MAP.email] || '',
    row[COLUMN_MAP.firstName] || '',
    row[COLUMN_MAP.lastName] || '',
    row[COLUMN_MAP.submittedAt] || row[COLUMN_MAP.legacySubmittedAt] || '',
  ].join('|');
  return crypto.createHash('sha256').update(key).digest('hex').substring(0, 32);
}

function extractMediaUrls(mediaStr) {
  if (!mediaStr) return null;
  // Extract URLs from media field - format: "filename.jpg (https://...)"
  const urls = [];
  const matches = mediaStr.matchAll(/\((https?:\/\/[^)]+)\)/g);
  for (const match of matches) {
    urls.push(match[1]);
  }
  return urls.length > 0 ? urls : null;
}

// ============================================
// Main Processing
// ============================================

async function main() {
  const options = parseArgs();
  const startTime = Date.now();

  console.log('\nLegacy Intake Submissions Ingest');
  console.log('='.repeat(50));

  // Check DATABASE_URL
  if (!process.env.DATABASE_URL) {
    console.error('Error: DATABASE_URL not set');
    console.log('Run: set -a && source .env && set +a');
    process.exit(1);
  }

  // Find CSV file
  let csvPath = options.csvPath;

  if (!csvPath) {
    // Auto-find in default location
    const dir = `${DEFAULT_INGEST_PATH}/airtable/appointment_requests`;
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.csv')).sort().reverse();
      if (files.length > 0) {
        csvPath = path.join(dir, files[0]);
      }
    }
  }

  if (!csvPath) {
    console.error('Error: No CSV file specified and none found in default location');
    printUsage();
    process.exit(1);
  }

  if (!fs.existsSync(csvPath)) {
    console.error(`Error: CSV file not found: ${csvPath}`);
    process.exit(1);
  }

  csvPath = path.resolve(csvPath);
  const sourceFile = path.basename(csvPath);

  console.log(`\nSource: ${csvPath}`);
  console.log(`Mode: ${options.dryRun ? 'DRY RUN (no DB writes)' : 'LIVE'}`);

  // Parse CSV
  console.log('\nParsing CSV (RFC 4180)...');
  const { headers, rows } = parseCsvFile(csvPath);
  console.log(`  Columns: ${headers.length}`);
  console.log(`  Rows: ${rows.length}`);

  if (options.verbose) {
    console.log('\nColumn headers found:');
    headers.forEach((h, i) => console.log(`  ${i}: ${h}`));
  }

  if (rows.length === 0) {
    console.log('Warning: No data rows to ingest');
    process.exit(0);
  }

  // Stats
  const stats = {
    total: rows.length,
    inserted: 0,
    skipped: 0,
    errors: 0,
  };

  // Connect to database
  let client = null;

  if (!options.dryRun) {
    console.log('\nConnecting to database...');
    client = new Client({ connectionString: process.env.DATABASE_URL });
    try {
      await client.connect();
      console.log('  Connected');
    } catch (e) {
      console.error(`  Connection failed: ${e.message}`);
      process.exit(1);
    }
  }

  // Process rows
  console.log('\nIngesting rows...');

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const csvRowNumber = i + 2; // 1-indexed, +1 for header

    try {
      // Extract and transform data
      const firstName = (row[COLUMN_MAP.firstName] || '').trim() || 'Unknown';
      const lastName = (row[COLUMN_MAP.lastName] || '').trim() || 'Unknown';
      const email = (row[COLUMN_MAP.email] || '').trim() || `legacy-${i}@placeholder.local`;
      const phone = (row[COLUMN_MAP.phone] || '').trim() || null;

      const catsAddress = (row[COLUMN_MAP.catsAddress] || row[COLUMN_MAP.catsAddressRaw] || '').trim() || 'Unknown';
      const county = (row[COLUMN_MAP.county] || '').trim() || null;

      const catCount = parseInt10(row[COLUMN_MAP.catCount]);
      const situationDescription = (row[COLUMN_MAP.situationDescription] || '').trim() || null;

      const confirmed = yesNoToBool(row[COLUMN_MAP.confirmed]);
      const beingFed = yesNoToBool(row[COLUMN_MAP.beingFed]);
      const hasMedical = yesNoToBool(row[COLUMN_MAP.medical]);
      const hasKittens = yesNoToBool(row[COLUMN_MAP.hasKittens]);
      const kittenCount = parseInt10(row[COLUMN_MAP.kittenCount]);
      const hasAccess = yesNoToBool(row[COLUMN_MAP.hasAccess]);

      const awarenessDuration = mapAwarenessDuration(row[COLUMN_MAP.awarenessDuration]);
      const ownershipStatus = mapOwnershipStatus(confirmed);

      const referralSource = (row[COLUMN_MAP.referralSource] || '').trim() || null;

      // Timestamps
      const submittedAtRaw = row[COLUMN_MAP.submittedAt] || row[COLUMN_MAP.legacySubmittedAt];
      const submittedAt = parseTimestamp(submittedAtRaw) || new Date().toISOString();

      // Legacy fields (preserve as-is for Jami's workflow)
      const legacyStatus = (row[COLUMN_MAP.legacyStatus] || '').trim() || null;
      const legacySubmissionStatus = (row[COLUMN_MAP.legacySubmissionStatus] || '').trim() || null;
      const legacyAppointmentDate = parseDate(row[COLUMN_MAP.legacyAppointmentDate]);
      const legacyNotes = (row[COLUMN_MAP.legacyNotes] || '').trim() || null;
      const recordId = (row[COLUMN_MAP.recordId] || '').trim() || null;

      // Media URLs
      const mediaUrls = extractMediaUrls(row[COLUMN_MAP.media]);

      // Row hash for deduplication
      const rowHash = createRowHash(row);

      if (options.dryRun) {
        if (options.verbose) {
          console.log(`  [dry-run] Row ${csvRowNumber}: ${firstName} ${lastName} - ${email}`);
          console.log(`    Address: ${catsAddress}`);
          console.log(`    Legacy Status: ${legacyStatus || '(none)'}`);
          console.log(`    Submission Status: ${legacySubmissionStatus || '(none)'}`);
        }
        stats.inserted++;
        continue;
      }

      // Check if already exists
      const existsResult = await client.query(
        'SELECT 1 FROM trapper.web_intake_submissions WHERE legacy_source_id = $1',
        [recordId]
      );

      if (existsResult.rows.length > 0) {
        if (options.verbose) {
          console.log(`  = Row ${csvRowNumber}: exists (${recordId})`);
        }
        stats.skipped++;
        continue;
      }

      // Insert
      await client.query(`
        INSERT INTO trapper.web_intake_submissions (
          -- Contact info
          first_name, last_name, email, phone,
          -- Requester address (use cats address if not provided)
          requester_address, requester_city, requester_zip,
          -- Cats location
          cats_address, cats_city, county,
          -- Cat info
          ownership_status, cat_count_estimate,
          fixed_status, has_kittens, kitten_count,
          has_medical_concerns, medical_description,
          awareness_duration,
          cats_being_fed, has_property_access,
          situation_description, referral_source,
          media_urls,
          -- Timestamps
          submitted_at,
          -- Legacy flag and fields
          is_legacy,
          legacy_status, legacy_submission_status,
          legacy_appointment_date, legacy_notes,
          legacy_source_id, legacy_source_file,
          -- Status (default for legacy)
          status
        ) VALUES (
          $1, $2, $3, $4,
          $5, $6, $7,
          $8, $9, $10,
          $11, $12,
          $13, $14, $15,
          $16, $17,
          $18,
          $19, $20,
          $21, $22,
          $23,
          $24,
          TRUE,
          $25, $26,
          $27, $28,
          $29, $30,
          'triaged'
        )
      `, [
        firstName, lastName, email, phone,
        row[COLUMN_MAP.requesterAddress] || catsAddress,
        row[COLUMN_MAP.requesterCity] || null,
        row[COLUMN_MAP.requesterZip] || null,
        catsAddress,
        null, // cats_city extracted separately if needed
        county,
        ownershipStatus, catCount,
        'unknown', // fixed_status - not in legacy form
        hasKittens, kittenCount,
        hasMedical, hasMedical ? 'Medical concerns noted in legacy form' : null,
        awarenessDuration,
        beingFed, hasAccess,
        situationDescription, referralSource,
        mediaUrls,
        submittedAt,
        legacyStatus, legacySubmissionStatus,
        legacyAppointmentDate, legacyNotes,
        recordId, sourceFile,
      ]);

      stats.inserted++;
      if (options.verbose) {
        console.log(`  + Row ${csvRowNumber}: inserted (${recordId})`);
      }

    } catch (err) {
      stats.errors++;
      console.error(`  ! Row ${csvRowNumber} error: ${err.message}`);
      if (options.verbose) {
        console.error(err.stack);
      }
    }
  }

  if (client) {
    await client.end();
  }

  const durationMs = Date.now() - startTime;

  // Print summary
  console.log('\nSummary');
  console.log('-'.repeat(50));
  console.log(`  Total rows:       ${stats.total}`);
  console.log(`  Inserted:         ${stats.inserted}`);
  console.log(`  Skipped (dupe):   ${stats.skipped}`);
  if (stats.errors > 0) {
    console.log(`  Errors:           ${stats.errors}`);
  }
  console.log(`  Duration:         ${durationMs}ms`);

  if (options.dryRun) {
    console.log('\nDry run complete. Run without --dry-run to insert.');
  }

  process.exit(stats.errors > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Fatal error:', e.message);
  console.error(e.stack);
  process.exit(1);
});
