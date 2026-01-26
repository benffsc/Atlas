#!/usr/bin/env node
/**
 * Classify Google Map Entries - Enhanced with Database Context
 * =============================================================
 *
 * Uses Claude with FULL DATABASE CONTEXT to intelligently classify
 * and enrich Google Maps entries by:
 *
 * 1. Looking up nearby Atlas places (within 200m)
 * 2. Matching phone numbers to existing people
 * 3. Matching names to existing people
 * 4. Finding related cats and requests
 * 5. Extracting location references that link to other places
 *
 * Usage:
 *   node scripts/jobs/classify_google_map_entries.mjs [options]
 *
 * Options:
 *   --limit N         Process up to N entries (default: 100)
 *   --dry-run         Preview without saving to database
 *   --reclassify-all  Re-classify already processed entries
 *   --verbose         Show database context being provided
 *   --help            Show help
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
      // Remove surrounding quotes
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

// Get env var with fallback to .env file
function getEnvVar(key) {
  return process.env[key] || envFile[key];
}

// Model configuration - Hybrid approach
const MODELS = {
  fast: 'claude-haiku-4-5-20251001',     // Haiku 4.5 - $1/$5 per MTok, good for routine entries
  quality: 'claude-sonnet-4-20250514',   // Sonnet 4 - higher quality for complex/critical entries
};

// Keywords that require the quality model
const REQUIRES_SONNET = {
  disease: /felv|fiv|leukemia|feline aids|positive|infected|contagious/i,
  safety: /hostile|aggressive|dangerous|do not|threat|violent|weapon|gun|knife/i,
  complex: /deceased|passed away|died|husband|wife|spouse|widow|inherited|took over/i,
};

// ANSI colors
const green = '\x1b[32m';
const yellow = '\x1b[33m';
const red = '\x1b[31m';
const cyan = '\x1b[36m';
const dim = '\x1b[2m';
const bold = '\x1b[1m';
const reset = '\x1b[0m';
const blue = '\x1b[34m';

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
 * Gather context from Atlas database for this entry
 */
