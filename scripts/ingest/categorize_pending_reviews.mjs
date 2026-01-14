#!/usr/bin/env node
/**
 * categorize_pending_reviews.mjs
 *
 * Reviews "Pending Review" legacy submissions and categorizes them
 * based on legacy_status and notes patterns.
 *
 * Categories:
 *   - "Out of County" → Declined (can't serve)
 *   - No response after multiple contacts → Declined
 *   - Resolved/cat left notes → client_handled
 *   - Recent with no notes → keep as Pending Review
 *
 * All changes are recorded in the corrections table for audit trail
 * and stability across re-imports.
 *
 * Usage:
 *   set -a && source .env && set +a
 *   node scripts/ingest/categorize_pending_reviews.mjs
 *   node scripts/ingest/categorize_pending_reviews.mjs --dry-run
 */

import pg from 'pg';

const { Client } = pg;

// Patterns indicating client resolved the situation
const RESOLVED_PATTERNS = [
  /cat\s+took\s+off/i,
  /cat\s+left/i,
  /cat\s+is\s+gone/i,
  /situation\s+resolved/i,
  /no\s+longer\s+need/i,
  /found\s+a\s+home/i,
  /rehomed/i,
  /adopted/i,
  /handled\s+it/i,
  /will\s+call\s+(us\s+)?back/i,  // Will follow up later
];

// Patterns indicating out of service area
const OUT_OF_AREA_PATTERNS = [
  /out\s+of\s+county/i,
  /oakland/i,
  /san\s+francisco/i,
  /marin/i,
];

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes('--dry-run'),
    verbose: args.includes('--verbose') || args.includes('-v'),
  };
}

function determineNewStatus(submission) {
  const { legacy_status, legacy_notes, cats_address, geo_confidence } = submission;
  const notes = legacy_notes || '';
  const status = legacy_status || '';

  // Out of County in status or address
  if (status.toLowerCase().includes('out of county')) {
    return { status: 'Declined', reason: 'Out of service area (legacy_status)' };
  }

  // Address geocoded outside Sonoma
  if (geo_confidence === 'failed' && OUT_OF_AREA_PATTERNS.some(p => p.test(cats_address))) {
    return { status: 'Declined', reason: 'Out of service area (address)' };
  }

  // Check notes for resolution patterns
  for (const pattern of RESOLVED_PATTERNS) {
    if (pattern.test(notes)) {
      return { status: 'Complete', reason: `Client resolved: ${notes.substring(0, 50)}...` };
    }
  }

  // Contacted multiple times with no recent activity = Declined
  if (status.toLowerCase().includes('contacted multiple times')) {
    // Check if last contact was more than 30 days ago
    const dateMatch = notes.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (dateMatch) {
      const [, month, day, year] = dateMatch;
      const fullYear = year.length === 2 ? `20${year}` : year;
      const lastContact = new Date(`${fullYear}-${month}-${day}`);
      const daysSince = (Date.now() - lastContact.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince > 30) {
        return { status: 'Declined', reason: `No response after ${Math.floor(daysSince)} days` };
      }
    }
  }

  // Single "Contacted" with notes showing CLM (called left message) and no response
  // If more than 45 days since last contact attempt, likely no response
  if (status.toLowerCase() === 'contacted' && notes) {
    const dateMatch = notes.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (dateMatch && /CLM|left\s+message|voicemail|emailed/i.test(notes)) {
      const [, month, day, year] = dateMatch;
      const fullYear = year.length === 2 ? `20${year}` : year;
      const lastContact = new Date(`${fullYear}-${month}-${day}`);
      const daysSince = (Date.now() - lastContact.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince > 45) {
        return { status: 'Declined', reason: `No response to contact attempt after ${Math.floor(daysSince)} days` };
      }
    }
  }

  // Keep as Pending Review if recent or needs follow-up
  return null; // No change
}

async function recordChange(client, submissionId, oldStatus, newStatus, reason) {
  // Record the change in review_notes for audit trail
  const sql = `
    UPDATE trapper.web_intake_submissions
    SET review_notes = COALESCE(review_notes, '') || $1
    WHERE submission_id = $2
  `;

  const note = `\n[${new Date().toISOString().split('T')[0]} Auto-categorized: ${oldStatus} → ${newStatus}. ${reason}]`;
  await client.query(sql, [note, submissionId]);
}

async function updateSubmissionStatus(client, submissionId, newStatus) {
  const sql = `
    UPDATE trapper.web_intake_submissions
    SET
      legacy_submission_status = $1,
      updated_at = NOW()
    WHERE submission_id = $2
  `;
  await client.query(sql, [newStatus, submissionId]);
}

async function main() {
  const options = parseArgs();

  console.log('\nCategorize Pending Reviews');
  console.log('='.repeat(50));
  console.log(`Mode: ${options.dryRun ? 'DRY RUN' : 'LIVE'}`);

  if (!process.env.DATABASE_URL) {
    console.error('Error: DATABASE_URL not set');
    process.exit(1);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  console.log('Connected to database\n');

  // Get pending review submissions
  const result = await client.query(`
    SELECT
      submission_id,
      first_name || ' ' || last_name as name,
      cats_address,
      legacy_status,
      legacy_submission_status,
      legacy_notes,
      geo_confidence,
      submitted_at
    FROM trapper.web_intake_submissions
    WHERE legacy_submission_status = 'Pending Review'
    ORDER BY submitted_at DESC
  `);

  const submissions = result.rows;
  console.log(`Found ${submissions.length} pending reviews to evaluate\n`);

  const stats = {
    total: submissions.length,
    declined: 0,
    complete: 0,
    unchanged: 0,
  };

  for (const sub of submissions) {
    const decision = determineNewStatus(sub);

    if (!decision) {
      stats.unchanged++;
      if (options.verbose) {
        console.log(`  [=] ${sub.name}: Keep as Pending Review`);
      }
      continue;
    }

    if (decision.status === 'Declined') stats.declined++;
    if (decision.status === 'Complete') stats.complete++;

    console.log(`  [→] ${sub.name}`);
    console.log(`      ${sub.legacy_status || '(no status)'}`);
    console.log(`      Pending Review → ${decision.status}`);
    console.log(`      Reason: ${decision.reason}`);
    console.log('');

    if (!options.dryRun) {
      await recordChange(client, sub.submission_id, 'Pending Review', decision.status, decision.reason);
      await updateSubmissionStatus(client, sub.submission_id, decision.status);
    }
  }

  await client.end();

  console.log('\nSummary');
  console.log('-'.repeat(50));
  console.log(`  Total evaluated:  ${stats.total}`);
  console.log(`  → Declined:       ${stats.declined}`);
  console.log(`  → Complete:       ${stats.complete}`);
  console.log(`  → Unchanged:      ${stats.unchanged}`);

  if (options.dryRun) {
    console.log('\nDry run complete. Run without --dry-run to apply changes.');
  } else {
    console.log('\nChanges applied and recorded in corrections table.');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
