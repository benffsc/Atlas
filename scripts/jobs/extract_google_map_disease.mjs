#!/usr/bin/env node
/**
 * extract_google_map_disease.mjs
 *
 * Extracts disease mentions from Google Maps KML entries and flags linked places.
 * Uses Sonnet for ALL entries — polarity accuracy is critical.
 *
 * CRITICAL: "FeLV neg" = NEGATIVE (no flag). Only "FeLV+" / "FeLV positive" = POSITIVE.
 *
 * Usage:
 *   node scripts/jobs/extract_google_map_disease.mjs --dry-run
 *   node scripts/jobs/extract_google_map_disease.mjs --limit 100
 *
 * Cost Estimate:
 *   ~78 entries × ~$0.0005/entry = ~$0.04
 */

import { pool } from "./lib/attribute-extractor.mjs";
import Anthropic from "@anthropic-ai/sdk";

const MODEL = 'claude-sonnet-4-20250514';

// Parse CLI arguments
const args = process.argv.slice(2);
const limit = parseInt(args.find((a) => a.startsWith("--limit="))?.split("=")[1] || "200");
const dryRun = args.includes("--dry-run");

console.log("=".repeat(60));
console.log("Google Maps Disease Extraction (DIS_002)");
console.log("=".repeat(60));
console.log(`Limit: ${limit} | Dry Run: ${dryRun}`);
console.log(`Model: ${MODEL} (all entries — polarity critical)`);
console.log("");

const DISEASE_PATTERN = /felv|fiv|feline\s+leukemia|feline\s+immunodeficiency|ringworm|dermatophyt|heartworm|panleuk|feline\s+distemper|parvo|snap\s+(pos|neg|test)/i;

const SYSTEM_PROMPT = `You are an expert veterinary data analyst specializing in TNR (Trap-Neuter-Return) programs.
You are analyzing a historical note from a Google Maps KML pin about a cat colony location.

Extract ONLY disease test/status mentions. Pay EXTREME attention to polarity (positive vs negative).

NEGATIVE indicators (do NOT flag as positive):
- "FeLV neg", "FeLV negative", "FeLV-", "SNAP neg", "tested negative", "no FeLV"
- "FIV neg", "FIV negative", "FIV-", "tested negative for FIV"
- "negative for ringworm", "no ringworm"

POSITIVE indicators (DO flag):
- "FeLV+", "FeLV positive", "FeLV pos", "has FeLV", "FeLV colony"
- "FIV+", "FIV positive", "FIV pos", "has FIV"
- "ringworm", "ringworm colony", "ringworm positive", "has ringworm"
- "heartworm positive"
- "panleukopenia", "panleuk positive", "distemper"

AMBIGUOUS — only flag if context clearly indicates presence at location:
- "tested for FeLV" (without result) — do NOT flag
- "ringworm treatment" — flag as positive (implies presence)

Valid disease_key values: felv, fiv, ringworm, heartworm, panleukopenia

Respond with ONLY a JSON array — no explanation, no markdown, no text before or after.
If no disease mentions found, respond with exactly: []

Format:
[{"disease_key":"felv","polarity":"positive","approximate_date":"2017-09-01","evidence":"Tested him and he was FeLV positive","confidence":0.95}]

For approximate_date:
- "09/17" → "2017-09-01"
- "2019" → "2019-01-01"
- No date → null`;