async function gatherDatabaseContext(pool, entry) {
  const context = {
    nearby_places: [],
    matching_people: [],
    nearby_cats: [],
    nearby_requests: [],
    matching_phones: [],
  };

  // 1. Find nearby Atlas places (within 200m)
  if (entry.lat && entry.lng) {
    const nearbyPlaces = await pool.query(`
      SELECT
        p.place_id::text,
        p.formatted_address,
        p.service_zone,
        COALESCE(cc.cat_count, 0) as cat_count,
        ST_Distance(
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
          p.location::geography
        )::int as distance_m
      FROM trapper.places p
      LEFT JOIN (
        SELECT place_id, COUNT(DISTINCT cat_id) as cat_count
        FROM trapper.cat_place_relationships
        GROUP BY place_id
      ) cc ON cc.place_id = p.place_id
      WHERE p.merged_into_place_id IS NULL
        AND p.location IS NOT NULL
        AND ST_DWithin(
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
          p.location::geography,
          200
        )
      ORDER BY distance_m
      LIMIT 5
    `, [entry.lng, entry.lat]);
    context.nearby_places = nearbyPlaces.rows;
  }

  // 2. Extract phone numbers from text and look them up
  const phoneRegex = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
  const phones = (entry.original_content || '').match(phoneRegex) || [];

  if (phones.length > 0) {
    for (const phone of phones.slice(0, 3)) {
      const normalized = phone.replace(/\D/g, '');
      const matchingPeople = await pool.query(`
        SELECT DISTINCT
          p.person_id::text,
          p.display_name,
          p.primary_email,
          ARRAY_AGG(DISTINCT pr.trapper_type) FILTER (WHERE pr.trapper_type IS NOT NULL) as roles
        FROM trapper.sot_people p
        JOIN trapper.person_identifiers pi ON pi.person_id = p.person_id
        LEFT JOIN trapper.person_roles pr ON pr.person_id = p.person_id AND pr.ended_at IS NULL
        WHERE pi.id_type = 'phone'
          AND pi.id_value_norm = $1
        GROUP BY p.person_id, p.display_name, p.primary_email
        LIMIT 1
      `, [normalized]);

      if (matchingPeople.rows.length > 0) {
        context.matching_phones.push({
          phone_found: phone,
          person: matchingPeople.rows[0]
        });
      }
    }
  }

  // 3. Look for name matches (extract potential names and search)
  const nameRegex = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/g;
  const potentialNames = (entry.original_content || '').match(nameRegex) || [];
  const kmlName = entry.kml_name || '';

  // Add KML name as potential match
  if (kmlName && !potentialNames.includes(kmlName)) {
    potentialNames.unshift(kmlName);
  }

  for (const name of potentialNames.slice(0, 3)) {
    // Skip common non-name phrases
    if (/^(Spay|Neuter|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December)/i.test(name)) continue;

    const matchingPeople = await pool.query(`
      SELECT
        p.person_id::text,
        p.display_name,
        p.primary_email,
        ARRAY_AGG(DISTINCT pr.trapper_type) FILTER (WHERE pr.trapper_type IS NOT NULL) as roles,
        similarity(p.display_name, $1) as name_similarity
      FROM trapper.sot_people p
      LEFT JOIN trapper.person_roles pr ON pr.person_id = p.person_id AND pr.ended_at IS NULL
      WHERE similarity(p.display_name, $1) > 0.4
      GROUP BY p.person_id, p.display_name, p.primary_email
      ORDER BY similarity(p.display_name, $1) DESC
      LIMIT 2
    `, [name]);

    if (matchingPeople.rows.length > 0) {
      context.matching_people.push({
        name_searched: name,
        matches: matchingPeople.rows
      });
    }
  }

  // 4. Find cats linked to nearby places
  if (context.nearby_places.length > 0) {
    const placeIds = context.nearby_places.map(p => p.place_id);
    const nearbyCats = await pool.query(`
      SELECT
        c.cat_id::text,
        c.display_name,
        c.altered_status,
        c.primary_color,
        p.formatted_address
      FROM trapper.sot_cats c
      JOIN trapper.cat_place_relationships cpr ON cpr.cat_id = c.cat_id
      JOIN trapper.places p ON p.place_id = cpr.place_id
      WHERE cpr.place_id = ANY($1::uuid[])
      LIMIT 10
    `, [placeIds]);
    context.nearby_cats = nearbyCats.rows;
  }

  // 5. Find active requests at nearby places
  if (context.nearby_places.length > 0) {
    const placeIds = context.nearby_places.map(p => p.place_id);
    const nearbyRequests = await pool.query(`
      SELECT
        r.request_id::text,
        r.summary,
        r.status,
        r.estimated_cat_count,
        p.formatted_address
      FROM trapper.sot_requests r
      JOIN trapper.places p ON p.place_id = r.place_id
      WHERE r.place_id = ANY($1::uuid[])
        AND r.status IN ('new', 'triaged', 'scheduled', 'in_progress')
      LIMIT 5
    `, [placeIds]);
    context.nearby_requests = nearbyRequests.rows;
  }

  return context;
}

/**
 * Build the AI prompt with database context
 */
