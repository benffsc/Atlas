#!/usr/bin/env node
/**
 * extract_communication_attributes.mjs
 *
 * Extracts structured attributes from communication logs.
 * Targets: notes from communication_logs
 * Entity Types: person (primarily - tracks responsiveness)
 *
 * Usage:
 *   node scripts/jobs/extract_communication_attributes.mjs --limit 100 --dry-run
 *   node scripts/jobs/extract_communication_attributes.mjs --limit 500
 *
 * Cost Estimate:
 *   ~1,000 logs × ~$0.0005/record = ~$0.50
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
console.log("Communication Log Attribute Extraction");
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
    // Get attribute definitions for persons
    const personAttrs = await getAttributeDefinitions("person");
    console.log(`Loaded ${personAttrs.length} person attributes`);

    // Query communication logs with notes
    const query = `
      SELECT
        cl.log_id,
        cl.submission_id,
        cl.contact_method,
        cl.contact_result,
        cl.notes,
        cl.contacted_at,
        cl.contacted_by,
        i.matched_person_id,
        i.place_id,
        p.display_name as person_name
      FROM trapper.communication_logs cl
      JOIN trapper.web_intake_submissions i ON i.submission_id = cl.submission_id
      LEFT JOIN trapper.sot_people p ON p.person_id = i.matched_person_id
      WHERE cl.notes IS NOT NULL
      AND LENGTH(cl.notes) > 20
      AND i.matched_person_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM trapper.extraction_status es
        WHERE es.source_table = 'communication_logs'
        AND es.source_record_id = cl.log_id::text
        AND es.last_extracted_at > NOW() - INTERVAL '7 days'
      )
      ORDER BY cl.contacted_at DESC NULLS LAST
      LIMIT $1
    `;

    const result = await pool.query(query, [limit]);
    console.log(`Found ${result.rows.length} communication logs with notes to process\n`);

    for (const row of result.rows) {
      recordsProcessed++;

      // Build context from communication
      const context = {
        description: `Communication log for ${row.person_name || "unknown person"}. ` +
          `Method: ${row.contact_method || "unknown"}. ` +
          `Result: ${row.contact_result || "unknown"}. ` +
          `Date: ${row.contacted_at ? new Date(row.contacted_at).toLocaleDateString() : "unknown"}.`,
      };

      // Extract person attributes
      const personResult = await extractAttributes(row.notes, "person", personAttrs, { model, context });
      totalCost += personResult.cost;

      if (personResult.extractions.length > 0 && !dryRun) {
        const saved = await saveAttributes("person", row.matched_person_id, personResult.extractions, {
          source_system: "communication_logs",
          source_record_id: row.log_id,
          extracted_by: model,
        });
        attributesExtracted += saved;
        recordsWithExtractions++;
      }

      if (personResult.extractions.length > 0) {
        const attrKeys = personResult.extractions.map((e) => e.attribute_key).join(", ");
        console.log(`[${recordsProcessed}] Log ${row.log_id.slice(0, 8)}: ${attrKeys}`);
      }

      // Update extraction status
      if (!dryRun) {
        await pool.query(`
          INSERT INTO trapper.extraction_status (source_table, source_record_id, last_extracted_at, attributes_extracted)
          VALUES ('communication_logs', $1, NOW(), $2)
          ON CONFLICT (source_table, source_record_id)
          DO UPDATE SET last_extracted_at = NOW(), attributes_extracted = $2
        `, [row.log_id, personResult.extractions.length]);
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
        source_system: "communication_logs",
        entity_type: "person",
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
