#!/usr/bin/env node
/**
 * extract_request_attributes.mjs
 *
 * Extracts structured attributes from request notes, summaries, and internal notes.
 * Targets: summary, notes, internal_notes, hold_reason_notes
 * Entity Types: request, place, person
 *
 * Usage:
 *   node scripts/jobs/extract_request_attributes.mjs --limit 100 --dry-run
 *   node scripts/jobs/extract_request_attributes.mjs --entity-type request --limit 500
 *   node scripts/jobs/extract_request_attributes.mjs --priority-only
 *
 * Cost Estimate:
 *   ~15,000 requests × ~$0.0005/record = ~$7.50
 */

import {
  getAttributeDefinitions,
  extractAttributes,
  saveAttributes,
  logExtractionJob,
  getPriorityKeywords,
  pool,
} from "./lib/attribute-extractor.mjs";

// Parse CLI arguments
const args = process.argv.slice(2);
const limit = parseInt(args.find((a) => a.startsWith("--limit="))?.split("=")[1] || "100");
const dryRun = args.includes("--dry-run");
const priorityOnly = args.includes("--priority-only");
const entityTypeFilter = args.find((a) => a.startsWith("--entity-type="))?.split("=")[1];
const model = args.find((a) => a.startsWith("--model="))?.split("=")[1] || "claude-haiku-4-5-20251001";

