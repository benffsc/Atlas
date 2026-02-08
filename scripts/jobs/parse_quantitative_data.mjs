#!/usr/bin/env node
/**
 * Parse Quantitative Data from Text Notes
 * ========================================
 *
 * Uses AI to extract quantitative data from informal notes:
 * - Cat counts (total cats, fixed/unfixed, eartipped)
 * - Colony size estimates
 * - Kitten counts
 * - Feeding duration
 * - Trapping progress
 *
 * Data is stored in:
 * - place_colony_estimates (for Beacon population modeling)
 * - place_alteration_snapshots (for TNR progress tracking)
 *
 * Usage:
 *   node scripts/jobs/parse_quantitative_data.mjs [--source SOURCE] [--limit N] [--dry-run]
 *
 * Sources: google_maps, project75, requests (default: all)
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

const SYSTEM_PROMPT = `You are a data extraction assistant for Forgotten Felines of Sonoma County (FFSC), a cat TNR organization in Northern California.

TNR CONTEXT - How FFSC Works:
- TNR = Trap-Neuter-Return: Humane approach to managing community cat colonies
- FFSC staff (JK, MP, DF, SN, etc.) coordinate operations, but don't trap themselves
- CLIENTS (community members) do the trapping after FFSC provides training/equipment
- Typical workflow: Client reports cats → Staff coordinates → Client traps → Clinic fixes cats → Cats returned
- Goal: Reduce colony size over time by preventing new births

TERMINOLOGY:
- Colony = group of community cats living at a location
- Fixed/Altered/Spayed/Neutered = surgically sterilized (can't reproduce)
- Eartipped = left ear tip clipped (universal TNR indicator, shows cat is fixed)
- Feral = unsocialized cat (can't be pets)
- Tame/Friendly = socialized cat (could be rehomed)
- Lactating = nursing mother (recently gave birth)
- Pregnant = expecting kittens

YOUR TASK:
Extract quantitative data from informal field notes. Return ONLY valid JSON.

EXTRACT THESE FIELDS (use your judgment to interpret):
{
  "total_cats": number or null,           // Best estimate of total cats at location
  "cats_fixed": number or null,           // Cats already altered (look for "fixed", "done", "eartipped")
  "cats_unfixed": number or null,         // Cats still needing TNR
  "cats_eartipped": number or null,       // Cats with visible eartips
  "kittens": number or null,              // Kitten count mentioned
  "observation_date": "YYYY-MM-DD" or null,  // Most recent date mentioned
  "feeding_months": number or null,       // How long feeding (convert years to months)
  "colony_status": "active" | "complete" | "unknown",  // Is TNR work done here?
  "confidence": "high" | "medium" | "low" // Your confidence in extraction
}

INTERPRETATION RULES:
1. You CAN infer reasonable values - e.g., if "trapped 5" and "2 more to go" → total_cats = 7
2. If a range (e.g., "5-7 cats"), use the higher end (colony size often underestimated)
3. If "about 10" or "approximately 10" → use 10
4. "Fixed all", "complete", "done" → cats_unfixed = 0, colony_status = "complete"
5. "Still have X to trap" → cats_unfixed = X
6. Dates: "10/22/24" = 2024-10-22, "May 2019" = 2019-05-01
7. "Feeding 2 years" → feeding_months = 24
8. If cats were trapped, assume they were fixed unless notes say otherwise
9. Return {"confidence": "none"} ONLY if truly no cat numbers mentioned

EXAMPLES:

Input: "10/22/24 MP. 6 cats total, 4 already fixed, 2 need TNR"
Output: {"total_cats": 6, "cats_fixed": 4, "cats_unfixed": 2, "observation_date": "2024-10-22", "colony_status": "active", "confidence": "high"}

Input: "Feeding for about 2 years, sees 8-10 cats, none eartipped"
Output: {"total_cats": 10, "cats_fixed": 0, "cats_eartipped": 0, "cats_unfixed": 10, "feeding_months": 24, "colony_status": "active", "confidence": "medium"}

Input: "Fixed all cats at this location. Complete 5/19. Colony of 12."
Output: {"total_cats": 12, "cats_fixed": 12, "cats_unfixed": 0, "observation_date": "2019-05-15", "colony_status": "complete", "confidence": "high"}

Input: "Trapped 8, still see 3 more unfixed ones around"
Output: {"total_cats": 11, "cats_fixed": 8, "cats_unfixed": 3, "colony_status": "active", "confidence": "medium"}

Input: "Client called about scheduling appointment"
Output: {"confidence": "none"}`;

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes('--dry-run'),
    limit: args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : 100,
    source: args.includes('--source') ? args[args.indexOf('--source') + 1] : 'all',
    help: args.includes('--help') || args.includes('-h'),
  };
}

async function extractQuantitativeData(anthropic, content) {
  if (!content || content.length < 15) {
    return null;
  }

  // Clean up HTML artifacts
  const cleanContent = content
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/Signals:.*?\|/g, '')  // Remove signal tags
    .replace(/Trapper:.*?\|/g, '')  // Remove trapper tags
    .trim();

  if (cleanContent.length < 15) {
    return null;
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-20250514',
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Extract quantitative data from this note:\n\n${cleanContent}`
        }
      ]
    });

    const text = response.content[0]?.text?.trim();
    if (!text) return null;

    // Parse JSON response
    try {
      const data = JSON.parse(text);
      if (data.confidence === 'none') return null;
      return data;
    } catch {
      // Try to extract JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        if (data.confidence === 'none') return null;
        return data;
      }
      return null;
    }
  } catch (err) {
    console.error(`${red}API error:${reset}`, err.message);
    return null;
  }
}

async function processGoogleMaps(pool, anthropic, options, stats) {
  console.log(`\n${cyan}Processing Google Maps entries...${reset}`);

  const result = await pool.query(`
    SELECT
      gme.entry_id,
      gme.original_content,
      gme.kml_name,
      gme.place_id,
      gme.imported_at
    FROM trapper.google_map_entries gme
    WHERE gme.ai_quantitative_parsed_at IS NULL
      AND gme.original_content IS NOT NULL
      AND LENGTH(gme.original_content) >= 20
      AND gme.place_id IS NOT NULL
    ORDER BY gme.imported_at DESC
    LIMIT $1
  `, [options.limit]);

  console.log(`  Found ${result.rows.length} entries with places to process`);

  for (const row of result.rows) {
    stats.processed++;
    process.stdout.write(`  [${stats.processed}] ${row.kml_name?.substring(0, 30) || 'Unknown'} `);

    const data = await extractQuantitativeData(anthropic, row.original_content);

    if (!data) {
      console.log(`${dim}no data${reset}`);
      stats.skipped++;
      // Mark as processed even if no data
      if (!options.dryRun) {
        await pool.query(`
          UPDATE trapper.google_map_entries
          SET ai_quantitative_parsed_at = NOW()
          WHERE entry_id = $1
        `, [row.entry_id]);
      }
      continue;
    }

    stats.hasData++;

    if (options.dryRun) {
      console.log(`${green}found${reset} ${JSON.stringify(data)}`);
    } else {
      try {
        // Insert colony estimate if we have total cats
        // Auto-verify high-confidence results (MIG_942 decision)
        if (data.total_cats) {
          const isHighConfidence = data.confidence === 'high';
          await pool.query(`
            INSERT INTO trapper.place_colony_estimates (
              place_id,
              total_cats,
              altered_count,
              unaltered_count,
              kitten_count,
              eartip_count_observed,
              source_type,
              observation_date,
              source_system,
              source_record_id,
              notes,
              verified_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6,
              'ai_parsed',
              COALESCE($7::date, CURRENT_DATE),
              'google_maps_kml',
              $8,
              $9,
              $10
            )
            ON CONFLICT DO NOTHING
          `, [
            row.place_id,
            data.total_cats,
            data.cats_fixed,
            data.cats_unfixed,
            data.kittens,
            data.cats_eartipped,
            data.observation_date,
            row.entry_id,
            `AI-parsed from Google Maps entry. Confidence: ${data.confidence}`,
            isHighConfidence ? new Date() : null  // Auto-verify high confidence
          ]);
          stats.colonyEstimates++;
          if (isHighConfidence) stats.autoVerified = (stats.autoVerified || 0) + 1;
        }

        // Mark as processed
        await pool.query(`
          UPDATE trapper.google_map_entries
          SET ai_quantitative_parsed_at = NOW()
          WHERE entry_id = $1
        `, [row.entry_id]);

        console.log(`${green}saved${reset} cats:${data.total_cats || '?'}`);
      } catch (err) {
        console.log(`${red}error${reset} ${err.message}`);
        stats.errors++;
      }
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 200));
  }
}

async function processRequests(pool, anthropic, options, stats) {
  console.log(`\n${cyan}Processing requests...${reset}`);

  const result = await pool.query(`
    SELECT
      r.request_id,
      r.notes,
      r.summary,
      r.place_id,
      r.created_at as source_created_at
    FROM trapper.sot_requests r
    LEFT JOIN trapper.place_colony_estimates pce
      ON pce.place_id = r.place_id
      AND pce.source_system = 'requests'
      AND pce.source_record_id = r.request_id::text
    WHERE r.notes IS NOT NULL
      AND LENGTH(r.notes) >= 30
      AND r.place_id IS NOT NULL
      AND pce.estimate_id IS NULL
    ORDER BY r.source_created_at DESC
    LIMIT $1
  `, [options.limit]);

  console.log(`  Found ${result.rows.length} requests to process`);

  for (const row of result.rows) {
    stats.processed++;
    process.stdout.write(`  [${stats.processed}] ${row.summary?.substring(0, 30) || 'Request'} `);

    const data = await extractQuantitativeData(anthropic, row.notes);

    if (!data) {
      console.log(`${dim}no data${reset}`);
      stats.skipped++;
      continue;
    }

    stats.hasData++;

    if (options.dryRun) {
      console.log(`${green}found${reset} ${JSON.stringify(data)}`);
    } else {
      try {
        // Auto-verify high-confidence results (MIG_942 decision)
        if (data.total_cats) {
          const isHighConfidence = data.confidence === 'high';
          await pool.query(`
            INSERT INTO trapper.place_colony_estimates (
              place_id,
              total_cats,
              altered_count,
              unaltered_count,
              kitten_count,
              eartip_count_observed,
              source_type,
              observation_date,
              source_system,
              source_record_id,
              notes,
              verified_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6,
              'ai_parsed',
              COALESCE($7::date, $8::date, CURRENT_DATE),
              'requests',
              $9,
              $10,
              $11
            )
            ON CONFLICT DO NOTHING
          `, [
            row.place_id,
            data.total_cats,
            data.cats_fixed,
            data.cats_unfixed,
            data.kittens,
            data.cats_eartipped,
            data.observation_date,
            row.source_created_at,
            row.request_id,
            `AI-parsed from request notes. Confidence: ${data.confidence}`,
            isHighConfidence ? new Date() : null  // Auto-verify high confidence
          ]);
          stats.colonyEstimates++;
          if (isHighConfidence) stats.autoVerified = (stats.autoVerified || 0) + 1;
        }

        console.log(`${green}saved${reset} cats:${data.total_cats || '?'}`);
      } catch (err) {
        console.log(`${red}error${reset} ${err.message}`);
        stats.errors++;
      }
    }

    await new Promise(r => setTimeout(r, 200));
  }
}

async function processProject75(pool, anthropic, options, stats) {
  console.log(`\n${cyan}Processing Project 75 surveys...${reset}`);

  // Check if p75 survey data exists
  const checkResult = await pool.query(`
    SELECT COUNT(*) as count
    FROM trapper.p75_post_clinic_surveys
    WHERE notes IS NOT NULL
  `);

  if (checkResult.rows[0].count === 0) {
    console.log(`  No Project 75 survey data found`);
    return;
  }

  const result = await pool.query(`
    SELECT
      s.survey_id,
      s.notes,
      s.cats_remaining,
      s.cats_fixed_estimate,
      s.place_id,
      s.survey_date
    FROM trapper.p75_post_clinic_surveys s
    LEFT JOIN trapper.place_colony_estimates pce
      ON pce.place_id = s.place_id
      AND pce.source_system = 'project75'
      AND pce.source_record_id = s.survey_id::text
    WHERE s.notes IS NOT NULL
      AND LENGTH(s.notes) >= 20
      AND s.place_id IS NOT NULL
      AND pce.estimate_id IS NULL
    ORDER BY s.survey_date DESC
    LIMIT $1
  `, [options.limit]);

  console.log(`  Found ${result.rows.length} surveys to process`);

  for (const row of result.rows) {
    stats.processed++;
    process.stdout.write(`  [${stats.processed}] Survey ${row.survey_id} `);

    // For P75, we already have structured data but can enhance with notes
    const data = await extractQuantitativeData(anthropic, row.notes);

    // Combine structured data with AI-extracted data
    const totalCats = row.cats_remaining || data?.total_cats;
    const catsFixed = row.cats_fixed_estimate || data?.cats_fixed;

    if (!totalCats) {
      console.log(`${dim}no count${reset}`);
      stats.skipped++;
      continue;
    }

    stats.hasData++;

    if (options.dryRun) {
      console.log(`${green}found${reset} cats:${totalCats} fixed:${catsFixed || '?'}`);
    } else {
      try {
        await pool.query(`
          INSERT INTO trapper.place_colony_estimates (
            place_id,
            total_cats,
            altered_count,
            source_type,
            observation_date,
            source_system,
            source_record_id,
            notes
          ) VALUES (
            $1, $2, $3,
            'post_clinic_survey',
            $4,
            'project75',
            $5,
            $6
          )
          ON CONFLICT DO NOTHING
        `, [
          row.place_id,
          totalCats,
          catsFixed,
          row.survey_date,
          row.survey_id,
          `From Project 75 post-clinic survey. ${row.notes?.substring(0, 200) || ''}`
        ]);
        stats.colonyEstimates++;

        console.log(`${green}saved${reset} cats:${totalCats}`);
      } catch (err) {
        console.log(`${red}error${reset} ${err.message}`);
        stats.errors++;
      }
    }

    await new Promise(r => setTimeout(r, 200));
  }
}

async function main() {
  const options = parseArgs();

  if (options.help) {
    console.log(`
${bold}Parse Quantitative Data from Text Notes${reset}

Usage: node scripts/jobs/parse_quantitative_data.mjs [options]

Options:
  --source SOURCE  Source to process: google_maps, project75, requests, or all (default)
  --limit N        Process up to N entries per source (default: 100)
  --dry-run        Preview without saving to database
  --help           Show this help

Environment:
  DATABASE_URL       Postgres connection string
  ANTHROPIC_API_KEY  Anthropic API key
`);
    process.exit(0);
  }

  console.log(`\n${bold}Parse Quantitative Data from Text Notes${reset}`);
  console.log('═'.repeat(50));

  if (options.dryRun) {
    console.log(`${yellow}DRY RUN MODE${reset}`);
  }

  console.log(`Source: ${options.source}, Limit: ${options.limit}`);

  if (!process.env.DATABASE_URL) {
    console.error(`${red}Error:${reset} DATABASE_URL not set`);
    process.exit(1);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(`${red}Error:${reset} ANTHROPIC_API_KEY not set`);
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const anthropic = new Anthropic();

  const stats = {
    processed: 0,
    hasData: 0,
    skipped: 0,
    errors: 0,
    colonyEstimates: 0,
  };

  try {
    // Ensure we have the tracking column
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'trapper'
          AND table_name = 'google_map_entries'
          AND column_name = 'ai_quantitative_parsed_at'
        ) THEN
          ALTER TABLE trapper.google_map_entries
          ADD COLUMN ai_quantitative_parsed_at TIMESTAMPTZ;
        END IF;
      END $$;
    `);

    // Process based on source selection
    if (options.source === 'all' || options.source === 'google_maps') {
      await processGoogleMaps(pool, anthropic, options, stats);
    }

    if (options.source === 'all' || options.source === 'requests') {
      await processRequests(pool, anthropic, options, stats);
    }

    if (options.source === 'all' || options.source === 'project75') {
      await processProject75(pool, anthropic, options, stats);
    }

    // Summary
    console.log(`\n${'═'.repeat(50)}`);
    console.log(`${bold}Summary${reset}`);
    console.log(`${'═'.repeat(50)}`);
    console.log(`${cyan}Processed:${reset}         ${stats.processed}`);
    console.log(`${green}With Data:${reset}         ${stats.hasData}`);
    console.log(`${yellow}Skipped (no data):${reset} ${stats.skipped}`);
    console.log(`${green}Colony Estimates:${reset}  ${stats.colonyEstimates}`);
    if (stats.errors > 0) {
      console.log(`${red}Errors:${reset}            ${stats.errors}`);
    }

    // Check totals
    const colonyCount = await pool.query(`
      SELECT COUNT(*) as count, COUNT(DISTINCT place_id) as places
      FROM trapper.place_colony_estimates
    `);
    console.log(`\n${cyan}Total colony estimates:${reset} ${colonyCount.rows[0].count} across ${colonyCount.rows[0].places} places`);

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
