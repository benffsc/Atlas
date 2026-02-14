#!/usr/bin/env npx tsx
/**
 * Migrate place coordinates from V1 to V2
 *
 * IMPORTANT: V2 places have DIFFERENT UUIDs than V1 places.
 * This script matches places by normalized_address, NOT by place_id.
 *
 * V1 has 13,933 places with coordinates, V2 currently has 0.
 * V1 and V2 place_ids do NOT match (see DATA_GAP_030).
 *
 * Strategy:
 * 1. Build lookup of V1 places by normalized_address
 * 2. For each V2 place, find matching V1 place by normalized_address
 * 3. Copy coordinates from V1 to V2
 *
 * Usage:
 *   npx tsx scripts/ingest-v2/migrate_place_coordinates.ts
 */

import pg from "pg";

const V1_DATABASE_URL = process.env.V1_DATABASE_URL ||
  "postgresql://postgres.tpjllrfpdlkenbapvpko:vfh0xba%21ujx%21gwz%21UGJ@aws-1-us-east-2.pooler.supabase.com:6543/postgres";

const V2_DATABASE_URL = process.env.V2_DATABASE_URL ||
  "postgresql://postgres.afxpboxisgoxttyrbtpw:BfuM42NhYjPfLY%21%40vdBV@aws-0-us-west-2.pooler.supabase.com:5432/postgres";

interface V1Place {
  place_id: string;
  lat: number;
  lng: number;
  formatted_address: string;
  normalized_address: string;
}

