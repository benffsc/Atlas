#!/usr/bin/env node
/**
 * extract_clinic_attributes.mjs
 *
 * Extracts structured attributes from ClinicHQ appointment notes.
 * Targets: medical_notes, request_notes, vet_notes
 * Entity Types: cat (temperament, disease, age), place (breeding, mortality)
 *
 * Usage:
 *   node scripts/jobs/extract_clinic_attributes.mjs --limit 100 --dry-run
 *   node scripts/jobs/extract_clinic_attributes.mjs --entity-type cat --limit 500
 *   node scripts/jobs/extract_clinic_attributes.mjs --priority-only  # High-priority attributes first
 *
 * Cost Estimate:
 *   ~50,000 appointments with notes × ~$0.0005/record = ~$25
 */

import {
  getAttributeDefinitions,
  extractAttributes,
  saveAttributes,
  logExtractionJob,
  hasExtractionKeywords,
  getPriorityKeywords,
  pool,
} from "./lib/attribute-extractor.mjs";

// ============================================================
// HYBRID MODEL SELECTION - Sonnet Escalation
// ============================================================
// Use Haiku for routine extraction, escalate to Sonnet for:
// - Population modeling (recapture, eartip counts)
// - Breeding/reproduction (litter size, pregnancy)
// - Complex historical patterns (years feeding, trap shy)

const MODELS = {
  fast: 'claude-haiku-4-5-20251001',     // $1/$5 per MTok - routine entries
  quality: 'claude-sonnet-4-20250514',   // Higher quality for complex entries
};

const REQUIRES_SONNET = {
  // Recapture/mark-resight patterns - critical for Chapman
  recapture: /recapture|recheck|return\s+visit|eartip\s*(present|noted)|already\s*(tipped|fixed)|previously\s+(fixed|altered)/i,
  // Population count patterns with numbers
  population_count: /\d+\s*(unfixed|intact|not fixed|unaltered)|\d+\s*(eartip|tipped|clipped)/i,
  // Breeding/reproduction with specifics
  reproduction: /litter\s*(of|size)?\s*\d|(\d+)\s*kittens|pregnant|gestational|lactating|nursing\s+mom|has\s+milk/i,
  // Complex historical patterns
  complex_history: /(\d+)\s*years?\s+(feeding|feed)|feeding\s+(since|for)\s+\d{4}|trap\s+shy|wont?\s+go\s+in/i,
};

function shouldUseSonnet(text) {
  return Object.values(REQUIRES_SONNET).some(pattern => pattern.test(text));
}

// Parse CLI arguments
const args = process.argv.slice(2);
const limit = parseInt(args.find((a) => a.startsWith("--limit="))?.split("=")[1] || "100");
const dryRun = args.includes("--dry-run");
const priorityOnly = args.includes("--priority-only");
const entityTypeFilter = args.find((a) => a.startsWith("--entity-type="))?.split("=")[1];
const model = args.find((a) => a.startsWith("--model="))?.split("=")[1] || "claude-haiku-4-5-20251001";

// Model usage tracking
let haikuCount = 0;
let sonnetCount = 0;

console.log("=".repeat(60));
console.log("Clinic Appointment Attribute Extraction (Hybrid Model)");
console.log("=".repeat(60));
console.log(`Limit: ${limit} | Dry Run: ${dryRun} | Priority Only: ${priorityOnly}`);
console.log(`Entity Type Filter: ${entityTypeFilter || "all"}`);
console.log(`Default Model: ${model} | Sonnet Escalation: ENABLED`);
console.log("");

