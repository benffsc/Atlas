#!/usr/bin/env node
/**
 * Classification Cluster Detection Script
 *
 * Detects geographic clusters of places that may need classification
 * reconciliation. For example:
 * - Neighboring places with different classifications
 * - Multiple places that should be linked to the same colony
 * - Feeding stations with satellite addresses
 *
 * Uses the detect_classification_clusters() SQL function from MIG_627.
 *
 * Usage:
 *   export $(grep -v '^#' .env | xargs)
 *   node scripts/jobs/detect_classification_clusters.mjs
 *
 * Options:
 *   --radius N      Detection radius in meters (default: 200)
 *   --min-places N  Minimum places to form a cluster (default: 2)
 *   --dry-run       Show clusters without saving
 *   --clear         Clear existing pending clusters before detecting
 */

import pg from "pg";
import { parseArgs } from "node:util";

const { Pool } = pg;

// Parse arguments
const { values: args } = parseArgs({
  options: {
    radius: { type: "string", default: "200" },
    "min-places": { type: "string", default: "2" },
    "dry-run": { type: "boolean", default: false },
    clear: { type: "boolean", default: false },
    help: { type: "boolean", short: "h" },
  },
});

if (args.help) {
  console.log(`
Classification Cluster Detection

Detects geographic clusters of places that may need classification
reconciliation after AI backfill.

Usage:
  node scripts/jobs/detect_classification_clusters.mjs [options]

Options:
  --radius N       Detection radius in meters (default: 200)
  --min-places N   Minimum places to form a cluster (default: 2)
  --dry-run        Show clusters without saving
  --clear          Clear existing pending clusters before detecting
  -h, --help       Show this help
  `);
  process.exit(0);
}

const RADIUS = parseInt(args.radius);
const MIN_PLACES = parseInt(args["min-places"]);
const DRY_RUN = args["dry-run"];
const CLEAR = args.clear;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function clearPendingClusters() {
  console.log("Clearing existing pending clusters...");
  const result = await pool.query(`
    DELETE FROM ops.classification_clusters
    WHERE status = 'pending'
    RETURNING cluster_id
  `);
  console.log(`  Deleted ${result.rowCount} pending clusters\n`);
}

async function detectClusters() {
  console.log(`Detecting clusters (radius: ${RADIUS}m, min-places: ${MIN_PLACES})...\n`);

  const result = await pool.query(
    `SELECT * FROM ops.detect_classification_clusters($1, $2)`,
    [RADIUS, MIN_PLACES]
  );

  return result.rows;
}

async function analyzeCluster(cluster) {
  // Get detailed place info
  const placesResult = await pool.query(`
    SELECT
      p.place_id,
      p.formatted_address,
      p.colony_classification::TEXT,
      p.colony_id,
      (
        SELECT jsonb_build_object(
          'suggestion', r.suggested_classification::TEXT,
          'confidence', r.classification_confidence
        )
        FROM ops.requests r
        WHERE r.place_id = p.place_id
          AND r.suggested_classification IS NOT NULL
        ORDER BY r.classification_confidence DESC
        LIMIT 1
      ) AS best_suggestion
    FROM sot.places p
    WHERE p.place_id = ANY($1)
  `, [cluster.place_ids]);

  // Get Google Maps context for the cluster
  const googleMapsResult = await pool.query(`
    SELECT
      gme.original_content AS notes,
      gme.ai_summary,
      gme.lat,
      gme.lng
    FROM ops.google_map_entries gme
    JOIN sot.places p ON ST_DWithin(
      p.location::geography,
      ST_SetSRID(ST_MakePoint(gme.lng, gme.lat), 4326)::geography,
      $2
    )
    WHERE p.place_id = ANY($1)
      AND gme.original_content IS NOT NULL
    LIMIT 5
  `, [cluster.place_ids, RADIUS]);

  // Determine recommended action
  const classifications = cluster.classifications.filter(c => c !== 'unknown');
  const uniqueClassifications = [...new Set(classifications)];
  const dominantClassification = getDominant(classifications);

  let recommendedAction = null;
  let recommendedClassification = null;

  if (cluster.consistency_score >= 0.9) {
    // Very consistent - probably just need to confirm
    recommendedAction = 'leave_separate';
  } else if (uniqueClassifications.length === 1) {
    // All same classification
    recommendedAction = 'leave_separate';
  } else if (uniqueClassifications.every(c => ['small_colony', 'large_colony', 'feeding_station'].includes(c))) {
    // All colony types - might need merging
    recommendedAction = 'merge_to_colony';
    recommendedClassification = dominantClassification;
  } else if (uniqueClassifications.includes('individual_cats') && uniqueClassifications.some(c => c.includes('colony'))) {
    // Mix of individual and colony - needs review
    recommendedAction = 'needs_site_visit';
  } else {
    // General inconsistency
    recommendedAction = 'reconcile_classification';
    recommendedClassification = dominantClassification;
  }

  // Check for feeding station language in Google Maps
  const hasFeedingStationLanguage = googleMapsResult.rows.some(g =>
    (g.notes || g.ai_summary || '').toLowerCase().match(/feeding|feeds|colony|been here for years|established/i)
  );

  if (hasFeedingStationLanguage && recommendedAction !== 'leave_separate') {
    recommendedAction = 'merge_to_colony';
    recommendedClassification = 'feeding_station';
  }

  return {
    places: placesResult.rows,
    googleMaps: googleMapsResult.rows,
    uniqueClassifications,
    dominantClassification,
    recommendedAction,
    recommendedClassification,
    hasFeedingStationLanguage,
  };
}

