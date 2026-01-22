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

Output ONLY the cleaned text, nothing else.`;

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
      model: 'claude-haiku-4-20250514',  // Haiku 4 - fast with better quality
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
    // Get entries needing paraphrasing
    const result = await pool.query(`
      SELECT entry_id, original_content, kml_name
      FROM trapper.google_map_entries
      WHERE ai_processed_at IS NULL
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
      skipped: 0,
      errors: 0,
    };

    for (const row of result.rows) {
      stats.processed++;
      process.stdout.write(`  [${stats.processed}/${result.rows.length}] `);

      const paraphrased = await paraphraseContent(anthropic, row.original_content);

      if (!paraphrased) {
        console.log(`${yellow}skipped${reset} (too short or error)`);
        stats.skipped++;
        continue;
      }

      if (options.dryRun) {
        console.log(`${green}would save${reset}`);
        console.log(`${dim}    Original: ${row.original_content.substring(0, 60)}...${reset}`);
        console.log(`${dim}    Paraphrased: ${paraphrased.substring(0, 60)}...${reset}`);
      } else {
        // Save to database
        await pool.query(`
          SELECT trapper.update_google_map_ai_summary($1, $2, $3)
        `, [row.entry_id, paraphrased, 0.85]);

        console.log(`${green}saved${reset}`);
      }

      stats.paraphrased++;

      // Rate limit - be nice to the API
      await new Promise(r => setTimeout(r, 200));
    }

    // Summary
    console.log(`\n${'═'.repeat(50)}`);
    console.log(`${bold}Summary${reset}`);
    console.log(`${'═'.repeat(50)}`);
    console.log(`${cyan}Processed:${reset}    ${stats.processed}`);
    console.log(`${green}Paraphrased:${reset}  ${stats.paraphrased}`);
    console.log(`${yellow}Skipped:${reset}      ${stats.skipped}`);
    if (stats.errors > 0) {
      console.log(`${red}Errors:${reset}       ${stats.errors}`);
    }

    // Check remaining
    const remaining = await pool.query(`
      SELECT COUNT(*) as count
      FROM trapper.google_map_entries
      WHERE ai_processed_at IS NULL
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
