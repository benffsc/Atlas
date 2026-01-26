#!/usr/bin/env node
/**
 * seed_attributes_from_google_maps.mjs
 *
 * Seeds entity attributes from already-classified Google Maps entries.
 * Uses the ai_classification JSONB field that was populated by classify_google_map_entries.mjs
 *
 * This is a FAST operation (no AI calls needed) - just converting existing classifications
 * to the entity_attributes format for unified querying.
 *
 * Usage:
 *   node scripts/jobs/seed_attributes_from_google_maps.mjs --dry-run
 *   node scripts/jobs/seed_attributes_from_google_maps.mjs --limit 1000
 *
 * Expected Output:
 *   - Place attributes: has_disease_history, feeder_present, has_kitten_history, etc.
 *   - Person attributes: safety_concern, is_volunteer, is_feeder, etc.
 */

import {
  saveAttributes,
  logExtractionJob,
  pool,
} from "./lib/attribute-extractor.mjs";

// Parse CLI arguments
const args = process.argv.slice(2);
const limit = parseInt(args.find((a) => a.startsWith("--limit="))?.split("=")[1] || "10000");
const dryRun = args.includes("--dry-run");

console.log("=".repeat(60));
console.log("Seed Attributes from Google Maps Classifications");
console.log("=".repeat(60));
console.log(`Limit: ${limit} | Dry Run: ${dryRun}`);
console.log("");

// Mapping from Google Maps ai_meaning to entity attributes
const MEANING_TO_ATTRIBUTES = {
  disease_risk: [
    { entity_type: "place", attribute_key: "has_disease_history", value: true, confidence: 0.85 },
  ],
  felv_colony: [
    { entity_type: "place", attribute_key: "has_disease_history", value: true, confidence: 0.95 },
  ],
  fiv_colony: [
    { entity_type: "place", attribute_key: "has_disease_history", value: true, confidence: 0.95 },
  ],
  watch_list: [
    { entity_type: "person", attribute_key: "safety_concern", value: true, confidence: 0.90 },
  ],
  volunteer: [
    { entity_type: "person", attribute_key: "is_volunteer", value: true, confidence: 0.85 },
  ],
  relocation_client: [
    { entity_type: "person", attribute_key: "provides_barn_homes", value: true, confidence: 0.80 },
    { entity_type: "place", attribute_key: "has_relocation_history", value: true, confidence: 0.80 },
  ],
  active_colony: [
    { entity_type: "place", attribute_key: "colony_status", value: { value: "active" }, confidence: 0.75 },
  ],
  historical_colony: [
    { entity_type: "place", attribute_key: "colony_status", value: { value: "resolved" }, confidence: 0.65 },
  ],
  feeding_station: [
    { entity_type: "place", attribute_key: "feeder_present", value: true, confidence: 0.85 },
  ],
};

// Extract additional signals from ai_classification JSONB
function extractSignalAttributes(classification) {
  const attributes = [];

  if (!classification || !classification.signals) {
    return attributes;
  }

  const signals = classification.signals;

  // Disease mentions
  if (signals.disease_mentions && signals.disease_mentions.length > 0) {
    attributes.push({
      entity_type: "place",
      attribute_key: "has_disease_history",
      value: true,
      confidence: 0.90,
      evidence: signals.disease_mentions.join(", "),
    });
  }

  // Kitten mentions
  if (signals.kitten_mentions && signals.kitten_mentions.length > 0) {
    attributes.push({
      entity_type: "place",
      attribute_key: "has_kitten_history",
      value: true,
      confidence: 0.85,
      evidence: signals.kitten_mentions.join(", "),
    });
  }

  // Cat count
  if (signals.cat_count && signals.cat_count > 0) {
    attributes.push({
      entity_type: "place",
      attribute_key: "estimated_colony_size",
      value: signals.cat_count,
      confidence: signals.confidence || 0.70,
      evidence: `Estimated ${signals.cat_count} cats`,
    });
  }

  // Breeding activity
  if (signals.breeding_active) {
    attributes.push({
      entity_type: "place",
      attribute_key: "has_breeding_activity",
      value: true,
      confidence: 0.80,
    });
  }

  // Safety concerns
  if (signals.safety_concerns && signals.safety_concerns.length > 0) {
    attributes.push({
      entity_type: "person",
      attribute_key: "safety_concern",
      value: true,
      confidence: 0.90,
      evidence: signals.safety_concerns.join(", "),
    });
  }

  // Feeder present
  if (signals.feeder_present || signals.managed_feeding) {
    attributes.push({
      entity_type: "place",
      attribute_key: "feeder_present",
      value: true,
      confidence: 0.85,
    });
  }

  // Mortality history
  if (signals.mortality_mentions && signals.mortality_mentions.length > 0) {
    attributes.push({
      entity_type: "place",
      attribute_key: "has_mortality_history",
      value: true,
      confidence: 0.85,
      evidence: signals.mortality_mentions.join(", "),
    });
  }

  return attributes;
}

