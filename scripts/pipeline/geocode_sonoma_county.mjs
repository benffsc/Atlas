#!/usr/bin/env node
/**
 * geocode_sonoma_county.mjs (FFS-337)
 *
 * Re-geocodes ~24 places in sot.places that have "Sonoma County, CA" in
 * their formatted_address but no coordinates (location IS NULL).
 *
 * Strategy:
 *   1. Query places matching the criteria
 *   2. Replace "Sonoma County, CA" with "Santa Rosa, CA" (most are Santa Rosa)
 *   3. Call Google Maps Geocoding API with the cleaned address
 *   4. Verify the result is in Sonoma County (lat ~38.2-38.8, lng ~-123.1 to -122.4)
 *   5. Update sot.places with lat/lng and PostGIS location
 *   6. Also update sot.addresses via find_or_create_address() if applicable
 *
 * Usage:
 *   cd apps/web
 *   set -a && source .env.local && set +a
 *   node ../../scripts/pipeline/geocode_sonoma_county.mjs --dry-run
 *   node ../../scripts/pipeline/geocode_sonoma_county.mjs
 *
 * Environment:
 *   DATABASE_URL          - Postgres connection string (required)
 *   GOOGLE_MAPS_API_KEY   - Google API key with Geocoding enabled (required)
 */

import pg from 'pg';
const { Client } = pg;

// ============================================
// Configuration
// ============================================

const GOOGLE_GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const RATE_LIMIT_DELAY_MS = 150; // 150ms between API calls

// Sonoma County bounding box (loose) for sanity-checking results
const SONOMA_BOUNDS = {
  latMin: 38.1,
  latMax: 38.9,
  lngMin: -123.2,
  lngMax: -122.3,
};

// Colors for output
const green = '\x1b[32m';
const red = '\x1b[31m';
const yellow = '\x1b[33m';
const cyan = '\x1b[36m';
const reset = '\x1b[0m';
const bold = '\x1b[1m';
const dim = '\x1b[2m';

// ============================================
// Argument Parsing
// ============================================

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    dryRun: false,
    verbose: false,
  };

  for (const arg of args) {
    switch (arg) {
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      case '--help':
      case '-h':
        console.log(`
Usage: node geocode_sonoma_county.mjs [options]

Options:
  --dry-run    Print what would happen without updating the database
  --verbose    Show detailed API responses
  --help       Show this help message
`);
        process.exit(0);
    }
  }

  return options;
}

// ============================================
// Google Geocoding
// ============================================

async function geocodeAddress(address, apiKey) {
  const url = new URL(GOOGLE_GEOCODE_URL);
  url.searchParams.set('address', address);
  url.searchParams.set('key', apiKey);

  const response = await fetch(url.toString());
  const data = await response.json();

  if (data.status === 'OK' && data.results?.length > 0) {
    const result = data.results[0];
    const { lat, lng } = result.geometry.location;
    return {
      success: true,
      lat,
      lng,
      formatted_address: result.formatted_address,
      location_type: result.geometry.location_type,
      place_id: result.place_id,
    };
  }

  return {
    success: false,
    error: data.status === 'ZERO_RESULTS'
      ? 'Address not found'
      : data.error_message || data.status || 'Unknown error',
  };
}

function isInSonomaCounty(lat, lng) {
  return (
    lat >= SONOMA_BOUNDS.latMin &&
    lat <= SONOMA_BOUNDS.latMax &&
    lng >= SONOMA_BOUNDS.lngMin &&
    lng <= SONOMA_BOUNDS.lngMax
  );
}

/**
 * Clean up "Sonoma County" addresses for better geocoding.
 *
 * Most of these addresses are street addresses in Santa Rosa or
 * other Sonoma County cities. Replacing "Sonoma County, CA" with
 * just "CA" lets Google figure out the correct city from the
 * street address + zip code.
 */
