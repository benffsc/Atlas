// Process uploaded files for ClinicHQ, Airtable, and Google Maps data
import { NextRequest, NextResponse } from "next/server";
import { query, queryOne, queryRows } from "@/lib/db";
import { readFile } from "fs/promises";
import path from "path";
import * as XLSX from "xlsx";
import { createHash } from "crypto";
import { parseStringPromise } from "xml2js";
import JSZip from "jszip";

export const maxDuration = 180; // 3 minutes: staging + post-processing + enrichment

interface FileUpload {
  upload_id: string;
  original_filename: string;
  stored_filename: string;
  source_system: string;
  source_table: string;
  status: string;
  file_content: Buffer | null;
}

// Parse XLSX or CSV file — uses XLSX library for both to handle
// quoted fields, BOM markers, and edge cases correctly
function parseFile(buffer: Buffer, filename: string): { headers: string[]; rows: Record<string, unknown>[] } {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  const headers = data.length > 0 ? Object.keys(data[0]) : [];
  return { headers, rows: data };
}

// Get ID field for a source/table combo
function getIdField(sourceSystem: string, sourceTable: string): string[] {
  const configs: Record<string, Record<string, string[]>> = {
    clinichq: {
      cat_info: ['Microchip Number', 'Number'],
      owner_info: ['Owner ID', 'Number'],
      appointment_info: ['Number', 'Appointment ID'],
    },
    airtable: {
      trapping_requests: ['Record ID', 'Request ID'],
      appointment_requests: ['Record ID'],
    },
  };

  return configs[sourceSystem]?.[sourceTable] || ['ID', 'id', 'Number'];
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: uploadId } = await params;

  if (!uploadId) {
    return NextResponse.json(
      { error: "Upload ID is required" },
      { status: 400 }
    );
  }

  try {
    // Get upload record (include file_content for serverless environments)
    const upload = await queryOne<FileUpload>(
      `SELECT upload_id, original_filename, stored_filename, source_system, source_table, status, file_content
       FROM trapper.file_uploads WHERE upload_id = $1`,
      [uploadId]
    );

    if (!upload) {
      return NextResponse.json(
        { error: "Upload not found" },
        { status: 404 }
      );
    }

    if (upload.status === 'processing') {
      return NextResponse.json(
        { error: "Upload is already being processed" },
        { status: 409 }
      );
    }

    // Mark as processing with timestamp for stuck-job detection
    await query(
      `UPDATE trapper.file_uploads SET status = 'processing', processed_at = NOW() WHERE upload_id = $1`,
      [uploadId]
    );

    // Read file - try filesystem first, fall back to database (for serverless)
    let buffer: Buffer;
    const uploadDir = path.join(process.cwd(), "uploads", "ingest");
    const filePath = path.join(uploadDir, upload.stored_filename);

    try {
      buffer = await readFile(filePath);
    } catch {
      // File not on disk (serverless environment) - read from database
      if (upload.file_content) {
        buffer = Buffer.from(upload.file_content);
      } else {
        return NextResponse.json(
          { error: "File content not available. Please re-upload the file." },
          { status: 404 }
        );
      }
    }

    // Handle Google Maps KMZ/KML files differently
    if (upload.source_system === 'google_maps') {
      return await processGoogleMapsFile(uploadId, upload, buffer);
    }

    // Parse file
    const { rows } = parseFile(buffer, upload.stored_filename);
    const idFieldCandidates = getIdField(upload.source_system, upload.source_table);

    // Extract date range from data
    const dateFields = ['Date', 'Appointment Date', 'Created', 'date', 'appointment_date'];
    let dataDateMin: Date | null = null;
    let dataDateMax: Date | null = null;

    for (const row of rows) {
      for (const field of dateFields) {
        const dateStr = row[field] as string;
        if (dateStr && typeof dateStr === 'string') {
          // Try to parse date (handles MM/DD/YYYY and YYYY-MM-DD formats)
          let parsedDate: Date | null = null;
          if (dateStr.includes('/')) {
            const [m, d, y] = dateStr.split('/');
            parsedDate = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
          } else if (dateStr.includes('-')) {
            parsedDate = new Date(dateStr);
          }

          if (parsedDate && !isNaN(parsedDate.getTime())) {
            if (!dataDateMin || parsedDate < dataDateMin) dataDateMin = parsedDate;
            if (!dataDateMax || parsedDate > dataDateMax) dataDateMax = parsedDate;
          }
        }
      }
    }

    // For appointment_info, aggregate service lines into main rows
    // ClinicHQ exports have: main row (with Number) + service lines (without Number)
    // Service lines contain important data like "Cat Spay" or "Cat Neuter" services
    let processedRows = rows;
    if (upload.source_table === 'appointment_info') {
      const aggregated: Record<string, unknown>[] = [];
      let currentAppointment: Record<string, unknown> | null = null;
      let services: string[] = [];

      for (const row of rows) {
        const hasNumber = row['Number'] && String(row['Number']).trim();

        if (hasNumber) {
          // Save previous appointment with aggregated services
          if (currentAppointment) {
            currentAppointment['All Services'] = services.join('; ');
            aggregated.push(currentAppointment);
          }
          // Start new appointment
          currentAppointment = { ...row };
          services = [];
          const svc = row['Service / Subsidy'];
          if (svc && String(svc).trim()) {
            services.push(String(svc).trim());
          }
        } else if (currentAppointment) {
          // Service line - aggregate into current appointment
          const svc = row['Service / Subsidy'];
          if (svc && String(svc).trim()) {
            services.push(String(svc).trim());
          }
        }
      }
      // Don't forget the last appointment
      if (currentAppointment) {
        currentAppointment['All Services'] = services.join('; ');
        aggregated.push(currentAppointment);
      }

      processedRows = aggregated;
    }

    // Process rows into staged_records
    let inserted = 0;
    let skipped = 0;
    let updated = 0;

    for (const row of processedRows) {
      // Skip empty rows (rows where all values are empty/null)
      const hasData = Object.values(row).some(v => v !== null && v !== undefined && String(v).trim() !== '');
      if (!hasData) {
        skipped++;
        continue;
      }

      // Find ID field
      let sourceRowId = null;
      for (const field of idFieldCandidates) {
        if (row[field]) {
          sourceRowId = String(row[field]);
          break;
        }
      }

      // For appointment_info, use composite key (Number_Date) since same appointment
      // number can appear on multiple dates (e.g., surgery + follow-up)
      if (sourceRowId && upload.source_table === 'appointment_info' && row['Date']) {
        sourceRowId = `${sourceRowId}_${String(row['Date']).replace(/\//g, '-')}`;
      }

      if (!sourceRowId) {
        sourceRowId = `row_${processedRows.indexOf(row)}`;
      }

      // Calculate row hash
      const rowHash = createHash('sha256')
        .update(JSON.stringify(row))
        .digest('hex')
        .substring(0, 16);

      // Step 1: Check if exact content already exists (by hash)
      // This is the primary dedup — same content = skip regardless of source_row_id
      const byHash = await queryOne<{ id: string; file_upload_id: string | null }>(
        `SELECT id, file_upload_id FROM trapper.staged_records
         WHERE source_system = $1 AND source_table = $2 AND row_hash = $3`,
        [upload.source_system, upload.source_table, rowHash]
      );

      if (byHash) {
        // Exact same content exists — skip (but claim for this upload if unclaimed)
        if (!byHash.file_upload_id) {
          await query(
            `UPDATE trapper.staged_records SET file_upload_id = $1 WHERE id = $2`,
            [uploadId, byHash.id]
          );
        }
        skipped++;
        continue;
      }

      // Step 2: Check if same logical record exists with different content (by source_row_id)
      // Safe to update row_hash here because Step 1 guarantees the new hash doesn't exist
      const byRowId = await queryOne<{ id: string }>(
        `SELECT id FROM trapper.staged_records
         WHERE source_system = $1 AND source_table = $2 AND source_row_id = $3`,
        [upload.source_system, upload.source_table, sourceRowId]
      );

      if (byRowId) {
        // Same logical record, updated content — safe to update hash (no conflict possible)
        await query(
          `UPDATE trapper.staged_records
           SET payload = $1, row_hash = $2, file_upload_id = $3, updated_at = NOW()
           WHERE id = $4`,
          [JSON.stringify(row), rowHash, uploadId, byRowId.id]
        );
        updated++;
      } else {
        // New record — INSERT with ON CONFLICT as safety net for race conditions
        const insertResult = await query(
          `INSERT INTO trapper.staged_records
           (source_system, source_table, source_row_id, payload, row_hash, file_upload_id)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (source_system, source_table, row_hash) DO NOTHING
           RETURNING id`,
          [upload.source_system, upload.source_table, sourceRowId, JSON.stringify(row), rowHash, uploadId]
        );
        if (insertResult.rowCount && insertResult.rowCount > 0) {
          inserted++;
        } else {
          skipped++; // Duplicate hash from concurrent insert
        }
      }
    }

    // Run post-processing for ClinicHQ (scoped to this upload's records)
    let postProcessingResults = null;
    if (upload.source_system === 'clinichq') {
      postProcessingResults = await runClinicHQPostProcessing(upload.source_table, uploadId);
    }

    // Mark as completed (persist post-processing results for UI display)
    await query(
      `UPDATE trapper.file_uploads
       SET status = 'completed', processed_at = NOW(),
           rows_total = $2, rows_inserted = $3, rows_updated = $4, rows_skipped = $5,
           data_date_min = $6, data_date_max = $7,
           post_processing_results = $8
       WHERE upload_id = $1`,
      [uploadId, rows.length, inserted, updated, skipped,
       // Format dates in local timezone (avoid UTC shift from toISOString)
       dataDateMin ? `${dataDateMin.getFullYear()}-${String(dataDateMin.getMonth() + 1).padStart(2, '0')}-${String(dataDateMin.getDate()).padStart(2, '0')}` : null,
       dataDateMax ? `${dataDateMax.getFullYear()}-${String(dataDateMax.getMonth() + 1).padStart(2, '0')}-${String(dataDateMax.getDate()).padStart(2, '0')}` : null,
       postProcessingResults ? JSON.stringify(postProcessingResults) : null]
    );

    return NextResponse.json({
      success: true,
      upload_id: uploadId,
      rows_total: rows.length,
      rows_inserted: inserted,
      rows_updated: updated,
      rows_skipped: skipped,
      post_processing: postProcessingResults,
    });

  } catch (error) {
    console.error("Processing error:", error);

    // Mark as failed
    await query(
      `UPDATE trapper.file_uploads
       SET status = 'failed', error_message = $2
       WHERE upload_id = $1`,
      [uploadId, error instanceof Error ? error.message : "Unknown error"]
    );

    return NextResponse.json(
      { error: "Failed to process file" },
      { status: 500 }
    );
  }
}