function getDominant(arr) {
  const counts = {};
  arr.forEach(item => {
    counts[item] = (counts[item] || 0) + 1;
  });
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

async function saveCluster(cluster, analysis) {
  // Calculate center point
  const centerResult = await pool.query(`
    SELECT
      AVG(ST_Y(location::geometry)) AS center_lat,
      AVG(ST_X(location::geometry)) AS center_lng
    FROM sot.places
    WHERE place_id = ANY($1)
  `, [cluster.place_ids]);

  const center = centerResult.rows[0];

  await pool.query(`
    INSERT INTO ops.classification_clusters (
      cluster_id,
      center_lat,
      center_lng,
      radius_meters,
      place_ids,
      unique_classifications,
      dominant_classification,
      consistency_score,
      recommended_action,
      recommended_classification,
      status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
    ON CONFLICT (cluster_id) DO UPDATE SET
      place_ids = EXCLUDED.place_ids,
      unique_classifications = EXCLUDED.unique_classifications,
      dominant_classification = EXCLUDED.dominant_classification,
      consistency_score = EXCLUDED.consistency_score,
      recommended_action = EXCLUDED.recommended_action,
      recommended_classification = EXCLUDED.recommended_classification,
      updated_at = NOW()
  `, [
    cluster.cluster_id,
    center.center_lat,
    center.center_lng,
    RADIUS,
    cluster.place_ids,
    analysis.uniqueClassifications,
    analysis.dominantClassification,
    cluster.consistency_score,
    analysis.recommendedAction,
    analysis.recommendedClassification,
  ]);
}

async function main() {
  console.log("=".repeat(60));
  console.log("Classification Cluster Detection");
  console.log("=".repeat(60));
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  console.log(`Radius: ${RADIUS}m`);
  console.log(`Min places per cluster: ${MIN_PLACES}`);
  console.log("");

  if (CLEAR && !DRY_RUN) {
    await clearPendingClusters();
  }

  const clusters = await detectClusters();
  console.log(`Found ${clusters.length} clusters\n`);

  if (clusters.length === 0) {
    console.log("No clusters detected. Places may be too far apart or all consistently classified.");
    await pool.end();
    return;
  }

  let saved = 0;
  let needsReview = 0;

  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i];
    const analysis = await analyzeCluster(cluster);

    console.log(`\n[${ i + 1}/${clusters.length}] Cluster with ${cluster.place_ids.length} places`);
    console.log(`  Consistency: ${Math.round(cluster.consistency_score * 100)}%`);
    console.log(`  Classifications: ${analysis.uniqueClassifications.join(", ")}`);
    console.log(`  Dominant: ${analysis.dominantClassification}`);
    console.log(`  Recommended: ${analysis.recommendedAction}${analysis.recommendedClassification ? ` → ${analysis.recommendedClassification}` : ""}`);

    if (analysis.hasFeedingStationLanguage) {
      console.log(`  ★ Google Maps mentions feeding/colony`);
    }

    // Show places
    console.log(`  Places:`);
    for (const place of analysis.places) {
      const classification = place.colony_classification || place.best_suggestion?.suggestion || 'unknown';
      const confidence = place.best_suggestion?.confidence ? ` (${Math.round(place.best_suggestion.confidence * 100)}%)` : '';
      console.log(`    - ${place.formatted_address.substring(0, 50)}: ${classification}${confidence}`);
    }

    if (!DRY_RUN && cluster.consistency_score < 1.0) {
      await saveCluster(cluster, analysis);
      saved++;

      if (analysis.recommendedAction !== 'leave_separate') {
        needsReview++;
      }
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("Summary");
  console.log("=".repeat(60));
  console.log(`Total clusters detected: ${clusters.length}`);
  console.log(`Clusters saved for review: ${saved}`);
  console.log(`Clusters needing action: ${needsReview}`);
  console.log(`\nReview clusters at: /admin/classification-clusters`);

  await pool.end();
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
