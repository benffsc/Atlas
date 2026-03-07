#!/usr/bin/env node
/**
 * classify_place_types.mjs
 * ========================
 *
 * Uses Claude AI to classify place types (apartment, mobile home park, ranch, etc.)
 * based on address patterns and linked notes.
 *
 * This classification feeds into:
 * - is_multi_unit_place() for linking decisions
 * - Map display (clustering apartments when zoomed out)
 * - Distance thresholds for Google Maps entry linking
 *
 * Usage:
 *   node scripts/jobs/classify_place_types.mjs --limit 100 --dry-run
 *   node scripts/jobs/classify_place_types.mjs --limit 500
 *   node scripts/jobs/classify_place_types.mjs --reclassify-all --limit 100
 *
 * Cost Estimate:
 *   ~14,000 places × ~$0.0003/record (mostly Haiku) = ~$4.20
 */

import pg from 'pg';
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;

// Read and parse .env file
function loadEnvFile() {
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const envPath = path.join(__dirname, '../../.env');
    const envContent = fs.readFileSync(envPath, 'utf-8');
    const envVars = {};
    for (const line of envContent.split('\n')) {
      if (line.startsWith('#') || !line.includes('=')) continue;
      const [key, ...valueParts] = line.split('=');
      let value = valueParts.join('=').trim();
      if ((value.startsWith("'") && value.endsWith("'")) ||
          (value.startsWith('"') && value.endsWith('"'))) {
        value = value.slice(1, -1);
      }
      envVars[key.trim()] = value;
    }
    return envVars;
  } catch (e) {
    return {};
  }
}

const envFile = loadEnvFile();

function getEnvVar(key) {
  return process.env[key] || envFile[key];
}

// Model configuration
const MODELS = {
  fast: 'claude-haiku-4-5-20251001',
  quality: 'claude-sonnet-4-20250514',
};

// Keywords that require the quality model
const REQUIRES_SONNET = {
  complex: /mobile home park|apartment complex|senior living|assisted living|condominium|townhouse|multi-family/i,
};

// ANSI colors
const green = '\x1b[32m';
const yellow = '\x1b[33m';
const red = '\x1b[31m';
const cyan = '\x1b[36m';
const dim = '\x1b[2m';
const bold = '\x1b[1m';
const reset = '\x1b[0m';

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes('--dry-run'),
    reclassifyAll: args.includes('--reclassify-all'),
    verbose: args.includes('--verbose') || args.includes('-v'),
    limit: args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : 100,
    help: args.includes('--help') || args.includes('-h'),
  };
}

/**
 * Gather context for a place from linked notes and requests
 */
async function gatherPlaceContext(pool, place) {
  const context = {
    linked_google_notes: [],
    linked_requests: [],
    linked_people: [],
    cat_count: 0,
    has_children: false,
    child_count: 0,
  };

  // 1. Get linked Google Maps notes
  const googleNotes = await pool.query(`
    SELECT
      kml_name,
      original_content,
      ai_summary
    FROM ops.google_map_entries
    WHERE (place_id = $1 OR linked_place_id = $1)
      AND (original_content IS NOT NULL OR ai_summary IS NOT NULL)
    ORDER BY imported_at DESC
    LIMIT 5
  `, [place.place_id]);
  context.linked_google_notes = googleNotes.rows;

  // 2. Get linked requests with notes
  const requests = await pool.query(`
    SELECT
      summary,
      requester_notes,
      internal_notes,
      estimated_cat_count
    FROM ops.requests
    WHERE place_id = $1
    ORDER BY source_created_at DESC
    LIMIT 3
  `, [place.place_id]);
  context.linked_requests = requests.rows;

  // 3. Get linked people
  const people = await pool.query(`
    SELECT
      sp.display_name,
      sp.notes
    FROM sot.person_place_relationships ppr
    JOIN sot.people sp ON sp.person_id = ppr.person_id
    WHERE ppr.place_id = $1
      AND sp.merged_into_person_id IS NULL
    LIMIT 5
  `, [place.place_id]);
  context.linked_people = people.rows;

  // 4. Check for child places (units)
  const children = await pool.query(`
    SELECT COUNT(*) as count
    FROM sot.places
    WHERE parent_place_id = $1
      AND merged_into_place_id IS NULL
  `, [place.place_id]);
  context.has_children = parseInt(children.rows[0].count) > 0;
  context.child_count = parseInt(children.rows[0].count);

  // 5. Get cat count
  const cats = await pool.query(`
    SELECT COUNT(DISTINCT cat_id) as count
    FROM sot.cat_place_relationships
    WHERE place_id = $1
  `, [place.place_id]);
  context.cat_count = parseInt(cats.rows[0].count);

  return context;
}

/**
 * Build the AI prompt for place type classification
 */