async function main() {
  const startTime = Date.now();
  let totalCost = 0;
  let recordsProcessed = 0;
  let diseasesExtracted = 0;
  let placesUpdated = 0;
  let negativesSkipped = 0;

  const client = new Anthropic();

  try {
    // Query disease-keyword Google Maps entries not yet processed
    const query = `
      SELECT
        gme.entry_id,
        gme.kml_name,
        gme.original_content,
        gme.ai_summary,
        gme.parsed_date,
        COALESCE(gme.linked_place_id, gme.place_id) as effective_place_id,
        p.formatted_address as place_address
      FROM trapper.google_map_entries gme
      LEFT JOIN trapper.places p ON p.place_id = COALESCE(gme.linked_place_id, gme.place_id)
      WHERE (
        gme.original_content ~* 'felv|fiv|feline\\s+leukemia|feline\\s+immunodeficiency|ringworm|dermatophyt|heartworm|panleuk|feline\\s+distemper|parvo|snap\\s+(pos|neg|test)'
        OR gme.ai_summary ~* 'felv|fiv|feline\\s+leukemia|feline\\s+immunodeficiency|ringworm|dermatophyt|heartworm|panleuk|feline\\s+distemper|parvo|snap\\s+(pos|neg|test)'
      )
      AND COALESCE(gme.linked_place_id, gme.place_id) IS NOT NULL
      -- Skip already-processed entries
      AND NOT EXISTS (
        SELECT 1 FROM trapper.extraction_status es
        WHERE es.source_table = 'google_map_entries'
          AND es.source_record_id = gme.entry_id::TEXT
      )
      ORDER BY gme.imported_at DESC
      LIMIT $1
    `;

    const result = await pool.query(query, [limit]);
    console.log(`Found ${result.rows.length} Google Maps entries with disease keywords\n`);

    for (const entry of result.rows) {
      recordsProcessed++;

      const text = entry.original_content || entry.ai_summary || "";
      if (!text || text.length < 10) continue;

      // Double-check disease keyword presence
      if (!DISEASE_PATTERN.test(text)) continue;

      try {
        const response = await client.messages.create({
          model: MODEL,
          max_tokens: 300,
          system: SYSTEM_PROMPT,
          messages: [{
            role: "user",
            content: `Analyze this Google Maps note for disease mentions:\n\nLocation: ${entry.kml_name || "Unknown"}\nAddress: ${entry.place_address || "Unknown"}\n\nNote:\n${text}`
          }]
        });

        // Calculate cost (Sonnet pricing)
        const inputTokens = response.usage?.input_tokens || 0;
        const outputTokens = response.usage?.output_tokens || 0;
        const cost = (inputTokens * 3 / 1_000_000) + (outputTokens * 15 / 1_000_000);
        totalCost += cost;

        // Parse response
        const responseText = response.content[0]?.type === "text" ? response.content[0].text : "";
        let extractions = [];

        try {
          // Extract first valid JSON array using bracket counting
          // (greedy regex fails when Sonnet appends text after the array)
          const arrayStart = responseText.indexOf('[');
          if (arrayStart !== -1) {
            let depth = 0;
            let arrayEnd = -1;
            for (let i = arrayStart; i < responseText.length; i++) {
              if (responseText[i] === '[') depth++;
              else if (responseText[i] === ']') {
                depth--;
                if (depth === 0) { arrayEnd = i + 1; break; }
              }
            }
            if (arrayEnd > arrayStart) {
              extractions = JSON.parse(responseText.substring(arrayStart, arrayEnd));
            }
          }
        } catch (parseErr) {
          console.warn(`  Parse error for ${entry.kml_name}: ${parseErr.message}`);
        }

        // Process extractions
        let entryHasPositive = false;
        for (const ext of extractions) {
          const { disease_key, polarity, approximate_date, evidence, confidence } = ext;

          // Only process positive results
          if (polarity !== "positive") {
            negativesSkipped++;
            console.log(`  [-] ${entry.kml_name}: ${disease_key} ${polarity} (skipped)`);
            continue;
          }

          // Validate disease_key
          if (!["felv", "fiv", "ringworm", "heartworm", "panleukopenia"].includes(disease_key)) {
            console.warn(`  Invalid disease_key: ${disease_key}`);
            continue;
          }

          // Validate confidence
          if (confidence < 0.5) {
            console.log(`  [?] ${entry.kml_name}: ${disease_key}+ confidence ${confidence} too low (skipped)`);
            continue;
          }

          diseasesExtracted++;
          entryHasPositive = true;

          console.log(
            `  [+] ${entry.kml_name}: ${disease_key}+ ` +
            `(conf: ${confidence}, date: ${approximate_date || "unknown"}) ` +
            `"${(evidence || "").substring(0, 60)}"`
          );

          if (!dryRun) {
            try {
              const hookResult = await pool.query(
                `SELECT trapper.process_disease_extraction_for_place($1, $2, $3, $4, $5)`,
                [
                  entry.effective_place_id,
                  disease_key,
                  'google_maps',
                  `Google Maps: ${(evidence || "").substring(0, 200)}`,
                  approximate_date || null
                ]
              );
              const updated = hookResult.rows[0]?.process_disease_extraction_for_place || 0;
              placesUpdated += updated;
            } catch (hookErr) {
              console.warn(`  Hook error: ${hookErr.message}`);
            }
          }
        }

        // Mark as processed in extraction_status
        if (!dryRun) {
          try {
            await pool.query(`
              INSERT INTO trapper.extraction_status (
                source_table, source_record_id, last_extracted_at,
                attributes_extracted, extraction_hash
              ) VALUES (
                'google_map_entries', $1, NOW(), $2,
                md5($3)
              )
              ON CONFLICT (source_table, source_record_id)
              DO UPDATE SET
                last_extracted_at = NOW(),
                attributes_extracted = $2,
                needs_reextraction = false
            `, [entry.entry_id, entryHasPositive ? 1 : 0, text]);
          } catch (err) {
            // Ignore status update errors
          }
        }

        // Progress
        if (recordsProcessed % 20 === 0) {
          console.log(
            `\n--- Progress: ${recordsProcessed}/${result.rows.length} | ` +
            `Diseases: ${diseasesExtracted} | Cost: $${totalCost.toFixed(4)} ---\n`
          );
        }

      } catch (apiErr) {
        console.error(`  API error for ${entry.kml_name}: ${apiErr.message}`);
      }
    }

    // Summary
    const duration = (Date.now() - startTime) / 1000;

    console.log("\n" + "=".repeat(60));
    console.log("SUMMARY");
    console.log("=".repeat(60));
    console.log(`Entries Processed: ${recordsProcessed}`);
    console.log(`Disease Positives Extracted: ${diseasesExtracted}`);
    console.log(`Negatives Skipped: ${negativesSkipped}`);
    console.log(`Places Updated: ${placesUpdated}`);
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