async function migrateCoordinates() {
  console.log("=".repeat(60));
  console.log("  Place Coordinate Migration: V1 → V2 (by normalized_address)");
  console.log("=".repeat(60));
  console.log("");
  console.log("NOTE: V2 has different UUIDs than V1. Matching by address, not place_id.");
  console.log("");

  const v1 = new pg.Pool({ connectionString: V1_DATABASE_URL });
  const v2 = new pg.Pool({ connectionString: V2_DATABASE_URL });

  try {
    // =========================================================================
    // Step 1: Build V1 place lookup by normalized_address
    // =========================================================================
    console.log("1. Fetching V1 places with coordinates...");
    const v1Places = await v1.query<V1Place>(`
      SELECT
        place_id,
        ST_Y(location::geometry) as lat,
        ST_X(location::geometry) as lng,
        formatted_address,
        normalized_address
      FROM sot.places
      WHERE location IS NOT NULL
        AND merged_into_place_id IS NULL
        AND normalized_address IS NOT NULL
        AND normalized_address != ''
    `);

    console.log(`   Found ${v1Places.rowCount} V1 places with coordinates and normalized_address`);

    // Build lookup map (normalized_address → place data)
    const v1Lookup = new Map<string, V1Place>();
    for (const p of v1Places.rows) {
      // Use first match if duplicates exist
      if (!v1Lookup.has(p.normalized_address)) {
        v1Lookup.set(p.normalized_address, p);
      }
    }
    console.log(`   Built lookup with ${v1Lookup.size} unique normalized addresses`);

    // =========================================================================
    // Step 2: Fetch V2 places that need coordinates
    // =========================================================================
    console.log("\n2. Fetching V2 places needing coordinates...");
    const v2Places = await v2.query<{ place_id: string; normalized_address: string }>(`
      SELECT place_id, normalized_address
      FROM sot.places
      WHERE location IS NULL
        AND merged_into_place_id IS NULL
        AND normalized_address IS NOT NULL
        AND normalized_address != ''
    `);

    console.log(`   Found ${v2Places.rowCount} V2 places needing coordinates`);

    // =========================================================================
    // Step 3: Match and update coordinates
    // =========================================================================
    console.log("\n3. Matching V2 places to V1 and copying coordinates...");
    let matched = 0;
    let notMatched = 0;
    let errors = 0;

    for (const v2Place of v2Places.rows) {
      const v1Match = v1Lookup.get(v2Place.normalized_address);

      if (v1Match) {
        try {
          await v2.query(`
            UPDATE sot.places
            SET location = ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
            WHERE place_id = $3
          `, [v1Match.lng, v1Match.lat, v2Place.place_id]);
          matched++;
        } catch (err: unknown) {
          const error = err as Error;
          errors++;
          if (errors <= 5) {
            console.error(`   Error updating ${v2Place.place_id}: ${error.message}`);
          }
        }
      } else {
        notMatched++;
      }

      // Progress indicator every 500
      if ((matched + notMatched) % 500 === 0) {
        console.log(`   Progress: ${matched + notMatched}/${v2Places.rowCount} processed (${matched} matched)...`);
      }
    }

    console.log(`\n   Matched and updated: ${matched} places`);
    console.log(`   No V1 match found: ${notMatched} places`);
    console.log(`   Errors: ${errors}`);

    // =========================================================================
    // Step 4: Try matching by formatted_address for remaining
    // =========================================================================
    console.log("\n4. Trying formatted_address match for unmatched places...");

    // Rebuild V1 lookup by formatted_address
    const v1FormattedLookup = new Map<string, V1Place>();
    for (const p of v1Places.rows) {
      if (p.formatted_address) {
        const key = p.formatted_address.toLowerCase().trim();
        if (!v1FormattedLookup.has(key)) {
          v1FormattedLookup.set(key, p);
        }
      }
    }

    const stillMissing = await v2.query<{ place_id: string; formatted_address: string }>(`
      SELECT place_id, formatted_address
      FROM sot.places
      WHERE location IS NULL
        AND merged_into_place_id IS NULL
        AND formatted_address IS NOT NULL
    `);

    let extraMatched = 0;
    for (const v2Place of stillMissing.rows) {
      if (!v2Place.formatted_address) continue;

      const key = v2Place.formatted_address.toLowerCase().trim();
      const v1Match = v1FormattedLookup.get(key);

      if (v1Match) {
        try {
          await v2.query(`
            UPDATE sot.places
            SET location = ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
            WHERE place_id = $3 AND location IS NULL
          `, [v1Match.lng, v1Match.lat, v2Place.place_id]);
          extraMatched++;
        } catch {
          // Ignore errors for this pass
        }
      }
    }
    console.log(`   Additional matches via formatted_address: ${extraMatched}`);

    // =========================================================================
    // Step 5: Verification
    // =========================================================================
    console.log("\n5. Verifying V2 places...");
    const v2Check = await v2.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE location IS NOT NULL) as with_location
      FROM sot.places
      WHERE merged_into_place_id IS NULL
    `);
    console.log(`   Total V2 places: ${v2Check.rows[0].total}`);
    console.log(`   With location: ${v2Check.rows[0].with_location}`);
    const pct = ((v2Check.rows[0].with_location / v2Check.rows[0].total) * 100).toFixed(1);
    console.log(`   Coverage: ${pct}%`);

    // Check map view
    console.log("\n6. Checking map view...");
    const mapPins = await v2.query(`SELECT COUNT(*) as cnt FROM sot.v_map_atlas_pins`);
    console.log(`   Map pins available: ${mapPins.rows[0].cnt}`);

    console.log("\n" + "=".repeat(60));
    console.log("  Coordinate Migration Complete!");
    console.log("=".repeat(60));
    console.log(`\nSummary:`);
    console.log(`  - Matched by normalized_address: ${matched}`);
    console.log(`  - Matched by formatted_address: ${extraMatched}`);
    console.log(`  - Total places with coordinates: ${v2Check.rows[0].with_location}`);
    console.log(`  - Map pins: ${mapPins.rows[0].cnt}`);

  } catch (error) {
    console.error("\nMigration failed:", error);
    process.exit(1);
  } finally {
    await v1.end();
    await v2.end();
  }
}

migrateCoordinates();