console.log("=".repeat(60));
console.log("Request Notes Attribute Extraction");
console.log("=".repeat(60));
console.log(`Limit: ${limit} | Dry Run: ${dryRun} | Priority Only: ${priorityOnly}`);
console.log(`Entity Type Filter: ${entityTypeFilter || "all"} | Model: ${model}`);
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
    const requestAttrs = allAttributeDefs.filter((a) => a.entity_type === "request");
    const placeAttrs = allAttributeDefs.filter((a) => a.entity_type === "place");
    const personAttrs = allAttributeDefs.filter((a) => a.entity_type === "person");

    // Get priority keywords for pre-filtering
    const priorityKeywords = priorityOnly
      ? getPriorityKeywords(allAttributeDefs, 20)
      : null;

    console.log(`Loaded ${requestAttrs.length} request, ${placeAttrs.length} place, ${personAttrs.length} person attributes`);

    // Query requests with text fields that haven't been processed
    const query = `
      SELECT
        r.request_id,
        r.place_id,
        r.requester_person_id,
        r.summary,
        r.notes,
        r.internal_notes,
        r.hold_reason_notes,
        r.status,
        r.created_at,
        p.formatted_address,
        pe.display_name as requester_name
      FROM trapper.sot_requests r
      LEFT JOIN trapper.places p ON p.place_id = r.place_id
      LEFT JOIN trapper.sot_people pe ON pe.person_id = r.requester_person_id
      WHERE (
        r.summary IS NOT NULL AND r.summary != ''
        OR r.notes IS NOT NULL AND r.notes != ''
        OR r.internal_notes IS NOT NULL AND r.internal_notes != ''
        OR r.hold_reason_notes IS NOT NULL AND r.hold_reason_notes != ''
      )
      -- Skip already-processed records
      AND NOT EXISTS (
        SELECT 1 FROM trapper.entity_attributes ea
        WHERE ea.source_system = 'request_notes'
          AND ea.source_record_id = r.request_id::TEXT
      )
      ORDER BY r.created_at DESC
      LIMIT $1
    `;

    const result = await pool.query(query, [limit * 2]);
    console.log(`Found ${result.rows.length} requests with notes to process\n`);

    // Filter by keywords if priority-only
    let requests = result.rows;
    if (priorityOnly) {
      requests = requests.filter((r) => {
        const combinedText = [r.summary, r.notes, r.internal_notes, r.hold_reason_notes]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return priorityKeywords.some((kw) => combinedText.includes(kw));
      });
      console.log(`After keyword filtering: ${requests.length} requests match priority keywords\n`);
    }

    requests = requests.slice(0, limit);

    for (const req of requests) {
      recordsProcessed++;

      // Combine all notes
      const combinedNotes = [
        req.summary && `Summary: ${req.summary}`,
        req.notes && `Notes: ${req.notes}`,
        req.internal_notes && `Internal Notes: ${req.internal_notes}`,
        req.hold_reason_notes && `Hold Reason: ${req.hold_reason_notes}`,
      ]
        .filter(Boolean)
        .join("\n\n");

      if (!combinedNotes || combinedNotes.length < 20) continue;

      const sourceInfo = {
        source_system: "request_notes",
        source_record_id: req.request_id,
        extracted_by: model.includes("sonnet") ? "claude_sonnet" : "claude_haiku",
      };

      let hasExtractions = false;

      // Extract request attributes
      if (!entityTypeFilter || entityTypeFilter === "request") {
        const context = {
          description: `This is a TNR service request for ${req.formatted_address || "an address in Sonoma County"}. ` +
            `Requested by: ${req.requester_name || "Unknown"}. Status: ${req.status}.`,
        };

        const result = await extractAttributes(combinedNotes, "request", requestAttrs, {
          model,
          context,
        });

        totalCost += result.cost;

        if (result.extractions.length > 0) {
          hasExtractions = true;

          if (!dryRun) {
            const saved = await saveAttributes(
              "request",
              req.request_id,
              result.extractions,
              sourceInfo
            );
            attributesExtracted += saved;
          }

          console.log(
            `[${recordsProcessed}] Request ${req.request_id.slice(0, 8)}: ` +
              `${result.extractions.map((e) => e.attribute_key).join(", ")}`
          );
        }
      }

      // Extract place attributes if we have a place_id
      if ((!entityTypeFilter || entityTypeFilter === "place") && req.place_id) {
        const context = {
          description: `This is a TNR request for ${req.formatted_address}. ` +
            `Look for information about the property/location itself.`,
        };

        const result = await extractAttributes(combinedNotes, "place", placeAttrs, {
          model,
          context,
        });

        totalCost += result.cost;

        if (result.extractions.length > 0) {
          hasExtractions = true;

          if (!dryRun) {
            const saved = await saveAttributes(
              "place",
              req.place_id,
              result.extractions,
              sourceInfo
            );
            attributesExtracted += saved;
          }

          console.log(
            `[${recordsProcessed}] Place ${req.formatted_address?.slice(0, 30) || req.place_id.slice(0, 8)}: ` +
              `${result.extractions.map((e) => e.attribute_key).join(", ")}`
          );
        }
      }

      // Extract person attributes if we have a requester
      if ((!entityTypeFilter || entityTypeFilter === "person") && req.requester_person_id) {
        const context = {
          description: `This is a TNR request from ${req.requester_name || "a caller"}. ` +
            `Look for information about the person (safety concerns, volunteer status, etc.).`,
        };

        const result = await extractAttributes(combinedNotes, "person", personAttrs, {
          model,
          context,
        });

        totalCost += result.cost;

        if (result.extractions.length > 0) {
          hasExtractions = true;

          if (!dryRun) {
            const saved = await saveAttributes(
              "person",
              req.requester_person_id,
              result.extractions,
              sourceInfo
            );
            attributesExtracted += saved;
          }

          console.log(
            `[${recordsProcessed}] Person ${req.requester_name || req.requester_person_id.slice(0, 8)}: ` +
              `${result.extractions.map((e) => e.attribute_key).join(", ")}`
          );
        }
      }

      if (hasExtractions) {
        recordsWithExtractions++;
      }

      // Progress update every 50 records
      if (recordsProcessed % 50 === 0) {
        console.log(
          `\n--- Progress: ${recordsProcessed}/${requests.length} | ` +
            `Cost: $${totalCost.toFixed(4)} | Extractions: ${attributesExtracted} ---\n`
        );
      }
    }

    // Log job
    if (!dryRun && recordsProcessed > 0) {
      const jobId = await logExtractionJob({
        source_system: "request_notes",
        entity_type: entityTypeFilter || "request,place,person",
        batch_size: limit,
        records_processed: recordsProcessed,
        records_with_extractions: recordsWithExtractions,
        attributes_extracted: attributesExtracted,
        model_used: model,
        cost_estimate_usd: totalCost,
        notes: priorityOnly ? "Priority keywords only" : null,
      });
      console.log(`\nLogged job: ${jobId}`);
    }

    // Summary
    const duration = (Date.now() - startTime) / 1000;
    console.log("\n" + "=".repeat(60));
    console.log("SUMMARY");
    console.log("=".repeat(60));
    console.log(`Records Processed: ${recordsProcessed}`);
    console.log(`Records with Extractions: ${recordsWithExtractions} (${((recordsWithExtractions / recordsProcessed) * 100 || 0).toFixed(1)}%)`);
    console.log(`Attributes Extracted: ${attributesExtracted}`);
    console.log(`Estimated Cost: $${totalCost.toFixed(4)}`);
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
