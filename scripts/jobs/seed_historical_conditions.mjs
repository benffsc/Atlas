#!/usr/bin/env node
/**
 * seed_historical_conditions.mjs
 *
 * Populates the place_condition_history table from Google Maps AI classifications.
 * Maps AI classifications to ecological condition types and extracts temporal data.
 *
 * Usage:
 *   node scripts/jobs/seed_historical_conditions.mjs --dry-run
 *   node scripts/jobs/seed_historical_conditions.mjs --limit 500
 *   node scripts/jobs/seed_historical_conditions.mjs
 */

import pg from "pg";
import dotenv from "dotenv";
dotenv.config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Map AI meanings to place condition types
const AI_MEANING_TO_CONDITION = {
  disease_risk: "disease_outbreak",
  felv_colony: "disease_outbreak",
  fiv_colony: "disease_outbreak",
  watch_list: "difficult_client",
  active_colony: "feeding_station",
  historical_colony: "resolved_colony",
  relocation_client: null, // Not a place condition
  volunteer: null, // Not a place condition
  contact_info: null, // Not a place condition
  unclassified: null,
};

// Severity mapping based on AI classification signals
function determineSeverity(classification) {
  const signals = classification?.signals || {};

  // Disease is always critical
  if (signals.disease_mentions?.length > 0) {
    return "critical";
  }

  // Safety concerns are severe
  if (signals.safety_concerns?.length > 0) {
    return "severe";
  }

  // High cat count indicates severity
  const catCount = signals.cat_count;
  if (catCount && catCount >= 50) return "severe";
  if (catCount && catCount >= 20) return "moderate";

  return "moderate";
}

// Estimate ecological impact based on cat count and condition
function estimateEcologicalImpact(classification, conditionType) {
  const signals = classification?.signals || {};
  const catCount = signals.cat_count;

  // Disease outbreaks have regional impact
  if (conditionType === "disease_outbreak") {
    return catCount && catCount >= 20 ? "regional" : "local";
  }

  // High cat counts have significant impact
  if (catCount && catCount >= 50) return "significant";
  if (catCount && catCount >= 20) return "regional";
  if (catCount && catCount >= 10) return "local";

  return "minimal";
}

// Extract date hints from the AI classification or original content
function extractDateHints(entry) {
  // Try to find year mentions in the original content
  const content = entry.original_content || "";
  const yearMatches = content.match(/\b(19|20)\d{2}\b/g);

  if (yearMatches && yearMatches.length > 0) {
    // Use earliest year found as valid_from
    const years = yearMatches.map((y) => parseInt(y)).sort((a, b) => a - b);
    return {
      validFrom: `${years[0]}-01-01`,
      validTo: null, // We don't know when it ended
    };
  }

  // Default to synced_at date (handle both Date objects and strings)
  let syncedDate;
  if (entry.synced_at instanceof Date) {
    syncedDate = entry.synced_at.toISOString().split("T")[0];
  } else if (typeof entry.synced_at === "string") {
    syncedDate = entry.synced_at.split("T")[0];
  } else {
    syncedDate = new Date().toISOString().split("T")[0];
  }

  return {
    validFrom: syncedDate,
    validTo: null,
  };
}

