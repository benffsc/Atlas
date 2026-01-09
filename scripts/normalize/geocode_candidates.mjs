#!/usr/bin/env node
/**
 * geocode_candidates.mjs
 *
 * Geocodes address candidates from staged trapping requests using Google Geocoding API.
 * - Pulls candidates from v_candidate_addresses_from_trapping_requests
 * - Checks cache before calling Google API
 * - Parses unit/apt from address string
 * - Upserts to sot_addresses on success
 * - Writes to address_review_queue on failure/low confidence
 *
 * Usage:
 *   set -a && source .env && set +a
 *   node scripts/normalize/geocode_candidates.mjs --limit 25
 *   node scripts/normalize/geocode_candidates.mjs --limit 100 --dry-run
 *   node scripts/normalize/geocode_candidates.mjs --all
 *
 * Environment:
 *   DATABASE_URL          - Postgres connection string (required)
 *   GOOGLE_PLACES_API_KEY - Google API key with Geocoding enabled (required)
 */

import pg from 'pg';
import https from 'https';

const { Client } = pg;

// ============================================
// Configuration
// ============================================

const GOOGLE_GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const DEFAULT_LIMIT = 25;
const RATE_LIMIT_DELAY_MS = 100;  // 100ms between API calls (10 QPS)
const CONFIDENCE_THRESHOLD = 0.7; // Below this goes to review queue

// Location type confidence scores
const LOCATION_TYPE_CONFIDENCE = {
  'ROOFTOP': 1.0,
  'RANGE_INTERPOLATED': 0.8,
  'GEOMETRIC_CENTER': 0.6,
  'APPROXIMATE': 0.4,
};