function buildClassificationPrompt(place, context) {
  let contextSection = '';

  // Add linked notes
  if (context.linked_google_notes.length > 0) {
    contextSection += `\nLINKED GOOGLE MAPS NOTES:\n`;
    for (const note of context.linked_google_notes) {
      contextSection += `- Name: "${note.kml_name || 'N/A'}"\n`;
      if (note.ai_summary) {
        contextSection += `  Summary: ${note.ai_summary}\n`;
      } else if (note.original_content) {
        contextSection += `  Content: ${note.original_content.substring(0, 300)}...\n`;
      }
    }
  }

  // Add request notes
  if (context.linked_requests.length > 0) {
    contextSection += `\nLINKED REQUESTS:\n`;
    for (const req of context.linked_requests) {
      contextSection += `- Summary: ${req.summary || 'N/A'}\n`;
      if (req.requester_notes) {
        contextSection += `  Notes: ${req.requester_notes.substring(0, 200)}...\n`;
      }
      if (req.estimated_cat_count) {
        contextSection += `  Cat Count: ${req.estimated_cat_count}\n`;
      }
    }
  }

  // Add people context
  if (context.linked_people.length > 0) {
    contextSection += `\nLINKED PEOPLE:\n`;
    for (const person of context.linked_people) {
      contextSection += `- ${person.display_name}\n`;
      if (person.notes) {
        contextSection += `  Notes: ${person.notes.substring(0, 150)}...\n`;
      }
    }
  }

  // Add hierarchy info
  if (context.has_children) {
    contextSection += `\nPLACE HIERARCHY:\n`;
    contextSection += `- This place has ${context.child_count} child unit(s) in the database\n`;
  }

  if (place.parent_place_id) {
    contextSection += `- This is a CHILD place (has parent_place_id)\n`;
  }

  contextSection += `\nSTATISTICS:\n`;
  contextSection += `- Cats linked: ${context.cat_count}\n`;

  return `You are classifying property types for a TNR (Trap-Neuter-Return) database.
Your classification affects how data is displayed and linked on the map.

=== PLACE TO CLASSIFY ===
Address: ${place.formatted_address}
Unit Identifier: ${place.unit_identifier || 'none'}
Current place_kind: ${place.place_kind || 'unknown'}
Has parent place: ${place.parent_place_id ? 'yes' : 'no'}
${contextSection}

=== CLASSIFICATION RULES ===

ADDRESS PATTERN CLUES:
- "Apt", "#", "Unit", "Suite", "Bldg" in address → apartment_unit
- Just street number (no unit) but known apartment complex → apartment_building
- "Space", "Lot", "Site" + park-like context → mobile_home_space
- Park names like "Coddingtown Park", "Valley Mobile Estates" → mobile_home_park
- "Ranch", "Acres", "Farm", rural road names → ranch_property
- Business names, "LLC", "Inc", storefront-like → commercial
- Parks, creeks, nature areas, outdoor descriptions → outdoor_site
- Standard house address with no indicators → single_family

PARENT vs UNIT CLASSIFICATION:
- If address has unit designator AND this has a parent → apartment_unit or mobile_home_space
- If address has NO unit AND has child places → apartment_building or mobile_home_park
- If notes mention "spaces", "units", "apartments" but address has no unit → parent building/park

IMPORTANT:
- Most addresses in Sonoma County are single_family homes
- Only classify as apartment/mobile_home if there's clear evidence
- Use linked notes to help disambiguate (mentions of "neighbors", "other units", "spaces")
- If already has child places in database, it's definitely a parent (apartment_building or mobile_home_park)

=== RESPOND WITH ONLY VALID JSON ===
{
  "place_type": "single_family" | "apartment_building" | "apartment_unit" | "mobile_home_park" | "mobile_home_space" | "ranch_property" | "commercial" | "outdoor_site" | "unknown",
  "is_multi_unit_parent": boolean,
  "unit_count_estimate": number or null,
  "property_size": "small" | "medium" | "large" | "unknown",
  "confidence": 0.0 to 1.0,
  "reasoning": "One sentence explaining your classification",
  "evidence": ["list of specific evidence points from address/notes"]
}`;
}

/**
 * Determine which model to use
 */
function selectModel(place, context) {
  const content = (place.formatted_address || '') +
    ' ' + (place.unit_identifier || '') +
    ' ' + context.linked_google_notes.map(n => n.original_content || n.ai_summary || '').join(' ');

  if (REQUIRES_SONNET.complex.test(content)) {
    return { model: MODELS.quality, reason: 'complex_property_type' };
  }

  // Use Haiku for most classifications
  return { model: MODELS.fast, reason: 'standard' };
}

/**
 * Call Claude API for classification
 */
