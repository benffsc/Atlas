#!/usr/bin/env node
/**
 * MyMaps KML Import Script
 * =========================
 *
 * Imports historical colony data from FFSC Colonies KML file.
 *
 * Data source: /Users/benmisdiaz/Downloads/FFSC Colonies and trapping assignments.kml
 * Pre-extracted: /tmp/kml_extracted_data.json (5,724 records, 2,546 importable)
 *
 * Process:
 * 1. Load pre-extracted JSON data
 * 2. Match to existing places by coordinates (haversine distance < 50m)
 * 3. For confident matches: Insert colony estimates with source_type = 'legacy_mymaps'
 * 4. For uncertain/unmatched: Stage in kml_pending_records for manual review
 * 5. Preserve qualitative notes for AI summarization and Beacon maps
 *
 * Mission Contract Alignment:
 * - Never create places from coordinates alone (would pollute data)
 * - Preserve all qualitative content (notes, descriptions) for future use
 * - Stage orphaned records for manual linking when places are verified
 * - Support AI summarization of historical context
 *
 * PREREQUISITES:
 * - colony_source_confidence removed in v2 — no prerequisite needed
 * - Run MIG_308 (creates kml_pending_records staging table)
 * - Run: python3 /tmp/kml_full_extract.py to generate JSON
 *
 * Usage:
 *   node scripts/ingest/mymaps_kml_import.mjs [--dry-run] [--limit N]
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';

const { Pool } = pg;

// ANSI colors
const green = '\x1b[32m';
const yellow = '\x1b[33m';
const red = '\x1b[31m';
const cyan = '\x1b[36m';
const bold = '\x1b[1m';
const reset = '\x1b[0m';

// Configuration
const KML_JSON_PATH = '/tmp/kml_extracted_data.json';
const SOURCE_TYPE = 'legacy_mymaps';
const SOURCE_SYSTEM = 'legacy_kml';
const MATCH_DISTANCE_METERS = 50; // Conservative: only match places within 50m

/**
 * IMPORTANT: KML data has coordinates but NOT addresses.
 *
 * Strategy:
 * 1. ONLY enrich existing places that are within 50m (conservative)
 * 2. DO NOT create new places from KML coords (would pollute places table)
 * 3. Unmatched/uncertain records go to kml_pending_records staging table
 * 4. Qualitative notes preserved for AI summarization and Beacon maps
 *
 * The coordinates may not be exact - someone may have dropped a pin
 * near a location, not at the exact address. We err on the side of
 * caution by:
 * - Using a tight 50m radius for confident matches
 * - Staging 50-150m matches as "uncertain" for manual review
 * - Staging >150m records as "unmatched" for future linking
 * - Preserving all qualitative content regardless of match status
 */

// Haversine distance calculation
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes('--dry-run'),
    limit: args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : null,
    help: args.includes('--help') || args.includes('-h'),
  };
}

