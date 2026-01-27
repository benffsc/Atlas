#!/usr/bin/env node
/**
 * extract_population_attributes.mjs
 *
 * TARGETED extraction for Beacon population modeling attributes.
 * Uses keyword pre-filtering to process only records likely to have population data.
 *
 * This script extracts the 12 new population modeling attributes (MIG_755):
 *   - Chapman estimator: is_recapture, was_eartipped_on_arrival, unfixed_count_observed, eartip_count_observed
 *   - Breeding: litter_size, gestational_stage, is_lactating, kitten_count_at_location
 *   - Colony context: trapping_difficulty, has_trap_shy_cats, newcomer_frequency, years_feeding
 *
 * Usage:
 *   node scripts/jobs/extract_population_attributes.mjs --limit 500 --dry-run
 *   node scripts/jobs/extract_population_attributes.mjs --limit 5000  # Full extraction
 *   node scripts/jobs/extract_population_attributes.mjs --source clinic --limit 1000
 *
 * Cost Estimate:
 *   ~5,000 keyword-matched records × ~$0.001/record (hybrid) = ~$5-7
 */

import {
  getAttributeDefinitions,
  extractAttributes,
  saveAttributes,
  logExtractionJob,
  pool,
} from "./lib/attribute-extractor.mjs";

// ============================================================
// POPULATION MODELING KEYWORDS
// These pre-filter records likely to have population data
// ============================================================

const POPULATION_KEYWORDS_REGEX = new RegExp([
  // Recapture/resight patterns
  'recapture', 'recheck', 'return', 'eartip', 'already\\s*(fixed|tipped|clipped)',
  'previously\\s*(fixed|altered)', 'came\\s+back', 'second\\s+time', 'seen\\s+before',
  // Population counts
  'unfixed', 'intact', 'unaltered', 'not\\s+fixed', 'whole\\s+cat',
  // Breeding/reproduction
  'litter', 'kitten', 'pregnant', 'lactating', 'nursing', 'milk\\s+present',
  'gestational', 'term', 'babies',
  // Colony context
  'trap\\s+shy', 'wont\\s+go', 'hard\\s+to\\s+trap', 'difficult',
  'new\\s+cats', 'keep\\s+showing', 'stable', 'same\\s+cats',
  'years?\\s+feed', 'feeding\\s+(since|for)', 'been\\s+feeding'
].join('|'), 'i');

// Population modeling attribute keys (from MIG_755)
const POPULATION_ATTRIBUTE_KEYS = [
  'is_recapture',
  'was_eartipped_on_arrival',
  'unfixed_count_observed',
  'eartip_count_observed',
  'litter_size',
  'gestational_stage',
  'is_lactating',
  'kitten_count_at_location',
  'trapping_difficulty',
  'has_trap_shy_cats',
  'newcomer_frequency',
  'years_feeding'
];

// ============================================================
// HYBRID MODEL SELECTION
// ============================================================

const MODELS = {
  fast: 'claude-haiku-4-5-20251001',
  quality: 'claude-sonnet-4-20250514',
};

// More conservative Sonnet escalation - only for truly complex cases
// Most simple extractions (single attribute) work fine with Haiku
const REQUIRES_SONNET = {
  // Multi-attribute complexity - needs reasoning across multiple facts
  complex_reproduction: /litter\s*(of|size)?\s*\d+.*(lactating|nursing)|pregnant.*(term|weeks)/i,
  // Historical context requiring inference
  historical_recapture: /previously\s+fixed.*\d|came\s+back.*years?|second\s+time.*same\s+cat/i,
  // Population counts with context
  count_with_context: /(\d+)\s*(unfixed|intact).*(eartip|tipped)|\d+.*fixed.*\d+.*unfixed/i,
  // Long-term patterns
  feeding_history: /(\d+)\s*years?\s+(feeding|feed).*colony|feeding\s+since\s+\d{4}/i,
};

function shouldUseSonnet(text) {
  return Object.values(REQUIRES_SONNET).some(pattern => pattern.test(text));
}

// Parse CLI arguments
const args = process.argv.slice(2);
const limit = parseInt(args.find((a) => a.startsWith("--limit="))?.split("=")[1] || "500");
const dryRun = args.includes("--dry-run");
const sourceFilter = args.find((a) => a.startsWith("--source="))?.split("=")[1] || "clinic";

// Model usage tracking
let haikuCount = 0;
let sonnetCount = 0;

console.log("=".repeat(60));
console.log("Population Modeling Attribute Extraction (Targeted)");
console.log("=".repeat(60));
console.log(`Source: ${sourceFilter} | Limit: ${limit} | Dry Run: ${dryRun}`);
console.log(`Target Attributes: ${POPULATION_ATTRIBUTE_KEYS.length}`);
console.log(`Hybrid Model: Haiku default, Sonnet for complex patterns`);
console.log("");