// Unit/Apt patterns to extract
const UNIT_PATTERNS = [
  /\b(?:apt\.?|apartment)\s*#?\s*(\S+)/i,
  /\b(?:unit)\s*#?\s*(\S+)/i,
  /\b(?:suite|ste\.?)\s*#?\s*(\S+)/i,
  /\b(?:#)\s*(\S+)/i,
  /\b(?:space|spc\.?)\s*#?\s*(\S+)/i,
  /\b(?:lot)\s*#?\s*(\S+)/i,
  /\b(?:bldg\.?|building)\s*(\S+)/i,
];

// Colors for output
const green = '\x1b[32m';
const red = '\x1b[31m';
const yellow = '\x1b[33m';
const cyan = '\x1b[36m';
const reset = '\x1b[0m';
const bold = '\x1b[1m';

// ============================================
// Argument Parsing
// ============================================

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    limit: DEFAULT_LIMIT,
    dryRun: false,
    verbose: false,
    all: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--limit':
        options.limit = parseInt(args[++i], 10);
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      case '--all':
        options.all = true;
        options.limit = 10000; // Safety cap
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
${bold}Usage:${reset}
  node scripts/normalize/geocode_candidates.mjs [options]

${bold}Options:${reset}
  --limit N     Process N candidates (default: 25)
  --all         Process all pending candidates (up to 10000)
  --dry-run     Show what would be done without API calls or DB writes
  --verbose     Show detailed output
  --help        Show this help

${bold}Environment:${reset}
  DATABASE_URL          Postgres connection string (required)
  GOOGLE_PLACES_API_KEY Google Geocoding API key (required)

${bold}Cost Notes:${reset}
  - Google Geocoding API: $5 per 1000 requests
  - 25 requests = ~$0.13
  - 1000 requests = ~$5.00
  - Cache prevents duplicate API calls

${bold}Example:${reset}
  set -a && source .env && set +a
  node scripts/normalize/geocode_candidates.mjs --limit 25 --verbose
`);
}

// ============================================
// Address Processing
// ============================================

/**
 * Normalize address text for cache lookup
 */
function normalizeAddressText(address) {
  return address
    .toLowerCase()
    .replace(/\s+/g, ' ')      // Collapse whitespace
    .replace(/[.,#]/g, '')      // Remove punctuation (except for unit parsing)
    .trim();
}

/**
 * Extract unit/apartment from address string
 * Returns { addressWithoutUnit, unitRaw, unitNormalized }
 */
function extractUnit(address) {
  let addressWithoutUnit = address;
  let unitRaw = null;
  let unitNormalized = null;

  for (const pattern of UNIT_PATTERNS) {
    const match = address.match(pattern);
    if (match) {
      unitRaw = match[0].trim();
      unitNormalized = match[1].trim().replace(/^#/, '');
      // Remove unit from address for geocoding
      addressWithoutUnit = address.replace(pattern, '').replace(/\s+/g, ' ').trim();
      break;
    }
  }

  return { addressWithoutUnit, unitRaw, unitNormalized };
}

/**
 * Calculate confidence score based on Google result
 */
function calculateConfidence(result) {
  let score = LOCATION_TYPE_CONFIDENCE[result.geometry?.location_type] || 0.5;

  // Penalize partial matches
  if (result.partial_match) {
    score *= 0.7;
  }

  return Math.round(score * 100) / 100;
}

/**
 * Extract address components from Google result
 */
function extractComponents(result) {
  const components = {};
  const mapping = {
    'street_number': 'street_number',
    'route': 'route',
    'locality': 'locality',
    'administrative_area_level_1': 'admin_area_1',
    'administrative_area_level_2': 'admin_area_2',
    'postal_code': 'postal_code',
    'postal_code_suffix': 'postal_code_suffix',
    'country': 'country',
    'neighborhood': 'neighborhood',
    'sublocality': 'sublocality',
  };

  for (const component of result.address_components || []) {
    for (const type of component.types) {
      if (mapping[type]) {
        components[mapping[type]] = component.short_name;
      }
    }
  }

  return components;
}

// ============================================
// Google Geocoding API
// ============================================

/**
 * Call Google Geocoding API
 */
function callGoogleGeocodeApi(address, apiKey) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      address: address,
      key: apiKey,
      // Bias to California/US
      components: 'country:US',
    });

    const url = `${GOOGLE_GEOCODE_URL}?${params.toString()}`;

    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (e) {
          reject(new Error(`Invalid JSON response: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

// ============================================
// Database Operations
// ============================================

/**
 * Get pending candidates from the view
 */
async function getCandidates(client, limit) {
  const result = await client.query(`
    SELECT
      staged_record_id,
      source_row_id,
      address_raw,
      address_role,
      created_at
    FROM trapper.v_candidate_addresses_from_trapping_requests
    ORDER BY created_at ASC
    LIMIT $1
  `, [limit]);

  return result.rows;
}

/**
 * Check if normalized address is in cache
 */
async function checkCache(client, normalizedAddress) {
  const result = await client.query(`
    SELECT *
    FROM trapper.geocode_cache
    WHERE normalized_address_text = $1
  `, [normalizedAddress]);

  return result.rows[0] || null;
}

/**
 * Insert into geocode cache
 */
async function insertCache(client, data) {
  const result = await client.query(`
    INSERT INTO trapper.geocode_cache (
      normalized_address_text,
      original_address_text,
      google_place_id,
      formatted_address,
      lat,
      lng,
      components,
      location_type,
      partial_match,
      result_count,
      geocode_status,
      raw_response
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING id
  `, [
    data.normalizedAddress,
    data.originalAddress,
    data.placeId,
    data.formattedAddress,
    data.lat,
    data.lng,
    JSON.stringify(data.components),
    data.locationType,
    data.partialMatch,
    data.resultCount,
    data.status,
    data.rawResponse ? JSON.stringify(data.rawResponse) : null,
  ]);

  return result.rows[0].id;
}

/**
 * Upsert into sot_addresses
 */
async function upsertSotAddress(client, data) {
  const result = await client.query(`
    INSERT INTO trapper.sot_addresses (
      google_place_id,
      formatted_address,
      unit_raw,
      unit_normalized,
      lat,
      lng,
      street_number,
      route,
      locality,
      admin_area_1,
      admin_area_2,
      postal_code,
      postal_code_suffix,
      country,
      neighborhood,
      components,
      geocode_status,
      location_type,
      confidence_score,
      geocode_cache_id,
      first_seen_at,
      last_seen_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, NOW(), NOW())
    ON CONFLICT (formatted_address, COALESCE(unit_normalized, ''))
    DO UPDATE SET
      last_seen_at = NOW(),
      updated_at = NOW()
    RETURNING address_id
  `, [
    data.placeId,
    data.formattedAddress,
    data.unitRaw,
    data.unitNormalized,
    data.lat,
    data.lng,
    data.components.street_number,
    data.components.route,
    data.components.locality,
    data.components.admin_area_1,
    data.components.admin_area_2,
    data.components.postal_code,
    data.components.postal_code_suffix,
    data.components.country || 'US',
    data.components.neighborhood,
    JSON.stringify(data.components),
    data.status,
    data.locationType,
    data.confidence,
    data.cacheId,
  ]);

  return result.rows[0].address_id;
}

/**
 * Link staged record to address
 */
async function linkStagedRecordToAddress(client, stagedRecordId, addressId, role, confidence, method) {
  await client.query(`
    INSERT INTO trapper.staged_record_address_link (
      staged_record_id,
      address_id,
      address_role,
      confidence_score,
      match_method
    ) VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (staged_record_id, address_role) DO NOTHING
  `, [stagedRecordId, addressId, role, confidence, method]);
}

/**
 * Add to review queue
 */
async function addToReviewQueue(client, data) {
  await client.query(`
    INSERT INTO trapper.address_review_queue (
      staged_record_id,
      source_row_id,
      address_raw,
      address_role,
      reason,
      reason_details,
      suggested_formatted,
      suggested_lat,
      suggested_lng
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (staged_record_id, address_role) DO NOTHING
  `, [
    data.stagedRecordId,
    data.sourceRowId,
    data.addressRaw,
    data.addressRole,
    data.reason,
    data.reasonDetails,
    data.suggestedFormatted,
    data.suggestedLat,
    data.suggestedLng,
  ]);
}

// ============================================
// Main Processing
// ============================================

async function processCandidate(client, candidate, apiKey, options, stats) {
  const { staged_record_id, source_row_id, address_raw, address_role } = candidate;

  // Extract unit
  const { addressWithoutUnit, unitRaw, unitNormalized } = extractUnit(address_raw);

  // Normalize for cache lookup
  const normalizedAddress = normalizeAddressText(addressWithoutUnit);

  if (options.verbose) {
    console.log(`\n  Processing: ${address_raw.substring(0, 60)}...`);
    if (unitRaw) console.log(`    Unit extracted: ${unitRaw} → ${unitNormalized}`);
    console.log(`    Normalized: ${normalizedAddress.substring(0, 50)}...`);
  }

  // Check cache
  let cacheEntry = await checkCache(client, normalizedAddress);
  let usedCache = false;

  if (cacheEntry) {
    stats.cacheHits++;
    usedCache = true;
    if (options.verbose) {
      console.log(`    ${green}Cache hit${reset}: ${cacheEntry.geocode_status}`);
    }
  } else {
    // Need to call Google API
    if (options.dryRun) {
      console.log(`    ${yellow}[dry-run]${reset} Would call Google API`);
      stats.wouldCall++;
      return;
    }

    // Rate limit
    await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY_MS));

    try {
      stats.apiCalls++;
      const response = await callGoogleGeocodeApi(addressWithoutUnit, apiKey);

      // Process response
      let status, placeId, formattedAddress, lat, lng, components, locationType, partialMatch;

      if (response.status === 'OK' && response.results.length > 0) {
        const result = response.results[0];
        status = result.partial_match ? 'partial' : 'ok';
        placeId = result.place_id;
        formattedAddress = result.formatted_address;
        lat = result.geometry.location.lat;
        lng = result.geometry.location.lng;
        components = extractComponents(result);
        locationType = result.geometry.location_type;
        partialMatch = !!result.partial_match;
      } else if (response.status === 'ZERO_RESULTS') {
        status = 'zero_results';
      } else {
        status = 'failed';
      }

      // Insert into cache
      const cacheId = await insertCache(client, {
        normalizedAddress,
        originalAddress: addressWithoutUnit,
        placeId,
        formattedAddress,
        lat,
        lng,
        components: components || {},
        locationType,
        partialMatch,
        resultCount: response.results?.length || 0,
        status,
        rawResponse: response.results?.[0] || null,
      });

      cacheEntry = {
        id: cacheId,
        geocode_status: status,
        google_place_id: placeId,
        formatted_address: formattedAddress,
        lat,
        lng,
        components: components || {},
        location_type: locationType,
        partial_match: partialMatch,
      };

      if (options.verbose) {
        console.log(`    ${cyan}API call${reset}: ${status} ${formattedAddress?.substring(0, 40) || '(no result)'}...`);
      }
    } catch (e) {
      stats.errors++;
      console.error(`    ${red}Error${reset}: ${e.message}`);
      await addToReviewQueue(client, {
        stagedRecordId: staged_record_id,
        sourceRowId: source_row_id,
        addressRaw: address_raw,
        addressRole: address_role,
        reason: 'api_error',
        reasonDetails: e.message,
      });
      return;
    }
  }

  // Process cache entry result
  if (cacheEntry.geocode_status === 'ok' || cacheEntry.geocode_status === 'partial') {
    const confidence = calculateConfidence({
      geometry: { location_type: cacheEntry.location_type },
      partial_match: cacheEntry.partial_match,
    });

    if (confidence >= CONFIDENCE_THRESHOLD) {
      // Create/update SoT address
      const addressId = await upsertSotAddress(client, {
        placeId: cacheEntry.google_place_id,
        formattedAddress: cacheEntry.formatted_address,
        unitRaw,
        unitNormalized,
        lat: cacheEntry.lat,
        lng: cacheEntry.lng,
        components: typeof cacheEntry.components === 'string'
          ? JSON.parse(cacheEntry.components)
          : cacheEntry.components,
        status: cacheEntry.geocode_status,
        locationType: cacheEntry.location_type,
        confidence,
        cacheId: cacheEntry.id,
      });

      // Link staged record to address
      await linkStagedRecordToAddress(
        client,
        staged_record_id,
        addressId,
        address_role,
        confidence,
        usedCache ? 'cached' : 'geocoded'
      );

      stats.created++;
      if (options.verbose) {
        console.log(`    ${green}Created${reset}: sot_address ${addressId.substring(0, 8)}... (confidence: ${confidence})`);
      }
    } else {
      // Low confidence - send to review
      await addToReviewQueue(client, {
        stagedRecordId: staged_record_id,
        sourceRowId: source_row_id,
        addressRaw: address_raw,
        addressRole: address_role,
        reason: 'low_confidence',
        reasonDetails: `Confidence ${confidence} < threshold ${CONFIDENCE_THRESHOLD}`,
        suggestedFormatted: cacheEntry.formatted_address,
        suggestedLat: cacheEntry.lat,
        suggestedLng: cacheEntry.lng,
      });
      stats.review++;
      if (options.verbose) {
        console.log(`    ${yellow}Review${reset}: low confidence (${confidence})`);
      }
    }
  } else {
    // Failed geocode - send to review
    await addToReviewQueue(client, {
      stagedRecordId: staged_record_id,
      sourceRowId: source_row_id,
      addressRaw: address_raw,
      addressRole: address_role,
      reason: cacheEntry.geocode_status,
      reasonDetails: `Google returned status: ${cacheEntry.geocode_status}`,
    });
    stats.review++;
    if (options.verbose) {
      console.log(`    ${yellow}Review${reset}: ${cacheEntry.geocode_status}`);
    }
  }
}

