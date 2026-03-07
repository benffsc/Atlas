#!/usr/bin/env node
/**
 * process_extraction_queue.mjs
 *
 * Unified queue processor for the AI Extraction Engine.
 * Processes pending items from extraction_queue by dispatching to
 * the appropriate extraction logic based on source_table.
 *
 * This bridges the gap between:
 *   - Database triggers (queue new/updated records)
 *   - Extraction scripts (process and extract attributes)
 *   - Classification engine (update place contexts from extractions)
 *
 * Usage:
 *   node scripts/jobs/process_extraction_queue.mjs --limit 50
 *   node scripts/jobs/process_extraction_queue.mjs --source sot_appointments --limit 100
 *   node scripts/jobs/process_extraction_queue.mjs --dry-run
 *
 * Designed for cron: runs once and exits.
 */

import {
  getAttributeDefinitions,
  extractAttributes,
  saveAttributes,
  logExtractionJob,
  pool,
} from "./lib/attribute-extractor.mjs";

const MODELS = {
  fast: "claude-haiku-4-5-20251001",
  quality: "claude-sonnet-4-20250514",
};

const REQUIRES_SONNET = {
  recapture:
    /recapture|recheck|return\s+visit|eartip\s*(present|noted)|already\s*(tipped|fixed)|previously\s+(fixed|altered)/i,
  population_count:
    /\d+\s*(unfixed|intact|not fixed|unaltered)|\d+\s*(eartip|tipped|clipped)/i,
  reproduction:
    /litter\s*(of|size)?\s*\d|(\d+)\s*kittens|pregnant|gestational|lactating|nursing\s+mom|has\s+milk/i,
  complex_history:
    /(\d+)\s*years?\s+(feeding|feed)|feeding\s+(since|for)\s+\d{4}|trap\s+shy|wont?\s+go\s+in/i,
};

function shouldUseSonnet(text) {
  return Object.values(REQUIRES_SONNET).some((pattern) => pattern.test(text));
}

// Parse CLI arguments
const args = process.argv.slice(2);
const limit = parseInt(
  args.find((a) => a.startsWith("--limit="))?.split("=")[1] || "50"
);
const dryRun = args.includes("--dry-run");
const sourceFilter = args
  .find((a) => a.startsWith("--source="))
  ?.split("=")[1];

console.log("=".repeat(60));
console.log("AI Extraction Engine - Queue Processor");
console.log("=".repeat(60));
console.log(
  `Limit: ${limit} | Dry Run: ${dryRun} | Source: ${sourceFilter || "all"}`
);
console.log("");

async function fetchSourceRecord(sourceTable, sourceRecordId) {
  switch (sourceTable) {
    case "sot_appointments": {
      const r = await pool.query(
        `SELECT a.appointment_id, a.cat_id, a.medical_notes,
                c.display_name as cat_name, cpr.place_id
         FROM ops.appointments a
         LEFT JOIN sot.cats c ON c.cat_id = a.cat_id
         LEFT JOIN sot.cat_place_relationships cpr ON cpr.cat_id = a.cat_id
           AND cpr.relationship_type = 'appointment_site'
         WHERE a.appointment_id = $1`,
        [sourceRecordId]
      );
      return r.rows[0];
    }
    case "sot_requests": {
      const r = await pool.query(
        `SELECT r.request_id, r.place_id, r.requester_person_id,
                r.summary, r.notes, r.internal_notes, r.hold_reason_notes,
                r.status, p.formatted_address, pe.display_name as requester_name
         FROM ops.requests r
         LEFT JOIN sot.places p ON p.place_id = r.place_id
         LEFT JOIN sot.people pe ON pe.person_id = r.requester_person_id
         WHERE r.request_id = $1`,
        [sourceRecordId]
      );
      return r.rows[0];
    }
    case "web_intake_submissions": {
      const r = await pool.query(
        `SELECT i.submission_id, i.place_id, i.situation_description,
                i.requester_person_id, p.formatted_address
         FROM ops.intake_submissions i
         LEFT JOIN sot.places p ON p.place_id = i.place_id
         WHERE i.submission_id = $1`,
        [sourceRecordId]
      );
      return r.rows[0];
    }
    default:
      return null;
  }
}

function getTextForExtraction(sourceTable, record) {
  if (!record) return null;
  switch (sourceTable) {
    case "sot_appointments":
      return record.medical_notes
        ? `Medical Notes: ${record.medical_notes}`
        : null;
    case "sot_requests":
      return [
        record.summary && `Summary: ${record.summary}`,
        record.notes && `Notes: ${record.notes}`,
        record.internal_notes && `Internal: ${record.internal_notes}`,
        record.hold_reason_notes && `Hold Reason: ${record.hold_reason_notes}`,
      ]
        .filter(Boolean)
        .join("\n\n") || null;
    case "web_intake_submissions":
      return record.situation_description
        ? `Situation: ${record.situation_description}`
        : null;
    default:
      return null;
  }
}