async function seedHistoricalConditions(options = {}) {
  const { dryRun = false, limit = null } = options;

  console.log("=== Seeding Historical Conditions from Google Maps ===");
  console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE"}`);
  if (limit) console.log(`Limit: ${limit}`);
  console.log("");

  const client = await pool.connect();

  try {
    // Get classified Google Maps entries that:
    // 1. Have been AI classified
    // 2. Are linked to a place
    // 3. Have a meaning that maps to a place condition
    // 4. Haven't already been processed into place_condition_history
    const query = `
      SELECT
        g.entry_id,
        g.kml_name,
        g.original_content,
        g.ai_meaning,
        g.ai_classification,
        g.ai_classified_at,
        g.synced_at,
        g.linked_place_id,
        p.formatted_address,
        p.place_id
      FROM trapper.google_map_entries g
      JOIN trapper.places p ON p.place_id = g.linked_place_id
      WHERE g.ai_meaning IS NOT NULL
        AND g.linked_place_id IS NOT NULL
        AND g.ai_meaning IN ('disease_risk', 'felv_colony', 'fiv_colony', 'watch_list', 'active_colony', 'historical_colony')
        AND NOT EXISTS (
          SELECT 1 FROM trapper.place_condition_history pch
          WHERE pch.source_system = 'google_maps'
          AND pch.source_record_id = g.entry_id::text
        )
      ORDER BY
        CASE g.ai_meaning
          WHEN 'disease_risk' THEN 1
          WHEN 'felv_colony' THEN 2
          WHEN 'fiv_colony' THEN 3
          WHEN 'watch_list' THEN 4
          WHEN 'active_colony' THEN 5
          WHEN 'historical_colony' THEN 6
        END
      ${limit ? `LIMIT ${limit}` : ""}
    `;

    const { rows: entries } = await client.query(query);
    console.log(`Found ${entries.length} entries to process`);

    let created = 0;
    let skipped = 0;
    const conditionCounts = {};

    for (const entry of entries) {
      const conditionType = AI_MEANING_TO_CONDITION[entry.ai_meaning];

      if (!conditionType) {
        skipped++;
        continue;
      }

      const classification = entry.ai_classification || {};
      const severity = determineSeverity(classification);
      const ecologicalImpact = estimateEcologicalImpact(classification, conditionType);
      const { validFrom, validTo } = extractDateHints(entry);
      const catCount = classification?.signals?.cat_count || null;

      // Build description from AI summary if available
      let description = entry.kml_name || "";
      if (classification?.signals?.disease_mentions?.length > 0) {
        description += ` Disease mentions: ${classification.signals.disease_mentions.join(", ")}.`;
      }
      if (classification?.signals?.safety_concerns?.length > 0) {
        description += ` Safety concerns: ${classification.signals.safety_concerns.join(", ")}.`;
      }
      if (catCount) {
        description += ` Estimated ${catCount} cats.`;
      }

      conditionCounts[conditionType] = (conditionCounts[conditionType] || 0) + 1;

      if (!dryRun) {
        await client.query(
          `
          INSERT INTO trapper.place_condition_history (
            place_id,
            condition_type,
            severity,
            valid_from,
            valid_to,
            description,
            peak_cat_count,
            ecological_impact,
            source_type,
            source_system,
            source_record_id,
            recorded_by
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          ON CONFLICT DO NOTHING
        `,
          [
            entry.place_id,
            conditionType,
            severity,
            validFrom,
            validTo,
            description.trim().substring(0, 500),
            catCount,
            ecologicalImpact,
            "ai_extracted",
            "google_maps",
            entry.entry_id.toString(),
            "seed_historical_conditions",
          ]
        );
      }

      created++;

      // Progress indicator
      if (created % 50 === 0) {
        process.stdout.write(`\r  Processed ${created}/${entries.length}...`);
      }
    }

    console.log(`\n\nSummary:`);
    console.log(`  Created: ${created}`);
    console.log(`  Skipped: ${skipped} (no matching condition type)`);
    console.log(`\nCondition breakdown:`);
    for (const [type, count] of Object.entries(conditionCounts)) {
      console.log(`  ${type}: ${count}`);
    }

    // Also refresh zone data coverage
    if (!dryRun) {
      console.log("\nRefreshing zone data coverage...");
      await client.query(`SELECT trapper.refresh_zone_data_coverage()`);
      console.log("Done.");
    }
  } finally {
    client.release();
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  dryRun: args.includes("--dry-run"),
  limit: null,
};

const limitIndex = args.indexOf("--limit");
if (limitIndex !== -1 && args[limitIndex + 1]) {
  options.limit = parseInt(args[limitIndex + 1]);
}

seedHistoricalConditions(options)
  .then(() => {
    console.log("\n=== Complete ===");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