async function main() {
  const options = parseArgs();

  if (options.help) {
    console.log(`
${bold}MyMaps KML Import Script${reset}

Usage: node scripts/ingest/mymaps_kml_import.mjs [options]

Options:
  --dry-run    Preview changes without writing to database
  --limit N    Process only first N records
  --help       Show this help

Prerequisites:
  1. Run MIG_267 (adds 'legacy_mymaps' source_type)
  2. Run MIG_308 (creates kml_pending_records staging table)
  3. Run: python3 /tmp/kml_full_extract.py

Output:
  - Confident matches (<50m): Colony estimates in place_colony_estimates
  - Uncertain matches (50-150m): Staged in kml_pending_records for review
  - Unmatched (>150m): Staged in kml_pending_records for future linking
`);
    process.exit(0);
  }

  console.log(`\n${bold}MyMaps KML Import${reset}`);
  console.log('═'.repeat(50));

  if (options.dryRun) {
    console.log(`${yellow}DRY RUN MODE - No changes will be made${reset}\n`);
  }

  // Check DATABASE_URL
  if (!process.env.DATABASE_URL) {
    console.error(`${red}Error:${reset} DATABASE_URL not set`);
    process.exit(1);
  }

  // Load extracted JSON
  if (!fs.existsSync(KML_JSON_PATH)) {
    console.error(`${red}Error:${reset} Extracted JSON not found at ${KML_JSON_PATH}`);
    console.error(`Run: python3 /tmp/kml_full_extract.py first`);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(KML_JSON_PATH, 'utf8'));
  console.log(`${cyan}Loaded:${reset} ${data.records.length} total records`);
  console.log(`${cyan}Stats:${reset} ${data.stats.with_tnr} with TNR, ${data.stats.with_colony_size} with colony size`);

  // Filter to importable records (have coords + useful data)
  let records = data.records.filter(r =>
    r.lat && r.lng && (r.tnr_count || r.colony_size || r.status_signals?.length || r.trapper)
  );

  console.log(`${cyan}Importable:${reset} ${records.length} records with coords + useful data`);

  if (options.limit) {
    records = records.slice(0, options.limit);
    console.log(`${cyan}Limited to:${reset} ${options.limit} records`);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // Load existing places with coordinates for matching
    // Use PostGIS to extract lat/lng from the geography location column
    console.log(`\n${cyan}Loading existing places for matching...${reset}`);
    const placesResult = await pool.query(`
      SELECT
        place_id,
        display_name,
        ST_Y(location::geometry) as lat,
        ST_X(location::geometry) as lng,
        formatted_address
      FROM sot.places
      WHERE location IS NOT NULL
        AND merged_into_place_id IS NULL
    `);
    const existingPlaces = placesResult.rows;
    console.log(`${cyan}Loaded:${reset} ${existingPlaces.length} places with coordinates`);

    // Stats
    const stats = {
      total: records.length,
      matched: 0,         // Confident match (<50m)
      uncertain: 0,       // Uncertain match (50-150m) - staged for review
      unmatched: 0,       // No match (>150m) - staged for future matching
      estimates_inserted: 0,
      pending_inserted: 0, // Records inserted into kml_pending_records
      skipped_duplicate: 0,
      skipped_pending_duplicate: 0,
      errors: 0,
    };

    // Process records
    console.log(`\n${cyan}Processing records...${reset}\n`);

    for (let i = 0; i < records.length; i++) {
      const record = records[i];

      if ((i + 1) % 100 === 0) {
        console.log(`  Processed ${i + 1}/${records.length}...`);
      }

      try {
        // Find nearest existing place
        let matchedPlace = null;
        let minDistance = Infinity;

        for (const place of existingPlaces) {
          const dist = haversineDistance(record.lat, record.lng, place.lat, place.lng);
          if (dist < minDistance) {
            minDistance = dist;
            matchedPlace = place;
          }
        }

        let placeId;
        let matchStatus;

        if (minDistance <= MATCH_DISTANCE_METERS) {
          // Use existing place - confident match
          placeId = matchedPlace.place_id;
          matchStatus = 'matched';
          stats.matched++;
        } else if (minDistance <= 150) {
          // Uncertain match (50-150m) - stage for manual review
          matchStatus = 'uncertain';
          stats.uncertain++;
        } else {
          // No match - stage for future matching
          matchStatus = 'unmatched';
          stats.unmatched++;
        }

        // For unmatched/uncertain records, insert into staging table
        if (matchStatus !== 'matched') {
          if (!options.dryRun) {
            // Check for existing pending record (by coordinates + name)
            const existingPending = await pool.query(`
              SELECT 1 FROM ops.kml_pending_records
              WHERE lat = $1 AND lng = $2 AND kml_name = $3
            `, [record.lat, record.lng, record.name || null]);

            if (existingPending.rowCount > 0) {
              stats.skipped_pending_duplicate++;
            } else {
              // Parse status signals into JSONB
              const parsedSignals = record.status_signals?.length
                ? JSON.stringify({
                    signals: record.status_signals,
                    has_kittens: record.status_signals.some(s => s.toLowerCase().includes('kitten')),
                    has_feeders: record.status_signals.some(s => s.toLowerCase().includes('feed')),
                    is_complete: record.status_signals.some(s => s.toLowerCase().includes('complete') || s.toLowerCase().includes('done')),
                  })
                : null;

              await pool.query(`
                INSERT INTO ops.kml_pending_records (
                  kml_name, kml_description, lat, lng, kml_folder,
                  parsed_cat_count, parsed_date, parsed_signals,
                  match_status, nearest_place_id, nearest_place_distance_m,
                  source_file, source_folder
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                ON CONFLICT (lat, lng, kml_name) DO NOTHING
              `, [
                record.name || null,
                record.notes || record.description || null,
                record.lat,
                record.lng,
                record.folder || null,
                record.colony_size || record.tnr_count || null,
                record.date ? `${record.date}-01` : null,
                parsedSignals,
                matchStatus,
                matchedPlace?.place_id || null,
                minDistance < Infinity ? minDistance : null,
                'FFSC Colonies and trapping assignments.kml',
                record.folder || null,
              ]);

              stats.pending_inserted++;
            }
          }
          continue; // Don't create colony estimate for unmatched records
        }

        if (options.dryRun) continue;

        // Build source_record_id from coordinates + name for deduplication
        const sourceRecordId = `kml_${record.lat.toFixed(6)}_${record.lng.toFixed(6)}`;

        // Check for existing estimate
        const existingEstimate = await pool.query(`
          SELECT 1 FROM sot.place_colony_estimates
          WHERE source_system = $1 AND source_record_id = $2
        `, [SOURCE_SYSTEM, sourceRecordId]);

        if (existingEstimate.rowCount > 0) {
          stats.skipped_duplicate++;
          continue;
        }

        // Insert colony estimate
        // Use TNR count as altered_count, colony_size as total_cats
        const totalCats = record.colony_size || record.tnr_count || null;
        const alteredCount = record.tnr_count || null;

        // Parse observation date from record.date (format: "YYYY-MM")
        let observationDate = null;
        if (record.date) {
          observationDate = `${record.date}-01`; // First of month
        }

        // Build notes from qualitative data
        const notesParts = [];
        if (record.trapper) notesParts.push(`Trapper: ${record.trapper}`);
        if (record.status_signals?.length) notesParts.push(`Signals: ${record.status_signals.join(', ')}`);
        if (record.notes) notesParts.push(record.notes.substring(0, 500)); // Truncate long notes
        const notes = notesParts.join(' | ') || null;

        await pool.query(`
          INSERT INTO sot.place_colony_estimates (
            place_id, total_cats, altered_count,
            source_type, observation_date, is_firsthand,
            notes, source_system, source_record_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (source_system, source_record_id) DO NOTHING
        `, [
          placeId,
          totalCats,
          alteredCount,
          SOURCE_TYPE,
          observationDate,
          true, // Historical observations are firsthand
          notes,
          SOURCE_SYSTEM,
          sourceRecordId,
        ]);

        stats.estimates_inserted++;

      } catch (err) {
        stats.errors++;
        if (stats.errors <= 5) {
          console.error(`${red}Error processing record ${i}:${reset} ${err.message}`);
        }
      }
    }

    // Summary
    console.log(`\n${'═'.repeat(50)}`);
    console.log(`${bold}Import Summary${reset}`);
    console.log(`${'═'.repeat(50)}`);
    console.log(`${cyan}Total records:${reset}        ${stats.total}`);
    console.log(`${green}Confident matches:${reset}    ${stats.matched} (within 50m of existing place)`);
    console.log(`${green}Estimates inserted:${reset}   ${stats.estimates_inserted}`);
    console.log(`${yellow}Uncertain matches:${reset}    ${stats.uncertain} (50-150m - staged for review)`);
    console.log(`${yellow}Unmatched:${reset}            ${stats.unmatched} (>150m - staged for future)`);
    console.log(`${cyan}Pending staged:${reset}       ${stats.pending_inserted} (in kml_pending_records)`);
    console.log(`${yellow}Skipped duplicates:${reset}   ${stats.skipped_duplicate}`);
    if (stats.skipped_pending_duplicate > 0) {
      console.log(`${yellow}Skipped pending dups:${reset} ${stats.skipped_pending_duplicate}`);
    }
    if (stats.errors > 0) {
      console.log(`${red}Errors:${reset}               ${stats.errors}`);
    }

    // Coverage analysis
    const matchRate = (stats.matched / stats.total * 100).toFixed(1);
    console.log(`\n${cyan}Match rate:${reset} ${matchRate}% of KML records matched to existing places`);

    if (stats.pending_inserted > 0) {
      console.log(`\n${green}NOTE:${reset} ${stats.pending_inserted} records staged in kml_pending_records.`);
      console.log(`Use /admin/kml-review to manually link these to places.`);
      console.log(`Qualitative data preserved for AI summarization and Beacon maps.`);
    }

    if (options.dryRun) {
      console.log(`\n${yellow}DRY RUN - No changes were made${reset}`);
      console.log(`Run without --dry-run to import data.`);
    }

  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error(`${red}Fatal error:${reset}`, err);
  process.exit(1);
});
