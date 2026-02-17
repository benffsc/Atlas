/**
 * V1 → V2 Cat Photo Migration
 *
 * Migrates cat photos from V1 Supabase storage to V2 Supabase storage,
 * mapping V1 cat_ids to V2 cat_ids based on microchip.
 *
 * Usage: node scripts/migrate-cat-photos.mjs
 */

import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
const { Pool } = pg;

// V1 (us-east-2)
const V1_SUPABASE_URL = 'https://tpjllrfpdlkenbapvpko.supabase.co';
const V1_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY_EAST;
const V1_DB_URL = 'postgresql://postgres.tpjllrfpdlkenbapvpko:vfh0xba!ujx!gwz!UGJ@aws-1-us-east-2.pooler.supabase.com:6543/postgres';

// V2 (us-west-2)
const V2_SUPABASE_URL = 'https://afxpboxisgoxttyrbtpw.supabase.co';
const V2_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const V2_DB_URL = 'postgresql://postgres.afxpboxisgoxttyrbtpw:BfuM42NhYjPfLY!@vdBV@aws-0-us-west-2.pooler.supabase.com:6543/postgres';

async function main() {
  console.log('=== V1 → V2 Cat Photo Migration ===\n');

  if (!V1_SERVICE_KEY || !V2_SERVICE_KEY) {
    console.error('Missing service keys. Set SUPABASE_SERVICE_ROLE_KEY_EAST and SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  // Initialize clients
  const v1Supabase = createClient(V1_SUPABASE_URL, V1_SERVICE_KEY);
  const v2Supabase = createClient(V2_SUPABASE_URL, V2_SERVICE_KEY);

  const v1Pool = new Pool({ connectionString: V1_DB_URL });
  const v2Pool = new Pool({ connectionString: V2_DB_URL });

  try {
    // Step 1: Get V2 microchip → cat_id mapping
    console.log('1. Building V2 cat mapping...');
    const v2Result = await v2Pool.query(`
      SELECT DISTINCT c.microchip, c.cat_id as v2_cat_id
      FROM ops.appointments a
      JOIN sot.cats c ON c.cat_id = a.cat_id
      WHERE a.appointment_date IN ('2026-02-02', '2026-02-04')
        AND c.microchip IS NOT NULL
    `);

    const v2Map = new Map();
    v2Result.rows.forEach(row => v2Map.set(row.microchip, row.v2_cat_id));
    console.log(`   Found ${v2Map.size} V2 cats\n`);

    // Step 2: Get V1 photos with microchip
    console.log('2. Getting V1 photos...');
    const v1Result = await v1Pool.query(`
      SELECT
        c.microchip,
        a.cat_id as v1_cat_id,
        p.name as photo_path
      FROM ops.appointments a
      JOIN sot.cats c ON c.cat_id = a.cat_id
      JOIN storage.objects p ON SPLIT_PART(p.name, '/', 2)::UUID = a.cat_id
        AND p.bucket_id = 'request-media' AND p.name LIKE 'cats/%'
      WHERE a.appointment_date IN ('2026-02-02', '2026-02-04')
        AND c.microchip IS NOT NULL
      ORDER BY c.microchip
    `);

    console.log(`   Found ${v1Result.rows.length} photos to migrate\n`);

    // Step 3: Migrate photos
    console.log('3. Migrating photos...');
    let migrated = 0;
    let skipped = 0;
    let errors = 0;

    for (const row of v1Result.rows) {
      const v2CatId = v2Map.get(row.microchip);
      if (!v2CatId) {
        console.log(`   SKIP: No V2 match for ${row.microchip}`);
        skipped++;
        continue;
      }

      const filename = row.photo_path.split('/').pop();
      const newPath = `cats/${v2CatId}/${filename}`;

      // Check if already exists in V2
      const { data: existing } = await v2Supabase.storage
        .from('request-media')
        .list(`cats/${v2CatId}`, { search: filename });

      if (existing && existing.length > 0) {
        console.log(`   EXISTS: ${newPath}`);
        skipped++;
        continue;
      }

      // Download from V1
      const { data: fileData, error: downloadError } = await v1Supabase.storage
        .from('request-media')
        .download(row.photo_path);

      if (downloadError) {
        console.error(`   ERROR downloading ${row.photo_path}:`, downloadError.message);
        errors++;
        continue;
      }

      // Upload to V2
      const contentType = filename.endsWith('.png') ? 'image/png' : 'image/jpeg';
      const { error: uploadError } = await v2Supabase.storage
        .from('request-media')
        .upload(newPath, fileData, { contentType, upsert: false });

      if (uploadError) {
        console.error(`   ERROR uploading ${newPath}:`, uploadError.message);
        errors++;
        continue;
      }

      console.log(`   ✓ ${row.microchip} → ${newPath}`);
      migrated++;
    }

    console.log(`\n=== Migration Complete ===`);
    console.log(`   Migrated: ${migrated}`);
    console.log(`   Skipped: ${skipped}`);
    console.log(`   Errors: ${errors}`);

  } finally {
    await v1Pool.end();
    await v2Pool.end();
  }
}

main().catch(console.error);