async function processQueueItem(item, allAttrs) {
  const record = await fetchSourceRecord(
    item.source_table,
    item.source_record_id
  );
  if (!record) return { extracted: 0, cost: 0, skipped: "record_not_found" };

  const text = getTextForExtraction(item.source_table, record);
  if (!text || text.length < 20)
    return { extracted: 0, cost: 0, skipped: "no_extractable_content" };

  const useSonnet = shouldUseSonnet(text);
  const model = useSonnet ? MODELS.quality : MODELS.fast;
  const modelTag = useSonnet ? "[S]" : "[H45]";

  let totalExtracted = 0;
  let totalCost = 0;
  const extractedKeys = [];

  const sourceInfo = {
    source_system: item.source_table,
    source_record_id: item.source_record_id,
    extracted_by: useSonnet ? "claude_sonnet" : "claude_haiku",
  };

  // Extract cat attributes (appointments)
  if (item.source_table === "sot_appointments" && record.cat_id) {
    const catAttrs = allAttrs.filter((a) => a.entity_type === "cat");
    const result = await extractAttributes(text, "cat", catAttrs, {
      model,
      context: {
        description: `Clinic appointment note for cat "${record.cat_name || "Unknown"}".`,
      },
    });
    totalCost += result.cost;
    if (result.extractions.length > 0 && !dryRun) {
      const saved = await saveAttributes(
        "cat",
        record.cat_id,
        result.extractions,
        sourceInfo
      );
      totalExtracted += saved;
      extractedKeys.push(
        ...result.extractions.map((e) => e.attribute_key)
      );
    }
  }

  // Extract place attributes (all sources with place_id)
  const placeId =
    record.place_id ||
    (item.source_table === "sot_appointments" ? record.place_id : null);
  if (placeId) {
    const placeAttrs = allAttrs.filter((a) => a.entity_type === "place");
    const result = await extractAttributes(text, "place", placeAttrs, {
      model,
      context: {
        description: `Look for information about the property/location itself.`,
      },
    });
    totalCost += result.cost;
    if (result.extractions.length > 0 && !dryRun) {
      const saved = await saveAttributes(
        "place",
        placeId,
        result.extractions,
        sourceInfo
      );
      totalExtracted += saved;
      extractedKeys.push(
        ...result.extractions.map((e) => `place:${e.attribute_key}`)
      );
    }
  }

  // Extract person attributes (requests with requester)
  if (
    item.source_table === "sot_requests" &&
    record.requester_person_id
  ) {
    const personAttrs = allAttrs.filter((a) => a.entity_type === "person");
    const result = await extractAttributes(text, "person", personAttrs, {
      model,
      context: {
        description: `TNR request from ${record.requester_name || "a caller"}.`,
      },
    });
    totalCost += result.cost;
    if (result.extractions.length > 0 && !dryRun) {
      const saved = await saveAttributes(
        "person",
        record.requester_person_id,
        result.extractions,
        sourceInfo
      );
      totalExtracted += saved;
      extractedKeys.push(
        ...result.extractions.map((e) => `person:${e.attribute_key}`)
      );
    }
  }

  // Extract request attributes
  if (item.source_table === "sot_requests") {
    const requestAttrs = allAttrs.filter(
      (a) => a.entity_type === "request"
    );
    const result = await extractAttributes(text, "request", requestAttrs, {
      model,
      context: {
        description: `TNR service request for ${record.formatted_address || "Sonoma County"}.`,
      },
    });
    totalCost += result.cost;
    if (result.extractions.length > 0 && !dryRun) {
      const saved = await saveAttributes(
        "request",
        record.request_id,
        result.extractions,
        sourceInfo
      );
      totalExtracted += saved;
      extractedKeys.push(
        ...result.extractions.map((e) => `req:${e.attribute_key}`)
      );
    }
  }

  if (extractedKeys.length > 0) {
    console.log(
      `${modelTag} ${item.source_table}/${item.source_record_id.slice(0, 8)}: ${extractedKeys.join(", ")}`
    );
  }

  return {
    extracted: totalExtracted,
    cost: totalCost,
    skipped: null,
    model: useSonnet ? "sonnet" : "haiku45",
  };
}

async function updateClassificationFromExtraction(placeId) {
  if (!placeId || dryRun) return;

  // Use the bridge function to classify place from its extracted attributes
  try {
    await pool.query(
      `SELECT ops.classify_place_from_extractions($1)`,
      [placeId]
    );
  } catch {
    // Ignore classification errors
  }
}