async function classifyWithClaude(anthropic, prompt, model) {
  const response = await anthropic.messages.create({
    model,
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }],
  });

  // Extract JSON from response
  const text = response.content[0]?.text || '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON found in response');
  }

  const result = JSON.parse(jsonMatch[0]);

  return {
    result,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

/**
 * Save classification to database
 */
async function saveClassification(pool, placeId, classification, dryRun) {
  if (dryRun) {
    return;
  }

  // Map place_type to place_kind enum values
  const placeKindMapping = {
    'single_family': 'residential_house',
    'apartment_building': 'apartment_building',
    'apartment_unit': 'apartment_unit',
    'mobile_home_park': 'mobile_home_park',
    'mobile_home_space': 'mobile_home_space',
    'ranch_property': 'outdoor_site',  // Map to existing enum value
    'commercial': 'business',
    'outdoor_site': 'outdoor_site',
    'unknown': 'unknown',
  };

  const placeKind = placeKindMapping[classification.place_type] || 'unknown';

  await pool.query(`
    UPDATE sot.places
    SET
      place_kind = $2,
      ai_classification = jsonb_set(
        COALESCE(ai_classification, '{}'::jsonb),
        '{place_type_classification}',
        $3::jsonb
      ),
      ai_classified_at = NOW()
    WHERE place_id = $1
      AND (place_kind IS NULL OR place_kind = 'unknown' OR place_kind != $2)
  `, [placeId, placeKind, JSON.stringify(classification)]);
}

async function main() {
  const options = parseArgs();

  if (options.help) {
    console.log(`
Usage: node scripts/jobs/classify_place_types.mjs [options]

Options:
  --limit N          Process up to N places (default: 100)
  --dry-run          Preview without saving to database
  --reclassify-all   Re-classify already processed places
  --verbose          Show detailed output
  --help             Show this help
    `);
    return;
  }

  console.log('='.repeat(60));
  console.log('Place Type Classification');
  console.log('='.repeat(60));
  console.log(`Limit: ${options.limit} | Dry Run: ${options.dryRun} | Reclassify All: ${options.reclassifyAll}`);
  console.log('');

  const pool = new Pool({ connectionString: getEnvVar('DATABASE_URL') });
  const anthropic = new Anthropic({ apiKey: getEnvVar('ANTHROPIC_API_KEY') });

  let processed = 0;
  let classified = 0;
  let errors = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  try {
    // Query places that need classification
    const whereClause = options.reclassifyAll
      ? '1=1'
      : `(p.place_kind IS NULL OR p.place_kind = 'unknown')
         AND p.ai_classified_at IS NULL`;

    const query = `
      SELECT
        p.place_id,
        p.formatted_address,
        p.unit_identifier,
        p.place_kind,
        p.parent_place_id
      FROM sot.places p
      WHERE ${whereClause}
        AND p.merged_into_place_id IS NULL
        AND p.formatted_address IS NOT NULL
      ORDER BY
        CASE WHEN p.place_kind IS NULL THEN 0 ELSE 1 END,
        p.created_at DESC
      LIMIT $1
    `;

    const result = await pool.query(query, [options.limit]);
    console.log(`Found ${result.rows.length} places to classify\n`);

    for (const place of result.rows) {
      processed++;

      try {
        // Gather context
        const context = await gatherPlaceContext(pool, place);

        // Build prompt
        const prompt = buildClassificationPrompt(place, context);

        // Select model
        const { model, reason } = selectModel(place, context);

        if (options.verbose) {
          console.log(`\n${dim}Processing: ${place.formatted_address}${reset}`);
          console.log(`${dim}Model: ${model} (${reason})${reset}`);
        }

        // Call Claude
        const { result: classification, inputTokens, outputTokens } = await classifyWithClaude(anthropic, prompt, model);

        totalInputTokens += inputTokens;
        totalOutputTokens += outputTokens;

        // Display result
        const typeColor = classification.place_type.includes('apartment') || classification.place_type.includes('mobile_home')
          ? yellow
          : green;

        console.log(
          `${typeColor}${classification.place_type.padEnd(18)}${reset} ` +
          `${dim}(${(classification.confidence * 100).toFixed(0)}%)${reset} ` +
          `${place.formatted_address.substring(0, 50)}`
        );

        if (options.verbose) {
          console.log(`  ${dim}Reasoning: ${classification.reasoning}${reset}`);
          if (classification.evidence?.length) {
            console.log(`  ${dim}Evidence: ${classification.evidence.join(', ')}${reset}`);
          }
        }

        // Save to database
        await saveClassification(pool, place.place_id, classification, options.dryRun);
        classified++;

      } catch (err) {
        console.log(`${red}ERROR${reset} ${place.formatted_address}: ${err.message}`);
        errors++;
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));
    console.log(`Processed: ${processed}`);
    console.log(`Classified: ${classified}`);
    console.log(`Errors: ${errors}`);
    console.log(`Input tokens: ${totalInputTokens.toLocaleString()}`);
    console.log(`Output tokens: ${totalOutputTokens.toLocaleString()}`);

    // Cost estimate (Haiku: $1/$5 per MTok, Sonnet: $3/$15 per MTok)
    const estimatedCost = (totalInputTokens * 1 + totalOutputTokens * 5) / 1_000_000;
    console.log(`Estimated cost: $${estimatedCost.toFixed(4)}`);

    if (options.dryRun) {
      console.log(`\n${yellow}DRY RUN - no changes saved${reset}`);
    }

  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
