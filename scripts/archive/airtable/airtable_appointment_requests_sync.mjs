#!/usr/bin/env node
/**
 * airtable_appointment_requests_sync.mjs
 *
 * Syncs Appointment Requests from Airtable API into Atlas.
 *
 * Philosophy:
 *   - People are always saved if we have contact info (name, email, phone)
 *   - Places are only created for valid geocodable addresses
 *   - Source provenance is always tracked
 *   - Bad data is flagged for review, not lost
 *
 * Data Mapping:
 *   - Person: First Name, Last Name, Email, Phone
 *   - Address: "Clean Address" is primary (NOT "Clean Address (Cats)")
 *   - Status: "Status" = contact status, "Submission Status" = workflow status
 *
 * Usage:
 *   node scripts/ingest/airtable_appointment_requests_sync.mjs
 *   node scripts/ingest/airtable_appointment_requests_sync.mjs --dry-run
 *   node scripts/ingest/airtable_appointment_requests_sync.mjs --resync
 */

import pg from 'pg';
import crypto from 'crypto';

const { Client } = pg;

// Airtable config - AIRTABLE_PAT is REQUIRED (no hardcoded fallback for security)
const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
if (!AIRTABLE_PAT) {
  console.error('ERROR: AIRTABLE_PAT environment variable is required');
  console.error('Set it with: export AIRTABLE_PAT=your_token_here');
  process.exit(1);
}
const BASE_ID = 'appl6zLrRFDvsz0dh';
const TABLE_ID = 'tbltFEFUPMS6KZU8Y';  // Appointment Requests

const SOURCE_SYSTEM = 'airtable';
const SOURCE_TABLE = 'appointment_requests';

// ============================================
// Airtable API
// ============================================