function cleanAddress(formatted_address) {
  // Remove "Sonoma County, " and let Google resolve the city
  // e.g., "123 Main St, Sonoma County, CA 95401" → "123 Main St, CA 95401"
  // Google will figure out "Santa Rosa" from the zip code
  let cleaned = formatted_address.replace(/,?\s*Sonoma County,?\s*/i, ', ');

  // Remove parenthetical notes like "(Co. #346434)"
  cleaned = cleaned.replace(/\s*\([^)]*\)\s*/g, ' ');

  // Clean up double commas or leading/trailing commas
  cleaned = cleaned.replace(/,\s*,/g, ',').replace(/^,\s*/, '').replace(/,\s*$/, '');

  return cleaned.trim();
}

/**
 * Retry strategy: replace "Sonoma County" with "Santa Rosa, Sonoma County"
 * to anchor ambiguous addresses (Sunset Ave, Apollo Way, Oakland Ave, Highway 12)
 * within Sonoma County.
 */
function cleanAddressWithCountyHint(formatted_address) {
  let cleaned = formatted_address.replace(
    /,?\s*Sonoma County,?\s*CA/i,
    ', Santa Rosa, Sonoma County, CA'
  );

  // Remove parenthetical notes
  cleaned = cleaned.replace(/\s*\([^)]*\)\s*/g, ' ');

  // Clean up double commas
  cleaned = cleaned.replace(/,\s*,/g, ',').replace(/^,\s*/, '').replace(/,\s*$/, '');

  return cleaned.trim();
}

// ============================================
// Main
// ============================================

