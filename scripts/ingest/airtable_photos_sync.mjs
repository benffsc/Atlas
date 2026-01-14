#!/usr/bin/env node
/**
 * airtable_photos_sync.mjs
 *
 * Syncs photos from Airtable Trapper Cats and Trapper Reports to Atlas.
 * Uses the Raw → Normalize → SoT pattern:
 *   1. Fetch from Airtable → raw_airtable_media (pending)
 *   2. Upload to Supabase Storage → raw_airtable_media (downloaded)
 *   3. Import to request_media → raw_airtable_media (imported)
 *
 * Usage:
 *   node scripts/ingest/airtable_photos_sync.mjs [--stage=fetch|download|import|all]
 *
 * Required env:
 *   DATABASE_URL - Postgres connection string
 *   SUPABASE_URL - Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY - Supabase service role key
 *   AIRTABLE_PAT - Airtable Personal Access Token (optional, has default)
 */

import pg from 'pg';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const { Client } = pg;

const AIRTABLE_PAT = process.env.AIRTABLE_PAT || 'patcjKFzC852FH3sI.ac4874470b704b94ed1545a6d7d67bab536f576d6f3292bdccc9d1eadf635351';
const BASE_ID = 'appl6zLrRFDvsz0dh';
const TRAPPER_CATS_TABLE = 'tblP6VojwygMA9VQ3';
const TRAPPER_REPORTS_TABLE = 'tblE8SFqVfsW051ox';
const MEDIA_BUCKET = 'request-media';

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
let supabase = null;

