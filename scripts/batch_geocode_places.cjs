#!/usr/bin/env node
// DEPRECATED: v1 script. References trapper.* schema dropped in MIG_2299. Do not run.

/**
 * Batch Geocode Places
 *
 * This script geocodes places that have addresses but no coordinates.
 * It uses the Google Geocoding API.
 *
 * Run from apps/web directory:
 * node ../../scripts/batch_geocode_places.mjs [--limit N] [--dry-run]
 */

// Use CommonJS require to work with the web app's node_modules
const pg = require("pg");
require("dotenv").config();

const { Pool } = pg;

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;

if (!GOOGLE_API_KEY) {
  console.error("ERROR: GOOGLE_PLACES_API_KEY or GOOGLE_MAPS_API_KEY not set");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function geocodeAddress(address) {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("key", GOOGLE_API_KEY);

  const response = await fetch(url.toString());
  const data = await response.json();

  if (data.status === "OK" && data.results && data.results.length > 0) {
    const location = data.results[0].geometry.location;
    return {
      success: true,
      lat: location.lat,
      lng: location.lng,
      formatted_address: data.results[0].formatted_address,
    };
  }

  return {
    success: false,
    error: data.status || "Unknown error",
  };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 50;

  console.log("Batch Geocode Places");
  console.log("====================");
  console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`Limit: ${limit}`);
  console.log("");

  try {
    // Get places without coordinates
    const result = await pool.query(
      `SELECT place_id, display_name, formatted_address
       FROM trapper.places
       WHERE location IS NULL
         AND formatted_address IS NOT NULL
         AND formatted_address != ''
       LIMIT $1`,
      [limit]
    );

    console.log(`Found ${result.rows.length} places without coordinates`);
    console.log("");

    if (result.rows.length === 0) {
      console.log("All places have coordinates!");
      return;
    }

    let successCount = 0;
    let failCount = 0;

    for (const place of result.rows) {
      process.stdout.write(`Geocoding: ${place.formatted_address.substring(0, 60).padEnd(60)} `);

      const geo = await geocodeAddress(place.formatted_address);

      if (geo.success) {
        if (!dryRun) {
          await pool.query(
            `UPDATE trapper.places
             SET location = ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
                 updated_at = NOW()
             WHERE place_id = $3`,
            [geo.lat, geo.lng, place.place_id]
          );
        }
        console.log(`OK (${geo.lat.toFixed(5)}, ${geo.lng.toFixed(5)})`);
        successCount++;
      } else {
        console.log(`FAIL: ${geo.error}`);
        failCount++;
      }

      // Small delay to avoid rate limiting
      await new Promise((r) => setTimeout(r, 100));
    }

    console.log("");
    console.log("Summary");
    console.log("-------");
    console.log(`Success: ${successCount}`);
    console.log(`Failed: ${failCount}`);

    // Check remaining
    const remaining = await pool.query(
      `SELECT COUNT(*) as count
       FROM trapper.places
       WHERE location IS NULL
         AND formatted_address IS NOT NULL
         AND formatted_address != ''`
    );
    console.log(`Remaining without coordinates: ${remaining.rows[0].count}`);

  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