// Post-processing for ClinicHQ data — scoped to a single upload's records
async function runClinicHQPostProcessing(sourceTable: string, uploadId: string): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};
  let stepNum = 0;

  // Save intermediate progress to DB so the UI can poll for step-by-step status
  async function saveProgress(step?: string) {
    stepNum++;
    if (step) results._current_step = step;
    results._step_num = stepNum;
    try {
      await query(
        `UPDATE trapper.file_uploads SET post_processing_results = $2 WHERE upload_id = $1`,
        [uploadId, JSON.stringify(results)]
      );
    } catch { /* best-effort progress saving */ }
  }

  if (sourceTable === 'cat_info') {
    // Step 1: Create cats from microchips using find_or_create_cat_by_microchip
    // This creates new cats or returns existing ones
    await saveProgress('Creating cats from microchips...');
    const catsCreated = await query(`
      WITH cat_data AS (
        SELECT DISTINCT ON (payload->>'Microchip Number')
          payload->>'Microchip Number' as microchip,
          NULLIF(TRIM(payload->>'Animal Name'), '') as name,
          NULLIF(TRIM(payload->>'Sex'), '') as sex,
          NULLIF(TRIM(payload->>'Breed'), '') as breed,
          NULLIF(TRIM(payload->>'Primary Color'), '') as color,
          CASE
            WHEN TRIM(payload->>'Spay Neuter Status') IN ('Yes', 'No') THEN TRIM(payload->>'Spay Neuter Status')
            ELSE NULL
          END as altered_status,
          NULLIF(TRIM(payload->>'Secondary Color'), '') as secondary_color
        FROM trapper.staged_records
        WHERE source_system = 'clinichq'
          AND source_table = 'cat_info'
          AND payload->>'Microchip Number' IS NOT NULL
          AND TRIM(payload->>'Microchip Number') != ''
          AND LENGTH(TRIM(payload->>'Microchip Number')) >= 9
          AND file_upload_id = $1
        ORDER BY payload->>'Microchip Number', created_at DESC
      ),
      created_cats AS (
        SELECT
          cd.*,
          trapper.find_or_create_cat_by_microchip(
            cd.microchip,
            cd.name,
            cd.sex,
            cd.breed,
            cd.altered_status,
            cd.color,
            cd.secondary_color,
            NULL,  -- ownership_type
            'clinichq'
          ) as cat_id
        FROM cat_data cd
        WHERE cd.microchip IS NOT NULL
      )
      SELECT COUNT(*) as cnt FROM created_cats WHERE cat_id IS NOT NULL
    `, [uploadId]);
    results.cats_created_or_matched = parseInt(catsCreated.rows?.[0]?.cnt || '0');

    // Step 2: Update sex on existing cats from cat_info records
    await saveProgress('Updating cat sex data...');
    const sexUpdates = await query(`
      UPDATE trapper.sot_cats c
      SET sex = sr.payload->>'Sex'
      FROM trapper.staged_records sr
      JOIN trapper.cat_identifiers ci ON ci.id_value = sr.payload->>'Microchip Number' AND ci.id_type = 'microchip'
      WHERE ci.cat_id = c.cat_id
        AND sr.source_system = 'clinichq'
        AND sr.source_table = 'cat_info'
        AND sr.file_upload_id = $1
        AND sr.payload->>'Sex' IS NOT NULL
        AND sr.payload->>'Sex' != ''
        AND LOWER(c.sex) IS DISTINCT FROM LOWER(sr.payload->>'Sex')
    `, [uploadId]);
    results.sex_updates = sexUpdates.rowCount || 0;

    // Step 3: Link orphaned appointments to cats via microchip
    // Appointments may have been created before cats existed
    // NOTE: We match on payload->>'Number' because source_row_id is a composite (Number_Date)
    await saveProgress('Linking orphaned appointments to cats...');
    const appointmentsLinked = await query(`
      UPDATE trapper.sot_appointments a
      SET cat_id = trapper.get_canonical_cat_id(ci.cat_id)
      FROM trapper.staged_records sr
      JOIN trapper.cat_identifiers ci ON ci.id_value = sr.payload->>'Microchip Number' AND ci.id_type = 'microchip'
      WHERE a.appointment_number = sr.payload->>'Number'
        AND a.appointment_date = TO_DATE(sr.payload->>'Date', 'MM/DD/YYYY')
        AND sr.source_system = 'clinichq'
        AND sr.source_table = 'appointment_info'
        AND a.cat_id IS NULL
        AND sr.payload->>'Microchip Number' IS NOT NULL
        AND TRIM(sr.payload->>'Microchip Number') != ''
    `);
    results.orphaned_appointments_linked = appointmentsLinked.rowCount || 0;

    // Step 4: Extract weight from cat_info into cat_vitals
    // This ensures weight data is captured during real-time ingest, not just via migrations
    await saveProgress('Extracting weight vitals...');
    const weightVitals = await query(`
      INSERT INTO trapper.cat_vitals (
        cat_id, recorded_at, weight_lbs, source_system, source_record_id
      )
      SELECT DISTINCT ON (ci.cat_id)
        ci.cat_id,
        COALESCE(
          (sr.payload->>'Date')::timestamp with time zone,
          NOW()
        ),
        (sr.payload->>'Weight')::numeric(5,2),
        'clinichq',
        'cat_info_' || sr.source_row_id
      FROM trapper.staged_records sr
      JOIN trapper.cat_identifiers ci ON
        ci.id_value = sr.payload->>'Microchip Number'
        AND ci.id_type = 'microchip'
      WHERE sr.source_system = 'clinichq'
        AND sr.source_table = 'cat_info'
        AND sr.file_upload_id = $1
        AND sr.payload->>'Weight' IS NOT NULL
        AND sr.payload->>'Weight' ~ '^[0-9]+\\.?[0-9]*$'
        AND (sr.payload->>'Weight')::numeric > 0
        AND NOT EXISTS (
          SELECT 1 FROM trapper.cat_vitals cv
          WHERE cv.cat_id = ci.cat_id
            AND cv.source_record_id = 'cat_info_' || sr.source_row_id
        )
      ORDER BY ci.cat_id, (sr.payload->>'Date')::date DESC NULLS LAST
      ON CONFLICT DO NOTHING
    `, [uploadId]);
    results.weight_vitals_created = weightVitals.rowCount || 0;
  }

  if (sourceTable === 'owner_info') {
    // Step 1: Create REAL PEOPLE using find_or_create_person SQL function
    // MIG_888/INV-22: Mirrors SQL processor (MIG_573) — only process records
    // where should_be_person() returns TRUE (has contact info + person-like name)
    await saveProgress('Creating people from owner records...');
    const peopleCreated = await query(`
      WITH owner_data AS (
        SELECT DISTINCT ON (COALESCE(NULLIF(LOWER(TRIM(payload->>'Owner Email')), ''), trapper.norm_phone_us(COALESCE(payload->>'Owner Cell Phone', payload->>'Owner Phone'))))
          payload->>'Owner First Name' as first_name,
          payload->>'Owner Last Name' as last_name,
          NULLIF(LOWER(TRIM(payload->>'Owner Email')), '') as email,
          trapper.norm_phone_us(COALESCE(NULLIF(payload->>'Owner Cell Phone', ''), payload->>'Owner Phone')) as phone,
          NULLIF(TRIM(payload->>'Owner Address'), '') as address,
          payload->>'Number' as appointment_number
        FROM trapper.staged_records
        WHERE source_system = 'clinichq'
          AND source_table = 'owner_info'
          AND file_upload_id = $1
          AND (
            (payload->>'Owner Email' IS NOT NULL AND TRIM(payload->>'Owner Email') != '')
            OR (payload->>'Owner Phone' IS NOT NULL AND TRIM(payload->>'Owner Phone') != '')
            OR (payload->>'Owner Cell Phone' IS NOT NULL AND TRIM(payload->>'Owner Cell Phone') != '')
          )
          AND (payload->>'Owner First Name' IS NOT NULL AND TRIM(payload->>'Owner First Name') != '')
          AND trapper.should_be_person(
            payload->>'Owner First Name',
            payload->>'Owner Last Name',
            NULLIF(LOWER(TRIM(payload->>'Owner Email')), ''),
            trapper.norm_phone_us(COALESCE(NULLIF(payload->>'Owner Cell Phone', ''), payload->>'Owner Phone'))
          )
        ORDER BY COALESCE(NULLIF(LOWER(TRIM(payload->>'Owner Email')), ''), trapper.norm_phone_us(COALESCE(payload->>'Owner Cell Phone', payload->>'Owner Phone'))),
                 (payload->>'Date')::date DESC NULLS LAST
      ),
      created_people AS (
        SELECT
          od.first_name,
          od.last_name,
          od.email,
          od.phone,
          od.address,
          od.appointment_number,
          trapper.find_or_create_person(
            od.email,
            od.phone,
            od.first_name,
            od.last_name,
            od.address,
            'clinichq'
          ) as created_person_id
        FROM owner_data od
        WHERE od.first_name IS NOT NULL
      )
      SELECT COUNT(*) as cnt FROM created_people WHERE created_person_id IS NOT NULL
    `, [uploadId]);
    results.people_created_or_matched = parseInt(peopleCreated.rows?.[0]?.cnt || '0');

    // Step 1b: Route pseudo-profiles to clinic_owner_accounts
    // INV-25: ClinicHQ pseudo-profiles (addresses, orgs, apartments) are NOT people
    await saveProgress('Routing pseudo-profiles to clinic accounts...');
    const accountsCreated = await query(`
      WITH pseudo_profiles AS (
        SELECT DISTINCT ON (TRIM(COALESCE(payload->>'Owner First Name', '') || ' ' || COALESCE(payload->>'Owner Last Name', '')))
          TRIM(COALESCE(payload->>'Owner First Name', '') || ' ' || COALESCE(payload->>'Owner Last Name', '')) as display_name
        FROM trapper.staged_records
        WHERE source_system = 'clinichq'
          AND source_table = 'owner_info'
          AND file_upload_id = $1
          AND NOT trapper.should_be_person(
            payload->>'Owner First Name',
            payload->>'Owner Last Name',
            NULLIF(LOWER(TRIM(payload->>'Owner Email')), ''),
            trapper.norm_phone_us(COALESCE(NULLIF(payload->>'Owner Cell Phone', ''), payload->>'Owner Phone'))
          )
          AND (payload->>'Owner First Name' IS NOT NULL AND TRIM(payload->>'Owner First Name') != '')
        ORDER BY TRIM(COALESCE(payload->>'Owner First Name', '') || ' ' || COALESCE(payload->>'Owner Last Name', '')),
                 (payload->>'Date')::date DESC NULLS LAST
      ),
      created_accounts AS (
        SELECT
          pp.*,
          trapper.find_or_create_clinic_account(pp.display_name, NULL, NULL, 'clinichq') as account_id
        FROM pseudo_profiles pp
        WHERE pp.display_name IS NOT NULL AND pp.display_name != ''
      )
      SELECT COUNT(*) as cnt FROM created_accounts WHERE account_id IS NOT NULL
    `, [uploadId]);
    results.clinic_accounts_created = parseInt(accountsCreated.rows?.[0]?.cnt || '0');

    // Step 2: Create places from owner addresses using find_or_create_place_deduped
    // This auto-queues for geocoding
    await saveProgress('Creating places from addresses...');
    const placesCreated = await query(`
      WITH owner_addresses AS (
        SELECT DISTINCT ON (TRIM(payload->>'Owner Address'))
          TRIM(payload->>'Owner Address') as address,
          NULLIF(LOWER(TRIM(payload->>'Owner Email')), '') as email,
          trapper.norm_phone_us(COALESCE(NULLIF(payload->>'Owner Cell Phone', ''), payload->>'Owner Phone')) as phone
        FROM trapper.staged_records
        WHERE source_system = 'clinichq'
          AND source_table = 'owner_info'
          AND file_upload_id = $1
          AND payload->>'Owner Address' IS NOT NULL
          AND TRIM(payload->>'Owner Address') != ''
          AND LENGTH(TRIM(payload->>'Owner Address')) > 10
        ORDER BY TRIM(payload->>'Owner Address'), (payload->>'Date')::date DESC NULLS LAST
      ),
      created_places AS (
        SELECT
          oa.*,
          trapper.find_or_create_place_deduped(
            oa.address,
            NULL,
            NULL,
            NULL,
            'clinichq'
          ) as place_id
        FROM owner_addresses oa
      )
      SELECT COUNT(*) as cnt FROM created_places WHERE place_id IS NOT NULL
    `, [uploadId]);
    results.places_created_or_matched = parseInt(placesCreated.rows?.[0]?.cnt || '0');

    // Step 3: Link people to places via person_place_relationships
    await saveProgress('Linking people to places...');
    const personPlaceLinks = await query(`
      INSERT INTO trapper.person_place_relationships (person_id, place_id, role, confidence, source_system, source_table)
      SELECT DISTINCT
        pi.person_id,
        p.place_id,
        'resident'::trapper.person_place_role,
        0.7,
        'clinichq',
        'owner_info'
      FROM trapper.staged_records sr
      JOIN trapper.person_identifiers pi ON (
        (pi.id_type = 'email' AND pi.id_value_norm = NULLIF(LOWER(TRIM(sr.payload->>'Owner Email')), ''))
        OR (pi.id_type = 'phone' AND pi.id_value_norm = trapper.norm_phone_us(COALESCE(NULLIF(sr.payload->>'Owner Cell Phone', ''), sr.payload->>'Owner Phone')))
      )
      JOIN trapper.places p ON p.normalized_address = trapper.normalize_address(sr.payload->>'Owner Address')
        AND p.merged_into_place_id IS NULL
      WHERE sr.source_system = 'clinichq'
        AND sr.source_table = 'owner_info'
        AND sr.file_upload_id = $1
        AND sr.payload->>'Owner Address' IS NOT NULL
        AND TRIM(sr.payload->>'Owner Address') != ''
        AND NOT EXISTS (
          SELECT 1 FROM trapper.person_place_relationships ppr
          WHERE ppr.person_id = pi.person_id AND ppr.place_id = p.place_id
        )
      ON CONFLICT DO NOTHING
    `, [uploadId]);
    results.person_place_links = personPlaceLinks.rowCount || 0;

    // Step 4: Link REAL people to appointments via email/phone match
    // MIG_888/INV-26: Respects data_engine_soft_blacklist — soft-blacklisted
    // identifiers are skipped to prevent shared org identifiers from matching wrong person
    await saveProgress('Linking appointments to people...');
    const personLinks = await query(`
      UPDATE trapper.sot_appointments a
      SET person_id = pi.person_id
      FROM trapper.staged_records sr
      JOIN trapper.person_identifiers pi ON (
        (pi.id_type = 'email'
         AND pi.id_value_norm = NULLIF(LOWER(TRIM(sr.payload->>'Owner Email')), '')
         AND NOT EXISTS (
           SELECT 1 FROM trapper.data_engine_soft_blacklist sbl
           WHERE sbl.identifier_norm = pi.id_value_norm AND sbl.identifier_type = 'email'
         )
        )
        OR (pi.id_type = 'phone'
         AND pi.id_value_norm = trapper.norm_phone_us(COALESCE(NULLIF(sr.payload->>'Owner Cell Phone', ''), sr.payload->>'Owner Phone'))
         AND NOT EXISTS (
           SELECT 1 FROM trapper.data_engine_soft_blacklist sbl
           WHERE sbl.identifier_norm = pi.id_value_norm AND sbl.identifier_type = 'phone'
         )
        )
      )
      WHERE sr.source_system = 'clinichq'
        AND sr.source_table = 'owner_info'
        AND sr.file_upload_id = $1
        AND a.appointment_number = sr.payload->>'Number'
        AND a.person_id IS NULL
    `, [uploadId]);
    results.appointments_linked_to_people = personLinks.rowCount || 0;

    // Step 4c: Backfill client_name, owner_email, owner_phone from owner_info
    // This was previously missing (DATA_GAP) — appointments were created from
    // appointment_info but owner contact fields were never populated from owner_info
    await saveProgress('Backfilling appointment owner fields...');
    const ownerFieldsBackfill = await query(`
      UPDATE trapper.sot_appointments a
      SET
        client_name = NULLIF(TRIM(
          COALESCE(NULLIF(TRIM(sr.payload->>'Owner First Name'), ''), '') || ' ' ||
          COALESCE(NULLIF(TRIM(sr.payload->>'Owner Last Name'), ''), '')
        ), ''),
        owner_email = NULLIF(LOWER(TRIM(sr.payload->>'Owner Email')), ''),
        owner_phone = trapper.norm_phone_us(
          COALESCE(NULLIF(sr.payload->>'Owner Phone', ''), sr.payload->>'Owner Cell Phone')
        )
      FROM trapper.staged_records sr
      WHERE sr.source_system = 'clinichq'
        AND sr.source_table = 'owner_info'
        AND sr.file_upload_id = $1
        AND sr.payload->>'Number' = a.appointment_number
        AND (
          a.client_name IS NULL
          OR a.owner_email IS NULL
          OR a.owner_phone IS NULL
        )
        AND (
          sr.payload->>'Owner First Name' IS NOT NULL
          OR sr.payload->>'Owner Last Name' IS NOT NULL
          OR sr.payload->>'Owner Email' IS NOT NULL
          OR sr.payload->>'Owner Phone' IS NOT NULL
          OR sr.payload->>'Owner Cell Phone' IS NOT NULL
        )
    `, [uploadId]);
    results.owner_fields_backfilled = ownerFieldsBackfill.rowCount || 0;

    // Step 4b: Link pseudo-profiles to appointments via owner_account_id
    // INV-22: Mirrors SQL processor Step 7 — appointments with no person_id
    // get linked to clinic_owner_accounts instead
    await saveProgress('Linking pseudo-profile appointments...');
    const accountLinks = await query(`
      UPDATE trapper.sot_appointments a
      SET owner_account_id = coa.account_id
      FROM trapper.staged_records sr
      JOIN trapper.clinic_owner_accounts coa ON (
        LOWER(coa.display_name) = LOWER(TRIM(COALESCE(sr.payload->>'Owner First Name', '') || ' ' || COALESCE(sr.payload->>'Owner Last Name', '')))
        OR LOWER(TRIM(COALESCE(sr.payload->>'Owner First Name', '') || ' ' || COALESCE(sr.payload->>'Owner Last Name', '')))
          = ANY(SELECT LOWER(unnest(coa.source_display_names)))
      )
      WHERE sr.source_system = 'clinichq'
        AND sr.source_table = 'owner_info'
        AND sr.file_upload_id = $1
        AND a.appointment_number = sr.payload->>'Number'
        AND a.person_id IS NULL
        AND a.owner_account_id IS NULL
    `, [uploadId]);
    results.appointments_linked_to_accounts = accountLinks.rowCount || 0;

    // Step 5: Link cats to people via appointments
    await saveProgress('Linking cats to people...');
    const catPersonLinks = await query(`
      INSERT INTO trapper.person_cat_relationships (cat_id, person_id, relationship_type, confidence, source_system, source_table)
      SELECT DISTINCT
        a.cat_id,
        a.person_id,
        'caretaker',
        'high',
        'clinichq',
        'owner_info'
      FROM trapper.sot_appointments a
      WHERE a.cat_id IS NOT NULL
        AND a.person_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM trapper.person_cat_relationships cpr
          WHERE cpr.cat_id = a.cat_id AND cpr.person_id = a.person_id
        )
      ON CONFLICT DO NOTHING
    `);
    results.cat_person_links = catPersonLinks.rowCount || 0;
  }

  if (sourceTable === 'appointment_info') {
    // Step 0: Link orphaned appointments to cats (in case cat_info was processed first)
    // This ensures order doesn't matter - process cat_info OR appointment_info first
    await saveProgress('Pre-linking orphaned appointments...');
    const orphanedLinked = await query(`
      UPDATE trapper.sot_appointments a
      SET cat_id = trapper.get_canonical_cat_id(ci.cat_id)
      FROM trapper.staged_records sr
      JOIN trapper.cat_identifiers ci ON ci.id_value = sr.payload->>'Microchip Number' AND ci.id_type = 'microchip'
      WHERE a.appointment_number = sr.payload->>'Number'
        AND a.appointment_date = TO_DATE(sr.payload->>'Date', 'MM/DD/YYYY')
        AND sr.source_system = 'clinichq'
        AND sr.source_table = 'appointment_info'
        AND sr.file_upload_id = $1
        AND a.cat_id IS NULL
        AND sr.payload->>'Microchip Number' IS NOT NULL
        AND TRIM(sr.payload->>'Microchip Number') != ''
    `, [uploadId]);
    results.orphaned_appointments_linked_pre = orphanedLinked.rowCount || 0;

    // Step 1: Create sot_appointments from staged_records
    // Uses get_canonical_cat_id to handle merged cats
    await saveProgress('Creating appointments...');
    const newAppointments = await query(`
      INSERT INTO trapper.sot_appointments (
        cat_id, appointment_date, appointment_number, service_type,
        is_spay, is_neuter, vet_name, technician, temperature, medical_notes,
        is_lactating, is_pregnant, is_in_heat,
        data_source, source_system, source_record_id, source_row_hash
      )
      SELECT
        trapper.get_canonical_cat_id(c.cat_id),
        TO_DATE(sr.payload->>'Date', 'MM/DD/YYYY'),
        sr.payload->>'Number',
        COALESCE(sr.payload->>'All Services', sr.payload->>'Service / Subsidy'),
        trapper.is_positive_value(sr.payload->>'Spay'),
        trapper.is_positive_value(sr.payload->>'Neuter'),
        sr.payload->>'Vet Name',
        sr.payload->>'Technician',
        CASE WHEN sr.payload->>'Temperature' ~ '^[0-9]+\.?[0-9]*$'
             THEN (sr.payload->>'Temperature')::NUMERIC(4,1)
             ELSE NULL END,
        sr.payload->>'Internal Medical Notes',
        trapper.is_positive_value(sr.payload->>'Lactating') OR trapper.is_positive_value(sr.payload->>'Lactating_2'),
        trapper.is_positive_value(sr.payload->>'Pregnant'),
        trapper.is_positive_value(sr.payload->>'In Heat'),
        'clinichq', 'clinichq', sr.source_row_id, sr.row_hash
      FROM trapper.staged_records sr
      LEFT JOIN trapper.cat_identifiers ci ON ci.id_value = sr.payload->>'Microchip Number' AND ci.id_type = 'microchip'
      LEFT JOIN trapper.sot_cats c ON c.cat_id = ci.cat_id
      WHERE sr.source_system = 'clinichq'
        AND sr.source_table = 'appointment_info'
        AND sr.file_upload_id = $1
        AND sr.payload->>'Date' IS NOT NULL AND sr.payload->>'Date' != ''
        AND NOT EXISTS (
          SELECT 1 FROM trapper.sot_appointments a
          WHERE a.appointment_number = sr.payload->>'Number'
            AND a.appointment_date = TO_DATE(sr.payload->>'Date', 'MM/DD/YYYY')
        )
      ON CONFLICT DO NOTHING
    `, [uploadId]);
    results.new_appointments = newAppointments.rowCount || 0;

    // Create cat_procedures from appointments with spay service_type
    await saveProgress('Creating spay procedures...');
    const newSpays = await query(`
      INSERT INTO trapper.cat_procedures (
        cat_id, appointment_id, procedure_type, procedure_date, status,
        performed_by, technician, is_spay, is_neuter,
        source_system, source_record_id
      )
      SELECT
        a.cat_id, a.appointment_id, 'spay', a.appointment_date,
        'completed'::trapper.procedure_status,
        a.vet_name, a.technician, TRUE, FALSE,
        'clinichq', a.appointment_number
      FROM trapper.sot_appointments a
      WHERE a.cat_id IS NOT NULL
        AND a.service_type ILIKE '%spay%'
        AND NOT EXISTS (
          SELECT 1 FROM trapper.cat_procedures cp
          WHERE cp.appointment_id = a.appointment_id AND cp.is_spay = TRUE
        )
      ON CONFLICT DO NOTHING
    `);
    results.new_spays = newSpays.rowCount || 0;

    // Create cat_procedures for neuter service_type
    await saveProgress('Creating neuter procedures...');
    const newNeuters = await query(`
      INSERT INTO trapper.cat_procedures (
        cat_id, appointment_id, procedure_type, procedure_date, status,
        performed_by, technician, is_spay, is_neuter,
        source_system, source_record_id
      )
      SELECT
        a.cat_id, a.appointment_id, 'neuter', a.appointment_date,
        'completed'::trapper.procedure_status,
        a.vet_name, a.technician, FALSE, TRUE,
        'clinichq', a.appointment_number
      FROM trapper.sot_appointments a
      WHERE a.cat_id IS NOT NULL
        AND a.service_type ILIKE '%neuter%'
        AND NOT EXISTS (
          SELECT 1 FROM trapper.cat_procedures cp
          WHERE cp.appointment_id = a.appointment_id AND cp.is_neuter = TRUE
        )
      ON CONFLICT DO NOTHING
    `);
    results.new_neuters = newNeuters.rowCount || 0;

    // Fix procedures based on cat sex
    await saveProgress('Fixing procedure types...');
    const fixedMales = await query(`
      UPDATE trapper.cat_procedures cp
      SET procedure_type = 'neuter', is_spay = FALSE, is_neuter = TRUE
      FROM trapper.sot_cats c
      WHERE cp.cat_id = c.cat_id
        AND cp.is_spay = TRUE
        AND LOWER(c.sex) = 'male'
    `);
    results.fixed_males = fixedMales.rowCount || 0;

    const fixedFemales = await query(`
      UPDATE trapper.cat_procedures cp
      SET procedure_type = 'spay', is_spay = TRUE, is_neuter = FALSE
      FROM trapper.sot_cats c
      WHERE cp.cat_id = c.cat_id
        AND cp.is_neuter = TRUE
        AND LOWER(c.sex) = 'female'
    `);
    results.fixed_females = fixedFemales.rowCount || 0;

    // Mark altered_by_clinic = TRUE when FFSC performed the spay/neuter
    // (service_type contains "Cat Spay" or "Cat Neuter")
    await saveProgress('Marking cats altered by clinic...');
    const alteredByClinic = await query(`
      UPDATE trapper.sot_cats c
      SET altered_by_clinic = TRUE
      FROM trapper.sot_appointments a
      WHERE a.cat_id = c.cat_id
        AND (a.service_type ILIKE '%Cat Spay%' OR a.service_type ILIKE '%Cat Neuter%')
        AND c.altered_by_clinic IS DISTINCT FROM TRUE
    `);
    results.marked_altered_by_clinic = alteredByClinic.rowCount || 0;

    // NOTE: Cat-place auto-linking removed from ingest process (MIG_305 fix).
    // The previous queries linked ALL cats to ALL of a person's places, which
    // caused data corruption when a person had multiple place relationships.
    //
    // Use the cron endpoint /api/cron/entity-linking instead, which calls
    // run_cat_place_linking() - a safer function that links cats based on
    // specific appointment ownership evidence, not just person relationships.
    //
    // See: docs/AUDIT_PLACE_CONSOLIDATION_ISSUE.md

    // Update altered_status
    await saveProgress('Updating altered status...');
    await query(`
      UPDATE trapper.sot_cats c SET altered_status = 'spayed'
      WHERE c.altered_status IS DISTINCT FROM 'spayed'
        AND EXISTS (SELECT 1 FROM trapper.cat_procedures cp WHERE cp.cat_id = c.cat_id AND cp.is_spay = TRUE)
    `);
    await query(`
      UPDATE trapper.sot_cats c SET altered_status = 'neutered'
      WHERE c.altered_status IS DISTINCT FROM 'neutered'
        AND EXISTS (SELECT 1 FROM trapper.cat_procedures cp WHERE cp.cat_id = c.cat_id AND cp.is_neuter = TRUE)
    `);

    // Link appointments to trappers for accurate trapper stats
    await saveProgress('Linking appointments to trappers...');
    const trapperLinks = await query(`
      SELECT * FROM trapper.link_appointments_to_trappers()
    `);
    if (trapperLinks.rows?.[0]) {
      results.appointments_linked_to_trappers = trapperLinks.rows[0].linked || 0;
    }

    // Link appointments via embedded microchips in Animal Name
    // ClinicHQ quirk: recaptured cats often have microchip in name field instead of microchip field
    // Must run AFTER appointments are created so we have records to link
    await saveProgress('Extracting embedded microchips...');
    const embeddedChipLinks = await query(`
      SELECT * FROM trapper.extract_and_link_microchips_from_animal_name()
    `);
    if (embeddedChipLinks.rows?.[0]) {
      results.embedded_microchip_cats_created = embeddedChipLinks.rows[0].cats_created || 0;
      results.embedded_microchip_appointments_linked = embeddedChipLinks.rows[0].appointments_linked || 0;
    }

    // Create cat_vitals records from appointments with temperature/reproductive data
    // This ensures vitals are captured during real-time ingest, not just via migrations
    await saveProgress('Creating appointment vitals...');
    const appointmentVitals = await query(`
      INSERT INTO trapper.cat_vitals (
        cat_id, appointment_id, recorded_at,
        temperature_f, is_pregnant, is_lactating, is_in_heat,
        source_system, source_record_id
      )
      SELECT
        a.cat_id,
        a.appointment_id,
        a.appointment_date::timestamp with time zone,
        a.temperature,
        a.is_pregnant,
        a.is_lactating,
        a.is_in_heat,
        'clinichq',
        'appointment_' || a.appointment_number
      FROM trapper.sot_appointments a
      WHERE a.cat_id IS NOT NULL
        AND (
          a.temperature IS NOT NULL
          OR a.is_pregnant = TRUE
          OR a.is_lactating = TRUE
          OR a.is_in_heat = TRUE
        )
        AND NOT EXISTS (
          SELECT 1 FROM trapper.cat_vitals cv
          WHERE cv.appointment_id = a.appointment_id
        )
      ON CONFLICT DO NOTHING
    `);
    results.appointment_vitals_created = appointmentVitals.rowCount || 0;

    // AUTO-LINK CATS TO REQUESTS based on attribution windows
    // This is the key integration that was missing - cats visiting clinic should be
    // automatically linked to any active request at their place
    await saveProgress('Linking cats to requests...');
    const catRequestLinks = await query(`
      INSERT INTO trapper.request_cat_links (request_id, cat_id, link_purpose, link_notes, linked_by)
      SELECT DISTINCT
        r.request_id,
        a.cat_id,
        CASE
          WHEN cp.is_spay = TRUE OR cp.is_neuter = TRUE THEN 'tnr_target'::trapper.cat_link_purpose
          ELSE 'wellness'::trapper.cat_link_purpose
        END,
        'Auto-linked: clinic visit ' || a.appointment_date::text || ' within request attribution window',
        'ingest_auto'
      FROM trapper.sot_appointments a
      JOIN trapper.cat_place_relationships cpr ON cpr.cat_id = a.cat_id
      JOIN trapper.sot_requests r ON r.place_id = cpr.place_id
      LEFT JOIN trapper.cat_procedures cp ON cp.appointment_id = a.appointment_id
      WHERE a.cat_id IS NOT NULL
        -- Attribution window logic (from MIG_208):
        -- Active requests: created up to 6 months ago, or closed up to 3 months ago
        AND (
          -- Active request: procedure within 6 months of request creation, or future
          (r.resolved_at IS NULL AND a.appointment_date >= r.source_created_at - INTERVAL '1 month')
          OR
          -- Resolved request: procedure before resolved + 3 month buffer
          (r.resolved_at IS NOT NULL AND a.appointment_date <= r.resolved_at + INTERVAL '3 months'
           AND a.appointment_date >= r.source_created_at - INTERVAL '1 month')
        )
        -- Only link new appointments (not historical backfill)
        AND a.appointment_date >= CURRENT_DATE - INTERVAL '30 days'
        AND NOT EXISTS (
          SELECT 1 FROM trapper.request_cat_links rcl
          WHERE rcl.request_id = r.request_id AND rcl.cat_id = a.cat_id
        )
      ON CONFLICT (request_id, cat_id) DO NOTHING
    `);
    results.cats_linked_to_requests = catRequestLinks.rowCount || 0;

    // Queue new appointments for AI extraction
    // This ensures recapture detection and other attributes are extracted promptly
    await saveProgress('Queuing AI extraction...');
    const aiQueueResult = await query(`
      SELECT trapper.queue_appointment_extraction(100, 10) as queued
    `);
    results.ai_extraction_queued = aiQueueResult.rows?.[0]?.queued || 0;
  }

  // ================================================================
  // Inline Enrichment — runs after ALL ClinicHQ post-processing
  // so staff see fully linked map data immediately after upload.
  // Each step is non-fatal (crons are safety net).
  // ================================================================

  // Entity linking: call individual functions
  // MIG_970: Added error tracking so failures are visible in UI response
  const linking: Record<string, number> = {};
  const linkingErrors: Array<{ step: string; error: string }> = [];

  try {
    await saveProgress('Linking appointments to owners...');
    const owners = await queryOne<{ appointments_updated: number; persons_created: number; persons_linked: number }>(
      `SELECT * FROM trapper.link_appointments_to_owners()`
    );
    if (owners) {
      linking.appointments_linked_to_owners = owners.appointments_updated;
      linking.persons_created_for_appointments = owners.persons_created;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    linkingErrors.push({ step: 'link_appointments_to_owners', error: msg });
    console.error('link_appointments_to_owners failed (non-fatal):', err);
  }

  try {
    await saveProgress('Linking cats to places...');
    const cats = await queryOne<{ cats_linked: number; places_involved: number }>(
      `SELECT * FROM trapper.run_cat_place_linking()`
    );
    if (cats) linking.cats_linked_to_places = cats.cats_linked;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    linkingErrors.push({ step: 'run_cat_place_linking', error: msg });
    console.error('run_cat_place_linking failed (non-fatal):', err);
  }

  try {
    await saveProgress('Linking appointments to trappers...');
    const trappers = await queryOne<{ run_appointment_trapper_linking: number }>(
      `SELECT trapper.run_appointment_trapper_linking() as run_appointment_trapper_linking`
    );
    if (trappers) linking.appointments_linked_to_trappers = trappers.run_appointment_trapper_linking;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    linkingErrors.push({ step: 'run_appointment_trapper_linking', error: msg });
    console.error('run_appointment_trapper_linking failed (non-fatal):', err);
  }

  try {
    // MIG_889/MIG_970: Infer appointment places from booking address + person places
    // Must run BEFORE link_cats_to_appointment_places() so inferred_place_id is populated.
    // Step 0 (booking_address) is highest priority — uses the actual ClinicHQ booking address
    // (colony site) instead of person's home address.
    await saveProgress('Inferring appointment places...');
    const inferred = await query(`SELECT * FROM trapper.infer_appointment_places()`);
    if (inferred.rows) {
      for (const row of inferred.rows) {
        linking[`inferred_place_${row.source}`] = row.appointments_linked;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    linkingErrors.push({ step: 'infer_appointment_places', error: msg });
    console.error('infer_appointment_places failed (non-fatal):', err);
  }

  try {
    // MIG_889: Link cats to places via appointment inferred_place_id
    // Replaces direct INSERT (which bypassed INV-10 gatekeeper and linked to ALL person places)
    await saveProgress('Linking cats to appointment places...');
    const appointmentPlaces = await queryOne<{ cats_linked: number }>(
      `SELECT * FROM trapper.link_cats_to_appointment_places()`
    );
    if (appointmentPlaces) linking.cats_linked_via_appointment_places = appointmentPlaces.cats_linked;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    linkingErrors.push({ step: 'link_cats_to_appointment_places', error: msg });
    console.error('link_cats_to_appointment_places failed (non-fatal):', err);
  }

  results.entity_linking = linking;
  if (linkingErrors.length > 0) {
    results.entity_linking_errors = linkingErrors;
  }

  // Cat-to-request linking (second pass): now that entity linking has created
  // fresh cat→place relationships, link newly-placed cats to active requests.
  // The first pass (in appointment_info post-processing) only catches cats that
  // ALREADY had place links; this catches the rest.
  try {
    await saveProgress('Linking cats to requests (post entity-linking)...');
    const postLinkResult = await queryOne<{ linked: number; skipped: number }>(
      `SELECT * FROM trapper.link_cats_to_requests_safe()`
    );
    if (postLinkResult) {
      results.cats_linked_to_requests_post = postLinkResult.linked;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!results.entity_linking_errors) results.entity_linking_errors = [];
    (results.entity_linking_errors as Array<{ step: string; error: string }>).push({
      step: 'link_cats_to_requests_safe',
      error: msg,
    });
    console.error('Post-linking cats to requests failed (non-fatal):', err);
  }

  // Geocoding: fire-and-forget so new places get coordinates for map
  try {
    await saveProgress('Triggering geocoding...');
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const cronSecret = process.env.CRON_SECRET;
    fetch(`${baseUrl}/api/cron/geocode`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {}),
      },
    }).catch(() => {});
    results.geocoding_triggered = true;
  } catch {
    // non-fatal
  }

  // Beacon enrichment: birth events from lactating appointments
  try {
    await saveProgress('Creating birth events from lactating appointments...');
    const birthResult = await query(`
      WITH lactating_mothers AS (
        SELECT DISTINCT ON (a.cat_id)
          a.appointment_id,
          a.appointment_date,
          a.cat_id,
          (
            SELECT cpr.place_id
            FROM trapper.cat_place_relationships cpr
            WHERE cpr.cat_id = a.cat_id
            ORDER BY cpr.created_at DESC
            LIMIT 1
          ) as place_id
        FROM trapper.sot_appointments a
        JOIN trapper.sot_cats c ON c.cat_id = a.cat_id
        LEFT JOIN trapper.cat_birth_events be ON be.mother_cat_id = a.cat_id
        WHERE a.is_lactating = true
          AND c.sex = 'Female'
          AND be.birth_event_id IS NULL
        ORDER BY a.cat_id, a.appointment_date DESC
        LIMIT 100
      )
      INSERT INTO trapper.cat_birth_events (
        cat_id, mother_cat_id, birth_date, birth_date_precision,
        birth_year, birth_month, birth_season, place_id,
        source_system, source_record_id, reported_by, notes
      )
      SELECT
        NULL, cat_id,
        appointment_date - INTERVAL '42 days',
        'estimated'::trapper.birth_date_precision,
        EXTRACT(YEAR FROM appointment_date - INTERVAL '42 days')::INT,
        EXTRACT(MONTH FROM appointment_date - INTERVAL '42 days')::INT,
        CASE
          WHEN EXTRACT(MONTH FROM appointment_date - INTERVAL '42 days') IN (3,4,5) THEN 'spring'
          WHEN EXTRACT(MONTH FROM appointment_date - INTERVAL '42 days') IN (6,7,8) THEN 'summer'
          WHEN EXTRACT(MONTH FROM appointment_date - INTERVAL '42 days') IN (9,10,11) THEN 'fall'
          ELSE 'winter'
        END,
        place_id, 'beacon_cron', appointment_id::TEXT, 'System',
        'Auto-created from lactating appointment on ' || appointment_date::TEXT
      FROM lactating_mothers
      ON CONFLICT DO NOTHING
    `);
    results.birth_events_created = birthResult.rowCount || 0;
  } catch (err) {
    console.error('Inline birth events failed (non-fatal):', err);
  }

  // Beacon enrichment: mortality events from clinic euthanasia/death notes
  try {
    await saveProgress('Creating mortality events from clinic notes...');
    const mortalityResult = await query(`
      WITH death_appointments AS (
        SELECT DISTINCT ON (a.cat_id)
          a.appointment_id,
          a.appointment_date,
          a.cat_id,
          a.medical_notes,
          CASE
            WHEN LOWER(a.medical_notes) LIKE '%humanely euthanized%' THEN 'euthanasia'
            WHEN LOWER(a.medical_notes) LIKE '%euthanasia%' THEN 'euthanasia'
            WHEN LOWER(a.medical_notes) LIKE '%hit by car%' OR LOWER(a.medical_notes) LIKE '%hbc%' THEN 'vehicle'
            WHEN LOWER(a.medical_notes) LIKE '%died%' THEN 'unknown'
            ELSE 'unknown'
          END AS death_cause,
          (
            SELECT cpr.place_id
            FROM trapper.cat_place_relationships cpr
            WHERE cpr.cat_id = a.cat_id
            ORDER BY cpr.created_at DESC
            LIMIT 1
          ) as place_id
        FROM trapper.sot_appointments a
        JOIN trapper.sot_cats c ON c.cat_id = a.cat_id
        LEFT JOIN trapper.cat_mortality_events me ON me.cat_id = a.cat_id
        WHERE (
            LOWER(a.medical_notes) LIKE '%euthanized%'
            OR LOWER(a.medical_notes) LIKE '%euthanasia%'
            OR LOWER(a.medical_notes) LIKE '%died%'
            OR LOWER(a.medical_notes) LIKE '%hit by car%'
            OR LOWER(a.medical_notes) LIKE '%hbc%'
          )
          AND me.mortality_event_id IS NULL
        ORDER BY a.cat_id, a.appointment_date DESC
        LIMIT 50
      )
      INSERT INTO trapper.cat_mortality_events (
        cat_id, death_date, death_date_precision, death_year, death_month,
        death_cause, place_id, source_system, source_record_id, reported_by, notes
      )
      SELECT
        cat_id, appointment_date, 'exact',
        EXTRACT(YEAR FROM appointment_date)::INT,
        EXTRACT(MONTH FROM appointment_date)::INT,
        death_cause::trapper.death_cause,
        place_id, 'beacon_cron', appointment_id::TEXT, 'System',
        'Auto-created from clinic notes: ' || LEFT(medical_notes, 200)
      FROM death_appointments
      ON CONFLICT (cat_id) DO NOTHING
    `);
    results.mortality_events_created = mortalityResult.rowCount || 0;

    // Mark cats as deceased
    if (mortalityResult.rowCount && mortalityResult.rowCount > 0) {
      const deceasedResult = await query(`
        UPDATE trapper.sot_cats
        SET is_deceased = true, deceased_date = me.death_date, updated_at = NOW()
        FROM trapper.cat_mortality_events me
        WHERE sot_cats.cat_id = me.cat_id
          AND (sot_cats.is_deceased IS NULL OR sot_cats.is_deceased = false)
          AND me.source_system = 'beacon_cron'
      `);
      results.cats_marked_deceased = deceasedResult.rowCount || 0;
    }
  } catch (err) {
    console.error('Inline mortality events failed (non-fatal):', err);
  }

  return results;
}

