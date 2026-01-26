#!/usr/bin/env node
/**
 * extract_observation_attributes.mjs
 *
 * Extracts structured attributes from site observations and trip reports.
 * Targets: notes, issue_details from site_observations
 * Entity Types: place (primarily)
 *
 * Usage:
 *   node scripts/jobs/extract_observation_attributes.mjs --limit 100 --dry-run
 *   node scripts/jobs/extract_observation_attributes.mjs --limit 500
 *
 * Cost Estimate:
 *   ~3,000 observations × ~$0.0005/record = ~$1.50
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
console.log("Site Observation Attribute Extraction");
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
    // Get attribute definitions for places
    const placeAttrs = await getAttributeDefinitions("place");
    console.log(`Loaded ${placeAttrs.length} place attributes`);

    // Query observations with notes
    const query = `
      SELECT
        o.observation_id,
        o.place_id,
        o.request_id,
        o.notes,
        o.issue_details,
        o.issues_encountered,
        o.cats_seen_total,
        o.eartipped_seen,
        o.observation_date,
        o.time_of_day,
        o.confidence,
        p.formatted_address
      FROM trapper.site_observations o
      LEFT JOIN trapper.places p ON p.place_id = o.place_id
      WHERE (
        o.notes IS NOT NULL AND LENGTH(o.notes) > 20
        OR o.issue_details IS NOT NULL AND LENGTH(o.issue_details) > 20
      )
      AND o.place_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM trapper.extraction_status es
        WHERE es.source_table = 'site_observations'
        AND es.source_record_id = o.observation_id::text
        AND es.last_extracted_at > NOW() - INTERVAL '7 days'
      )
      ORDER BY o.observation_date DESC NULLS LAST
      LIMIT $1
    `;

    const result = await pool.query(query, [limit]);
    console.log(`Found ${result.rows.length} observations with notes to process\n`);

    for (const row of result.rows) {
      recordsProcessed++;

      // Combine text fields
      const textParts = [];
      if (row.notes) textParts.push(`Observation Notes: ${row.notes}`);
      if (row.issue_details) textParts.push(`Issue Details: ${row.issue_details}`);
      if (row.issues_encountered?.length > 0) {
        textParts.push(`Issues Encountered: ${row.issues_encountered.join(", ")}`);
      }

      const combinedText = textParts.join("\n\n");
      if (combinedText.length < 20) continue;

      // Add context
      const context = {
        description: `Site observation${row.formatted_address ? ` at ${row.formatted_address}` : ""}. ` +
          `Date: ${row.observation_date || "unknown"}. ` +
          `Cats seen: ${row.cats_seen_total || 0}. ` +
          `Eartipped: ${row.eartipped_seen || 0}. ` +
          `Confidence: ${row.confidence || "unknown"}.`,
      };

      // Extract place attributes
      const placeResult = await extractAttributes(combinedText, "place", placeAttrs, { model, context });
      totalCost += placeResult.cost;

      if (placeResult.extractions.length > 0 && !dryRun) {
        const saved = await saveAttributes("place", row.place_id, placeResult.extractions, {
          source_system: "site_observations",
          source_record_id: row.observation_id,
          extracted_by: model,
        });
        attributesExtracted += saved;
        recordsWithExtractions++;
      }

      if (placeResult.extractions.length > 0) {
        const attrKeys = placeResult.extractions.map((e) => e.attribute_key).join(", ");
        console.log(`[${recordsProcessed}] Observation ${row.observation_id.slice(0, 8)}: ${attrKeys}`);
      }

      // Update extraction status
      if (!dryRun) {
        await pool.query(`
          INSERT INTO trapper.extraction_status (source_table, source_record_id, last_extracted_at, attributes_extracted)
          VALUES ('site_observations', $1, NOW(), $2)
          ON CONFLICT (source_table, source_record_id)
          DO UPDATE SET last_extracted_at = NOW(), attributes_extracted = $2
        `, [row.observation_id, placeResult.extractions.length]);
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
        source_system: "site_observations",
        entity_type: "place",
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