async function main() {
  const startTime = Date.now();
  let totalCost = 0;
  let recordsProcessed = 0;
  let recordsWithExtractions = 0;
  let attributesExtracted = 0;

  try {
    // Get attribute definitions
    const allAttributeDefs = await getAttributeDefinitions();
    const catAttrs = allAttributeDefs.filter((a) => a.entity_type === "cat");
    const placeAttrs = allAttributeDefs.filter((a) => a.entity_type === "place");

    // Get priority keywords for pre-filtering
    const priorityKeywords = priorityOnly
      ? getPriorityKeywords(allAttributeDefs, 20)
      : null;

    console.log(`Loaded ${catAttrs.length} cat attributes, ${placeAttrs.length} place attributes`);
    if (priorityOnly) {
      console.log(`Priority keywords: ${priorityKeywords.slice(0, 10).join(", ")}...`);
    }

    // Query appointments with notes that haven't been processed
    // Join to get cat_id for cat-level extraction
    const query = `
      SELECT
        a.appointment_id,
        a.cat_id,
        a.medical_notes,
        a.appointment_date,
        c.display_name as cat_name,
        cpr.place_id
      FROM trapper.sot_appointments a
      LEFT JOIN trapper.sot_cats c ON c.cat_id = a.cat_id
      LEFT JOIN trapper.cat_place_relationships cpr ON cpr.cat_id = a.cat_id
        AND cpr.relationship_type = 'appointment_site'
      WHERE a.medical_notes IS NOT NULL AND a.medical_notes != ''
      -- Skip already-processed records (check if any attribute exists)
      AND NOT EXISTS (
        SELECT 1 FROM trapper.entity_attributes ea
        WHERE ea.source_system = 'clinichq'
          AND ea.source_record_id = a.appointment_id::TEXT
      )
      ORDER BY a.appointment_date DESC
      LIMIT $1
    `;

    const result = await pool.query(query, [limit * 2]); // Fetch extra for keyword filtering
    console.log(`Found ${result.rows.length} appointments with notes to process\n`);

    // Filter by keywords if priority-only
    let appointments = result.rows;
    if (priorityOnly) {
      appointments = appointments.filter((a) => {
        const text = (a.medical_notes || "").toLowerCase();
        return priorityKeywords.some((kw) => text.includes(kw));
      });
      console.log(`After keyword filtering: ${appointments.length} appointments match priority keywords\n`);
    }

    appointments = appointments.slice(0, limit);

    for (const appt of appointments) {
      recordsProcessed++;

      // Use medical notes (only notes column on sot_appointments)
      const combinedNotes = appt.medical_notes ? `Medical Notes: ${appt.medical_notes}` : "";

      if (!combinedNotes || combinedNotes.length < 20) continue;

      // HYBRID MODEL SELECTION: Escalate to Sonnet for complex patterns
      const useSonnet = shouldUseSonnet(combinedNotes);
      const selectedModel = useSonnet ? MODELS.quality : (model || MODELS.fast);
      const modelIndicator = useSonnet ? '[S]' : '[H]';

      if (useSonnet) {
        sonnetCount++;
      } else {
        haikuCount++;
      }

      const sourceInfo = {
        source_system: "clinichq",
        source_record_id: appt.appointment_id,
        extracted_by: useSonnet ? "claude_sonnet" : "claude_haiku",
      };

      let hasExtractions = false;

      // Extract cat attributes if we have a cat_id
      if ((!entityTypeFilter || entityTypeFilter === "cat") && appt.cat_id) {
        const context = {
          description: `This is a clinic appointment note for a cat named "${appt.cat_name || "Unknown"}". The notes were recorded during a TNR (spay/neuter) appointment at FFSC clinic.`,
        };

        const result = await extractAttributes(combinedNotes, "cat", catAttrs, {
          model: selectedModel,
          context,
        });

        totalCost += result.cost;

        if (result.extractions.length > 0) {
          hasExtractions = true;

          if (!dryRun) {
            const saved = await saveAttributes(
              "cat",
              appt.cat_id,
              result.extractions,
              sourceInfo
            );
            attributesExtracted += saved;
          }

          console.log(
            `${modelIndicator} [${recordsProcessed}] Cat ${appt.cat_name || appt.cat_id.slice(0, 8)}: ` +
              `${result.extractions.map((e) => e.attribute_key).join(", ")}`
          );
        }
      }

      // Extract place attributes if we have a place_id
      if ((!entityTypeFilter || entityTypeFilter === "place") && appt.place_id) {
        const context = {
          description: `This is a clinic appointment note. The cat came from a specific address. Look for information about the location itself (breeding, disease history, mortality).`,
        };

        const result = await extractAttributes(combinedNotes, "place", placeAttrs, {
          model: selectedModel,
          context,
        });

        totalCost += result.cost;

        if (result.extractions.length > 0) {
          hasExtractions = true;

          if (!dryRun) {
            const saved = await saveAttributes(
              "place",
              appt.place_id,
              result.extractions,
              sourceInfo
            );
            attributesExtracted += saved;
          }

          console.log(
            `${modelIndicator} [${recordsProcessed}] Place: ${result.extractions.map((e) => e.attribute_key).join(", ")}`
          );
        }
      }

      if (hasExtractions) {
        recordsWithExtractions++;
      }

      // Progress update every 50 records
      if (recordsProcessed % 50 === 0) {
        console.log(
          `\n--- Progress: ${recordsProcessed}/${appointments.length} | ` +
            `Cost: $${totalCost.toFixed(4)} | Extractions: ${attributesExtracted} ---\n`
        );
      }
    }

    // Log job
    if (!dryRun && recordsProcessed > 0) {
      const jobId = await logExtractionJob({
        source_system: "clinichq",
        entity_type: entityTypeFilter || "cat,place",
        batch_size: limit,
        records_processed: recordsProcessed,
        records_with_extractions: recordsWithExtractions,
        attributes_extracted: attributesExtracted,
        model_used: `hybrid (haiku:${haikuCount}, sonnet:${sonnetCount})`,
        cost_estimate_usd: totalCost,
        notes: priorityOnly ? "Priority keywords only" : `Sonnet escalation: ${sonnetCount}/${recordsProcessed} (${sonnetPct}%)`,
      });
      console.log(`\nLogged job: ${jobId}`);
    }

    // Summary
    const duration = (Date.now() - startTime) / 1000;
    const sonnetPct = recordsProcessed > 0 ? ((sonnetCount / recordsProcessed) * 100).toFixed(1) : 0;
    console.log("\n" + "=".repeat(60));
    console.log("SUMMARY");
    console.log("=".repeat(60));
    console.log(`Records Processed: ${recordsProcessed}`);
    console.log(`Records with Extractions: ${recordsWithExtractions} (${((recordsWithExtractions / recordsProcessed) * 100).toFixed(1)}%)`);
    console.log(`Attributes Extracted: ${attributesExtracted}`);
    console.log(`\nModel Usage (Hybrid):`);
    console.log(`  [H] Haiku:  ${haikuCount} (routine)`);
    console.log(`  [S] Sonnet: ${sonnetCount} (complex/population) - ${sonnetPct}% escalation rate`);
    console.log(`\nEstimated Cost: $${totalCost.toFixed(4)}`);
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