async function fetchAllRecords() {
  const records = [];
  let offset = null;
  let page = 1;

  console.log('Fetching from Airtable...');

  while (true) {
    let url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}?pageSize=100`;
    if (offset) url += `&offset=${offset}`;

    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` }
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Airtable API error: ${response.status} - ${text}`);
    }

    const data = await response.json();
    records.push(...data.records);
    console.log(`  Page ${page}: ${data.records.length} records (total: ${records.length})`);

    if (data.offset) {
      offset = data.offset;
      page++;
    } else {
      break;
    }
  }

  return records;
}

// ============================================
// Data Quality Checks
// ============================================

function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function isValidPhone(phone) {
  if (!phone || typeof phone !== 'string') return false;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 10;
}

/**
 * Validate person name using SOT logic (matches sot.classify_owner_name)
 * Required for a person to be created in sot_people
 */
function isValidPersonName(name) {
  if (!name || typeof name !== 'string') return false;
  const trimmed = name.trim();

  // Reject empty
  if (trimmed === '') return false;

  // Reject HTML-like content
  if (/<[^>]+>/.test(trimmed)) return false;

  // Reject URLs/image links
  if (/airtableusercontent/i.test(trimmed)) return false;
  if (/https?:\/\//i.test(trimmed)) return false;
  if (/\.(jpg|png|gif)/i.test(trimmed)) return false;

  // Reject cat-like identifiers
  if (/^\s*#?\d+[/-]/.test(trimmed)) return false;
  if (/^FFSC-\d+/.test(trimmed)) return false;

  // Reject just parenthetical content
  if (/^\s*\([^)]+\)\s*$/.test(trimmed)) return false;

  // Normalize for token analysis
  const normalized = trimmed.toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();

  // Must have content after stripping non-alpha
  if (normalized === '') return false;

  // Split into tokens
  const tokens = normalized.split(' ').filter(t => t.length > 0);

  // Require at least 2 tokens (first + last name)
  if (tokens.length < 2) return false;

  // If exactly 2 tokens, each must be at least 2 chars
  if (tokens.length === 2) {
    if (tokens[0].length < 2 || tokens[1].length < 2) return false;
  }

  // Reject excessively long names
  if (trimmed.length > 100) return false;

  // Reject if more than 30% digits
  const digitCount = (trimmed.match(/\d/g) || []).length;
  if (digitCount / trimmed.length > 0.3) return false;

  return true;
}

/**
 * Check if name looks like an address (matches sot.classify_owner_name)
 */
function isAddressLikeName(name) {
  if (!name || typeof name !== 'string') return false;

  // Starts with a number
  if (/^\d/.test(name)) return true;

  // Contains common street suffixes
  const streetPattern = /\b(St|Street|Rd|Road|Ave|Avenue|Blvd|Boulevard|Ln|Lane|Dr|Drive|Ct|Court|Way|Pl|Place)\b/i;
  if (streetPattern.test(name) && !/\bDr\./i.test(name)) {
    return true;
  }

  return false;
}

function isValidAddress(address) {
  if (!address || typeof address !== 'string') return false;
  const cleaned = address.trim().toLowerCase();

  // Reject common garbage values
  const garbage = ['same', 'unknown', 'n/a', 'na', 'none', 'my apt', 'my apartment', 'here'];
  if (garbage.includes(cleaned)) return false;

  // Reject if it's just a unit number
  if (/^#?\d+[a-z]?$/i.test(cleaned)) return false;
  if (/^(apt|unit|suite|ste|bldg)\.?\s*#?\d+[a-z]?$/i.test(cleaned)) return false;

  // Must have reasonable length and look like an address
  if (cleaned.length < 10) return false;
  if (!/\d+\s+\w/.test(cleaned)) return false;  // Should have street number

  return true;
}

function extractBestAddress(fields) {
  // Priority order for address fields
  const candidates = [
    fields['Clean Address'],
    fields['Street address where cats are located'],
    fields['Your address'],
  ];

  for (const addr of candidates) {
    if (isValidAddress(addr)) {
      // Check if we need to merge with unit number
      const unitField = fields['Clean Address (Cats)'];
      if (unitField && /^#?\d+[a-z]?$/i.test(unitField.trim())) {
        // It's a unit number - merge with address
        if (addr.includes(',')) {
          return addr.replace(',', ` ${unitField.trim()},`);
        }
        return `${addr} ${unitField.trim()}`;
      }
      return addr;
    }
  }

  return null;
}

function computeRowHash(fields) {
  const normalized = {};
  for (const key of Object.keys(fields).sort()) {
    let value = fields[key];
    if (typeof value === 'string') value = value.trim().toLowerCase();
    if (value !== '' && value !== null && value !== undefined) {
      normalized[key] = value;
    }
  }
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex').substring(0, 32);
}

// ============================================
// Status Mapping
// ============================================

function mapToAtlasStatus(airtableStatus, submissionStatus) {
  // Map Airtable statuses to Atlas request statuses
  const status = (airtableStatus || '').toLowerCase();
  const submission = (submissionStatus || '').toLowerCase();

  if (submission === 'declined') return 'cancelled';
  if (submission === 'complete') return 'completed';
  if (submission === 'booked' || status.includes('booked')) return 'scheduled';
  if (status.includes('contacted')) return 'triaged';
  if (status.includes('out of county')) return 'cancelled';
  if (status.includes('no response')) return 'on_hold';

  return 'new';  // Default for unprocessed
}

// ============================================
// Main Sync
// ============================================

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const resync = args.includes('--resync');

  console.log('\n═══════════════════════════════════════════════════');
  console.log('Airtable Appointment Requests Sync');
  console.log('═══════════════════════════════════════════════════');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Resync: ${resync ? 'Yes (update existing)' : 'No (new only)'}\n`);

  // Fetch from Airtable
  const airtableRecords = await fetchAllRecords();
  console.log(`\nTotal records from Airtable: ${airtableRecords.length}\n`);

  if (dryRun) {
    // Analyze without DB connection
    analyzeRecords(airtableRecords);
    return;
  }

  // Check DATABASE_URL only for live runs
  if (!process.env.DATABASE_URL) {
    console.error('Error: DATABASE_URL not set');
    process.exit(1);
  }

  // Connect to database
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  console.log('Connected to database\n');

  const stats = {
    staged: { inserted: 0, updated: 0, unchanged: 0 },
    people: { created: 0, matched: 0, skipped: 0 },
    places: { created: 0, matched: 0, skipped: 0, invalid: 0 },
    requests: { created: 0, updated: 0, skipped: 0 },
    flagged: 0,
  };

  // Process each record
  for (const record of airtableRecords) {
    const recordId = record.id;
    const fields = record.fields;
    const rowHash = computeRowHash(fields);

    // Step 1: Upsert into staged_records (always - preserve raw data)
    const stagedResult = await client.query(`
      INSERT INTO ops.staged_records (
        source_system, source_table, source_row_id, row_hash, payload
      ) VALUES ($1, $2, $3, $4, $5::jsonb)
      ON CONFLICT (source_system, source_table, row_hash)
      DO UPDATE SET
        source_row_id = EXCLUDED.source_row_id,
        payload = EXCLUDED.payload,
        updated_at = NOW()
      RETURNING (xmax = 0) AS was_inserted
    `, [SOURCE_SYSTEM, SOURCE_TABLE, recordId, rowHash, JSON.stringify(fields)]);

    if (stagedResult.rows[0]?.was_inserted) {
      stats.staged.inserted++;
    } else {
      stats.staged.updated++;
    }

    // Step 2: Extract person info
    const firstName = (fields['First Name'] || '').trim();
    const lastName = (fields['Last Name'] || '').trim();
    const email = (fields['Email'] || '').trim().toLowerCase();
    const phone = fields['Best phone number to reach you'] || '';
    const displayName = `${firstName} ${lastName}`.trim();

    let personId = null;

    // SOT validation: Name must pass is_valid_person_name rules
    const nameIsValid = isValidPersonName(displayName);
    const nameIsAddressLike = isAddressLikeName(displayName);
    const hasValidContact = isValidEmail(email) || isValidPhone(phone);

    // Only create person if:
    // 1. Name passes SOT validation (2+ tokens, no HTML, etc)
    // 2. Name doesn't look like an address
    // 3. Has at least one valid contact method
    if (nameIsValid && !nameIsAddressLike && hasValidContact) {
      // Use the centralized find_or_create_person SQL function
      // This function handles:
      // - Email/phone normalization using sot.norm_phone_us()
      // - Lookup via person_identifiers table
      // - Phone blacklist checking
      // - Canonical person resolution (handles merged persons)
      // - Creating person and identifiers if not found
      const personResult = await client.query(`
        SELECT sot.find_or_create_person($1, $2, $3, $4, NULL, 'airtable') as person_id
      `, [
        isValidEmail(email) ? email : null,
        isValidPhone(phone) ? phone : null,
        firstName,
        lastName
      ]);

      personId = personResult.rows[0]?.person_id;
      if (personId) {
        stats.people.created++;  // Could be matched or created - function handles both
      }
    } else {
      stats.people.skipped++;
      // Invalid/skipped person name - counted but not stored in db (no suspect_issues column)
      if (!nameIsValid || nameIsAddressLike) {
        stats.flagged++;
      }
    }

    // Step 3: Extract and validate address
    const address = extractBestAddress(fields);
    let placeId = null;

    if (address) {
      // Use smart merge function and find/create place
      const placeResult = await client.query(`
        SELECT sot.find_or_create_place_deduped($1, NULL, NULL, NULL, 'airtable') as place_id
      `, [address]);

      placeId = placeResult.rows[0]?.place_id;
      if (placeId) {
        stats.places.created++;  // Could be matched, but function handles dedup
      }
    } else {
      stats.places.invalid++;
      stats.flagged++;
    }

    // Step 4: Link person to place if both exist
    if (personId && placeId) {
      await client.query(`
        INSERT INTO sot.person_place_relationships (
          person_id, place_id, role, confidence, source_system, source_table
        ) VALUES ($1, $2, 'requester', 0.75, 'airtable', 'appointment_requests')
        ON CONFLICT DO NOTHING
      `, [personId, placeId]);
    }
  }

  await client.end();

  // Print summary
  console.log('\n═══════════════════════════════════════════════════');
  console.log('Summary');
  console.log('═══════════════════════════════════════════════════');
  console.log(`Staged Records:`);
  console.log(`  ✓ Inserted: ${stats.staged.inserted}`);
  console.log(`  ↻ Updated:  ${stats.staged.updated}`);
  console.log(`\nPeople:`);
  console.log(`  ✓ Created:  ${stats.people.created}`);
  console.log(`  ○ Matched:  ${stats.people.matched}`);
  console.log(`  ⊘ Skipped:  ${stats.people.skipped} (no valid contact info)`);
  console.log(`\nPlaces:`);
  console.log(`  ✓ Created/Found: ${stats.places.created}`);
  console.log(`  ⚠ Invalid addr:  ${stats.places.invalid}`);
  console.log(`\nFlagged for Review: ${stats.flagged}`);
  console.log('═══════════════════════════════════════════════════\n');
}

