import { NextRequest, NextResponse } from "next/server";
import { query, queryOne, queryRows } from "@/lib/db";
import { readFile } from "fs/promises";
import path from "path";
import * as XLSX from "xlsx";
import { createHash } from "crypto";
import { parseStringPromise } from "xml2js";
import JSZip from "jszip";

interface FileUpload {
  upload_id: string;
  original_filename: string;
  stored_filename: string;
  source_system: string;
  source_table: string;
  status: string;
  file_content: Buffer | null;
}

// Parse XLSX or CSV file
function parseFile(buffer: Buffer, filename: string): { headers: string[]; rows: Record<string, unknown>[] } {
  const ext = filename.split('.').pop()?.toLowerCase();

  if (ext === 'csv') {
    // Parse CSV
    const text = buffer.toString('utf-8');
    const lines = text.split('\n').filter(l => l.trim());
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const rows = lines.slice(1).map(line => {
      const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
      const row: Record<string, unknown> = {};
      headers.forEach((h, i) => { row[h] = values[i] || ''; });
      return row;
    });
    return { headers, rows };
  } else {
    // Parse XLSX
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
    const headers = data.length > 0 ? Object.keys(data[0]) : [];
    return { headers, rows: data };
  }
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

    // Mark as processing
    await query(
      `UPDATE trapper.file_uploads SET status = 'processing' WHERE upload_id = $1`,
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

      // Check if exists by row_id OR by hash (unique constraint is on hash)
      const existing = await queryOne<{ id: string; row_hash: string; source_row_id: string; file_upload_id: string | null }>(
        `SELECT id, row_hash, source_row_id, file_upload_id FROM trapper.staged_records
         WHERE source_system = $1 AND source_table = $2
           AND (source_row_id = $3 OR row_hash = $4)`,
        [upload.source_system, upload.source_table, sourceRowId, rowHash]
      );

      if (existing) {
        if (existing.row_hash === rowHash) {
          // Exact same content - skip (but update file_upload_id if not set)
          if (!existing.file_upload_id) {
            await query(
              `UPDATE trapper.staged_records SET file_upload_id = $1 WHERE id = $2`,
              [uploadId, existing.id]
            );
          }
          skipped++;
        } else {
          // Same row_id but different content - update
          await query(
            `UPDATE trapper.staged_records
             SET payload = $1, row_hash = $2, file_upload_id = $3, updated_at = NOW()
             WHERE id = $4`,
            [JSON.stringify(row), rowHash, uploadId, existing.id]
          );
          updated++;
        }
      } else {
        // Insert new record with ON CONFLICT to handle race conditions
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

    // Run post-processing for ClinicHQ
    let postProcessingResults = null;
    if (upload.source_system === 'clinichq') {
      postProcessingResults = await runClinicHQPostProcessing(upload.source_table);
    }

    // Mark as completed
    await query(
      `UPDATE trapper.file_uploads
       SET status = 'completed', processed_at = NOW(),
           rows_total = $2, rows_inserted = $3, rows_updated = $4, rows_skipped = $5,
           data_date_min = $6, data_date_max = $7
       WHERE upload_id = $1`,
      [uploadId, rows.length, inserted, updated, skipped,
       dataDateMin?.toISOString().split('T')[0] || null,
       dataDateMax?.toISOString().split('T')[0] || null]
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

// Post-processing for ClinicHQ data
async function runClinicHQPostProcessing(sourceTable: string): Promise<Record<string, number>> {
  const results: Record<string, number> = {};

  if (sourceTable === 'cat_info') {
    // Step 1: Create cats from microchips using find_or_create_cat_by_microchip
    // This creates new cats or returns existing ones
    const catsCreated = await query(`
      WITH cat_data AS (
        SELECT DISTINCT ON (payload->>'Microchip Number')
          payload->>'Microchip Number' as microchip,
          NULLIF(TRIM(payload->>'Patient Name'), '') as name,
          NULLIF(TRIM(payload->>'Sex'), '') as sex,
          NULLIF(TRIM(payload->>'Breed'), '') as breed,
          NULLIF(TRIM(payload->>'Color'), '') as color
        FROM trapper.staged_records
        WHERE source_system = 'clinichq'
          AND source_table = 'cat_info'
          AND payload->>'Microchip Number' IS NOT NULL
          AND TRIM(payload->>'Microchip Number') != ''
          AND LENGTH(TRIM(payload->>'Microchip Number')) >= 9
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
            NULL,  -- altered_status
            cd.color,
            NULL,  -- secondary_color
            NULL,  -- ownership_type
            'clinichq'
          ) as cat_id
        FROM cat_data cd
        WHERE cd.microchip IS NOT NULL
      )
      SELECT COUNT(*) as cnt FROM created_cats WHERE cat_id IS NOT NULL
    `);
    results.cats_created_or_matched = parseInt(catsCreated.rows?.[0]?.cnt || '0');

    // Step 2: Update sex on existing cats from cat_info records
    const sexUpdates = await query(`
      UPDATE trapper.sot_cats c
      SET sex = sr.payload->>'Sex'
      FROM trapper.staged_records sr
      JOIN trapper.cat_identifiers ci ON ci.id_value = sr.payload->>'Microchip Number' AND ci.id_type = 'microchip'
      WHERE ci.cat_id = c.cat_id
        AND sr.source_system = 'clinichq'
        AND sr.source_table = 'cat_info'
        AND sr.payload->>'Sex' IS NOT NULL
        AND sr.payload->>'Sex' != ''
        AND LOWER(c.sex) IS DISTINCT FROM LOWER(sr.payload->>'Sex')
    `);
    results.sex_updates = sexUpdates.rowCount || 0;

    // Step 3: Link orphaned appointments to cats via microchip
    // Appointments may have been created before cats existed
    // NOTE: We match on payload->>'Number' because source_row_id is a composite (Number_Date)
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
    `);
    results.weight_vitals_created = weightVitals.rowCount || 0;
  }

  if (sourceTable === 'owner_info') {
    // Step 1: Create people using find_or_create_person SQL function (consistent with other ingests)
    // This finds existing people by email/phone OR creates new ones
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
          AND (
            (payload->>'Owner Email' IS NOT NULL AND TRIM(payload->>'Owner Email') != '')
            OR (payload->>'Owner Phone' IS NOT NULL AND TRIM(payload->>'Owner Phone') != '')
            OR (payload->>'Owner Cell Phone' IS NOT NULL AND TRIM(payload->>'Owner Cell Phone') != '')
          )
          AND (payload->>'Owner First Name' IS NOT NULL AND TRIM(payload->>'Owner First Name') != '')
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
    `);
    results.people_created_or_matched = parseInt(peopleCreated.rows?.[0]?.cnt || '0');

    // Step 2: Create places from owner addresses using find_or_create_place_deduped
    // This auto-queues for geocoding
    const placesCreated = await query(`
      WITH owner_addresses AS (
        SELECT DISTINCT ON (TRIM(payload->>'Owner Address'))
          TRIM(payload->>'Owner Address') as address,
          NULLIF(LOWER(TRIM(payload->>'Owner Email')), '') as email,
          trapper.norm_phone_us(COALESCE(NULLIF(payload->>'Owner Cell Phone', ''), payload->>'Owner Phone')) as phone
        FROM trapper.staged_records
        WHERE source_system = 'clinichq'
          AND source_table = 'owner_info'
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
    `);
    results.places_created_or_matched = parseInt(placesCreated.rows?.[0]?.cnt || '0');

    // Step 3: Link people to places via person_place_relationships
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
        AND sr.payload->>'Owner Address' IS NOT NULL
        AND TRIM(sr.payload->>'Owner Address') != ''
        AND NOT EXISTS (
          SELECT 1 FROM trapper.person_place_relationships ppr
          WHERE ppr.person_id = pi.person_id AND ppr.place_id = p.place_id
        )
      ON CONFLICT DO NOTHING
    `);
    results.person_place_links = personPlaceLinks.rowCount || 0;

    // Step 4: Link people to appointments via email/phone match through person_identifiers
    const personLinks = await query(`
      UPDATE trapper.sot_appointments a
      SET person_id = pi.person_id
      FROM trapper.staged_records sr
      JOIN trapper.person_identifiers pi ON (
        (pi.id_type = 'email' AND pi.id_value_norm = NULLIF(LOWER(TRIM(sr.payload->>'Owner Email')), ''))
        OR (pi.id_type = 'phone' AND pi.id_value_norm = trapper.norm_phone_us(COALESCE(NULLIF(sr.payload->>'Owner Cell Phone', ''), sr.payload->>'Owner Phone')))
      )
      WHERE sr.source_system = 'clinichq'
        AND sr.source_table = 'owner_info'
        AND a.appointment_number = sr.payload->>'Number'
        AND a.person_id IS NULL
    `);
    results.appointments_linked_to_people = personLinks.rowCount || 0;

    // Step 5: Link cats to people via appointments
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
    const orphanedLinked = await query(`
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
    results.orphaned_appointments_linked_pre = orphanedLinked.rowCount || 0;

    // Step 1: Create sot_appointments from staged_records
    // Uses get_canonical_cat_id to handle merged cats
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
        sr.payload->>'Spay' = 'Yes',
        sr.payload->>'Neuter' = 'Yes',
        sr.payload->>'Vet Name',
        sr.payload->>'Technician',
        CASE WHEN sr.payload->>'Temperature' ~ '^[0-9]+\.?[0-9]*$'
             THEN (sr.payload->>'Temperature')::NUMERIC(4,1)
             ELSE NULL END,
        sr.payload->>'Internal Medical Notes',
        sr.payload->>'Lactating' = 'Yes' OR sr.payload->>'Lactating_2' = 'Yes',
        sr.payload->>'Pregnant' = 'Yes',
        sr.payload->>'In Heat' = 'Yes',
        'clinichq', 'clinichq', sr.source_row_id, sr.row_hash
      FROM trapper.staged_records sr
      LEFT JOIN trapper.cat_identifiers ci ON ci.id_value = sr.payload->>'Microchip Number' AND ci.id_type = 'microchip'
      LEFT JOIN trapper.sot_cats c ON c.cat_id = ci.cat_id
      WHERE sr.source_system = 'clinichq'
        AND sr.source_table = 'appointment_info'
        AND sr.payload->>'Date' IS NOT NULL AND sr.payload->>'Date' != ''
        AND NOT EXISTS (
          SELECT 1 FROM trapper.sot_appointments a
          WHERE a.appointment_number = sr.payload->>'Number'
            AND a.appointment_date = TO_DATE(sr.payload->>'Date', 'MM/DD/YYYY')
        )
      ON CONFLICT DO NOTHING
    `);
    results.new_appointments = newAppointments.rowCount || 0;

    // Create cat_procedures from appointments with spay service_type
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
    const trapperLinks = await query(`
      SELECT * FROM trapper.link_appointments_to_trappers()
    `);
    if (trapperLinks.rows?.[0]) {
      results.appointments_linked_to_trappers = trapperLinks.rows[0].linked || 0;
    }

    // Create cat_vitals records from appointments with temperature/reproductive data
    // This ensures vitals are captured during real-time ingest, not just via migrations
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
