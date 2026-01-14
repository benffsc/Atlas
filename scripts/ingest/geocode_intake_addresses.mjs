#!/usr/bin/env node
/**
 * geocode_intake_addresses.mjs
 *
 * Geocodes addresses in web_intake_submissions using Google Geocoding API.
 *
 * Philosophy:
 *   - Atlas Intake Queue is SoT - must be protected from bad data
 *   - Bad data must not be lost - original address preserved, clean version added
 *   - Confidence flags help staff identify addresses needing manual review
 *
 * Usage:
 *   set -a && source .env && set +a
 *   node scripts/ingest/geocode_intake_addresses.mjs
 *   node scripts/ingest/geocode_intake_addresses.mjs --limit 100
 *   node scripts/ingest/geocode_intake_addresses.mjs --dry-run
 *   node scripts/ingest/geocode_intake_addresses.mjs --reprocess-failed
 */

import pg from 'pg';

const { Client } = pg;

// Google Geocoding API endpoint
const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

// Rate limiting: Google allows 50 requests/second, we'll be conservative
const RATE_LIMIT_MS = 100; // 10 requests/second max
const BATCH_SIZE = 50;

// Addresses that are clearly not geocodable
const SKIP_PATTERNS = [
  /^#\d+$/,                    // Just "#4" or similar
  /^unknown$/i,
  /^n\/?a$/i,
  /^none$/i,
  /^tbd$/i,
  /^\?+$/,
  /^-+$/,
  /^\s*$/,
];

// Sonoma County bounds for validation
const SONOMA_BOUNDS = {
  north: 38.85,
  south: 38.10,
  east: -122.35,
  west: -123.15,
};

// ============================================
// Argument Parsing
// ============================================

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    limit: null,
    dryRun: false,
    reprocessFailed: false,
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--limit':
        options.limit = parseInt(args[++i], 10);
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--reprocess-failed':
        options.reprocessFailed = true;
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
    }
  }

  return options;
}

function printUsage() {
  console.log(`
Geocode Intake Addresses

Processes addresses in web_intake_submissions through Google Geocoding API.
Original addresses are preserved; clean versions stored in geo_* fields.

Usage:
  node scripts/ingest/geocode_intake_addresses.mjs [options]

Options:
  --limit <n>         Process at most n addresses
  --dry-run           Show what would be done without making changes
  --reprocess-failed  Re-attempt addresses that previously failed
  --verbose, -v       Show detailed output
  --help, -h          Show this help

Environment:
  DATABASE_URL              PostgreSQL connection string (required)
  GOOGLE_PLACES_API_KEY     Google API key with Geocoding enabled (required)

Examples:
  # Process all un-geocoded addresses
  node scripts/ingest/geocode_intake_addresses.mjs

  # Test with first 10 addresses
  node scripts/ingest/geocode_intake_addresses.mjs --limit 10 --dry-run --verbose

  # Retry failed addresses
  node scripts/ingest/geocode_intake_addresses.mjs --reprocess-failed
`);
}

// ============================================
// Geocoding Logic
// ============================================

function shouldSkipAddress(address) {
  if (!address || typeof address !== 'string') return true;
  const trimmed = address.trim();
  if (trimmed.length < 3) return true;
  return SKIP_PATTERNS.some(pattern => pattern.test(trimmed));
}

function isInSonomaCounty(lat, lng) {
  return (
    lat >= SONOMA_BOUNDS.south &&
    lat <= SONOMA_BOUNDS.north &&
    lng >= SONOMA_BOUNDS.west &&
    lng <= SONOMA_BOUNDS.east
  );
}

async function geocodeAddress(address, apiKey) {
  const params = new URLSearchParams({
    address: address,
    key: apiKey,
    // Bias results toward Sonoma County
    bounds: `${SONOMA_BOUNDS.south},${SONOMA_BOUNDS.west}|${SONOMA_BOUNDS.north},${SONOMA_BOUNDS.east}`,
  });

  const response = await fetch(`${GEOCODE_URL}?${params}`);
  const data = await response.json();

  return data;
}