async function main() {
  const startTime = Date.now();
  let totalSeeded = 0;
  let entriesProcessed = 0;
  let entriesWithAttributes = 0;

  try {
    // Query classified Google Maps entries with linked entities
    const query = `
      SELECT
        g.entry_id,
        g.kml_name,
        g.ai_meaning,
        g.ai_classification,
        g.original_content,
        g.linked_place_id,
        g.linked_person_id,
        g.ai_classified_at
      FROM trapper.google_map_entries g
      WHERE g.ai_classified_at IS NOT NULL
        AND g.ai_meaning IS NOT NULL
        AND (g.linked_place_id IS NOT NULL OR g.linked_person_id IS NOT NULL)
        -- Skip already-seeded entries
        AND NOT EXISTS (
          SELECT 1 FROM trapper.entity_attributes ea
          WHERE ea.source_system = 'google_maps'
            AND ea.source_record_id = g.entry_id::TEXT
        )
      ORDER BY g.ai_classified_at DESC
      LIMIT $1
    `;

    const result = await pool.query(query, [limit]);
    console.log(`Found ${result.rows.length} classified Google Maps entries to seed\n`);

    for (const entry of result.rows) {
      entriesProcessed++;

      const sourceInfo = {
        source_system: "google_maps",
        source_record_id: entry.entry_id.toString(),
        extracted_by: "seed_from_classification",
      };

      // Collect all attributes to seed
      const attributesToSeed = [];

      // Get attributes from ai_meaning
      const meaningAttrs = MEANING_TO_ATTRIBUTES[entry.ai_meaning] || [];
      for (const attr of meaningAttrs) {
        attributesToSeed.push({
          ...attr,
          evidence: `ai_meaning: ${entry.ai_meaning}`,
        });
      }

      // Get additional attributes from ai_classification signals
      const classification =
        typeof entry.ai_classification === "string"
          ? JSON.parse(entry.ai_classification)
          : entry.ai_classification;

      const signalAttrs = extractSignalAttributes(classification);
      attributesToSeed.push(...signalAttrs);

      if (attributesToSeed.length === 0) continue;

      entriesWithAttributes++;

      // Group by entity type and save
      const placeAttrs = attributesToSeed.filter(
        (a) => a.entity_type === "place" && entry.linked_place_id
      );
      const personAttrs = attributesToSeed.filter(
        (a) => a.entity_type === "person" && entry.linked_person_id
      );

      if (placeAttrs.length > 0 && !dryRun) {
        const formattedAttrs = placeAttrs.map((a) => ({
          attribute_key: a.attribute_key,
          value: a.value,
          confidence: a.confidence,
          evidence: a.evidence || entry.original_content?.slice(0, 200),
        }));

        const saved = await saveAttributes(
          "place",
          entry.linked_place_id,
          formattedAttrs,
          sourceInfo
        );
        totalSeeded += saved;

        console.log(
          `[${entriesProcessed}] Place: ${formattedAttrs.map((a) => a.attribute_key).join(", ")}`
        );
      }

      if (personAttrs.length > 0 && !dryRun) {
        const formattedAttrs = personAttrs.map((a) => ({
          attribute_key: a.attribute_key,
          value: a.value,
          confidence: a.confidence,
          evidence: a.evidence || entry.original_content?.slice(0, 200),
        }));

        const saved = await saveAttributes(
          "person",
          entry.linked_person_id,
          formattedAttrs,
          sourceInfo
        );
        totalSeeded += saved;

        console.log(
          `[${entriesProcessed}] Person: ${formattedAttrs.map((a) => a.attribute_key).join(", ")}`
        );
      }

      // Progress update every 100 entries
      if (entriesProcessed % 100 === 0) {
        console.log(
          `\n--- Progress: ${entriesProcessed}/${result.rows.length} | ` +
            `Seeded: ${totalSeeded} attributes ---\n`
        );
      }
    }

    // Log job
    if (!dryRun && entriesProcessed > 0) {
      const jobId = await logExtractionJob({
        source_system: "google_maps",
        entity_type: "place,person",
        batch_size: limit,
        records_processed: entriesProcessed,
        records_with_extractions: entriesWithAttributes,
        attributes_extracted: totalSeeded,
        model_used: "seed_from_classification",
        cost_estimate_usd: 0, // No AI cost - using existing classifications
        notes: "Seeded from existing Google Maps AI classifications",
      });
      console.log(`\nLogged job: ${jobId}`);
    }

    // Summary
    const duration = (Date.now() - startTime) / 1000;
    console.log("\n" + "=".repeat(60));
    console.log("SUMMARY");
    console.log("=".repeat(60));
    console.log(`Entries Processed: ${entriesProcessed}`);
    console.log(`Entries with Attributes: ${entriesWithAttributes} (${((entriesWithAttributes / entriesProcessed) * 100 || 0).toFixed(1)}%)`);
    console.log(`Attributes Seeded: ${totalSeeded}`);
    console.log(`Cost: $0.00 (no AI calls - using existing classifications)`);
    console.log(`Duration: ${duration.toFixed(1)}s`);
    console.log(`Dry Run: ${dryRun}`);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