function analyzeRecords(records) {
  console.log('Analyzing records (dry run)...\n');

  let validAddress = 0;
  let invalidAddress = 0;
  let validPerson = 0;
  let invalidPerson = 0;
  let invalidPersonName = 0;
  let addressLikeName = 0;
  let noContact = 0;
  const statusCounts = {};
  const addressIssues = [];
  const nameIssues = [];

  for (const record of records) {
    const fields = record.fields;

    // Check address
    const address = extractBestAddress(fields);
    if (address) {
      validAddress++;
    } else {
      invalidAddress++;
      if (addressIssues.length < 5) {
        addressIssues.push({
          name: fields['Name'],
          cleanAddr: fields['Clean Address'],
          catsAddr: fields['Clean Address (Cats)'],
        });
      }
    }

    // Check person - SOT validation
    const firstName = (fields['First Name'] || '').trim();
    const lastName = (fields['Last Name'] || '').trim();
    const displayName = `${firstName} ${lastName}`.trim();
    const email = fields['Email'];
    const phone = fields['Best phone number to reach you'];

    const nameValid = isValidPersonName(displayName);
    const addressLike = isAddressLikeName(displayName);
    const hasContact = isValidEmail(email) || isValidPhone(phone);

    if (nameValid && !addressLike && hasContact) {
      validPerson++;
    } else {
      invalidPerson++;
      if (!nameValid) {
        invalidPersonName++;
        if (nameIssues.length < 5) {
          nameIssues.push({ name: displayName, reason: 'fails SOT validation' });
        }
      } else if (addressLike) {
        addressLikeName++;
        if (nameIssues.length < 5) {
          nameIssues.push({ name: displayName, reason: 'looks like address' });
        }
      } else if (!hasContact) {
        noContact++;
      }
    }

    // Count statuses
    const status = fields['Submission Status'] || 'empty';
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  }

  console.log('Address Quality:');
  console.log(`  ✓ Valid:   ${validAddress}`);
  console.log(`  ⚠ Invalid: ${invalidAddress}`);

  console.log('\nPerson Quality (SOT Validation):');
  console.log(`  ✓ Valid (will create):  ${validPerson}`);
  console.log(`  ⚠ Invalid (will skip):  ${invalidPerson}`);
  console.log(`    - Invalid name:       ${invalidPersonName}`);
  console.log(`    - Address-like name:  ${addressLikeName}`);
  console.log(`    - No contact info:    ${noContact}`);

  console.log('\nSubmission Status Distribution:');
  for (const [status, count] of Object.entries(statusCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${status}: ${count}`);
  }

  if (addressIssues.length > 0) {
    console.log('\nSample Invalid Addresses:');
    for (const issue of addressIssues) {
      console.log(`  ${issue.name}: "${issue.cleanAddr}" / "${issue.catsAddr}"`);
    }
  }

  if (nameIssues.length > 0) {
    console.log('\nSample Invalid Person Names:');
    for (const issue of nameIssues) {
      console.log(`  "${issue.name}" - ${issue.reason}`);
    }
  }
}

main().catch(e => {
  console.error('Fatal:', e.message);
  console.error(e.stack);
  process.exit(1);
});
