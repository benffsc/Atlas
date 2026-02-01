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
  budget: 'claude-3-haiku-20240307',     // $0.25/$1.25 per MTok - bulk routine entries
  fast: 'claude-haiku-4-5-20251001',     // $1/$5 per MTok - better quality routine
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
  // Disease mentions - polarity is critical (FeLV neg vs FeLV+)
  disease_status: /felv|fiv|feline\s+leukemia|feline\s+immunodeficiency|ringworm|dermatophyt|heartworm|panleukopenia|panleuk|feline\s+distemper|parvo|snap\s+(pos|neg|test)/i,
};

function shouldUseSonnet(text) {
  return Object.values(REQUIRES_SONNET).some(pattern => pattern.test(text));
}

// Parse CLI arguments
const args = process.argv.slice(2);
const limit = parseInt(args.find((a) => a.startsWith("--limit="))?.split("=")[1] || "100");
const dryRun = args.includes("--dry-run");
const priorityOnly = args.includes("--priority-only");
const useBudgetModel = args.includes("--budget"); // Use Haiku 3 for bulk processing
const entityTypeFilter = args.find((a) => a.startsWith("--entity-type="))?.split("=")[1];
const defaultModel = useBudgetModel ? MODELS.budget :
  (args.find((a) => a.startsWith("--model="))?.split("=")[1] || MODELS.fast);

// Model usage tracking
let haiku3Count = 0;  // Budget model
let haiku45Count = 0; // Fast model
let sonnetCount = 0;  // Quality model