function buildPromptWithContext(entry, dbContext) {
  // Clean up HTML artifacts
  const cleanContent = (entry.original_content || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();

  let contextSection = '';

  // Add nearby places context
  if (dbContext.nearby_places.length > 0) {
    contextSection += `\n\nNEARBY ATLAS PLACES (within 200m of this pin):
${dbContext.nearby_places.map(p => `- ${p.formatted_address} (${p.distance_m}m away, ${p.cat_count} cats linked, zone: ${p.service_zone || 'unknown'})`).join('\n')}`;
  }

  // Add phone match context
  if (dbContext.matching_phones.length > 0) {
    contextSection += `\n\nPHONE NUMBERS FOUND - MATCHED TO ATLAS PEOPLE:
${dbContext.matching_phones.map(m => `- "${m.phone_found}" → ${m.person.display_name}${m.person.roles?.length ? ` (${m.person.roles.join(', ')})` : ''}`).join('\n')}`;
  }

  // Add name match context
  if (dbContext.matching_people.length > 0) {
    contextSection += `\n\nPOTENTIAL NAME MATCHES IN ATLAS:
${dbContext.matching_people.map(m =>
  `- "${m.name_searched}" may match: ${m.matches.map(p => `${p.display_name} (${(p.name_similarity * 100).toFixed(0)}% match${p.roles?.length ? `, ${p.roles.join('/')}` : ''})`).join(' or ')}`
).join('\n')}`;
  }

  // Add nearby cats context
  if (dbContext.nearby_cats.length > 0) {
    contextSection += `\n\nCATS LINKED TO NEARBY PLACES:
${dbContext.nearby_cats.slice(0, 5).map(c => `- ${c.display_name || 'Unnamed'} (${c.altered_status}, ${c.primary_color || 'unknown color'}) at ${c.formatted_address}`).join('\n')}`;
  }

  // Add active requests context
  if (dbContext.nearby_requests.length > 0) {
    contextSection += `\n\nACTIVE REQUESTS AT NEARBY PLACES:
${dbContext.nearby_requests.map(r => `- [${r.status}] "${r.summary}" (~${r.estimated_cat_count || '?'} cats) at ${r.formatted_address}`).join('\n')}`;
  }

  return `You are analyzing a historical Google Maps pin from Forgotten Felines of Sonoma County (FFSC).
Your job is to CLASSIFY the entry and EXTRACT structured data that can enrich our database.

${contextSection ? `=== ATLAS DATABASE CONTEXT ===${contextSection}\n\nUse this context to:
- Confirm person identities (if phone/name matches, note the person_id)
- Link to nearby places if this pin is about the same location
- Note if cats mentioned might match existing records
- Flag if there's already an active request at this location
- IMPORTANT: If the pin references a DIFFERENT person than who's linked to the nearby place,
  this may indicate a family/spousal relationship or succession (e.g., spouse took over after death).
  Note this in "relationship_notes" - the historical context is valuable but should NOT create duplicates.` : ''}

=== ENTRY TO ANALYZE ===
Pin Name: ${entry.kml_name || '(no name)'}
Coordinates: ${entry.lat}, ${entry.lng}
Content:
${cleanContent}

=== CLASSIFICATION RULES ===
IMPORTANT CONTEXT RULES:
- "FeLV Neg" or "tested negative" = NOT a disease risk
- Only disease_risk for ACTUAL ongoing risks (positive status, proximity to positive colony)
- Read the full context - historical resolved cases are NOT current risks

CRITICAL - INTERPRETING CAT COUNTS:
- "1000s of cats", "hundreds of cats", "tons of cats" = METAPHOR meaning "many cats" → use null or ~10-20
- "dozens of cats", "a lot of cats" = METAPHOR meaning "many" → use null or ~10-15
- Only use exact numbers when LITERALLY stated (e.g., "we trapped 8 cats")
- Community cat colonies rarely exceed 30-40 cats. Numbers >50 are almost certainly metaphorical
- When uncertain, use NULL rather than an inflated number

CLASSIFICATION TYPES (choose the MOST APPROPRIATE):
1. disease_risk - Active FeLV/FIV positive, current disease outbreak, proximity to known positive colony
2. watch_list - Difficult/hostile person, safety concerns, "do not contact"
3. felv_colony - Location with multiple FeLV-positive cats currently
4. fiv_colony - Location with multiple FIV-positive cats currently
5. volunteer - Person explicitly described as volunteer, trapper, feeder, community helper
6. relocation_client - Takes cats for barn/farm placement
7. active_colony - Active feeding colony with ongoing care
8. historical_colony - Past/resolved cases, old information
9. contact_info - Primarily contact details without meaningful activity
10. unclassified - Cannot determine

=== RESPOND WITH ONLY VALID JSON ===
{
  "primary_meaning": "one of the 10 types",
  "confidence": 0.0 to 1.0,
  "reasoning": "One sentence explaining your classification",

  "signals": {
    "disease_mentions": ["ONLY actual risks, not negative results"] or null,
    "disease_status": "positive_active" | "positive_historical" | "negative" | "proximity_risk" | null,
    "safety_concerns": ["exact concerning text"] or null,
    "cat_count": number or null,
    "colony_status": "active" | "resolved" | "unknown"
  },

  "entity_links": {
    "person_id": "UUID if phone/name confidently matches an Atlas person" or null,
    "person_confidence": "high" | "medium" | "low" or null,
    "place_id": "UUID if this pin is about a nearby Atlas place" or null,
    "place_confidence": "high" | "medium" | "low" or null,
    "is_same_as_nearby_place": boolean
  },

  "extracted_people": [
    {
      "name": "full name",
      "phone": "phone if found",
      "role": "volunteer" | "trapper" | "client" | "caretaker" | null,
      "atlas_person_id": "UUID if matches" or null
    }
  ] or null,

  "location_references": [
    {
      "address_text": "mentioned address or location",
      "relationship": "source" | "destination" | "nearby_risk" | "related" | "same_colony",
      "context": "brief quote showing the relationship"
    }
  ] or null,

  "relationship_notes": "If pin person differs from current Atlas person at same address, note the relationship (e.g., 'Bob Collinsworth appears to be predecessor/spouse of Jean Worthey who now manages this location')" or null,

  "staff_alert_text": "Brief warning if disease_risk or watch_list" or null
}`;
}

/**
 * Determine which model to use based on content complexity
 */
function selectModel(entry, dbContext) {
  const content = (entry.original_content || '') + ' ' + (entry.kml_name || '');

  // Check for keywords requiring Sonnet
  if (REQUIRES_SONNET.disease.test(content)) {
    return { model: MODELS.quality, reason: 'disease_keywords' };
  }
  if (REQUIRES_SONNET.safety.test(content)) {
    return { model: MODELS.quality, reason: 'safety_keywords' };
  }
  if (REQUIRES_SONNET.complex.test(content)) {
    return { model: MODELS.quality, reason: 'complex_relationship' };
  }

  // Only escalate for name conflicts when there's a HIGH confidence phone match
  // to a DIFFERENT person than the KML name (indicates potential family relationship)
  if (dbContext.matching_phones.length > 0 && entry.kml_name) {
    const kmlNameLower = entry.kml_name.toLowerCase().split(' ')[0];
    const phoneMatchedPerson = dbContext.matching_phones[0]?.person?.display_name?.toLowerCase() || '';
    // Only escalate if phone matches a person with a completely different first name
    if (phoneMatchedPerson && !phoneMatchedPerson.includes(kmlNameLower) && !kmlNameLower.includes(phoneMatchedPerson.split(' ')[0])) {
      return { model: MODELS.quality, reason: 'phone_name_mismatch' };
    }
  }

  // Default to fast model
  return { model: MODELS.fast, reason: 'routine' };
}

async function classifyEntry(anthropic, pool, entry, options) {
  // Gather database context
  const dbContext = await gatherDatabaseContext(pool, entry);

  if (options.verbose) {
    console.log(`\n${dim}  Context: ${dbContext.nearby_places.length} nearby places, ${dbContext.matching_phones.length} phone matches, ${dbContext.matching_people.length} name matches${reset}`);
  }

  // Build prompt with context
  const prompt = buildPromptWithContext(entry, dbContext);

  // Skip very short content
  const cleanContent = (entry.original_content || '').replace(/<[^>]+>/g, '').trim();
  if (cleanContent.length < 10) {
    return {
      primary_meaning: 'unclassified',
      confidence: 0.1,
      reasoning: 'Content too short to classify',
      signals: { colony_status: 'unknown' },
      entity_links: {},
      extracted_people: null,
      location_references: null,
      staff_alert_text: null,
      _model_used: 'none'
    };
  }

  // Select model based on content
  const { model, reason } = selectModel(entry, dbContext);

  try {
    const response = await anthropic.messages.create({
      model: model,
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt + '\n\nRespond with ONLY the JSON object.' }]
    });

    const responseText = response.content[0]?.text?.trim();

    try {
      let jsonText = responseText;
      if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
      }

      const classification = JSON.parse(jsonText);

      // Validate and fill defaults
      if (!classification.primary_meaning) classification.primary_meaning = 'unclassified';
      if (typeof classification.confidence !== 'number') classification.confidence = 0.5;
      if (!classification.signals) classification.signals = { colony_status: 'unknown' };
      if (!classification.entity_links) classification.entity_links = {};

      // Track which model was used
      classification._model_used = model === MODELS.fast ? 'haiku' : 'sonnet';
      classification._model_reason = reason;

      // ESCALATION CHECK: If Haiku returned suspicious results, retry with Sonnet
      if (model === MODELS.fast) {
        const needsEscalation =
          // Suspiciously high cat count (likely metaphor misread)
          (classification.signals?.cat_count && classification.signals.cat_count > 50) ||
          // Low confidence on critical classifications
          (classification.confidence < 0.6 && ['disease_risk', 'watch_list', 'felv_colony', 'fiv_colony'].includes(classification.primary_meaning)) ||
          // Disease classification with low confidence
          (classification.primary_meaning === 'disease_risk' && classification.confidence < 0.85);

        if (needsEscalation) {
          if (options.verbose) {
            console.log(`\n${yellow}  ↑ Escalating to Sonnet (${classification.signals?.cat_count ? 'high cat count' : 'low confidence on critical'})${reset}`);
          }
          // Retry with Sonnet
          const sonnetResponse = await anthropic.messages.create({
            model: MODELS.quality,
            max_tokens: 1200,
            messages: [{ role: 'user', content: prompt + '\n\nRespond with ONLY the JSON object.' }]
          });

          const sonnetText = sonnetResponse.content[0]?.text?.trim();
          let sonnetJson = sonnetText;
          if (sonnetJson.startsWith('```')) {
            sonnetJson = sonnetJson.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
          }
          const sonnetClassification = JSON.parse(sonnetJson);

          // Use Sonnet result
          if (!sonnetClassification.primary_meaning) sonnetClassification.primary_meaning = 'unclassified';
          if (typeof sonnetClassification.confidence !== 'number') sonnetClassification.confidence = 0.5;
          if (!sonnetClassification.signals) sonnetClassification.signals = { colony_status: 'unknown' };
          if (!sonnetClassification.entity_links) sonnetClassification.entity_links = {};

          sonnetClassification._model_used = 'sonnet_escalated';
          sonnetClassification._model_reason = `escalated_from_haiku_${classification.signals?.cat_count > 50 ? 'high_count' : 'low_confidence'}`;
          return sonnetClassification;
        }
      }

      return classification;
    } catch (parseErr) {
      console.error(`${red}JSON parse error:${reset}`, parseErr.message);
      return {
        primary_meaning: 'unclassified',
        confidence: 0.1,
        reasoning: 'Failed to parse AI response',
        signals: { colony_status: 'unknown' },
        entity_links: {},
        _parse_error: parseErr.message
      };
    }
  } catch (err) {
    console.error(`${red}API error:${reset}`, err.message);
    return {
      primary_meaning: 'unclassified',
      confidence: 0.0,
      reasoning: 'API error',
      signals: { colony_status: 'unknown' },
      entity_links: {},
      _api_error: err.message
    };
  }
}

