#!/usr/bin/env node
/**
 * KML Import to source.google_map_entries
 * ========================================
 *
 * Imports Google Maps KML data to source.google_map_entries table.
 * This is the SOURCE OF TRUTH for all Google Maps data in Atlas.
 *
 * Features:
 * - Parses KML directly (no pre-extraction needed)
 * - Extracts icon styles for disease risk detection
 * - Orange square (icon-961-F8971B) = disease risk
 * - Runs place matching and linking
 *
 * Usage:
 *   node scripts/ingest/import_kml_to_source.mjs <kml_file> [--dry-run] [--limit N]
 *
 * After import:
 *   - Run ops.link_google_entries_tiered() for place matching
 *   - Disease risk entries auto-flagged via icon style
 */

import pg from 'pg';
import fs from 'fs';
import { parseStringPromise } from 'xml2js';

const { Pool } = pg;

// ANSI colors
const green = '\x1b[32m';
const yellow = '\x1b[33m';
const red = '\x1b[31m';
const cyan = '\x1b[36m';
const bold = '\x1b[1m';
const reset = '\x1b[0m';

// Icon style to meaning mapping
// Based on FFSC's Google Maps icon conventions
const ICON_MEANINGS = {
  // Orange square = disease risk (FeLV/FIV)
  'icon-961-F8971B': { meaning: 'disease_risk', color: 'orange', type: 'square', staff_alert: true },
  'icon-961-F4B400': { meaning: 'disease_risk', color: 'yellow', type: 'square', staff_alert: true },

  // Red markers = urgent/needs attention
  'icon-503-DB4436': { meaning: 'urgent', color: 'red', type: 'pin', staff_alert: true },
  'icon-959-DB4436': { meaning: 'urgent', color: 'red', type: 'pin', staff_alert: true },

  // Green markers = completed/good status
  'icon-503-009D57': { meaning: 'completed', color: 'green', type: 'pin', staff_alert: false },
  'icon-959-009D57': { meaning: 'completed', color: 'green', type: 'pin', staff_alert: false },
  'icon-503-62AF44': { meaning: 'completed', color: 'green', type: 'pin', staff_alert: false },

  // Blue markers = general/standard
  'icon-503-4186F0': { meaning: 'general', color: 'blue', type: 'pin', staff_alert: false },
  'icon-959-3F5BA9': { meaning: 'general', color: 'blue', type: 'pin', staff_alert: false },

  // Purple markers = special
  'icon-503-7C3592': { meaning: 'special', color: 'purple', type: 'pin', staff_alert: false },

  // Black markers = inactive/archived
  'icon-503-000000': { meaning: 'archived', color: 'black', type: 'pin', staff_alert: false },
  'icon-959-000000': { meaning: 'archived', color: 'black', type: 'pin', staff_alert: false },
};