async function main() {
  const startTime = Date.now();
  let totalCost = 0;
  let recordsProcessed = 0;
  let recordsWithExtractions = 0;
  let attributesExtracted = 0;
  let recordsSkipped = 0;

  try {
    // Get only population modeling attribute definitions
    const allDefs = await getAttributeDefinitions();
    const popCatAttrs = allDefs.filter(
      (a) => a.entity_type === "cat" && POPULATION_ATTRIBUTE_KEYS.includes(a.attribute_key)
    );
    const popPlaceAttrs = allDefs.filter(
      (a) => a.entity_type === "place" && POPULATION_ATTRIBUTE_KEYS.includes(a.attribute_key)
    );

    console.log(`Loaded ${popCatAttrs.length} cat population attributes`);
    console.log(`Loaded ${popPlaceAttrs.length} place population attributes`);

    // Build query based on source
    let query;
    if (sourceFilter === "clinic") {
      // Query clinic appointments with keyword pre-filter
      query = `
        SELECT
          'clinic' as source_type,
          a.appointment_id as record_id,
          a.cat_id,
          a.medical_notes as notes,
          a.appointment_date as record_date,
          c.display_name as cat_name,
          cpr.place_id
        FROM trapper.sot_appointments a
        LEFT JOIN trapper.sot_cats c ON c.cat_id = a.cat_id
        LEFT JOIN trapper.cat_place_relationships cpr ON cpr.cat_id = a.cat_id
          AND cpr.relationship_type = 'appointment_site'
        WHERE a.medical_notes IS NOT NULL
          AND a.medical_notes != ''
          -- Keyword pre-filter for population data
          AND a.medical_notes ~* 'recapture|recheck|eartip|litter|kitten|pregnant|lactating|unfixed|intact|trap.shy|years?.feed|nursing|already.*(fixed|tipped)'
          -- Skip already-processed for population attributes
          AND NOT EXISTS (
            SELECT 1 FROM trapper.entity_attributes ea
            WHERE ea.source_record_id = a.appointment_id::TEXT
              AND ea.attribute_key = 'is_recapture'
          )
        ORDER BY a.appointment_date DESC
        LIMIT $1
      `;
    } else if (sourceFilter === "intake") {
      query = `
        SELECT
          'intake' as source_type,
          ws.submission_id::TEXT as record_id,
          NULL::UUID as cat_id,
          COALESCE(ws.notes, ws.situation_description, '') as notes,
          ws.created_at as record_date,
          NULL as cat_name,
          ws.place_id
        FROM trapper.web_intake_submissions ws
        WHERE (ws.notes IS NOT NULL AND ws.notes != '')
           OR (ws.situation_description IS NOT NULL AND ws.situation_description != '')
          -- Keyword pre-filter
          AND (ws.notes || ' ' || COALESCE(ws.situation_description, '')) ~* 'recapture|eartip|litter|kitten|pregnant|unfixed|intact|trap.shy|years?.feed|nursing'
          -- Skip already-processed
          AND NOT EXISTS (
            SELECT 1 FROM trapper.entity_attributes ea
            WHERE ea.source_record_id = ws.submission_id::TEXT
              AND ea.attribute_key IN ('unfixed_count_observed', 'eartip_count_observed')
          )
        ORDER BY ws.created_at DESC
        LIMIT $1
      `;
    } else {
      console.error(`Unknown source: ${sourceFilter}. Use --source=clinic or --source=intake`);
      process.exit(1);
    }

    const result = await pool.query(query, [limit]);
    console.log(`\nFound ${result.rows.length} records matching population keywords\n`);

    for (const record of result.rows) {
      recordsProcessed++;

      const notes = record.notes || "";
      if (!notes || notes.length < 20) {
        recordsSkipped++;
        continue;
      }

      // Double-check keyword match (in case DB regex differs slightly)
      if (!POPULATION_KEYWORDS_REGEX.test(notes)) {
        recordsSkipped++;
        continue;
      }

      // Model selection
      const useSonnet = shouldUseSonnet(notes);
      const selectedModel = useSonnet ? MODELS.quality : MODELS.fast;
      const modelIndicator = useSonnet ? '[S]' : '[H]';

      if (useSonnet) {
        sonnetCount++;
      } else {
        haikuCount++;
      }

      const sourceInfo = {
        source_system: sourceFilter === "clinic" ? "clinichq" : "web_intake",
        source_record_id: record.record_id,
        extracted_by: useSonnet ? "claude_sonnet" : "claude_haiku",
      };

      let hasExtractions = false;

      // Extract cat attributes if we have a cat_id
      if (record.cat_id && popCatAttrs.length > 0) {
        const context = {
          description: `This is a ${sourceFilter} record for a cat named "${record.cat_name || "Unknown"}". Look specifically for RECAPTURE indicators (previously seen/fixed), LACTATING status, and LITTER SIZE if this is a mom or kitten.`,
        };

        const extractionResult = await extractAttributes(notes, "cat", popCatAttrs, {
          model: selectedModel,
          context,
        });

        totalCost += extractionResult.cost;

        if (extractionResult.extractions.length > 0) {
          hasExtractions = true;

          if (!dryRun) {
            const saved = await saveAttributes(
              "cat",
              record.cat_id,
              extractionResult.extractions,
              sourceInfo
            );
            attributesExtracted += saved;
          }

          console.log(
            `${modelIndicator} [${recordsProcessed}] Cat ${record.cat_name || record.cat_id.slice(0, 8)}: ` +
              extractionResult.extractions.map((e) => e.attribute_key).join(", ")
          );
        }
      }

      // Extract place attributes if we have a place_id
      if (record.place_id && popPlaceAttrs.length > 0) {
        const context = {
          description: `This is a ${sourceFilter} record about cats at a specific location. Look for POPULATION COUNTS (unfixed cats, eartipped cats seen), TRAPPING DIFFICULTY, NEWCOMER patterns, and YEARS the feeder has been active.`,
        };

        const extractionResult = await extractAttributes(notes, "place", popPlaceAttrs, {
          model: selectedModel,
          context,
        });

        totalCost += extractionResult.cost;

        if (extractionResult.extractions.length > 0) {
          hasExtractions = true;

          if (!dryRun) {
            const saved = await saveAttributes(
              "place",
              record.place_id,
              extractionResult.extractions,
              sourceInfo
            );
            attributesExtracted += saved;
          }

          console.log(
            `${modelIndicator} [${recordsProcessed}] Place: ` +
              extractionResult.extractions.map((e) => e.attribute_key).join(", ")
          );
        }
      }

      if (hasExtractions) {
        recordsWithExtractions++;
      }

      // Progress update every 50 records
      if (recordsProcessed % 50 === 0) {
        const sonnetPct = ((sonnetCount / (haikuCount + sonnetCount)) * 100).toFixed(1);
        console.log(
          `\n--- Progress: ${recordsProcessed}/${result.rows.length} | ` +
            `Cost: $${totalCost.toFixed(4)} | Extractions: ${attributesExtracted} | ` +
            `Sonnet: ${sonnetPct}% ---\n`
        );
      }
    }

    // Log job
    const sonnetPct = (haikuCount + sonnetCount) > 0
      ? ((sonnetCount / (haikuCount + sonnetCount)) * 100).toFixed(1)
      : 0;

    if (!dryRun && recordsProcessed > 0) {
      const jobId = await logExtractionJob({
        source_system: sourceFilter === "clinic" ? "clinichq" : "web_intake",
        entity_type: "population_modeling",
        batch_size: limit,
        records_processed: recordsProcessed,
        records_with_extractions: recordsWithExtractions,
        attributes_extracted: attributesExtracted,
        model_used: `hybrid (haiku:${haikuCount}, sonnet:${sonnetCount})`,
        cost_estimate_usd: totalCost,
        notes: `Population modeling attributes (MIG_755). Keyword pre-filtered. Sonnet escalation: ${sonnetPct}%`,
      });
      console.log(`\nLogged job: ${jobId}`);
    }

    // Summary
    const duration = (Date.now() - startTime) / 1000;
    console.log("\n" + "=".repeat(60));
    console.log("SUMMARY - Population Modeling Extraction");
    console.log("=".repeat(60));
    console.log(`Records Processed: ${recordsProcessed}`);
    console.log(`Records Skipped: ${recordsSkipped}`);
    console.log(`Records with Extractions: ${recordsWithExtractions} (${recordsProcessed > 0 ? ((recordsWithExtractions / recordsProcessed) * 100).toFixed(1) : 0}%)`);
    console.log(`Attributes Extracted: ${attributesExtracted}`);
    console.log(`\nModel Usage (Hybrid):`);
    console.log(`  [H] Haiku:  ${haikuCount} (routine)`);
    console.log(`  [S] Sonnet: ${sonnetCount} (complex) - ${sonnetPct}% escalation rate`);
    console.log(`\nEstimated Cost: $${totalCost.toFixed(4)}`);
    console.log(`Duration: ${duration.toFixed(1)}s`);
    console.log(`Dry Run: ${dryRun}`);

    // Attribute breakdown
    console.log(`\nTarget Attributes:`);
    console.log(`  Cat: is_recapture, was_eartipped_on_arrival, litter_size, gestational_stage, is_lactating`);
    console.log(`  Place: unfixed_count_observed, eartip_count_observed, kitten_count_at_location,`);
    console.log(`         trapping_difficulty, has_trap_shy_cats, newcomer_frequency, years_feeding`);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
