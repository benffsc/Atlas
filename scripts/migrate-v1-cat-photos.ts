/**
 * V1 → V2 Cat Photo Migration Script
 *
 * Purpose: Copy cat photos from V1 storage to V2 storage, mapping V1 cat_ids to V2 cat_ids
 * based on microchip matching.
 *
 * Usage: npx ts-node scripts/migrate-v1-cat-photos.ts
 *
 * What it does:
 * 1. Connects to both V1 (us-east-2) and V2 (us-west-2) databases
 * 2. Gets V1 cats with photos for clinic days 02/02 and 02/04
 * 3. Matches them to V2 cats by microchip
 * 4. Downloads photos from V1 storage and uploads to V2 storage with new paths
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// V1 Database (us-east-2)
const V1_SUPABASE_URL = 'https://tpjllrfpdlkenbapvpko.supabase.co';
const V1_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY_EAST!;

// V2 Database (us-west-2)
const V2_SUPABASE_URL = 'https://afxpboxisgoxttyrbtpw.supabase.co';
const V2_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

interface PhotoMapping {
  v1_cat_id: string;
  v2_cat_id: string;
  microchip: string;
  cat_name: string;
  photo_paths: string[];
}

async function getV1PhotoMappings(v1Client: SupabaseClient): Promise<PhotoMapping[]> {
  // Get V1 cats with photos for 02/02 and 02/04
  const { data: v1Cats, error: v1Error } = await v1Client.rpc('get_cats_with_photos_for_migration', {
    clinic_dates: ['2026-02-02', '2026-02-04']
  });

  if (v1Error) {
    // Fallback: direct query
    const { data, error } = await v1Client
      .from('sot.cats')
      .select(`
        cat_id,
        microchip,
        name,
        appointments:ops.appointments!inner(appointment_date)
      `)
      .in('appointments.appointment_date', ['2026-02-02', '2026-02-04'])
      .not('microchip', 'is', null);

    if (error) throw error;
    return data as any[];
  }

  return v1Cats;
}

async function migratePhotos() {
  console.log('=== V1 → V2 Cat Photo Migration ===\n');

  // Initialize clients
  const v1Client = createClient(V1_SUPABASE_URL, V1_SERVICE_KEY);
  const v2Client = createClient(V2_SUPABASE_URL, V2_SERVICE_KEY);

  // Step 1: Get V1 storage objects
  console.log('1. Fetching V1 photos...');
  const { data: v1Photos, error: v1PhotoError } = await v1Client
    .storage
    .from('request-media')
    .list('cats', { limit: 500 });

  if (v1PhotoError) {
    console.error('Error fetching V1 photos:', v1PhotoError);
    return;
  }

  console.log(`   Found ${v1Photos?.length || 0} cat folders in V1\n`);

  // Step 2: Get cat mappings from database
  console.log('2. Building V1→V2 cat mapping...');

  // Query V1 for cats with photos
  const { data: v1CatData, error: v1CatError } = await v1Client.rpc('sql', {
    query: `
      SELECT
        c.microchip,
        a.cat_id as v1_cat_id,
        c.name as cat_name,
        ARRAY_AGG(p.name) as photo_paths
      FROM ops.appointments a
      JOIN sot.cats c ON c.cat_id = a.cat_id
      JOIN storage.objects p ON SPLIT_PART(p.name, '/', 2)::UUID = a.cat_id
        AND p.bucket_id = 'request-media' AND p.name LIKE 'cats/%'
      WHERE a.appointment_date IN ('2026-02-02', '2026-02-04')
        AND c.microchip IS NOT NULL
      GROUP BY c.microchip, a.cat_id, c.name
    `
  });

  // Query V2 for matching cats
  const { data: v2CatData, error: v2CatError } = await v2Client.rpc('sql', {
    query: `
      SELECT
        c.microchip,
        c.cat_id as v2_cat_id,
        c.name as cat_name
      FROM ops.appointments a
      JOIN sot.cats c ON c.cat_id = a.cat_id
      WHERE a.appointment_date IN ('2026-02-02', '2026-02-04')
        AND c.microchip IS NOT NULL
    `
  });

  // Create microchip → v2_cat_id mapping
  const v2CatMap = new Map<string, string>();
  (v2CatData || []).forEach((cat: any) => {
    v2CatMap.set(cat.microchip, cat.v2_cat_id);
  });

  // Build migration list
  const migrations: PhotoMapping[] = [];
  let skipped = 0;

  (v1CatData || []).forEach((v1Cat: any) => {
    const v2CatId = v2CatMap.get(v1Cat.microchip);
    if (v2CatId) {
      migrations.push({
        v1_cat_id: v1Cat.v1_cat_id,
        v2_cat_id: v2CatId,
        microchip: v1Cat.microchip,
        cat_name: v1Cat.cat_name,
        photo_paths: v1Cat.photo_paths
      });
    } else {
      console.log(`   Skipping ${v1Cat.cat_name} (${v1Cat.microchip}) - no V2 match`);
      skipped++;
    }
  });

  console.log(`   ${migrations.length} cats to migrate, ${skipped} skipped\n`);

  // Step 3: Migrate photos
  console.log('3. Migrating photos...');

  let migrated = 0;
  let errors = 0;

  for (const mapping of migrations) {
    for (const oldPath of mapping.photo_paths) {
      // Download from V1
      const { data: fileData, error: downloadError } = await v1Client
        .storage
        .from('request-media')
        .download(oldPath);

      if (downloadError) {
        console.error(`   Error downloading ${oldPath}:`, downloadError);
        errors++;
        continue;
      }

      // Create new path with V2 cat_id
      const filename = oldPath.split('/').pop()!;
      const newPath = `cats/${mapping.v2_cat_id}/${filename}`;

      // Upload to V2
      const { error: uploadError } = await v2Client
        .storage
        .from('request-media')
        .upload(newPath, fileData, {
          contentType: filename.endsWith('.png') ? 'image/png' : 'image/jpeg',
          upsert: false
        });

      if (uploadError) {
        if (uploadError.message.includes('already exists')) {
          console.log(`   Skipping ${newPath} - already exists`);
        } else {
          console.error(`   Error uploading ${newPath}:`, uploadError);
          errors++;
        }
        continue;
      }

      migrated++;
      console.log(`   ✓ Migrated: ${mapping.cat_name} (${mapping.microchip})`);
    }
  }

  console.log(`\n=== Migration Complete ===`);
  console.log(`   Photos migrated: ${migrated}`);
  console.log(`   Errors: ${errors}`);
  console.log(`   Cats without V2 match: ${skipped}`);
}

// Run migration
migratePhotos().catch(console.error);