// ============================================
// Main Entry Point
// ============================================

async function main() {
  const options = parseArgs();

  console.log(`\n${bold}Atlas Address Geocoder${reset}`);
  console.log('═'.repeat(50));

  // Check environment
  if (!process.env.DATABASE_URL) {
    console.error(`${red}Error:${reset} DATABASE_URL not set`);
    process.exit(1);
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey && !options.dryRun) {
    console.error(`${red}Error:${reset} GOOGLE_PLACES_API_KEY not set`);
    console.log('Set in .env or run with --dry-run');
    process.exit(1);
  }

  console.log(`${cyan}Mode:${reset} ${options.dryRun ? 'DRY RUN (no API calls)' : 'LIVE'}`);
  console.log(`${cyan}Limit:${reset} ${options.limit} candidates`);

  // Connect to database
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    console.log(`${green}✓${reset} Connected to database`);
  } catch (e) {
    console.error(`${red}Error:${reset} Database connection failed: ${e.message}`);
    process.exit(1);
  }

  // Get candidates
  console.log(`\n${bold}Fetching candidates...${reset}`);
  const candidates = await getCandidates(client, options.limit);
  console.log(`  Found ${candidates.length} pending candidates`);

  if (candidates.length === 0) {
    console.log(`\n${green}Nothing to process.${reset} All candidates geocoded or in review.`);
    await client.end();
    process.exit(0);
  }

  // Process candidates
  console.log(`\n${bold}Processing...${reset}`);
  const stats = {
    total: candidates.length,
    created: 0,
    review: 0,
    cacheHits: 0,
    apiCalls: 0,
    wouldCall: 0,
    errors: 0,
  };

  for (const candidate of candidates) {
    await processCandidate(client, candidate, apiKey, options, stats);
  }

  await client.end();

  // Print summary
  console.log(`\n${bold}Summary${reset}`);
  console.log('─'.repeat(50));
  console.log(`  Candidates processed: ${stats.total}`);
  console.log(`  ${green}Addresses created:${reset} ${stats.created}`);
  console.log(`  ${yellow}Sent to review:${reset} ${stats.review}`);
  console.log(`  Cache hits: ${stats.cacheHits}`);
  console.log(`  API calls: ${stats.apiCalls}`);
  if (stats.wouldCall > 0) {
    console.log(`  Would call API (dry-run): ${stats.wouldCall}`);
  }
  if (stats.errors > 0) {
    console.log(`  ${red}Errors:${reset} ${stats.errors}`);
  }

  // Cost estimate
  if (stats.apiCalls > 0) {
    const cost = (stats.apiCalls / 1000) * 5;
    console.log(`\n${cyan}Estimated cost:${reset} $${cost.toFixed(2)} (${stats.apiCalls} API calls @ $5/1000)`);
  }

  console.log(`\n${bold}Verify with:${reset}`);
  console.log(`  psql "$DATABASE_URL" -c "SELECT * FROM trapper.v_geocode_pipeline_stats;"`);

  if (stats.review > 0) {
    console.log(`\n${yellow}Review queue:${reset}`);
    console.log(`  psql "$DATABASE_URL" -c "SELECT reason, COUNT(*) FROM trapper.address_review_queue WHERE NOT is_resolved GROUP BY reason;"`);
  }
}

main().catch(e => {
  console.error(`${red}Fatal error:${reset}`, e.message);
  process.exit(1);
});
