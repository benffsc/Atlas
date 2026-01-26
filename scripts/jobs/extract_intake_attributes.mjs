#!/usr/bin/env node
/**
 * extract_intake_attributes.mjs
 *
 * Extracts structured attributes from intake form submissions.
 * Targets: situation_description, medical_description, access_notes,
 *          cat_count_text, feeder_info, legacy_notes
 * Entity Types: request, place, person
 *
 * Usage:
 *   node scripts/jobs/extract_intake_attributes.mjs --limit 100 --dry-run
 *   node scripts/jobs/extract_intake_attributes.mjs --limit 500
 *
 * Cost Estimate:
 *   ~10,000 submissions × ~$0.0005/record = ~$5.00
 */

import {
  getAttributeDefinitions,
  extractAttributes,
  saveAttributes,
  logExtractionJob,
  pool,
} from "./lib/attribute-extractor.mjs";

// Parse CLI arguments
const args = process.argv.slice(2);
const limit = parseInt(args.find((a) => a.startsWith("--limit="))?.split("=")[1] || "100");
const dryRun = args.includes("--dry-run");
const model = args.find((a) => a.startsWith("--model="))?.split("=")[1] || "claude-haiku-4-5-20251001";

console.log("=".repeat(60));
console.log("Intake Submission Attribute Extraction");
console.log("=".repeat(60));
console.log(`Limit: ${limit} | Dry Run: ${dryRun} | Model: ${model}`);
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

    console.log(`Loaded ${requestAttrs.length} request, ${placeAttrs.length} place, ${personAttrs.length} person attributes`);

    // Query intake submissions with text fields that haven't been processed
    const query = `
      SELECT
        i.submission_id,
        i.place_id,
        i.matched_person_id,
        i.created_request_id,
        i.situation_description,
        i.medical_description,
        i.access_notes,
        i.cat_count_text,
        i.feeder_info,
        i.legacy_notes,
        i.ownership_status,
        i.cats_being_fed,
        i.is_emergency,
        p.formatted_address
      FROM trapper.web_intake_submissions i
      LEFT JOIN trapper.places p ON p.place_id = i.place_id
      WHERE (
        i.situation_description IS NOT NULL AND LENGTH(i.situation_description) > 20
        OR i.medical_description IS NOT NULL AND LENGTH(i.medical_description) > 20
        OR i.access_notes IS NOT NULL AND LENGTH(i.access_notes) > 20
        OR i.legacy_notes IS NOT NULL AND LENGTH(i.legacy_notes) > 20
      )
      AND NOT EXISTS (
        SELECT 1 FROM trapper.extraction_status es
        WHERE es.source_table = 'web_intake_submissions'
        AND es.source_record_id = i.submission_id::text
        AND es.last_extracted_at > NOW() - INTERVAL '7 days'
      )
      ORDER BY i.submitted_at DESC
      LIMIT $1
    `;

    const result = await pool.query(query, [limit]);
    console.log(`Found ${result.rows.length} intake submissions with notes to process\n`);

    for (const row of result.rows) {
      recordsProcessed++;

      // Combine text fields
      const textParts = [];
      if (row.situation_description) textParts.push(`Situation: ${row.situation_description}`);
      if (row.medical_description) textParts.push(`Medical Concerns: ${row.medical_description}`);
      if (row.access_notes) textParts.push(`Access Notes: ${row.access_notes}`);
      if (row.cat_count_text) textParts.push(`Cat Count Info: ${row.cat_count_text}`);
      if (row.feeder_info) textParts.push(`Feeder Info: ${row.feeder_info}`);
      if (row.legacy_notes) textParts.push(`Legacy Notes: ${row.legacy_notes}`);

      const combinedText = textParts.join("\n\n");
      if (combinedText.length < 20) continue;

      // Add context about the submission
      const context = {
        description: `Intake form submission${row.formatted_address ? ` for ${row.formatted_address}` : ""}. ` +
          `Ownership status: ${row.ownership_status || "unknown"}. ` +
          `Feeding: ${row.cats_being_fed ? "yes" : "no"}. ` +
          `Emergency: ${row.is_emergency ? "yes" : "no"}.`,
      };

      // Extract for place if we have a place_id
      if (row.place_id) {
        const placeResult = await extractAttributes(combinedText, "place", placeAttrs, { model, context });
        totalCost += placeResult.cost;

        if (placeResult.extractions.length > 0 && !dryRun) {
          const saved = await saveAttributes("place", row.place_id, placeResult.extractions, {
            source_system: "web_intake",
            source_record_id: row.submission_id,
            extracted_by: model,
          });
          attributesExtracted += saved;
          recordsWithExtractions++;
        }

        if (placeResult.extractions.length > 0) {
          const attrKeys = placeResult.extractions.map((e) => e.attribute_key).join(", ");
          console.log(`[${recordsProcessed}] Intake ${row.submission_id.slice(0, 8)}: ${attrKeys}`);
        }
      }

      // Extract for request if we have a created_request_id
      if (row.created_request_id) {
        const requestResult = await extractAttributes(combinedText, "request", requestAttrs, { model, context });
        totalCost += requestResult.cost;

        if (requestResult.extractions.length > 0 && !dryRun) {
          const saved = await saveAttributes("request", row.created_request_id, requestResult.extractions, {
            source_system: "web_intake",
            source_record_id: row.submission_id,
            extracted_by: model,
          });
          attributesExtracted += saved;
        }
      }

      // Extract for person if we have a matched_person_id
      if (row.matched_person_id) {
        const personResult = await extractAttributes(combinedText, "person", personAttrs, { model, context });
        totalCost += personResult.cost;

        if (personResult.extractions.length > 0 && !dryRun) {
          const saved = await saveAttributes("person", row.matched_person_id, personResult.extractions, {
            source_system: "web_intake",
            source_record_id: row.submission_id,
            extracted_by: model,
          });
          attributesExtracted += saved;
        }
      }

      // Update extraction status
      if (!dryRun) {
        await pool.query(`
          INSERT INTO trapper.extraction_status (source_table, source_record_id, last_extracted_at, attributes_extracted)
          VALUES ('web_intake_submissions', $1, NOW(), $2)
          ON CONFLICT (source_table, source_record_id)
          DO UPDATE SET last_extracted_at = NOW(), attributes_extracted = $2
        `, [row.submission_id, attributesExtracted]);
      }
    }

    // Log job
    const duration = (Date.now() - startTime) / 1000;
    console.log("\n" + "=".repeat(60));
    console.log(`Completed in ${duration.toFixed(1)}s`);
    console.log(`Records processed: ${recordsProcessed}`);
    console.log(`Records with extractions: ${recordsWithExtractions}`);
    console.log(`Attributes extracted: ${attributesExtracted}`);
    console.log(`Estimated cost: $${totalCost.toFixed(4)}`);

    if (!dryRun) {
      await logExtractionJob({
        source_system: "web_intake",
        entity_type: "place,request,person",
        batch_size: limit,
        records_processed: recordsProcessed,
        records_with_extractions: recordsWithExtractions,
        attributes_extracted: attributesExtracted,
        model_used: model,
        cost_estimate_usd: totalCost,
      });
    }

  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
