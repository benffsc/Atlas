#!/usr/bin/env node
/**
 * extract_notes_relationships.mjs (DATA_GAP_066)
 *
 * Extracts structured relationship data from clinic account notes using Claude Batch API.
 * Targets ops.clinic_accounts with quick_notes or long_notes populated.
 * Results stored in ops.extracted_note_entities for staff review.
 *
 * Architecture:
 *   1. Export accounts with notes from DB → JSONL batch file
 *   2. Submit to Claude Batch API (50% cost discount, 24h window)
 *   3. Poll until complete
 *   4. Parse responses → INSERT into ops.extracted_note_entities
 *
 * Usage:
 *   cd apps/web
 *   set -a && source .env.local && set +a
 *   node ../../scripts/pipeline/extract_notes_relationships.mjs --dry-run
 *   node ../../scripts/pipeline/extract_notes_relationships.mjs --export-only
 *   node ../../scripts/pipeline/extract_notes_relationships.mjs
 *   node ../../scripts/pipeline/extract_notes_relationships.mjs --import results-abc123.jsonl
 *
 * Environment:
 *   DATABASE_URL        - Postgres connection string (required)
 *   ANTHROPIC_API_KEY   - Anthropic API key (required for submit/poll)
 *
 * Cost estimate: ~18K accounts × ~500 input tokens × ~200 output tokens ≈ $30-50 batch
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';

const { Client } = pg;

// ============================================================================
// Config
// ============================================================================

const EXTRACTION_MODEL = 'claude-sonnet-4-5-20250514';
const MAX_TOKENS = 500;
const BATCH_API_URL = 'https://api.anthropic.com/v1/messages/batches';
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const OUTPUT_DIR = 'scripts/pipeline/batch-output';

const colors = {
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m'
};

// ============================================================================
// Prompt
// ============================================================================

const EXTRACTION_PROMPT = `Extract structured data from these veterinary clinic notes about a client account.
Return JSON only — no markdown, no explanation. Extract:
- people: [{name, role (resident/caretaker/trapper/family_member/neighbor), confidence (0.0-1.0)}]
- relationships: [{person_name, relation_to (place/colony/other_person), relation_type}]
- colony_info: {estimated_size, feeding_schedule, management_notes} or null
- flags: [any relevant operational flags like "aggressive cats", "access issues", "seasonal"]

Rules:
- Only extract NAMED people (not "the neighbor" without a name)
- confidence: 1.0 = explicitly stated role, 0.7 = implied, 0.5 = guessed
- If no extractable data, return {"people": [], "relationships": [], "colony_info": null, "flags": []}

Notes:`;

// ============================================================================
// CLI Args
// ============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes('--dry-run'),
    exportOnly: args.includes('--export-only'),
    verbose: args.includes('--verbose') || args.includes('-v'),
    importFile: args.includes('--import') ? args[args.indexOf('--import') + 1] : null,
    limit: args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1], 10) : null,
  };
}

// ============================================================================
// Database
// ============================================================================

async function getAccountsWithNotes(client, limit) {
  const limitClause = limit ? `LIMIT ${limit}` : '';
  const result = await client.query(`
    SELECT
      ca.account_id,
      ca.display_name,
      ca.quick_notes,
      ca.long_notes,
      ca.tags,
      ca.owner_address,
      ca.owner_city,
      ca.owner_zip
    FROM ops.clinic_accounts ca
    WHERE (ca.quick_notes IS NOT NULL OR ca.long_notes IS NOT NULL)
      -- Skip already-extracted accounts
      AND NOT EXISTS (
        SELECT 1 FROM ops.extracted_note_entities ene
        WHERE ene.clinic_account_id = ca.account_id
      )
    ORDER BY ca.account_id
    ${limitClause}
  `);
  return result.rows;
}

async function insertExtractions(client, extractions) {
  let inserted = 0;
  let skipped = 0;

  for (const ext of extractions) {
    try {
      await client.query(`
        INSERT INTO ops.extracted_note_entities (
          clinic_account_id, extraction_model, extraction_batch_id,
          extracted_people, extracted_relationships, extracted_colony_info, extracted_flags
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT DO NOTHING
      `, [
        ext.clinic_account_id,
        ext.extraction_model,
        ext.batch_id,
        JSON.stringify(ext.people),
        JSON.stringify(ext.relationships),
        ext.colony_info ? JSON.stringify(ext.colony_info) : null,
        JSON.stringify(ext.flags),
      ]);
      inserted++;
    } catch (err) {
      console.error(`${colors.red}  Error inserting ${ext.clinic_account_id}: ${err.message}${colors.reset}`);
      skipped++;
    }
  }

  return { inserted, skipped };
}

// ============================================================================
// Batch File Generation
// ============================================================================

function buildBatchRequest(account) {
  const address = [account.owner_address, account.owner_city, account.owner_zip]
    .filter(Boolean).join(', ');

  const notesContent = [
    account.quick_notes ? `Quick: ${account.quick_notes}` : null,
    account.long_notes ? `Long: ${account.long_notes}` : null,
    account.tags ? `Tags: ${account.tags}` : null,
    `Account name: ${account.display_name || 'Unknown'}`,
    address ? `Address: ${address}` : null,
  ].filter(Boolean).join('\n');

  return {
    custom_id: `account-${account.account_id}`,
    params: {
      model: EXTRACTION_MODEL,
      max_tokens: MAX_TOKENS,
      messages: [
        {
          role: 'user',
          content: `${EXTRACTION_PROMPT}\n${notesContent}`
        }
      ]
    }
  };
}

function exportBatchFile(accounts, outputPath) {
  const lines = accounts.map(a => JSON.stringify(buildBatchRequest(a)));
  fs.writeFileSync(outputPath, lines.join('\n') + '\n');
  return lines.length;
}

// ============================================================================
// Batch API
// ============================================================================

async function submitBatch(filePath) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const requests = fileContent.trim().split('\n').map(line => JSON.parse(line));

  const response = await fetch(BATCH_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'message-batches-2024-09-24',
    },
    body: JSON.stringify({ requests }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Batch API error ${response.status}: ${text}`);
  }

  return response.json();
}

async function pollBatch(batchId) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  const response = await fetch(`${BATCH_API_URL}/${batchId}`, {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'message-batches-2024-09-24',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Poll error ${response.status}: ${text}`);
  }

  return response.json();
}

async function downloadResults(batchId) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  const response = await fetch(`${BATCH_API_URL}/${batchId}/results`, {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'message-batches-2024-09-24',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Download error ${response.status}: ${text}`);
  }

  return response.text();
}

// ============================================================================
// Response Parsing
// ============================================================================

function parseExtractionResponse(customId, result) {
  const accountId = customId.replace('account-', '');

  // Default empty result
  const empty = {
    clinic_account_id: accountId,
    extraction_model: EXTRACTION_MODEL,
    batch_id: null,
    people: [],
    relationships: [],
    colony_info: null,
    flags: [],
  };

  if (result.type === 'error') {
    console.error(`${colors.yellow}  Skipping ${accountId}: API error${colors.reset}`);
    return empty;
  }

  try {
    const message = result.message;
    const textBlock = message.content.find(b => b.type === 'text');
    if (!textBlock) return empty;

    // Parse JSON from response, stripping any markdown fences
    let jsonText = textBlock.text.trim();
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const parsed = JSON.parse(jsonText);

    return {
      clinic_account_id: accountId,
      extraction_model: EXTRACTION_MODEL,
      batch_id: null,
      people: Array.isArray(parsed.people) ? parsed.people : [],
      relationships: Array.isArray(parsed.relationships) ? parsed.relationships : [],
      colony_info: parsed.colony_info || null,
      flags: Array.isArray(parsed.flags) ? parsed.flags : [],
    };
  } catch (err) {
    console.error(`${colors.yellow}  Parse error for ${accountId}: ${err.message}${colors.reset}`);
    return empty;
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const opts = parseArgs();

  console.log(`${colors.bold}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
  console.log(`${colors.bold}  Clinic Notes → Relationship Extraction${colors.reset}`);
  console.log(`${colors.bold}  DATA_GAP_066 | Model: ${EXTRACTION_MODEL}${colors.reset}`);
  console.log(`${colors.bold}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
  console.log('');

  if (opts.dryRun) console.log(`${colors.yellow}  DRY RUN — no changes will be made${colors.reset}\n`);

  // ── Import mode: parse a downloaded results file ──
  if (opts.importFile) {
    console.log(`${colors.cyan}Importing results from: ${opts.importFile}${colors.reset}\n`);

    if (!fs.existsSync(opts.importFile)) {
      console.error(`${colors.red}File not found: ${opts.importFile}${colors.reset}`);
      process.exit(1);
    }

    const lines = fs.readFileSync(opts.importFile, 'utf-8').trim().split('\n');
    const extractions = [];

    for (const line of lines) {
      const row = JSON.parse(line);
      const extraction = parseExtractionResponse(row.custom_id, row.result);
      extractions.push(extraction);
    }

    const withPeople = extractions.filter(e => e.people.length > 0);
    const withColony = extractions.filter(e => e.colony_info !== null);

    console.log(`${colors.green}  Parsed: ${extractions.length} results${colors.reset}`);
    console.log(`  With people: ${withPeople.length}`);
    console.log(`  With colony info: ${withColony.length}`);
    console.log('');

    if (opts.verbose) {
      for (const ext of withPeople.slice(0, 10)) {
        console.log(`  ${colors.cyan}${ext.clinic_account_id}${colors.reset}: ${ext.people.map(p => `${p.name} (${p.role})`).join(', ')}`);
      }
      console.log('');
    }

    if (opts.dryRun) {
      console.log(`${colors.yellow}DRY RUN — would insert ${extractions.length} extractions${colors.reset}`);
      process.exit(0);
    }

    const db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();

    try {
      const { inserted, skipped } = await insertExtractions(db, extractions);
      console.log(`${colors.green}  Inserted: ${inserted} | Skipped: ${skipped}${colors.reset}`);
    } finally {
      await db.end();
    }

    process.exit(0);
  }

  // ── Export + Submit mode ──
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  try {
    // Step 1: Get accounts with notes
    console.log(`${colors.cyan}Step 1: Querying accounts with notes...${colors.reset}`);
    const accounts = await getAccountsWithNotes(db, opts.limit);
    console.log(`  Found ${accounts.length} accounts with notes to process\n`);

    if (accounts.length === 0) {
      console.log(`${colors.green}Nothing to do — all accounts already extracted.${colors.reset}`);
      process.exit(0);
    }

    // Step 2: Generate batch JSONL file
    console.log(`${colors.cyan}Step 2: Generating batch file...${colors.reset}`);
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const batchFileName = `notes-extraction-${timestamp}.jsonl`;
    const batchFilePath = path.join(OUTPUT_DIR, batchFileName);

    const count = exportBatchFile(accounts, batchFilePath);
    console.log(`  Wrote ${count} requests to ${batchFilePath}\n`);

    if (opts.verbose) {
      // Show first request as sample
      const sample = buildBatchRequest(accounts[0]);
      console.log(`  ${colors.dim}Sample request:${colors.reset}`);
      console.log(`  ${colors.dim}${JSON.stringify(sample, null, 2).split('\n').join('\n  ')}${colors.reset}\n`);
    }

    // Estimate cost
    const estInputTokens = count * 500;
    const estOutputTokens = count * 200;
    const estCost = (estInputTokens * 1.5 / 1_000_000) + (estOutputTokens * 7.5 / 1_000_000); // Batch pricing
    console.log(`  ${colors.dim}Estimated cost: ~$${estCost.toFixed(2)} (batch pricing)${colors.reset}\n`);

    if (opts.exportOnly || opts.dryRun) {
      console.log(`${colors.yellow}${opts.dryRun ? 'DRY RUN' : 'EXPORT ONLY'} — batch file created but not submitted${colors.reset}`);
      console.log(`  To submit manually: node scripts/pipeline/extract_notes_relationships.mjs --import <results-file>`);
      process.exit(0);
    }

    // Step 3: Submit to Batch API
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error(`${colors.red}ANTHROPIC_API_KEY not set — cannot submit batch${colors.reset}`);
      console.log(`  Batch file saved to: ${batchFilePath}`);
      console.log(`  Set ANTHROPIC_API_KEY and re-run, or submit manually.`);
      process.exit(1);
    }

    console.log(`${colors.cyan}Step 3: Submitting batch to Claude API...${colors.reset}`);
    const batchResult = await submitBatch(batchFilePath);
    const batchId = batchResult.id;
    console.log(`  Batch ID: ${batchId}`);
    console.log(`  Status: ${batchResult.processing_status}\n`);

    // Step 4: Poll until complete
    console.log(`${colors.cyan}Step 4: Polling for completion (every 5 min)...${colors.reset}`);
    let status = batchResult.processing_status;

    while (status !== 'ended') {
      console.log(`  ${colors.dim}${new Date().toISOString()} — Status: ${status}. Waiting ${POLL_INTERVAL_MS / 1000}s...${colors.reset}`);
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));

      const pollResult = await pollBatch(batchId);
      status = pollResult.processing_status;

      if (pollResult.request_counts) {
        const rc = pollResult.request_counts;
        console.log(`  ${colors.dim}  Processing: ${rc.processing} | Succeeded: ${rc.succeeded} | Errored: ${rc.errored}${colors.reset}`);
      }
    }

    console.log(`\n${colors.green}  Batch complete!${colors.reset}\n`);

    // Step 5: Download results
    console.log(`${colors.cyan}Step 5: Downloading results...${colors.reset}`);
    const resultsText = await downloadResults(batchId);
    const resultsPath = path.join(OUTPUT_DIR, `results-${batchId}.jsonl`);
    fs.writeFileSync(resultsPath, resultsText);
    console.log(`  Saved to: ${resultsPath}\n`);

    // Step 6: Parse and insert
    console.log(`${colors.cyan}Step 6: Parsing and inserting results...${colors.reset}`);
    const lines = resultsText.trim().split('\n');
    const extractions = [];

    for (const line of lines) {
      const row = JSON.parse(line);
      const extraction = parseExtractionResponse(row.custom_id, row.result);
      extraction.batch_id = batchId;
      extractions.push(extraction);
    }

    const withPeople = extractions.filter(e => e.people.length > 0);
    const withColony = extractions.filter(e => e.colony_info !== null);

    console.log(`  Total: ${extractions.length}`);
    console.log(`  With people: ${withPeople.length}`);
    console.log(`  With colony info: ${withColony.length}\n`);

    const { inserted, skipped } = await insertExtractions(db, extractions);
    console.log(`${colors.green}  Inserted: ${inserted} | Skipped: ${skipped}${colors.reset}\n`);

    // Summary
    console.log(`${colors.bold}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
    console.log(`${colors.bold}  COMPLETE${colors.reset}`);
    console.log(`${colors.bold}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
    console.log(`  Accounts processed: ${extractions.length}`);
    console.log(`  People extracted: ${withPeople.length}`);
    console.log(`  Colony info found: ${withColony.length}`);
    console.log(`  Results file: ${resultsPath}`);
    console.log(`  Batch ID: ${batchId}`);
    console.log('');
    console.log(`  Next: Review at /admin/notes-review or:`);
    console.log(`    SELECT * FROM ops.extracted_note_entities WHERE extracted_people != '[]' ORDER BY created_at;`);

  } finally {
    await db.end();
  }
}

main().catch(err => {
  console.error(`${colors.red}Fatal: ${err.message}${colors.reset}`);
  if (err.stack) console.error(colors.dim + err.stack + colors.reset);
  process.exit(1);
});