function parseGeocodingResult(data, originalAddress) {
  if (data.status === 'ZERO_RESULTS') {
    return {
      confidence: 'failed',
      formatted_address: null,
      latitude: null,
      longitude: null,
      place_id: null,
      raw_response: data,
      note: 'No results found',
    };
  }

  if (data.status !== 'OK') {
    return {
      confidence: 'failed',
      formatted_address: null,
      latitude: null,
      longitude: null,
      place_id: null,
      raw_response: data,
      note: `API error: ${data.status}`,
    };
  }

  const result = data.results[0];
  const location = result.geometry.location;
  const locationType = result.geometry.location_type;

  // Determine confidence based on location_type
  let confidence;
  switch (locationType) {
    case 'ROOFTOP':
      confidence = 'exact';
      break;
    case 'RANGE_INTERPOLATED':
    case 'GEOMETRIC_CENTER':
      confidence = 'approximate';
      break;
    case 'APPROXIMATE':
      // Check if it's just a city match
      const types = result.types || [];
      if (types.includes('locality') || types.includes('administrative_area_level_2')) {
        confidence = 'city';
      } else {
        confidence = 'approximate';
      }
      break;
    default:
      confidence = 'approximate';
  }

  // Check if result is in Sonoma County area
  const inArea = isInSonomaCounty(location.lat, location.lng);

  return {
    confidence,
    formatted_address: result.formatted_address,
    latitude: location.lat,
    longitude: location.lng,
    place_id: result.place_id,
    raw_response: data,
    in_service_area: inArea,
    note: inArea ? null : 'Outside Sonoma County bounds',
  };
}

// ============================================
// Database Operations
// ============================================

async function getAddressesToGeocode(client, options) {
  let conditions = [];

  if (options.reprocessFailed) {
    // Get addresses that failed previously
    conditions.push(`geo_confidence = 'failed'`);
  } else {
    // Get addresses not yet geocoded
    conditions.push(`geo_confidence IS NULL`);
  }

  // Exclude clearly invalid addresses at DB level
  conditions.push(`cats_address IS NOT NULL`);
  conditions.push(`LENGTH(TRIM(cats_address)) >= 3`);

  const whereClause = conditions.join(' AND ');
  const limitClause = options.limit ? `LIMIT ${options.limit}` : '';

  const sql = `
    SELECT
      submission_id,
      cats_address,
      cats_city,
      county,
      requester_city
    FROM trapper.web_intake_submissions
    WHERE ${whereClause}
    ORDER BY submitted_at DESC
    ${limitClause}
  `;

  const result = await client.query(sql);
  return result.rows;
}

async function updateGeocodingResult(client, submissionId, geoResult) {
  const sql = `
    UPDATE trapper.web_intake_submissions
    SET
      geo_formatted_address = $1,
      geo_latitude = $2,
      geo_longitude = $3,
      geo_place_id = $4,
      geo_confidence = $5,
      geo_raw_response = $6,
      updated_at = NOW()
    WHERE submission_id = $7
  `;

  await client.query(sql, [
    geoResult.formatted_address,
    geoResult.latitude,
    geoResult.longitude,
    geoResult.place_id,
    geoResult.confidence,
    JSON.stringify(geoResult.raw_response),
    submissionId,
  ]);
}

// ============================================
// Main Processing
// ============================================