async function main() {
  const startTime = Date.now();
  let totalCost = 0;
  let recordsProcessed = 0;
  let recordsWithExtractions = 0;
  let attributesExtracted = 0;
  let sonnetCount = 0;
  let haiku45Count = 0;

  try {
    const allAttrs = await getAttributeDefinitions();
    console.log(`Loaded ${allAttrs.length} attribute definitions\n`);

    // Fetch pending queue items
    const sourceClause = sourceFilter
      ? `AND eq.source_table = '${sourceFilter}'`
      : "";
    const queueResult = await pool.query(`
      SELECT eq.queue_id, eq.source_table, eq.source_record_id,
             eq.entity_type, eq.entity_id, eq.priority, eq.trigger_reason
      FROM ops.extraction_queue eq
      WHERE eq.completed_at IS NULL
        AND eq.error_count < 3
        ${sourceClause}
      ORDER BY eq.priority ASC, eq.queued_at ASC
      LIMIT $1
    `, [limit]);

    console.log(`Queue items to process: ${queueResult.rows.length}\n`);

    for (const item of queueResult.rows) {
      recordsProcessed++;

      try {
        const result = await processQueueItem(item, allAttrs);

        totalCost += result.cost;
        if (result.extracted > 0) {
          recordsWithExtractions++;
          attributesExtracted += result.extracted;
        }
        if (result.model === "sonnet") sonnetCount++;
        else haiku45Count++;

        // Mark processed in extraction_status
        if (!dryRun) {
          await pool.query(
            `
            INSERT INTO ops.extraction_status (
              source_table, source_record_id, last_extracted_at,
              attributes_extracted, model_used, skip_reason
            ) VALUES ($1, $2, NOW(), $3, $4, $5)
            ON CONFLICT (source_table, source_record_id)
            DO UPDATE SET
              last_extracted_at = NOW(),
              attributes_extracted = $3,
              model_used = $4,
              needs_reextraction = false
          `,
            [
              item.source_table,
              item.source_record_id,
              result.extracted,
              result.model || "haiku45",
              result.skipped,
            ]
          );

          // Mark queue item completed
          await pool.query(
            `UPDATE ops.extraction_queue SET completed_at = NOW() WHERE queue_id = $1`,
            [item.queue_id]
          );

          // Update classification if place attributes were extracted
          if (item.entity_type === "place" && item.entity_id) {
            await updateClassificationFromExtraction(item.entity_id);
          }
        }
      } catch (err) {
        console.error(
          `Error processing ${item.source_table}/${item.source_record_id}: ${err.message}`
        );
        if (!dryRun) {
          await pool.query(
            `UPDATE ops.extraction_queue
             SET error_count = error_count + 1, last_error = $2
             WHERE queue_id = $1`,
            [item.queue_id, err.message]
          );
        }
      }

      if (recordsProcessed % 25 === 0) {
        console.log(
          `\n--- Progress: ${recordsProcessed}/${queueResult.rows.length} | Cost: $${totalCost.toFixed(4)} ---\n`
        );
      }
    }

    // Log job
    if (!dryRun && recordsProcessed > 0) {
      const jobId = await logExtractionJob({
        source_system: "queue_processor",
        entity_type: sourceFilter || "mixed",
        batch_size: limit,
        records_processed: recordsProcessed,
        records_with_extractions: recordsWithExtractions,
        attributes_extracted: attributesExtracted,
        model_used: `tiered (haiku45:${haiku45Count}, sonnet:${sonnetCount})`,
        cost_estimate_usd: totalCost,
        notes: "Queue processor run",
      });
      console.log(`\nLogged job: ${jobId}`);
    }

    const duration = (Date.now() - startTime) / 1000;
    console.log("\n" + "=".repeat(60));
    console.log("QUEUE PROCESSOR SUMMARY");
    console.log("=".repeat(60));
    console.log(`Queue items processed: ${recordsProcessed}`);
    console.log(
      `With extractions: ${recordsWithExtractions} (${recordsProcessed > 0 ? ((recordsWithExtractions / recordsProcessed) * 100).toFixed(1) : 0}%)`
    );
    console.log(`Attributes extracted: ${attributesExtracted}`);
    console.log(
      `Models: H45=${haiku45Count} S=${sonnetCount} (${recordsProcessed > 0 ? ((sonnetCount / recordsProcessed) * 100).toFixed(1) : 0}% escalation)`
    );
    console.log(`Cost: $${totalCost.toFixed(4)}`);
    console.log(`Duration: ${duration.toFixed(1)}s`);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