if (supabaseUrl && supabaseServiceKey) {
  supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

async function fetchAllRecords(tableId, filterFormula = '') {
  const records = [];
  let offset = null;
  let page = 1;

  while (true) {
    let url = `https://api.airtable.com/v0/${BASE_ID}/${tableId}?pageSize=100`;
    if (offset) url += `&offset=${offset}`;
    if (filterFormula) url += `&filterByFormula=${encodeURIComponent(filterFormula)}`;

    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` }
    });

    if (!response.ok) {
      throw new Error(`Airtable API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    records.push(...data.records);
    console.log(`  Page ${page}: ${data.records.length} records (total: ${records.length})`);

    if (data.offset) {
      offset = data.offset;
      page++;
    } else {
      break;
    }
  }

  return records;
}

async function downloadAndUpload(url, storagePath, mimeType) {
  // Download from Airtable
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  const fileBuffer = Buffer.from(buffer);

  // Upload to Supabase Storage
  const { data, error } = await supabase.storage
    .from(MEDIA_BUCKET)
    .upload(storagePath, fileBuffer, {
      contentType: mimeType || 'application/octet-stream',
      upsert: true
    });

  if (error) {
    throw new Error(`Supabase upload failed: ${error.message}`);
  }

  // Get public URL
  const { data: urlData } = supabase.storage
    .from(MEDIA_BUCKET)
    .getPublicUrl(storagePath);

  return { size: buffer.byteLength, publicUrl: urlData.publicUrl };
}

// ═══════════════════════════════════════════════════
// STAGE 1: Fetch metadata from Airtable to raw_airtable_media
// ═══════════════════════════════════════════════════

async function stageFetch(client) {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('STAGE 1: Fetching Airtable media metadata');
  console.log('═══════════════════════════════════════════════════\n');

  let inserted = 0;
  let skipped = 0;

  // 1. Fetch Trapper Cats with photos
  console.log('Fetching Trapper Cats with photos...');
  const trapperCats = await fetchAllRecords(TRAPPER_CATS_TABLE, 'NOT({Photo}=BLANK())');
  console.log(`Found ${trapperCats.length} cats with photos\n`);

  for (const record of trapperCats) {
    const catName = record.fields['Cat Name'] || 'Unknown cat';
    const notes = record.fields['Notes'] || null;
    const photos = record.fields['Photo'] || [];
    const requestIds = record.fields['Record ID  (from Trapping Requests)'] || [];

    for (const airtableRequestId of requestIds) {
      for (const photo of photos) {
        try {
          await client.query(
            `INSERT INTO trapper.raw_airtable_media (
              airtable_record_id, airtable_attachment_id, airtable_table,
              airtable_request_id, filename, url, size_bytes, mime_type,
              width, height, media_type, caption, cat_description
            ) VALUES ($1, $2, 'trapper_cats', $3, $4, $5, $6, $7, $8, $9, 'cat_photo', $10, $11)
            ON CONFLICT (airtable_record_id, airtable_attachment_id) DO NOTHING`,
            [
              record.id,
              photo.id,
              airtableRequestId,
              photo.filename || `photo_${Date.now()}.jpg`,
              photo.url,
              photo.size || null,
              photo.type || null,
              photo.width || null,
              photo.height || null,
              notes,
              catName
            ]
          );
          inserted++;
        } catch (err) {
          if (err.code === '23505') { // duplicate key
            skipped++;
          } else {
            console.error(`  ✗ Error inserting cat photo: ${err.message}`);
          }
        }
      }
    }
  }

  // 2. Fetch Trapper Reports with media
  console.log('\nFetching Trapper Reports with media...');
  const trapperReports = await fetchAllRecords(TRAPPER_REPORTS_TABLE, 'NOT({Media}=BLANK())');
  console.log(`Found ${trapperReports.length} reports with media\n`);

  for (const record of trapperReports) {
    const reportName = record.fields['Name'] || 'Report';
    const details = record.fields['Report Details'] || null;
    const media = record.fields['Media'] || [];
    const requestIds = record.fields['Record ID  (from Trapping Requests)'] || [];

    for (const airtableRequestId of requestIds) {
      for (const item of media) {
        try {
          await client.query(
            `INSERT INTO trapper.raw_airtable_media (
              airtable_record_id, airtable_attachment_id, airtable_table,
              airtable_request_id, filename, url, size_bytes, mime_type,
              width, height, media_type, caption, notes
            ) VALUES ($1, $2, 'trapper_reports', $3, $4, $5, $6, $7, $8, $9, 'site_photo', $10, $11)
            ON CONFLICT (airtable_record_id, airtable_attachment_id) DO NOTHING`,
            [
              record.id,
              item.id,
              airtableRequestId,
              item.filename || `media_${Date.now()}.jpg`,
              item.url,
              item.size || null,
              item.type || null,
              item.width || null,
              item.height || null,
              reportName,
              details
            ]
          );
          inserted++;
        } catch (err) {
          if (err.code === '23505') {
            skipped++;
          } else {
            console.error(`  ✗ Error inserting report media: ${err.message}`);
          }
        }
      }
    }
  }

  console.log(`\n✓ Fetch complete: ${inserted} inserted, ${skipped} skipped (duplicates)`);
  return { inserted, skipped };
}

// ═══════════════════════════════════════════════════
// STAGE 2: Download from Airtable and upload to Supabase
// ═══════════════════════════════════════════════════

async function stageDownload(client) {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('STAGE 2: Downloading and uploading media files');
  console.log('═══════════════════════════════════════════════════\n');

  if (!supabase) {
    console.error('Error: Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    return { downloaded: 0, failed: 0 };
  }

  // Get pending records
  const pending = await client.query(
    `SELECT raw_media_id, airtable_request_id, filename, url, mime_type
     FROM trapper.raw_airtable_media
     WHERE processing_status = 'pending'
     ORDER BY ingested_at`
  );

  console.log(`Found ${pending.rows.length} pending uploads\n`);

  let downloaded = 0;
  let failed = 0;

  for (const row of pending.rows) {
    const requestId = row.airtable_request_id || 'unlinked';

    try {
      // Generate unique filename
      const timestamp = Date.now();
      const hash = crypto.randomBytes(4).toString('hex');
      const ext = (row.filename.match(/\.[^.]+$/) || ['.jpg'])[0];
      const storedFilename = `${requestId}_${timestamp}_${hash}${ext}`;

      // Determine MIME type if not set
      let mimeType = row.mime_type;
      if (!mimeType) {
        const mimeTypes = {
          '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
          '.png': 'image/png', '.gif': 'image/gif',
          '.webp': 'image/webp', '.heic': 'image/heic',
          '.mp4': 'video/mp4', '.mov': 'video/quicktime'
        };
        mimeType = mimeTypes[ext.toLowerCase()] || 'application/octet-stream';
      }

      // Supabase storage path: requests/{request_id}/{filename}
      const storagePath = `requests/${requestId}/${storedFilename}`;

      // Download from Airtable and upload to Supabase
      const { size, publicUrl } = await downloadAndUpload(row.url, storagePath, mimeType);

      // Update raw record with Supabase URL
      await client.query(
        `UPDATE trapper.raw_airtable_media
         SET processing_status = 'downloaded',
             local_filename = $1,
             local_path = $2,
             size_bytes = COALESCE(size_bytes, $3),
             mime_type = COALESCE(mime_type, $4)
         WHERE raw_media_id = $5`,
        [
          storedFilename,
          publicUrl,
          size,
          mimeType,
          row.raw_media_id
        ]
      );

      downloaded++;
      if (downloaded % 10 === 0) {
        console.log(`  Uploaded ${downloaded}/${pending.rows.length}...`);
      }
    } catch (err) {
      await client.query(
        `UPDATE trapper.raw_airtable_media
         SET processing_status = 'failed',
             error_message = $1,
             processed_at = NOW()
         WHERE raw_media_id = $2`,
        [err.message, row.raw_media_id]
      );
      failed++;
      console.error(`  ✗ Failed: ${row.filename} - ${err.message}`);
    }
  }

  console.log(`\n✓ Upload complete: ${downloaded} uploaded, ${failed} failed`);
  return { downloaded, failed };
}

// ═══════════════════════════════════════════════════
// STAGE 3: Import to request_media via SQL function
// ═══════════════════════════════════════════════════

async function stageImport(client) {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('STAGE 3: Importing to request_media');
  console.log('═══════════════════════════════════════════════════\n');

  const result = await client.query(
    `SELECT * FROM trapper.import_all_raw_media()`
  );

  const { imported, skipped, failed } = result.rows[0];
  console.log(`\n✓ Import complete: ${imported} imported, ${skipped} skipped, ${failed} failed`);

  // Show status summary
  const status = await client.query(
    `SELECT * FROM trapper.v_media_import_status`
  );

  console.log('\nMedia Import Status:');
  console.table(status.rows);

  return { imported, skipped, failed };
}

// ═══════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('Error: DATABASE_URL not set');
    process.exit(1);
  }

  if (!supabase) {
    console.error('Error: Supabase not configured');
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables');
    process.exit(1);
  }

  // Parse --stage argument
  const args = process.argv.slice(2);
  let stage = 'all';
  for (const arg of args) {
    if (arg.startsWith('--stage=')) {
      stage = arg.split('=')[1];
    }
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log('Airtable Photos Sync (Raw → Supabase Storage → SoT)');
  console.log(`Stage: ${stage}`);
  console.log(`Supabase: ${supabaseUrl}`);
  console.log('═══════════════════════════════════════════════════\n');

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    if (stage === 'fetch' || stage === 'all') {
      await stageFetch(client);
    }

    if (stage === 'download' || stage === 'all') {
      await stageDownload(client);
    }

    if (stage === 'import' || stage === 'all') {
      await stageImport(client);
    }
  } finally {
    await client.end();
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log('Done!');
  console.log('═══════════════════════════════════════════════════\n');
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