async function main() {
  const options = parseArgs();
  const apiKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
  const dbUrl = process.env.DATABASE_URL;

  console.log('');
  console.log(`${bold}FFS-337: Re-geocode "Sonoma County, CA" Places${reset}`);
  console.log('='.repeat(50));
  console.log(`Mode: ${options.dryRun ? `${yellow}DRY RUN${reset}` : `${red}LIVE${reset}`}`);
  console.log('');

  if (!apiKey) {
    console.error(`${red}ERROR: GOOGLE_MAPS_API_KEY or GOOGLE_PLACES_API_KEY not set${reset}`);
    console.error('Run: set -a && source .env.local && set +a');
    process.exit(1);
  }

  if (!dbUrl) {
    console.error(`${red}ERROR: DATABASE_URL not set${reset}`);
    process.exit(1);
  }

  const client = new Client({ connectionString: dbUrl });
  await client.connect();

  try {
    // Step 1: Query places needing geocoding
    const { rows: places } = await client.query(`
      SELECT
        p.place_id,
        p.display_name,
        p.formatted_address,
        p.sot_address_id,
        p.place_kind,
        p.merged_into_place_id
      FROM sot.places p
      WHERE p.formatted_address ILIKE '%Sonoma County%'
        AND p.location IS NULL
        AND p.merged_into_place_id IS NULL
      ORDER BY p.formatted_address
    `);

    console.log(`Found ${bold}${places.length}${reset} places with "Sonoma County" and no coordinates`);
    console.log('');

    if (places.length === 0) {
      console.log(`${green}Nothing to do — all "Sonoma County" places have coordinates.${reset}`);
      await client.end();
      return;
    }

    // Step 2: Process each place
    const results = {
      success: [],
      noResults: [],
      outOfBounds: [],
      error: [],
    };

    for (let i = 0; i < places.length; i++) {
      const place = places[i];
      const cleaned = cleanAddress(place.formatted_address);

      process.stdout.write(
        `[${String(i + 1).padStart(2)}/${places.length}] ${dim}${place.formatted_address.substring(0, 55).padEnd(55)}${reset} `
      );

      if (options.verbose) {
        console.log('');
        console.log(`       Cleaned: ${cyan}${cleaned}${reset}`);
        process.stdout.write('       Result:  ');
      }

      try {
        let geo = await geocodeAddress(cleaned, apiKey);
        let usedAddress = cleaned;
        let retried = false;

        // Retry strategy: if first attempt fails or resolves outside Sonoma County,
        // retry with "Santa Rosa, Sonoma County, CA" hint to anchor the search
        const needsRetry =
          (!geo.success) ||
          (geo.success && !isInSonomaCounty(geo.lat, geo.lng));

        if (needsRetry) {
          const retryAddress = cleanAddressWithCountyHint(place.formatted_address);
          if (options.verbose) {
            console.log(
              `${yellow}${geo.success ? 'OUT OF BOUNDS' : 'FAIL'}${reset} — retrying with county hint: ${cyan}${retryAddress}${reset}`
            );
            process.stdout.write('       Retry:   ');
          } else {
            process.stdout.write(`${yellow}retry${reset} `);
          }

          await new Promise((r) => setTimeout(r, RATE_LIMIT_DELAY_MS));
          const retryGeo = await geocodeAddress(retryAddress, apiKey);

          if (retryGeo.success && isInSonomaCounty(retryGeo.lat, retryGeo.lng)) {
            geo = retryGeo;
            usedAddress = retryAddress;
            retried = true;
          }
          // If retry also fails or is out-of-bounds, keep the original result
        }

        if (geo.success && isInSonomaCounty(geo.lat, geo.lng)) {
          console.log(
            `${green}OK${reset}${retried ? ` ${dim}(retried)${reset}` : ''} (${geo.lat.toFixed(5)}, ${geo.lng.toFixed(5)}) → ${geo.formatted_address}`
          );

          if (!options.dryRun) {
            // Update place with coordinates
            await client.query(
              `UPDATE sot.places
               SET location = ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
                   formatted_address = $3,
                   updated_at = NOW()
               WHERE place_id = $4`,
              [geo.lat, geo.lng, geo.formatted_address, place.place_id]
            );

            // Update or create sot.addresses link
            await client.query(
              `UPDATE sot.places
               SET sot_address_id = sot.find_or_create_address(
                 $1, $2, $3, $4, 'google_maps'
               )
               WHERE place_id = $5
                 AND sot_address_id IS NULL`,
              [
                place.formatted_address, // raw_input (original)
                geo.formatted_address,    // formatted_address (from Google)
                geo.lat,
                geo.lng,
                place.place_id,
              ]
            );
          }

          results.success.push({
            ...place,
            cleaned: usedAddress,
            geo,
            retried,
          });
        } else if (geo.success) {
          // Resolved but outside Sonoma County even after retry
          console.log(
            `${yellow}OUT OF BOUNDS${reset} (${geo.lat.toFixed(5)}, ${geo.lng.toFixed(5)}) → ${geo.formatted_address}`
          );
          results.outOfBounds.push({
            ...place,
            cleaned: usedAddress,
            geo,
          });
        } else {
          console.log(`${red}FAIL: ${geo.error}${reset}`);
          results.noResults.push({
            ...place,
            cleaned: usedAddress,
            error: geo.error,
          });
        }
      } catch (err) {
        console.log(`${red}ERROR: ${err.message}${reset}`);
        results.error.push({
          ...place,
          cleaned,
          error: err.message,
        });
      }

      // Rate limit
      await new Promise((r) => setTimeout(r, RATE_LIMIT_DELAY_MS));
    }

    // Step 3: Summary
    console.log('');
    console.log(`${bold}Summary${reset}`);
    console.log('-'.repeat(50));
    console.log(`${green}Geocoded:${reset}       ${results.success.length}`);
    console.log(`${yellow}Out of bounds:${reset}  ${results.outOfBounds.length}`);
    console.log(`${red}No results:${reset}     ${results.noResults.length}`);
    console.log(`${red}Errors:${reset}         ${results.error.length}`);
    console.log(`Total:          ${places.length}`);

    if (options.dryRun) {
      console.log('');
      console.log(`${yellow}DRY RUN — no database changes were made.${reset}`);
      console.log(`Run without --dry-run to apply updates.`);
    }

    // Show failures for investigation
    if (results.noResults.length > 0 || results.outOfBounds.length > 0) {
      console.log('');
      console.log(`${bold}Places needing manual review:${reset}`);
      for (const p of [...results.noResults, ...results.outOfBounds]) {
        console.log(`  - ${p.place_id}: ${p.formatted_address}`);
        console.log(`    Cleaned: ${p.cleaned}`);
        if (p.error) console.log(`    Error: ${p.error}`);
        if (p.geo) console.log(`    Google: ${p.geo.formatted_address} (${p.geo.lat}, ${p.geo.lng})`);
      }
    }

  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(`${red}Fatal error: ${err.message}${reset}`);
  console.error(err.stack);
  process.exit(1);
});