async function main() {
  const options = parseArgs();
  const startTime = Date.now();

  console.log('\nGeocode Intake Addresses');
  console.log('='.repeat(50));

  // Check environment
  if (!process.env.DATABASE_URL) {
    console.error('Error: DATABASE_URL not set');
    process.exit(1);
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    console.error('Error: GOOGLE_PLACES_API_KEY not set');
    process.exit(1);
  }

  console.log(`Mode: ${options.dryRun ? 'DRY RUN' : 'LIVE'}`);
  if (options.reprocessFailed) {
    console.log('Reprocessing previously failed addresses');
  }

  // Connect to database
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  console.log('Connected to database');

  // Get addresses to process
  const addresses = await getAddressesToGeocode(client, options);
  console.log(`\nFound ${addresses.length} addresses to process`);

  if (addresses.length === 0) {
    console.log('Nothing to do.');
    await client.end();
    return;
  }

  // Stats
  const stats = {
    total: addresses.length,
    exact: 0,
    approximate: 0,
    city: 0,
    failed: 0,
    skipped: 0,
    outside_area: 0,
    errors: 0,
  };

  // Process addresses
  console.log('\nProcessing...');

  for (let i = 0; i < addresses.length; i++) {
    const row = addresses[i];
    const address = row.cats_address;

    // Progress indicator
    if ((i + 1) % 50 === 0 || i === addresses.length - 1) {
      process.stdout.write(`\r  ${i + 1}/${addresses.length} processed`);
    }

    // Skip invalid addresses
    if (shouldSkipAddress(address)) {
      if (options.verbose) {
        console.log(`\n  [skip] "${address}" - invalid pattern`);
      }

      if (!options.dryRun) {
        await updateGeocodingResult(client, row.submission_id, {
          confidence: 'skip',
          formatted_address: null,
          latitude: null,
          longitude: null,
          place_id: null,
          raw_response: { note: 'Address too short or invalid pattern' },
        });
      }
      stats.skipped++;
      continue;
    }

    // Build full address string
    let fullAddress = address;
    if (row.cats_city) {
      fullAddress += `, ${row.cats_city}`;
    } else if (row.requester_city) {
      fullAddress += `, ${row.requester_city}`;
    }
    if (!fullAddress.toLowerCase().includes('ca')) {
      fullAddress += ', CA';
    }

    if (options.dryRun) {
      if (options.verbose) {
        console.log(`\n  [dry-run] Would geocode: "${fullAddress}"`);
      }
      stats.exact++; // Assume success for dry run
      continue;
    }

    try {
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS));

      // Geocode
      const data = await geocodeAddress(fullAddress, apiKey);
      const result = parseGeocodingResult(data, address);

      // Update database
      await updateGeocodingResult(client, row.submission_id, result);

      // Update stats
      stats[result.confidence]++;
      if (result.in_service_area === false) {
        stats.outside_area++;
      }

      if (options.verbose) {
        const emoji = result.confidence === 'exact' ? '✓' :
                      result.confidence === 'approximate' ? '~' :
                      result.confidence === 'city' ? '○' : '✗';
        console.log(`\n  [${emoji}] "${address}"`);
        console.log(`      → ${result.formatted_address || '(no result)'}`);
        if (result.note) console.log(`      ! ${result.note}`);
      }

    } catch (err) {
      stats.errors++;
      console.error(`\n  [!] Error geocoding "${address}": ${err.message}`);

      // Mark as failed
      await updateGeocodingResult(client, row.submission_id, {
        confidence: 'failed',
        formatted_address: null,
        latitude: null,
        longitude: null,
        place_id: null,
        raw_response: { error: err.message },
      });
    }
  }

  await client.end();

  const durationMs = Date.now() - startTime;
  const durationSec = (durationMs / 1000).toFixed(1);

  // Print summary
  console.log('\n\nSummary');
  console.log('-'.repeat(50));
  console.log(`  Total processed:    ${stats.total}`);
  console.log(`  Exact matches:      ${stats.exact}`);
  console.log(`  Approximate:        ${stats.approximate}`);
  console.log(`  City-level only:    ${stats.city}`);
  console.log(`  Failed:             ${stats.failed}`);
  console.log(`  Skipped (invalid):  ${stats.skipped}`);
  console.log(`  Outside area:       ${stats.outside_area}`);
  if (stats.errors > 0) {
    console.log(`  Errors:             ${stats.errors}`);
  }
  console.log(`  Duration:           ${durationSec}s`);

  // Quality report
  const successRate = ((stats.exact + stats.approximate) / (stats.total - stats.skipped) * 100).toFixed(1);
  console.log(`\n  Success rate:       ${successRate}%`);

  if (options.dryRun) {
    console.log('\nDry run complete. Run without --dry-run to process.');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