// Process Google Maps KMZ/KML files
interface Placemark {
  name: string;
  description: string;
  lat: number;
  lng: number;
  styleUrl: string;
  folder: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractPlacemarks(node: any, folderName = ""): Placemark[] {
  const placemarks: Placemark[] = [];

  if (!node) return placemarks;

  // Handle Folder
  if (node.Folder) {
    const folders = Array.isArray(node.Folder) ? node.Folder : [node.Folder];
    for (const folder of folders) {
      const name = folder.name?.[0] || "";
      placemarks.push(...extractPlacemarks(folder, name));
    }
  }

  // Handle Placemark
  if (node.Placemark) {
    const pms = Array.isArray(node.Placemark) ? node.Placemark : [node.Placemark];
    for (const pm of pms) {
      const name = pm.name?.[0] || "";
      const description = pm.description?.[0] || "";
      const styleUrl = pm.styleUrl?.[0] || "";
      const coords = pm.Point?.[0]?.coordinates?.[0] || "";

      const [lng, lat] = coords.split(",").map((s: string) => parseFloat(s.trim()));

      if (lat && lng) {
        placemarks.push({
          name,
          description,
          lat,
          lng,
          styleUrl,
          folder: folderName,
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

async function processGoogleMapsFile(
  uploadId: string,
  upload: FileUpload,
  buffer: Buffer
): Promise<NextResponse> {
  const isKmz = upload.stored_filename.endsWith(".kmz");
  const isKml = upload.stored_filename.endsWith(".kml");

  if (!isKmz && !isKml) {
    await query(
      `UPDATE trapper.file_uploads SET status = 'failed', error_message = $2 WHERE upload_id = $1`,
      [uploadId, "Google Maps files must be .kmz or .kml"]
    );
    return NextResponse.json(
      { error: "Google Maps files must be .kmz or .kml" },
      { status: 400 }
    );
  }

  let kmlContent: string;

  // For KMZ files, we need to extract the KML using JSZip
  if (isKmz) {
    try {
      const zip = await JSZip.loadAsync(buffer);
      const kmlFile = zip.file("doc.kml");
      if (!kmlFile) {
        // Try to find any .kml file
        const kmlFiles = Object.keys(zip.files).filter(name => name.endsWith(".kml"));
        if (kmlFiles.length === 0) {
          throw new Error("No KML file found in KMZ archive");
        }
        kmlContent = await zip.file(kmlFiles[0])!.async("string");
      } else {
        kmlContent = await kmlFile.async("string");
      }
    } catch (error) {
      await query(
        `UPDATE trapper.file_uploads SET status = 'failed', error_message = $2 WHERE upload_id = $1`,
        [uploadId, `Failed to extract KMZ: ${error instanceof Error ? error.message : "Unknown error"}`]
      );
      return NextResponse.json(
        { error: "Failed to extract KMZ file" },
        { status: 500 }
      );
    }
  } else {
    kmlContent = buffer.toString("utf-8");
  }

  // Parse KML
  let placemarks: Placemark[];
  try {
    const result = await parseStringPromise(kmlContent);
    placemarks = extractPlacemarks(result.kml);
  } catch (error) {
    await query(
      `UPDATE trapper.file_uploads SET status = 'failed', error_message = $2 WHERE upload_id = $1`,
      [uploadId, `Failed to parse KML: ${error instanceof Error ? error.message : "Unknown error"}`]
    );
    return NextResponse.json(
      { error: "Failed to parse KML file" },
      { status: 500 }
    );
  }

  if (placemarks.length === 0) {
    await query(
      `UPDATE trapper.file_uploads SET status = 'failed', error_message = $2 WHERE upload_id = $1`,
      [uploadId, "No placemarks found. If using a link from Google Maps, download the full KMZ export instead."]
    );
    return NextResponse.json(
      { error: "No placemarks found in the file. It may be a NetworkLink file - please download the full KMZ export." },
      { status: 400 }
    );
  }

  // Stage the import using the centralized pattern
  const importResult = await queryOne<{ import_id: string }>(`
    INSERT INTO trapper.staged_google_maps_imports (
      filename,
      upload_method,
      placemarks,
      placemark_count,
      uploaded_by,
      status
    ) VALUES ($1, $2, $3, $4, $5, 'pending')
    RETURNING import_id::text
  `, [
    upload.original_filename,
    'data_ingest',
    JSON.stringify(placemarks),
    placemarks.length,
    'ingest_upload',
  ]);

  if (!importResult) {
    await query(
      `UPDATE trapper.file_uploads SET status = 'failed', error_message = $2 WHERE upload_id = $1`,
      [uploadId, "Failed to stage import"]
    );
    return NextResponse.json(
      { error: "Failed to stage import" },
      { status: 500 }
    );
  }

  // Process the import through the centralized function
  const processResult = await queryOne<{ result: { success: boolean; updated: number; inserted: number; not_matched: number; error?: string } }>(`
    SELECT trapper.process_google_maps_import($1) as result
  `, [importResult.import_id]);

  if (!processResult?.result?.success) {
    await query(
      `UPDATE trapper.file_uploads SET status = 'failed', error_message = $2 WHERE upload_id = $1`,
      [uploadId, processResult?.result?.error || "Processing failed"]
    );
    return NextResponse.json(
      { error: processResult?.result?.error || "Processing failed" },
      { status: 500 }
    );
  }

  // Mark file upload as completed
  await query(
    `UPDATE trapper.file_uploads
     SET status = 'completed', processed_at = NOW(),
         rows_total = $2, rows_inserted = $3, rows_updated = $4, rows_skipped = $5
     WHERE upload_id = $1`,
    [
      uploadId,
      placemarks.length,
      processResult.result.inserted,
      processResult.result.updated,
      processResult.result.not_matched,
    ]
  );

  return NextResponse.json({
    success: true,
    upload_id: uploadId,
    import_id: importResult.import_id,
    rows_total: placemarks.length,
    rows_inserted: processResult.result.inserted,
    rows_updated: processResult.result.updated,
    rows_skipped: processResult.result.not_matched,
  });
}
