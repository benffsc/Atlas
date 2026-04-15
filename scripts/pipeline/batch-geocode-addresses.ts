#!/usr/bin/env npx tsx
/**
 * Batch geocode addresses with NULL coordinates.
 * FFS-1252 / DATA_GAP_067
 *
 * Queries sot.addresses where latitude IS NULL and formatted_address IS NOT NULL,
 * geocodes via Google Geocoding API, and updates both the address and linked place.
 *
 * Usage: GOOGLE_MAPS_API_KEY=... DATABASE_URL=... npx tsx scripts/pipeline/batch-geocode-addresses.ts
 */

import { Pool } from "pg";

const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL;
const RATE_LIMIT_MS = 100; // 10 per second (conservative for 50 QPS limit)
const MAX_ATTEMPTS = 3;

if (!GOOGLE_API_KEY || !DATABASE_URL) {
  console.error("Required: GOOGLE_MAPS_API_KEY and DATABASE_URL env vars");
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

interface PendingAddress {
  address_id: string;
  formatted_address: string;
  place_id: string | null;
  place_has_geom: boolean;
}

interface GeocodeResult {
  lat: number;
  lng: number;
  quality: string;
  formatted: string;
}

async function geocode(address: string): Promise<GeocodeResult | null> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GOOGLE_API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();

  if (data.status === "OK" && data.results?.length > 0) {
    const best = data.results[0];
    return {
      lat: best.geometry.location.lat,
      lng: best.geometry.location.lng,
      quality: (best.geometry.location_type || "unknown").toLowerCase(),
      formatted: best.formatted_address,
    };
  }

  if (data.status === "ZERO_RESULTS") return null;
  if (data.status === "OVER_QUERY_LIMIT") throw new Error("RATE_LIMITED");
  throw new Error(`Geocode failed: ${data.status} - ${data.error_message || ""}`);
}

async function main() {
  // Fetch pending addresses
  const { rows: pending } = await pool.query<PendingAddress>(`
    SELECT
      a.address_id::text,
      a.formatted_address,
      p.place_id::text,
      (p.location IS NOT NULL) AS place_has_geom
    FROM sot.addresses a
    LEFT JOIN sot.places p ON COALESCE(p.sot_address_id, p.address_id) = a.address_id
      AND p.merged_into_place_id IS NULL
    WHERE a.latitude IS NULL
      AND a.formatted_address IS NOT NULL
      AND COALESCE(a.geocoding_status, 'pending') != 'no_result'
    ORDER BY
      CASE WHEN p.place_id IS NOT NULL THEN 0 ELSE 1 END,
      a.created_at
    LIMIT 200
  `);

  console.log(`Found ${pending.length} addresses to geocode`);

  let success = 0, noResult = 0, failed = 0;

  for (const addr of pending) {
    try {
      const result = await geocode(addr.formatted_address);

      if (result) {
        // Update address
        await pool.query(`
          UPDATE sot.addresses SET
            latitude = $1, longitude = $2,
            location = ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
            geocoding_status = 'success',
            updated_at = NOW()
          WHERE address_id = $3
        `, [result.lat, result.lng, addr.address_id]);

        // Update linked place geometry if it's missing
        if (addr.place_id && !addr.place_has_geom) {
          await pool.query(`
            UPDATE sot.places SET
              location = ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
              updated_at = NOW()
            WHERE place_id = $3 AND location IS NULL
          `, [result.lng, result.lat, addr.place_id]);
        }

        success++;
        console.log(`  ✓ ${addr.formatted_address} → ${result.lat}, ${result.lng} (${result.quality})`);
      } else {
        await pool.query(`
          UPDATE sot.addresses SET
            geocoding_status = 'no_result', updated_at = NOW()
          WHERE address_id = $1
        `, [addr.address_id]);
        noResult++;
        console.log(`  ○ ${addr.formatted_address} → no result`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "RATE_LIMITED") {
        console.error("Rate limited! Waiting 60s...");
        await new Promise((r) => setTimeout(r, 60000));
        // Retry this one
        continue;
      }
      await pool.query(`
        UPDATE sot.addresses SET
          geocoding_status = 'failed', updated_at = NOW()
        WHERE address_id = $1
      `, [addr.address_id]);
      failed++;
      console.log(`  ✗ ${addr.formatted_address} → ${msg}`);
    }

    await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
  }

  console.log(`\nDone: ${success} geocoded, ${noResult} no result, ${failed} failed`);

  // Print health check
  const { rows: health } = await pool.query(`
    SELECT * FROM ops.v_address_geocoding_health
  `);
  console.log("\nGeocoding health:");
  console.table(health);

  // Print desync check
  const { rows: desync } = await pool.query(`
    SELECT count(*)::int AS desync_count FROM ops.v_address_coord_desync
  `);
  console.log(`Address coord desync: ${desync[0].desync_count} (should be 0)`);

  await pool.end();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