async function main() {
  const options = parseArgs();

  if (options.help) {
    console.log(`
${bold}Classify Google Map Entries - Enhanced${reset}

Uses AI with FULL DATABASE CONTEXT to classify and enrich entries.
The AI can see nearby Atlas places, match phone numbers to people,
and create intelligent entity links.

Usage: node scripts/jobs/classify_google_map_entries.mjs [options]

Options:
  --limit N           Process up to N entries (default: 100)
  --dry-run           Preview without saving
  --reclassify-all    Re-classify already processed entries
  --verbose, -v       Show database context being provided
  --help              Show this help

Database Context Provided to AI:
  • Nearby Atlas places (within 200m)
  • Phone number matches to existing people
  • Name similarity matches to existing people
  • Cats linked to nearby places
  • Active requests at nearby places
`);
    process.exit(0);
  }

  console.log(`\n${bold}Classify Google Map Entries${reset} ${cyan}(Enhanced with Database Context)${reset}`);
  console.log('═'.repeat(60));

  if (options.dryRun) console.log(`${yellow}DRY RUN MODE${reset}\n`);
  if (options.reclassifyAll) console.log(`${yellow}RECLASSIFY ALL MODE${reset}\n`);
  if (options.verbose) console.log(`${blue}VERBOSE MODE${reset}\n`);

  if (!getEnvVar('DATABASE_URL')) {
    console.error(`${red}Error:${reset} DATABASE_URL not set`);
    process.exit(1);
  }

  if (!getEnvVar('ANTHROPIC_API_KEY')) {
    console.error(`${red}Error:${reset} ANTHROPIC_API_KEY not set`);
    process.exit(1);
  }

  const pool = new Pool({ connectionString: getEnvVar('DATABASE_URL') });
  const anthropic = new Anthropic({ apiKey: getEnvVar('ANTHROPIC_API_KEY') });

  try {
    // Ensure pg_trgm extension for name similarity
    await pool.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');

    const whereClause = options.reclassifyAll
      ? 'WHERE original_content IS NOT NULL'
      : 'WHERE ai_classified_at IS NULL AND original_content IS NOT NULL';

    const query = `
      SELECT entry_id, original_content, kml_name, lat, lng
      FROM trapper.google_map_entries
      ${whereClause}
      ORDER BY
        CASE
          WHEN original_content ILIKE '%felv%' OR original_content ILIKE '%fiv%' THEN 0
          WHEN original_content ILIKE '%hostile%' OR original_content ILIKE '%difficult%' THEN 1
          ELSE 2
        END,
        LENGTH(original_content) DESC
      LIMIT $1
    `;

    const result = await pool.query(query, [options.limit]);
    console.log(`${cyan}Found:${reset} ${result.rows.length} entries to process\n`);

    if (result.rows.length === 0) {
      console.log(`${green}All entries already classified!${reset}`);
      return;
    }

    const stats = {
      processed: 0,
      classified: 0,
      disease_risks: 0,
      watch_list: 0,
      person_links: 0,
      place_links: 0,
      errors: 0,
      haiku_used: 0,
      sonnet_used: 0,
      sonnet_escalated: 0,
    };

    const classificationCounts = {};

    for (const row of result.rows) {
      stats.processed++;
      process.stdout.write(`  [${stats.processed}/${result.rows.length}] `);

      const classification = await classifyEntry(anthropic, pool, row, options);

      const meaning = classification.primary_meaning;
      classificationCounts[meaning] = (classificationCounts[meaning] || 0) + 1;

      if (['disease_risk', 'felv_colony', 'fiv_colony'].includes(meaning)) {
        stats.disease_risks++;
      }
      if (meaning === 'watch_list') {
        stats.watch_list++;
      }
      if (classification.entity_links?.person_id) {
        stats.person_links++;
      }
      if (classification.entity_links?.place_id) {
        stats.place_links++;
      }

      // Track model usage
      if (classification._model_used === 'haiku') stats.haiku_used++;
      else if (classification._model_used === 'sonnet') stats.sonnet_used++;
      else if (classification._model_used === 'sonnet_escalated') stats.sonnet_escalated++;

      // Color output
      let color = reset;
      if (meaning === 'disease_risk' || meaning === 'felv_colony') color = red;
      else if (meaning === 'watch_list') color = yellow;
      else if (meaning === 'volunteer') color = cyan;
      else if (meaning === 'active_colony') color = green;
      else if (meaning === 'unclassified') color = dim;

      if (classification._api_error || classification._parse_error) {
        console.log(`${red}error${reset}`);
        stats.errors++;
        continue;
      }

      const linkInfo = [];
      if (classification.entity_links?.person_id) linkInfo.push(`👤 person`);
      if (classification.entity_links?.place_id) linkInfo.push(`📍 place`);
      const linkStr = linkInfo.length > 0 ? ` ${blue}[${linkInfo.join(', ')}]${reset}` : '';

      // Model indicator
      const modelIndicator = classification._model_used === 'haiku' ? `${dim}[H]${reset}` :
                             classification._model_used === 'sonnet' ? `${cyan}[S]${reset}` :
                             classification._model_used === 'sonnet_escalated' ? `${yellow}[S↑]${reset}` : '';

      if (options.dryRun) {
        console.log(`${modelIndicator} ${color}${meaning}${reset} (${(classification.confidence * 100).toFixed(0)}%)${linkStr}`);
        if (options.verbose && classification.reasoning) {
          console.log(`${dim}    → ${classification.reasoning}${reset}`);
        }
      } else {
        // Validate UUIDs before saving (AI sometimes returns addresses instead)
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const personId = classification.entity_links?.person_id;
        const placeId = classification.entity_links?.place_id;

        const validPersonId = personId && uuidRegex.test(personId) ? personId : null;
        const validPlaceId = placeId && uuidRegex.test(placeId) ? placeId : null;

        // Save to database
        await pool.query(`
          UPDATE trapper.google_map_entries SET
            ai_classification = $1,
            ai_meaning = $2,
            ai_classified_at = NOW(),
            linked_person_id = $3,
            linked_place_id = $4,
            link_confidence = $5,
            link_method = $6
          WHERE entry_id = $7
        `, [
          JSON.stringify(classification),
          classification.primary_meaning,
          validPersonId,
          validPlaceId,
          validPersonId ? (classification.entity_links?.person_confidence === 'high' ? 0.95 :
            classification.entity_links?.person_confidence === 'medium' ? 0.75 : 0.5) :
            validPlaceId ? (classification.entity_links?.place_confidence === 'high' ? 0.95 :
            classification.entity_links?.place_confidence === 'medium' ? 0.75 : 0.5) : null,
          validPersonId ? 'ai_phone_match' : validPlaceId ? 'ai_proximity' : null,
          row.entry_id
        ]);

        console.log(`${modelIndicator} ${color}${meaning}${reset} (${(classification.confidence * 100).toFixed(0)}%)${linkStr}`);
      }

      stats.classified++;
      await new Promise(r => setTimeout(r, 150)); // Rate limit
    }

    // Summary
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`${bold}Summary${reset}`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`${cyan}Processed:${reset}      ${stats.processed}`);
    console.log(`${green}Classified:${reset}     ${stats.classified}`);
    console.log(`${red}Disease Risks:${reset}  ${stats.disease_risks}`);
    console.log(`${yellow}Watch List:${reset}     ${stats.watch_list}`);
    console.log(`${blue}Person Links:${reset}   ${stats.person_links}`);
    console.log(`${blue}Place Links:${reset}    ${stats.place_links}`);
    if (stats.errors > 0) {
      console.log(`${red}Errors:${reset}         ${stats.errors}`);
    }

    // Model usage stats
    console.log(`\n${bold}Model Usage (Hybrid):${reset}`);
    console.log(`  ${dim}[H]${reset} Haiku:           ${stats.haiku_used} (routine entries)`);
    console.log(`  ${cyan}[S]${reset} Sonnet:          ${stats.sonnet_used} (disease/safety/complex)`);
    console.log(`  ${yellow}[S↑]${reset} Sonnet escalated: ${stats.sonnet_escalated} (Haiku uncertain)`);

    // Estimated cost calculation
    const haikuCost = stats.haiku_used * 0.004;  // ~$0.004 per entry avg
    const sonnetCost = (stats.sonnet_used + stats.sonnet_escalated) * 0.017;  // ~$0.017 per entry avg
    const totalCost = haikuCost + sonnetCost;
    const savingsVsAllSonnet = (stats.processed * 0.017) - totalCost;
    console.log(`\n${bold}Estimated Cost:${reset}`);
    console.log(`  Haiku:     ~$${haikuCost.toFixed(2)}`);
    console.log(`  Sonnet:    ~$${sonnetCost.toFixed(2)}`);
    console.log(`  ${green}Total:     ~$${totalCost.toFixed(2)}${reset} (saved ~$${savingsVsAllSonnet.toFixed(2)} vs all-Sonnet)`);

    console.log(`\n${bold}Classification Breakdown:${reset}`);
    for (const [type, count] of Object.entries(classificationCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${type}: ${count}`);
    }

    const remaining = await pool.query(`
      SELECT COUNT(*) as count FROM trapper.google_map_entries
      WHERE ai_classified_at IS NULL AND original_content IS NOT NULL
    `);
    console.log(`\n${cyan}Remaining:${reset}      ${remaining.rows[0].count} entries`);

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