console.log("=".repeat(60));
console.log("Clinic Appointment Attribute Extraction (Tiered Model)");
console.log("=".repeat(60));
console.log(`Limit: ${limit} | Dry Run: ${dryRun} | Priority Only: ${priorityOnly}`);
console.log(`Entity Type Filter: ${entityTypeFilter || "all"}`);
console.log(`Default Model: ${defaultModel}`);
console.log(`Model Tiers: Budget=${useBudgetModel} | Sonnet Escalation: ${priorityOnly ? 'ENABLED' : 'DISABLED for bulk'}`);
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
    // Uses extraction_status to track ALL processed records (not just those with extractions)
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
      -- Skip already-processed records (check extraction_status)
      AND NOT EXISTS (
        SELECT 1 FROM trapper.extraction_status es
        WHERE es.source_table = 'sot_appointments'
          AND es.source_record_id = a.appointment_id::TEXT
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

      // SMART TIERED MODEL SELECTION:
      // - Sonnet: ALWAYS for critical patterns (recapture, eartip, population counts, reproduction)
      //   These are essential for Chapman mark-recapture calculations
      // - Haiku 4.5: Default for non-budget runs (routine records)
      // - Haiku 3: Budget mode for bulk processing (simple records)
      const hasCriticalPattern = shouldUseSonnet(combinedNotes);
      let selectedModel = defaultModel;
      let modelIndicator = useBudgetModel ? '[H3]' : '[H45]';

      if (hasCriticalPattern) {
        // Always use Sonnet for critical population/recapture data
        selectedModel = MODELS.quality;
        modelIndicator = '[S]';
        sonnetCount++;
      } else if (useBudgetModel) {
        haiku3Count++;
      } else {
        haiku45Count++;
      }

      const sourceInfo = {
        source_system: "clinichq",
        source_record_id: appt.appointment_id,
        extracted_by: hasCriticalPattern ? "claude_sonnet" : "claude_haiku",
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

            // Post-extraction hook: flag places for positive disease results
            for (const extraction of result.extractions) {
              if (extraction.attribute_key.endsWith('_status') && extraction.value === 'positive') {
                const diseaseKey = extraction.attribute_key.replace('_status', '');
                try {
                  const hookResult = await pool.query(
                    `SELECT trapper.process_disease_extraction($1, $2, $3, $4)`,
                    [appt.cat_id, diseaseKey, 'positive', 'ai_extraction']
                  );
                  const placesUpdated = hookResult.rows[0]?.process_disease_extraction || 0;
                  if (placesUpdated > 0) {
                    console.log(`  🦠 Disease hook: ${diseaseKey}+ → flagged ${placesUpdated} place(s)`);
                  }
                } catch (hookErr) {
                  // process_disease_extraction may not exist yet (pre-MIG_814)
                  console.warn(`  Disease hook skipped (${diseaseKey}): ${hookErr.message}`);
                }
              }
            }
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

      // Mark record as processed in extraction_status (even if no extractions)
      // This prevents re-processing records that have no extractable content
      if (!dryRun) {
        try {
          await pool.query(`
            INSERT INTO trapper.extraction_status (
              source_table, source_record_id, last_extracted_at,
              attributes_extracted, extraction_hash
            ) VALUES (
              'sot_appointments', $1, NOW(), $2,
              md5($3)
            )
            ON CONFLICT (source_table, source_record_id)
            DO UPDATE SET
              last_extracted_at = NOW(),
              attributes_extracted = $2,
              needs_reextraction = false
          `, [appt.appointment_id, hasExtractions ? 1 : 0, combinedNotes]);

          // Mark queue item completed if it exists
          await pool.query(`
            UPDATE trapper.extraction_queue
            SET completed_at = NOW()
            WHERE source_table = 'sot_appointments'
              AND source_record_id = $1
              AND completed_at IS NULL
          `, [appt.appointment_id]);
        } catch (err) {
          // Ignore status update errors
        }
      }

      // Progress update every 50 records
      if (recordsProcessed % 50 === 0) {
        console.log(
          `\n--- Progress: ${recordsProcessed}/${appointments.length} | ` +
            `Cost: $${totalCost.toFixed(4)} | Extractions: ${attributesExtracted} ---\n`
        );
      }
    }

    // Calculate metrics
    const duration = (Date.now() - startTime) / 1000;
    const totalHaiku = haiku3Count + haiku45Count;
    const sonnetPct = recordsProcessed > 0 ? ((sonnetCount / recordsProcessed) * 100).toFixed(1) : 0;
    const modelUsed = useBudgetModel
      ? `budget (haiku3:${haiku3Count}, sonnet:${sonnetCount})`
      : `tiered (haiku45:${haiku45Count}, sonnet:${sonnetCount})`;

    // Log job
    if (!dryRun && recordsProcessed > 0) {
      const jobId = await logExtractionJob({
        source_system: "clinichq",
        entity_type: entityTypeFilter || "cat,place",
        batch_size: limit,
        records_processed: recordsProcessed,
        records_with_extractions: recordsWithExtractions,
        attributes_extracted: attributesExtracted,
        model_used: modelUsed,
        cost_estimate_usd: totalCost,
        notes: useBudgetModel ? "Budget mode (Haiku 3)" : (priorityOnly ? "Priority keywords only" : `Sonnet escalation: ${sonnetCount}/${recordsProcessed} (${sonnetPct}%)`),
      });
      console.log(`\nLogged job: ${jobId}`);
    }

    // Summary
    console.log("\n" + "=".repeat(60));
    console.log("SUMMARY");
    console.log("=".repeat(60));
    console.log(`Records Processed: ${recordsProcessed}`);
    console.log(`Records with Extractions: ${recordsWithExtractions} (${recordsProcessed > 0 ? ((recordsWithExtractions / recordsProcessed) * 100).toFixed(1) : 0}%)`);
    console.log(`Attributes Extracted: ${attributesExtracted}`);
    console.log(`\nModel Usage (${useBudgetModel ? 'Budget' : 'Tiered'}):`);
    if (useBudgetModel) {
      console.log(`  [H3] Haiku 3:  ${haiku3Count} (budget/bulk - ~$0.00015/record)`);
    } else {
      console.log(`  [H45] Haiku 4.5: ${haiku45Count} (routine - ~$0.0006/record)`);
    }
    console.log(`  [S] Sonnet: ${sonnetCount} (complex/priority) - ${sonnetPct}% escalation`);
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
