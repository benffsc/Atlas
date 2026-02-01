#!/usr/bin/env node
/**
 * reverse_geocode_batch.mjs
 *
 * One-shot batch reverse geocoding for coordinate-only places.
 * Processes the entire get_reverse_geocoding_queue() in one run.
 *
 * Usage:
 *   node scripts/jobs/reverse_geocode_batch.mjs
 *   node scripts/jobs/reverse_geocode_batch.mjs --limit 100
 *   node scripts/jobs/reverse_geocode_batch.mjs --dry-run
 */

import { pool } from "./lib/attribute-extractor.mjs";

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;

const args = process.argv.slice(2);
const limit = parseInt(args.find((a) => a.startsWith("--limit="))?.split("=")[1] || "2000");
const dryRun = args.includes("--dry-run");

console.log("=".repeat(60));
console.log("Batch Reverse Geocoding");
console.log("=".repeat(60));
console.log(`Limit: ${limit} | Dry Run: ${dryRun}`);
console.log("");

if (!GOOGLE_API_KEY) {
  console.error("Error: GOOGLE_PLACES_API_KEY or GOOGLE_MAPS_API_KEY required");
  process.exit(1);
}

async function main() {
  const startTime = Date.now();
  let processed = 0;
  let upgraded = 0;
  let merged = 0;
  let failed = 0;
  let apiCost = 0;

  try {
    const { rows: queue } = await pool.query(
      "SELECT * FROM trapper.get_reverse_geocoding_queue($1)",
      [limit]
    );

    console.log(`Found ${queue.length} coordinate-only places to reverse geocode\n`);

    for (const place of queue) {
      processed++;

      try {
        const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
        url.searchParams.set("latlng", `${place.lat},${place.lng}`);
        url.searchParams.set("key", GOOGLE_API_KEY);

        const response = await fetch(url.toString());
        const data = await response.json();
        apiCost += 0.005;

        if (data.status === "OK" && data.results?.[0]?.formatted_address) {
          const googleAddress = data.results[0].formatted_address;

          if (dryRun) {
            console.log(`  [→] ${place.display_name} → ${googleAddress}`);
            upgraded++;
          } else {
            const { rows } = await pool.query(
              "SELECT trapper.record_reverse_geocoding_result($1, TRUE, $2)",
              [place.place_id, googleAddress]
            );

            const result = rows[0]?.record_reverse_geocoding_result;
            if (result?.action === "merged") {
              merged++;
              console.log(`  [M] ${place.display_name} → merged into existing (${googleAddress})`);
            } else {
              upgraded++;
              console.log(`  [U] ${place.display_name} → ${googleAddress}`);
            }
          }
        } else {
          const error = data.status === "ZERO_RESULTS"
            ? "No address found"
            : data.error_message || data.status || "Unknown";

          if (!dryRun) {
            await pool.query(
              "SELECT trapper.record_reverse_geocoding_result($1, FALSE, NULL, $2)",
              [place.place_id, error]
            );
          }
          failed++;
          console.log(`  [X] ${place.display_name} — ${error}`);
        }

        // Rate limit — 50ms between requests
        await new Promise((r) => setTimeout(r, 50));

        // Progress every 50
        if (processed % 50 === 0) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
          console.log(
            `\n--- Progress: ${processed}/${queue.length} | Upgraded: ${upgraded} | Merged: ${merged} | Failed: ${failed} | ${elapsed}s ---\n`
          );
        }
      } catch (err) {
        failed++;
        console.log(`  [X] ${place.display_name} — ${err.message}`);
        if (!dryRun) {
          await pool.query(
            "SELECT trapper.record_reverse_geocoding_result($1, FALSE, NULL, $2)",
            [place.place_id, err.message]
          ).catch(() => {});
        }
      }
    }

    const duration = (Date.now() - startTime) / 1000;

    console.log("\n" + "=".repeat(60));
    console.log("SUMMARY");
    console.log("=".repeat(60));
    console.log(`Processed: ${processed}`);
    console.log(`Upgraded (new address): ${upgraded}`);
    console.log(`Merged (matched existing): ${merged}`);
    console.log(`Failed: ${failed}`);
    console.log(`Estimated API Cost: $${apiCost.toFixed(2)}`);
    console.log(`Duration: ${duration.toFixed(1)}s`);
    console.log(`Dry Run: ${dryRun}`);

    // Final stats
    if (!dryRun) {
      const { rows: stats } = await pool.query("SELECT * FROM trapper.v_reverse_geocoding_stats");
      if (stats[0]) {
        console.log(`\nRemaining: ${stats[0].pending_reverse} pending, ${stats[0].failed_reverse} failed`);
      }
    }
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
