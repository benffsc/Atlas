#!/usr/bin/env node
/**
 * Paraphrase Google Map Entries
 * ==============================
 *
 * Uses Claude to paraphrase informal Google Maps notes into professional
 * language while preserving:
 *   - Staff initials and attribution (JK, MP, DF, etc.)
 *   - Dates and timeline of events
 *   - Cat counts and details
 *   - Key facts and observations
 *
 * The goal is NOT to summarize (lose info) but to paraphrase (clean up).
 *
 * Usage:
 *   node scripts/jobs/paraphrase_google_map_entries.mjs [--limit N] [--dry-run]
 *
 * Environment:
 *   DATABASE_URL - Postgres connection
 *   ANTHROPIC_API_KEY - Anthropic API key
 */

import pg from 'pg';
import Anthropic from '@anthropic-ai/sdk';

const { Pool } = pg;

// ANSI colors
const green = '\x1b[32m';
const yellow = '\x1b[33m';
const red = '\x1b[31m';
const cyan = '\x1b[36m';
const dim = '\x1b[2m';
const bold = '\x1b[1m';
const reset = '\x1b[0m';

/**
 * Light Redaction
 * ===============
 * Keeps original text verbatim with minimal cleanup:
 * - Explicit profanity → [***]
 * - SSN patterns → [SSN]
 *
 * PRESERVES: phone numbers, initials, informal language, sentiment
 */
const PROFANITY_PATTERNS = [
  /\b(fuck|fucking|fucked|fucker)\b/gi,
  /\b(shit|shitting|shitty)\b/gi,
  /\b(damn|damned|goddamn)\b/gi,
  /\b(ass|asshole)\b/gi,
  /\b(bitch|bitches)\b/gi,
  /\b(cunt|cunts)\b/gi,
  /\b(cock|cocks)\b/gi,
  /\b(dick|dicks)\b/gi,
];

const SSN_PATTERN = /\b\d{3}[-.]?\d{2}[-.]?\d{4}\b/g;

function lightRedact(text) {
  if (!text) return null;

  let redacted = text;

  // Redact profanity
  for (const pattern of PROFANITY_PATTERNS) {
    redacted = redacted.replace(pattern, '[***]');
  }

  // Redact SSNs
  redacted = redacted.replace(SSN_PATTERN, '[SSN]');

  return redacted;
}

const SYSTEM_PROMPT = `You are a light editor for Forgotten Felines of Sonoma County (FFSC), a cat TNR (Trap-Neuter-Return) organization.

CONTEXT - How TNR Works:
- FFSC staff (identified by initials like JK, MP, DF, SN) coordinate TNR operations
- Staff does NOT trap cats - they coordinate with CLIENTS (community members/requesters)
- Clients are people who contact FFSC about cats in their area needing help
- The workflow: Client contacts FFSC → Staff coordinates → Client traps cats → Cats go to clinic → Cats returned
- "Colony" = a group of community cats at a location
- "Fixed" / "Altered" = spayed or neutered
- Cats are often described by their appearance, temperament, and whether they're friendly or feral

YOUR TASK - Light Cleanup Only:
1. Keep the text AS CLOSE TO ORIGINAL as possible
2. Only fix: typos, swear words, and obviously unclear phrasing
3. When actions are described without a subject, add "[the client]" for clarity
   - Example: "trapped 3 cats" → "[The client] trapped 3 cats"
4. Remove "Signals:" prefix lines (that's just internal metadata tags)
5. PRESERVE exactly: dates, staff initials, cat counts, all facts

DO NOT:
- Rewrite sentences that are already clear
- Make it "more professional" - keep the casual tone if it's understandable
- Add information that wasn't there
- Remove any details, even if they seem minor
- Change the structure or order of information

EXAMPLES:
- Input: "12/14/23 JK Female 7-8 month trapped yesterday"
  Output: "12/14/23 JK Female 7-8 month old [cat] trapped yesterday [by the client]"

- Input: "damn cat keeps coming back, trapped it again"
  Output: "[The] cat keeps coming back, [the client] trapped it again"

- Input: "MP called, no answer, left vm about scheduling"
  Output: "MP called, no answer, left voicemail about scheduling"

CRITICAL OUTPUT RULES:
1. Output ONLY the edited text itself - nothing else
2. If the text needs NO changes, output the EXACT ORIGINAL TEXT
3. NEVER output commentary like "I can't paraphrase", "no changes needed", "here's the cleaned version", etc.
4. NEVER explain what you did or didn't change
5. Just output the text, period.`;

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes('--dry-run'),
    limit: args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : 50,
    help: args.includes('--help') || args.includes('-h'),
  };
}