// Extract icon info from styleUrl
function parseStyleUrl(styleUrl) {
  if (!styleUrl) return { iconType: null, iconColor: null, meaning: 'unknown', staffAlert: false };

  // Remove # prefix
  const styleId = styleUrl.replace(/^#/, '');

  // Check direct mapping first
  const directMatch = ICON_MEANINGS[styleId];
  if (directMatch) {
    return {
      iconType: styleId.split('-')[1],
      iconColor: directMatch.color,
      meaning: directMatch.meaning,
      staffAlert: directMatch.staff_alert,
    };
  }

  // Parse format: icon-{type}-{color}[-nodesc][-normal|-highlight]
  const match = styleId.match(/icon-(\d+)-([A-F0-9]{6})/i);
  if (match) {
    const iconType = match[1];
    const colorCode = match[2].toUpperCase();

    // Check for disease risk colors (orange/amber range)
    const isOrange = ['F8971B', 'F4B400', 'FF9800', 'FF6D00', 'E65100'].includes(colorCode);
    const isRed = ['DB4436', 'FF0000', 'E53935', 'D32F2F'].includes(colorCode);

    // Square icons (961) with orange = disease risk
    if (iconType === '961' && isOrange) {
      return {
        iconType,
        iconColor: 'orange',
        meaning: 'disease_risk',
        staffAlert: true,
      };
    }

    // Red = urgent
    if (isRed) {
      return {
        iconType,
        iconColor: 'red',
        meaning: 'urgent',
        staffAlert: true,
      };
    }

    return {
      iconType,
      iconColor: colorCode,
      meaning: 'general',
      staffAlert: false,
    };
  }

  return { iconType: null, iconColor: null, meaning: 'unknown', staffAlert: false };
}

// Extract placemarks from KML
function extractPlacemarks(node, folderName = '') {
  const placemarks = [];

  if (!node) return placemarks;

  // Handle Folder
  if (node.Folder) {
    const folders = Array.isArray(node.Folder) ? node.Folder : [node.Folder];
    for (const folder of folders) {
      const name = folder.name?.[0] || '';
      placemarks.push(...extractPlacemarks(folder, name));
    }
  }

  // Handle Placemark
  if (node.Placemark) {
    const pms = Array.isArray(node.Placemark) ? node.Placemark : [node.Placemark];
    for (const pm of pms) {
      const name = pm.name?.[0] || '';
      const description = pm.description?.[0] || '';
      const styleUrl = pm.styleUrl?.[0] || '';
      const coords = pm.Point?.[0]?.coordinates?.[0] || '';

      const [lngStr, latStr] = coords.split(',').map(s => s.trim());
      const lng = parseFloat(lngStr);
      const lat = parseFloat(latStr);

      if (lat && lng && !isNaN(lat) && !isNaN(lng)) {
        const iconInfo = parseStyleUrl(styleUrl);

        placemarks.push({
          name,
          description: typeof description === 'string' ? description : '',
          lat,
          lng,
          styleUrl,
          folder: folderName,
          iconType: iconInfo.iconType,
          iconColor: iconInfo.iconColor,
          iconMeaning: iconInfo.meaning,
          staffAlert: iconInfo.staffAlert,
        });
      }
    }
  }

  // Handle Document
  if (node.Document) {
    const docs = Array.isArray(node.Document) ? node.Document : [node.Document];
    for (const doc of docs) {
      placemarks.push(...extractPlacemarks(doc, folderName));
    }
  }

  return placemarks;
}

// Parse date from description (format: MM/DD/YY or MM/YY)
function parseDate(description) {
  if (!description) return null;

  // Try MM/DD/YY format
  const fullMatch = description.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (fullMatch) {
    const [, month, day, year] = fullMatch;
    const fullYear = year.length === 2 ? (parseInt(year) < 50 ? `20${year}` : `19${year}`) : year;
    return `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // Try MM/YY format at start of line
  const shortMatch = description.match(/^(\d{1,2})\/(\d{2,4})\b/);
  if (shortMatch) {
    const [, month, year] = shortMatch;
    const fullYear = year.length === 2 ? (parseInt(year) < 50 ? `20${year}` : `19${year}`) : year;
    return `${fullYear}-${month.padStart(2, '0')}-01`;
  }

  return null;
}

// Extract cat count from description
function extractCatCount(description) {
  if (!description) return null;

  // Look for patterns like "5 cats", "colony of 10", "3 kittens"
  const patterns = [
    /(\d+)\s*(?:cats?|felines?|kitties?)/i,
    /colony\s*(?:of\s*)?(\d+)/i,
    /(\d+)\s*(?:ferals?|strays?)/i,
    /(\d+)\s*kittens?/i,
  ];

  for (const pattern of patterns) {
    const match = description.match(pattern);
    if (match) return parseInt(match[1]);
  }

  return null;
}

// Extract trapper initials
function extractTrapper(description) {
  if (!description) return null;

  // Look for staff initials at start after date: "05/23/18. MP."
  const match = description.match(/^\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\.\s*([A-Z]{2})\./);
  if (match) return match[1];

  return null;
}

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const kmlFile = args.find(a => !a.startsWith('--'));

  return {
    kmlFile,
    dryRun: args.includes('--dry-run'),
    limit: args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : null,
    help: args.includes('--help') || args.includes('-h'),
  };
}

async function main() {
  const options = parseArgs();

  if (options.help || !options.kmlFile) {
    console.log(`
${bold}KML Import to source.google_map_entries${reset}

Usage: node scripts/ingest/import_kml_to_source.mjs <kml_file> [options]

Options:
  --dry-run    Preview changes without writing to database
  --limit N    Process only first N records
  --help       Show this help

Example:
  node scripts/ingest/import_kml_to_source.mjs "/path/to/FFSC Colonies.kml"
`);
    process.exit(options.help ? 0 : 1);
  }

  console.log(`\n${bold}KML Import to source.google_map_entries${reset}`);
  console.log('='.repeat(50));

  if (options.dryRun) {
    console.log(`${yellow}DRY RUN MODE - No changes will be made${reset}\n`);
  }

  // Check DATABASE_URL
  if (!process.env.DATABASE_URL) {
    console.error(`${red}Error:${reset} DATABASE_URL not set`);
    process.exit(1);
  }

  // Check KML file exists
  if (!fs.existsSync(options.kmlFile)) {
    console.error(`${red}Error:${reset} KML file not found: ${options.kmlFile}`);
    process.exit(1);
  }

  // Read and parse KML
  console.log(`${cyan}Reading KML file:${reset} ${options.kmlFile}`);
  const kmlContent = fs.readFileSync(options.kmlFile, 'utf8');

  console.log(`${cyan}Parsing KML...${reset}`);
  const result = await parseStringPromise(kmlContent);
  let placemarks = extractPlacemarks(result.kml);

  console.log(`${cyan}Total placemarks:${reset} ${placemarks.length}`);

  // Count icon types
  const iconCounts = {};
  for (const pm of placemarks) {
    const key = pm.iconMeaning || 'unknown';
    iconCounts[key] = (iconCounts[key] || 0) + 1;
  }
  console.log(`${cyan}By icon meaning:${reset}`);
  for (const [meaning, count] of Object.entries(iconCounts).sort((a, b) => b[1] - a[1])) {
    const color = meaning === 'disease_risk' ? red : meaning === 'urgent' ? yellow : cyan;
    console.log(`  ${color}${meaning}:${reset} ${count}`);
  }

  if (options.limit) {
    placemarks = placemarks.slice(0, options.limit);
    console.log(`${cyan}Limited to:${reset} ${options.limit} records`);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // Stats
    const stats = {
      total: placemarks.length,
      inserted: 0,
      skipped_duplicate: 0,
      disease_risk: 0,
      errors: 0,
    };

    const sourceFile = options.kmlFile.split('/').pop();

    console.log(`\n${cyan}Importing to source.google_map_entries...${reset}\n`);

    for (let i = 0; i < placemarks.length; i++) {
      const pm = placemarks[i];

      if ((i + 1) % 500 === 0) {
        console.log(`  Processed ${i + 1}/${placemarks.length}...`);
      }

      try {
        if (options.dryRun) {
          stats.inserted++;
          if (pm.iconMeaning === 'disease_risk') stats.disease_risk++;
          continue;
        }

        // Parse data from description
        const parsedDate = parseDate(pm.description);
        const parsedCatCount = extractCatCount(pm.description);
        const parsedTrapper = extractTrapper(pm.description);

        // Build parsed signals
        const parsedSignals = {
          disease_mentions: [],
          has_kittens: /kitten/i.test(pm.description),
          is_complete: /complete|done|finished/i.test(pm.description),
          has_feeders: /feed|feeding/i.test(pm.description),
        };

        // Check for disease mentions in description
        if (/FeLV|feline leukemia/i.test(pm.description)) {
          parsedSignals.disease_mentions.push('FeLV');
        }
        if (/FIV|feline immunodeficiency/i.test(pm.description)) {
          parsedSignals.disease_mentions.push('FIV');
        }
        if (/positive|euthanized|exposure/i.test(pm.description)) {
          parsedSignals.has_disease_risk = true;
        }

        // Check for existing record first (to handle NULL kml_name properly)
        const existingCheck = await pool.query(`
          SELECT entry_id FROM source.google_map_entries
          WHERE lat = $1 AND lng = $2 AND COALESCE(kml_name, '') = COALESCE($3, '')
          LIMIT 1
        `, [pm.lat, pm.lng, pm.name || null]);

        if (existingCheck.rowCount > 0) {
          stats.skipped_duplicate++;
          continue;
        }

        // Insert into source.google_map_entries
        const insertResult = await pool.query(`
          INSERT INTO source.google_map_entries (
            kml_name,
            original_content,
            lat,
            lng,
            kml_folder,
            source_file,
            icon_type,
            icon_color,
            icon_meaning,
            staff_alert,
            parsed_date,
            parsed_cat_count,
            parsed_trapper,
            parsed_signals,
            match_status,
            imported_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'unmatched', NOW())
          RETURNING entry_id
        `, [
          pm.name || null,
          pm.description || null,
          pm.lat,
          pm.lng,
          pm.folder || null,
          sourceFile,
          pm.iconType || null,
          pm.iconColor || null,
          pm.iconMeaning || null,
          pm.staffAlert || false,
          parsedDate,
          parsedCatCount,
          parsedTrapper,
          JSON.stringify(parsedSignals),
        ]);

        if (insertResult.rowCount > 0) {
          stats.inserted++;
          if (pm.iconMeaning === 'disease_risk') stats.disease_risk++;
        }

      } catch (err) {
        stats.errors++;
        if (stats.errors <= 5) {
          console.error(`${red}Error at ${i}:${reset} ${err.message}`);
        }
      }
    }

    // Summary
    console.log(`\n${'='.repeat(50)}`);
    console.log(`${bold}Import Summary${reset}`);
    console.log(`${'='.repeat(50)}`);
    console.log(`${cyan}Total placemarks:${reset}     ${stats.total}`);
    console.log(`${green}Inserted:${reset}             ${stats.inserted}`);
    console.log(`${red}Disease risk entries:${reset} ${stats.disease_risk}`);
    console.log(`${yellow}Skipped duplicates:${reset}   ${stats.skipped_duplicate}`);
    if (stats.errors > 0) {
      console.log(`${red}Errors:${reset}               ${stats.errors}`);
    }

    if (!options.dryRun && stats.inserted > 0) {
      // Run place matching
      console.log(`\n${cyan}Running place matching...${reset}`);

      // Update nearest_place for all entries
      const nearestResult = await pool.query(`
        WITH updated AS (
          UPDATE source.google_map_entries e
          SET
            nearest_place_id = nearest.place_id,
            nearest_place_distance_m = nearest.distance_m
          FROM (
            SELECT DISTINCT ON (e2.entry_id)
              e2.entry_id,
              p.place_id,
              ST_Distance(
                ST_SetSRID(ST_MakePoint(e2.lng, e2.lat), 4326)::geography,
                p.location::geography
              ) as distance_m
            FROM source.google_map_entries e2
            CROSS JOIN LATERAL (
              SELECT place_id, location
              FROM sot.places p
              WHERE p.merged_into_place_id IS NULL
                AND p.location IS NOT NULL
                AND ST_DWithin(
                  ST_SetSRID(ST_MakePoint(e2.lng, e2.lat), 4326)::geography,
                  p.location::geography,
                  500
                )
              ORDER BY ST_Distance(
                ST_SetSRID(ST_MakePoint(e2.lng, e2.lat), 4326)::geography,
                p.location::geography
              )
              LIMIT 1
            ) p
            WHERE e2.nearest_place_id IS NULL
              AND e2.lat IS NOT NULL
          ) nearest
          WHERE e.entry_id = nearest.entry_id
          RETURNING e.entry_id
        )
        SELECT COUNT(*)::int as updated FROM updated
      `);
      console.log(`${green}Updated nearest place for ${nearestResult.rows[0]?.updated || 0} entries${reset}`);

      // Auto-link entries - stricter for multi-unit buildings
      // Single-unit: 30m threshold, Multi-unit: 10m threshold
      const linkResult = await pool.query(`
        WITH linked AS (
          UPDATE source.google_map_entries e
          SET
            linked_place_id = nearest_place_id,
            match_status = 'matched',
            matched_at = NOW()
          FROM sot.places p
          WHERE p.place_id = e.nearest_place_id
            AND e.nearest_place_id IS NOT NULL
            AND e.linked_place_id IS NULL
            AND e.match_status = 'unmatched'
            AND (
              -- Multi-unit: only auto-link within 10m
              (p.formatted_address ~* 'apt|unit|apartment|suite|#' AND e.nearest_place_distance_m <= 10)
              OR
              -- Single-unit: auto-link within 30m
              (NOT p.formatted_address ~* 'apt|unit|apartment|suite|#' AND e.nearest_place_distance_m <= 30)
            )
          RETURNING e.entry_id
        )
        SELECT COUNT(*)::int as linked FROM linked
      `);
      console.log(`${green}Auto-linked ${linkResult.rows[0]?.linked || 0} entries (30m single-unit, 10m multi-unit)${reset}`);

      // Mark uncertain - includes multi-unit 10-30m and all 30-100m
      const uncertainResult = await pool.query(`
        UPDATE source.google_map_entries e
        SET match_status = 'uncertain'
        FROM sot.places p
        WHERE p.place_id = e.nearest_place_id
          AND e.nearest_place_id IS NOT NULL
          AND e.linked_place_id IS NULL
          AND e.match_status = 'unmatched'
          AND (
            -- Multi-unit at 10-30m: needs manual review
            (p.formatted_address ~* 'apt|unit|apartment|suite|#'
             AND e.nearest_place_distance_m > 10
             AND e.nearest_place_distance_m <= 100)
            OR
            -- Single-unit at 30-100m
            (NOT p.formatted_address ~* 'apt|unit|apartment|suite|#'
             AND e.nearest_place_distance_m > 30
             AND e.nearest_place_distance_m <= 100)
          )
      `);
      console.log(`${yellow}Marked ${uncertainResult.rowCount} entries as uncertain${reset}`);

      // Get final stats
      const finalStats = await pool.query(`
        SELECT
          COUNT(*)::int as total,
          COUNT(*) FILTER (WHERE match_status = 'matched')::int as matched,
          COUNT(*) FILTER (WHERE match_status = 'uncertain')::int as uncertain,
          COUNT(*) FILTER (WHERE match_status = 'unmatched')::int as unmatched,
          COUNT(*) FILTER (WHERE icon_meaning = 'disease_risk')::int as disease_risk
        FROM source.google_map_entries
      `);

      console.log(`\n${bold}Database State${reset}`);
      console.log(`${'='.repeat(50)}`);
      const s = finalStats.rows[0];
      console.log(`${cyan}Total entries:${reset}        ${s.total}`);
      console.log(`${green}Matched:${reset}              ${s.matched}`);
      console.log(`${yellow}Uncertain:${reset}            ${s.uncertain}`);
      console.log(`${cyan}Unmatched:${reset}            ${s.unmatched}`);
      console.log(`${red}Disease risk:${reset}         ${s.disease_risk}`);

      // Run entity linking and disease computation if there are linked entries
      if (linkResult.rows[0]?.linked > 0) {
        console.log(`\n${cyan}Running entity linking and disease sync...${reset}`);

        try {
          // Run entity linking
          const linkingResult = await pool.query(`
            SELECT * FROM sot.run_all_entity_linking()
          `);
          console.log(`${green}Entity linking complete:${reset}`);
          for (const row of linkingResult.rows) {
            console.log(`  ${row.step}: ${row.records_processed || 0} records`);
          }
        } catch (err) {
          console.error(`${yellow}Entity linking skipped:${reset} ${err.message}`);
        }

        try {
          // Run disease status computation
          const diseaseResult = await pool.query(`
            SELECT * FROM ops.run_disease_status_computation()
          `);
          const dr = diseaseResult.rows[0];
          if (dr) {
            console.log(`${green}Disease computation complete:${reset}`);
            console.log(`  Places processed: ${dr.places_processed || 0}`);
            console.log(`  Cats with tests: ${dr.cats_with_tests || 0}`);
            console.log(`  Disease statuses: ${dr.disease_statuses_created || 0}`);
            console.log(`  Flags set TRUE: ${dr.flags_set_true || 0}`);
            console.log(`  Flags set FALSE: ${dr.flags_set_false || 0}`);
          }
        } catch (err) {
          console.error(`${yellow}Disease computation skipped:${reset} ${err.message}`);
        }
      }
    }

    if (options.dryRun) {
      console.log(`\n${yellow}DRY RUN - No changes were made${reset}`);
    }

  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error(`${red}Fatal error:${reset}`, err);
  process.exit(1);
});