async function paraphraseContent(anthropic, content) {
  // Skip very short content
  if (!content || content.length < 20) {
    return null;
  }

  // Clean up HTML artifacts
  const cleanContent = content
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();

  if (cleanContent.length < 20) {
    return null;
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',  // Haiku 4.5 - fast and capable
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Paraphrase this Google Maps note about a cat colony location:\n\n${cleanContent}`
        }
      ]
    });

    const paraphrased = response.content[0]?.text?.trim();

    // Validate output - should preserve key elements
    if (!paraphrased || paraphrased.length < 10) {
      return null;
    }

    // Detect AI refusal messages and return null (will fall back to redacted original)
    const lowerText = paraphrased.toLowerCase();
    const isRefusal =
      lowerText.includes("i can't paraphrase") ||
      lowerText.includes("i cannot paraphrase") ||
      lowerText.includes("i appreciate the question") ||
      lowerText.includes("i need to clarify my role") ||
      lowerText.includes("violate my instructions") ||
      lowerText.includes("here's the original") ||
      lowerText.includes("here's the cleaned version") ||
      lowerText.includes("no changes needed") ||
      lowerText.startsWith("i ") || // AI talking about itself
      lowerText.includes("this note is already");

    if (isRefusal) {
      // AI refused to just output the text - skip the paraphrase and use redacted original
      return null;
    }

    return paraphrased;
  } catch (err) {
    console.error(`${red}API error:${reset}`, err.message);
    return null;
  }
}

async function main() {
  const options = parseArgs();

  if (options.help) {
    console.log(`
${bold}Paraphrase Google Map Entries${reset}

Usage: node scripts/jobs/paraphrase_google_map_entries.mjs [options]

Options:
  --dry-run    Preview without saving to database
  --limit N    Process up to N entries (default: 50)
  --help       Show this help

Environment:
  DATABASE_URL     Postgres connection string
  ANTHROPIC_API_KEY Anthropic API key (Claude 3.5 Haiku)
`);
    process.exit(0);
  }

  console.log(`\n${bold}Paraphrase Google Map Entries${reset}`);
  console.log('═'.repeat(50));

  if (options.dryRun) {
    console.log(`${yellow}DRY RUN MODE${reset}\n`);
  }

  // Check environment
  if (!process.env.DATABASE_URL) {
    console.error(`${red}Error:${reset} DATABASE_URL not set`);
    process.exit(1);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(`${red}Error:${reset} ANTHROPIC_API_KEY not set`);
    console.error(`Add to .env: ANTHROPIC_API_KEY=sk-ant-...`);
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const anthropic = new Anthropic();

  try {
    // Get entries needing processing (either paraphrasing or light redaction)
    const result = await pool.query(`
      SELECT entry_id, original_content, kml_name, original_redacted, ai_processed_at
      FROM ops.google_map_entries
      WHERE (ai_processed_at IS NULL OR original_redacted IS NULL)
        AND original_content IS NOT NULL
        AND LENGTH(original_content) >= 20
      ORDER BY
        CASE match_status
          WHEN 'matched' THEN 1
          WHEN 'manually_linked' THEN 2
          ELSE 3
        END,
        imported_at DESC
      LIMIT $1
    `, [options.limit]);

    console.log(`${cyan}Found:${reset} ${result.rows.length} entries to process\n`);

    if (result.rows.length === 0) {
      console.log(`${green}All entries already processed!${reset}`);
      return;
    }

    const stats = {
      processed: 0,
      paraphrased: 0,
      redactedOnly: 0,
      skipped: 0,
      errors: 0,
    };

    for (const row of result.rows) {
      stats.processed++;
      process.stdout.write(`  [${stats.processed}/${result.rows.length}] `);

      // Check what needs to be done
      const needsRedaction = !row.original_redacted;
      const needsParaphrase = !row.ai_processed_at;

      // Skip if both are already done
      if (!needsRedaction && !needsParaphrase) {
        console.log(`${yellow}skipped${reset} (already processed)`);
        stats.skipped++;
        continue;
      }

      // Create light-redacted version if needed
      const redacted = needsRedaction ? lightRedact(row.original_content) : row.original_redacted;

      // Run AI paraphrasing if needed
      let paraphrased = null;
      if (needsParaphrase) {
        paraphrased = await paraphraseContent(anthropic, row.original_content);
      }

      if (!redacted && !paraphrased) {
        console.log(`${yellow}skipped${reset} (too short or error)`);
        stats.skipped++;
        continue;
      }

      if (options.dryRun) {
        console.log(`${green}would save${reset}`);
        console.log(`${dim}    Original: ${row.original_content.substring(0, 60)}...${reset}`);
        if (redacted) {
          console.log(`${dim}    Redacted: ${redacted.substring(0, 60)}...${reset}`);
        }
        if (paraphrased) {
          console.log(`${dim}    Paraphrased: ${paraphrased.substring(0, 60)}...${reset}`);
        }
      } else {
        // Save to database based on what we have
        if (paraphrased && needsRedaction) {
          // Both paraphrase and redaction needed
          await pool.query(`
            UPDATE ops.google_map_entries
            SET
              original_redacted = $2,
              ai_summary = $3,
              ai_processed_at = NOW(),
              ai_confidence = 0.85
            WHERE entry_id = $1
          `, [row.entry_id, redacted, paraphrased]);
          stats.paraphrased++;
          console.log(`${green}saved (redacted + paraphrased)${reset}`);
        } else if (paraphrased && !needsRedaction) {
          // Only paraphrase needed (redaction already done)
          await pool.query(`
            UPDATE ops.google_map_entries
            SET
              ai_summary = $2,
              ai_processed_at = NOW(),
              ai_confidence = 0.85
            WHERE entry_id = $1
          `, [row.entry_id, paraphrased]);
          stats.paraphrased++;
          console.log(`${green}saved (paraphrased only)${reset}`);
        } else if (needsRedaction && redacted) {
          // Only redaction needed (API call failed or not needed)
          await pool.query(`
            UPDATE ops.google_map_entries
            SET original_redacted = $2
            WHERE entry_id = $1
          `, [row.entry_id, redacted]);
          stats.redactedOnly++;
          console.log(`${green}saved (redacted only)${reset}`);
        } else if (needsParaphrase && !paraphrased && redacted) {
          // AI returned null (refusal or error) but we have redacted content
          // Mark as processed so it doesn't keep appearing, use redacted as summary
          await pool.query(`
            UPDATE ops.google_map_entries
            SET
              ai_summary = $2,
              ai_processed_at = NOW(),
              ai_confidence = 0.50
            WHERE entry_id = $1
          `, [row.entry_id, redacted]);
          stats.redactedOnly++;
          console.log(`${green}saved (AI skipped, using redacted)${reset}`);
        } else {
          console.log(`${yellow}skipped${reset} (nothing to save)`);
          stats.skipped++;
        }
      }

      // Rate limit - be nice to the API (only if we made an API call)
      if (paraphrased) {
        await new Promise(r => setTimeout(r, 200));
      }
    }

    // Summary
    console.log(`\n${'═'.repeat(50)}`);
    console.log(`${bold}Summary${reset}`);
    console.log(`${'═'.repeat(50)}`);
    console.log(`${cyan}Processed:${reset}      ${stats.processed}`);
    console.log(`${green}Paraphrased:${reset}    ${stats.paraphrased}`);
    console.log(`${green}Redacted only:${reset}  ${stats.redactedOnly}`);
    console.log(`${yellow}Skipped:${reset}        ${stats.skipped}`);
    if (stats.errors > 0) {
      console.log(`${red}Errors:${reset}         ${stats.errors}`);
    }

    // Check remaining
    const remaining = await pool.query(`
      SELECT COUNT(*) as count
      FROM ops.google_map_entries
      WHERE (ai_processed_at IS NULL OR original_redacted IS NULL)
        AND original_content IS NOT NULL
        AND LENGTH(original_content) >= 20
    `);
    console.log(`\n${cyan}Remaining:${reset}    ${remaining.rows[0].count} entries`);

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
