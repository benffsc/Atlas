// Process uploaded files for ClinicHQ, Airtable, and Google Maps data
// Phase 3c (FFS-736): Per-sourceTable post-processing moved to stored procedure
// ops.run_clinichq_post_processing(). Entity linking + beacon enrichment stay in TS.
import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import type {
  BulkStagingRow, BulkStagingChunkResult,
  PostProcessingProcedureResult,
  LinkCatsToPlacesResult, LinkCatsToAppointmentPlacesResult,
  LinkAppointmentsToOwnersResult,
  LinkCatsToRequestsResult, RunAppointmentTrapperLinkingResult,
  QueueUnofficialTrapperCandidatesResult,
} from "@/lib/types/ingest-types";
import { apiSuccess, apiBadRequest, apiNotFound, apiServerError, apiConflict } from "@/lib/api-response";
import { getServerConfig } from "@/lib/server-config";
import { isValidUUID } from "@/lib/validation";
import { readFile } from "fs/promises";
import path from "path";
import * as XLSX from "xlsx";
import { createHash } from "crypto";
import { parseStringPromise } from "xml2js";
import JSZip from "jszip";

export const maxDuration = 300; // 5 minutes: staging + post-processing + enrichment

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

// --- Result type for processUpload (exported for batch processor + retry) ---
export interface ProcessUploadResult {
  success: boolean;
  upload_id: string;
  rows_total: number;
  rows_inserted: number;
  rows_updated: number;
  rows_skipped: number;
  post_processing: Record<string, unknown> | null;
}

// --- HTTP Handler ---
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: uploadId } = await params;

  if (!uploadId) return apiBadRequest("Upload ID is required");
  if (!isValidUUID(uploadId)) return apiBadRequest("Invalid upload ID format");

  try {
    // Fetch upload to check for Google Maps (different code path)
    const upload = await queryOne<FileUpload>(
      `SELECT upload_id, original_filename, stored_filename, source_system, source_table, status, file_content
       FROM ops.file_uploads WHERE upload_id = $1`,
      [uploadId]
    );

    if (!upload) return apiNotFound("Upload not found");
    if (upload.status === 'processing') return apiConflict("Upload is already being processed");

    // Google Maps KMZ/KML — entirely different code path
    if (upload.source_system === 'google_maps') {
      await query(
        `UPDATE ops.file_uploads SET status = 'processing', processed_at = NOW() WHERE upload_id = $1`,
        [uploadId]
      );
      const buffer = await readUploadContent(upload);
      return processGoogleMapsFile(uploadId, upload, buffer);
    }

    // Standard processing (ClinicHQ, Airtable)
    const result = await processUpload(uploadId, upload);
    return apiSuccess(result);
  } catch (error) {
    console.error("Processing error:", error);
    await query(
      `UPDATE ops.file_uploads SET status = 'failed', processing_phase = 'failed', error_message = $2 WHERE upload_id = $1`,
      [uploadId, error instanceof Error ? error.message : "Unknown error"]
    ).catch(() => {});
    return apiServerError("Failed to process file");
  }
}

// --- Read file content from filesystem or database ---
async function readUploadContent(upload: FileUpload): Promise<Buffer> {
  const uploadDir = path.join(process.cwd(), "uploads", "ingest");
  const filePath = path.join(uploadDir, upload.stored_filename);
  try {
    return await readFile(filePath);
  } catch {
    if (upload.file_content) return Buffer.from(upload.file_content);
    throw new Error("File content not available. Please re-upload the file.");
  }
}

// ================================================================
// Core processing logic — exported for batch processor + retry endpoint
// Phase 3c: Per-sourceTable SQL moved to ops.run_clinichq_post_processing()
// ================================================================
export async function processUpload(uploadId: string, existingUpload?: FileUpload): Promise<ProcessUploadResult> {
  // 1. Get upload record
  const upload = existingUpload ?? await queryOne<FileUpload>(
    `SELECT upload_id, original_filename, stored_filename, source_system, source_table, status, file_content
     FROM ops.file_uploads WHERE upload_id = $1`,
    [uploadId]
  );
  if (!upload) throw new Error("Upload not found");
  if (upload.status === 'processing') throw new Error("Upload is already being processed");

  try {
    // 2. Mark as processing
    await query(
      `UPDATE ops.file_uploads SET status = 'processing', processed_at = NOW(), processing_phase = 'staging' WHERE upload_id = $1`,
      [uploadId]
    );

    // 3. Read file
    const buffer = await readUploadContent(upload);

    // 4. Parse file
    const { rows } = parseFile(buffer, upload.stored_filename);
    const idFieldCandidates = getIdField(upload.source_system, upload.source_table);

    // Extract date range
    const dateFields = ['Date', 'Appointment Date', 'Created', 'date', 'appointment_date'];
    let dataDateMin: Date | null = null;
    let dataDateMax: Date | null = null;
    for (const row of rows) {
      for (const field of dateFields) {
        const dateStr = row[field] as string;
        if (dateStr && typeof dateStr === 'string') {
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

    // 5. Aggregate service lines for appointment_info
    let processedRows = rows;
    if (upload.source_table === 'appointment_info') {
      const aggregated: Record<string, unknown>[] = [];
      let currentAppointment: Record<string, unknown> | null = null;
      let services: string[] = [];
      for (const row of rows) {
        const hasNumber = row['Number'] && String(row['Number']).trim();
        if (hasNumber) {
          if (currentAppointment) {
            currentAppointment['All Services'] = services.join('; ');
            aggregated.push(currentAppointment);
          }
          currentAppointment = { ...row };
          services = [];
          const svc = row['Service / Subsidy'];
          if (svc && String(svc).trim()) services.push(String(svc).trim());
        } else if (currentAppointment) {
          const svc = row['Service / Subsidy'];
          if (svc && String(svc).trim()) services.push(String(svc).trim());
        }
      }
      if (currentAppointment) {
        currentAppointment['All Services'] = services.join('; ');
        aggregated.push(currentAppointment);
      }
      processedRows = aggregated;
    }

    // 6. Bulk stage rows (FFS-739: unnest() chunks instead of N+1)
    let inserted = 0;
    let skipped = 0;
    let updated = 0;
    const stagingRows: BulkStagingRow[] = [];
    for (const row of processedRows) {
      const hasData = Object.values(row).some(v => v !== null && v !== undefined && String(v).trim() !== '');
      if (!hasData) { skipped++; continue; }
      let sourceRowId: string | null = null;
      for (const field of idFieldCandidates) {
        if (row[field]) { sourceRowId = String(row[field]); break; }
      }
      if (sourceRowId && upload.source_table === 'appointment_info' && row['Date']) {
        sourceRowId = `${sourceRowId}_${String(row['Date']).replace(/\//g, '-')}`;
      }
      if (!sourceRowId) sourceRowId = `row_${processedRows.indexOf(row)}`;
      const rowHash = createHash('sha256').update(JSON.stringify(row)).digest('hex').substring(0, 16);
      stagingRows.push({ sourceRowId, payload: JSON.stringify(row), rowHash });
    }

    const CHUNK_SIZE = 500;
    for (let i = 0; i < stagingRows.length; i += CHUNK_SIZE) {
      const chunk = stagingRows.slice(i, i + CHUNK_SIZE);
      const sourceRowIds = chunk.map(r => r.sourceRowId);
      const payloads = chunk.map(r => r.payload);
      const rowHashes = chunk.map(r => r.rowHash);
      const bulkResult = await queryOne<BulkStagingChunkResult>(`
        WITH incoming AS (
          SELECT * FROM unnest($1::text[], $2::text[], $3::text[])
            AS t(source_row_id, payload_text, row_hash)
        ),
        hash_matches AS (
          SELECT sr.id, sr.row_hash, sr.file_upload_id
          FROM ops.staged_records sr
          WHERE sr.source_system = $4 AND sr.source_table = $5
            AND sr.row_hash = ANY($3::text[])
        ),
        claimed AS (
          UPDATE ops.staged_records sr
          SET file_upload_id = $6
          FROM hash_matches hm
          WHERE sr.id = hm.id AND hm.file_upload_id IS NULL
          RETURNING sr.id
        ),
        id_matches AS (
          SELECT sr.id, sr.source_row_id
          FROM ops.staged_records sr
          JOIN incoming i ON i.source_row_id = sr.source_row_id
          WHERE sr.source_system = $4 AND sr.source_table = $5
            AND i.row_hash NOT IN (SELECT row_hash FROM hash_matches)
        ),
        updates AS (
          UPDATE ops.staged_records sr
          SET payload = i.payload_text::jsonb, row_hash = i.row_hash,
              file_upload_id = $6, updated_at = NOW()
          FROM incoming i
          JOIN id_matches im ON im.source_row_id = i.source_row_id
          WHERE sr.id = im.id
          RETURNING sr.id
        ),
        inserts AS (
          INSERT INTO ops.staged_records
            (source_system, source_table, source_row_id, payload, row_hash, file_upload_id)
          SELECT $4, $5, i.source_row_id, i.payload_text::jsonb, i.row_hash, $6
          FROM incoming i
          WHERE i.row_hash NOT IN (SELECT row_hash FROM hash_matches)
            AND i.source_row_id NOT IN (SELECT source_row_id FROM id_matches)
          ON CONFLICT (source_system, source_table, row_hash) DO NOTHING
          RETURNING id
        )
        SELECT
          (SELECT COUNT(*) FROM inserts)::text as inserted,
          (SELECT COUNT(*) FROM updates)::text as updated,
          (SELECT COUNT(*) FROM hash_matches)::text as skipped
      `, [sourceRowIds, payloads, rowHashes, upload.source_system, upload.source_table, uploadId]);
      if (bulkResult) {
        inserted += parseInt(bulkResult.inserted || '0');
        updated += parseInt(bulkResult.updated || '0');
        skipped += parseInt(bulkResult.skipped || '0');
      }
    }

    // 7. ClinicHQ post-processing: stored procedure + entity linking + beacon enrichment
    let postProcessingResults: Record<string, unknown> | null = null;
    if (upload.source_system === 'clinichq') {
      const results: Record<string, unknown> = {};
      let stepNum = 0;

      async function saveProgress(step?: string) {
        stepNum++;
        if (step) results._current_step = step;
        results._step_num = stepNum;
        try {
          await query(
            `UPDATE ops.file_uploads SET post_processing_results = $2 WHERE upload_id = $1`,
            [uploadId, JSON.stringify(results)]
          );
        } catch (err) { console.error('saveProgress failed:', err); }
      }

      // Phase B: Call stored procedure (replaces ~1,300 lines of per-sourceTable SQL)
      await query(
        `UPDATE ops.file_uploads SET processing_phase = 'post_processing' WHERE upload_id = $1`,
        [uploadId]
      );
      await saveProgress('Running post-processing stored procedure...');
      const procResult = await queryOne<PostProcessingProcedureResult>(
        `SELECT ops.run_clinichq_post_processing($1, $2)`,
        [uploadId, upload.source_table]
      );
      if (procResult?.run_clinichq_post_processing) {
        Object.assign(results, procResult.run_clinichq_post_processing);
      }

      // Phase C: Entity linking (idempotent, cron safety net)
      await runEntityLinking(uploadId, results, saveProgress);

      // Phase D: Beacon enrichment
      await runBeaconEnrichment(uploadId, results, saveProgress);

      postProcessingResults = results;
    }

    // 8. Mark completed
    await query(
      `UPDATE ops.file_uploads
       SET status = 'completed', processed_at = NOW(), processing_phase = 'completed',
           rows_total = $2, rows_inserted = $3, rows_updated = $4, rows_skipped = $5,
           data_date_min = $6, data_date_max = $7,
           post_processing_results = $8
       WHERE upload_id = $1`,
      [uploadId, rows.length, inserted, updated, skipped,
       dataDateMin ? `${dataDateMin.getFullYear()}-${String(dataDateMin.getMonth() + 1).padStart(2, '0')}-${String(dataDateMin.getDate()).padStart(2, '0')}` : null,
       dataDateMax ? `${dataDateMax.getFullYear()}-${String(dataDateMax.getMonth() + 1).padStart(2, '0')}-${String(dataDateMax.getDate()).padStart(2, '0')}` : null,
       postProcessingResults ? JSON.stringify(postProcessingResults) : null]
    );

    return {
      success: true,
      upload_id: uploadId,
      rows_total: rows.length,
      rows_inserted: inserted,
      rows_updated: updated,
      rows_skipped: skipped,
      post_processing: postProcessingResults,
    };
  } catch (error) {
    // Mark file as failed so recovery cron doesn't have to wait
    await query(
      `UPDATE ops.file_uploads
       SET status = 'failed', processing_phase = 'failed',
           error_message = $2, failed_at_step = 'processUpload'
       WHERE upload_id = $1`,
      [uploadId, error instanceof Error ? error.message : "Unknown error"]
    ).catch(() => {});
    throw error;
  }
}

// ================================================================
// Entity Linking (Phase C) — runs outside transaction, idempotent
// Each step in try-catch with per-step error tracking.
// Cron job (/api/cron/entity-linking) is the safety net.
// ================================================================
async function runEntityLinking(
  uploadId: string,
  results: Record<string, unknown>,
  saveProgress: (step?: string) => Promise<void>
) {
  const linking: Record<string, number> = {};
  const linkingErrors: Array<{ step: string; error: string }> = [];

  try {
    await saveProgress('Linking appointments to owners...');
    const owners = await queryOne<LinkAppointmentsToOwnersResult>(
      `SELECT * FROM sot.link_appointments_to_owners()`
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
    const cats = await queryOne<LinkCatsToPlacesResult>(
      `SELECT * FROM sot.link_cats_to_places()`
    );
    if (cats) {
      linking.cats_linked_to_places = cats.cats_linked_home + cats.cats_linked_appointment;
      linking.cats_skipped_place_linking = cats.cats_skipped;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    linkingErrors.push({ step: 'link_cats_to_places', error: msg });
    console.error('link_cats_to_places failed (non-fatal):', err);
  }

  try {
    await saveProgress('Linking appointments to trappers...');
    const trappers = await queryOne<RunAppointmentTrapperLinkingResult>(
      `SELECT sot.run_appointment_trapper_linking() as run_appointment_trapper_linking`
    );
    if (trappers) linking.appointments_linked_to_trappers = trappers.run_appointment_trapper_linking;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    linkingErrors.push({ step: 'run_appointment_trapper_linking', error: msg });
    console.error('run_appointment_trapper_linking failed (non-fatal):', err);
  }

  try {
    // MIG_2811: Link appointments to places via owner_address or person_place chain.
    // Must run BEFORE link_cats_to_appointment_places() so inferred_place_id is populated.
    await saveProgress('Inferring appointment places...');
    const inferred = await query(`SELECT * FROM sot.link_appointments_to_places()`);
    if (inferred.rows) {
      for (const row of inferred.rows) {
        linking[`inferred_place_${row.source}`] = row.appointments_linked;
      }
      // FFS-141: Warn when both steps link 0 appointments
      if (
        (linking.inferred_place_owner_address ?? 0) === 0 &&
        (linking.inferred_place_person_place ?? 0) === 0
      ) {
        console.warn(
          'WARNING: link_appointments_to_places() linked 0 appointments in both steps. ' +
          'Verify Step 1 (owner_address) is processing correctly.'
        );
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    linkingErrors.push({ step: 'link_appointments_to_places', error: msg });
    console.error('link_appointments_to_places failed (non-fatal):', err);
  }

  try {
    // MIG_889: Link cats to places via appointment inferred_place_id
    await saveProgress('Linking cats to appointment places...');
    const appointmentPlaces = await queryOne<LinkCatsToAppointmentPlacesResult>(
      `SELECT * FROM sot.link_cats_to_appointment_places()`
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

  // FFS-141: Warn if 0 cat-place links produced
  const totalCatsLinked = (linking.cats_linked_to_places ?? 0) + (linking.cats_linked_via_appointment_places ?? 0);
  if (totalCatsLinked === 0 && linkingErrors.length === 0) {
    if (!results.entity_linking_warnings) results.entity_linking_warnings = [];
    (results.entity_linking_warnings as string[]).push(
      'Entity linking produced 0 cat-place links. Check data quality.'
    );
  }

  // Cat-to-request linking (second pass): now that entity linking has created
  // fresh cat→place relationships, link newly-placed cats to active requests.
  try {
    await saveProgress('Linking cats to requests (post entity-linking)...');
    const postLinkResult = await queryOne<LinkCatsToRequestsResult>(
      `SELECT * FROM sot.link_cats_to_requests_safe()`
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

  // MIG_2908/FFS-449: Detect unofficial trapper candidates after entity linking
  try {
    await saveProgress('Detecting unofficial trapper candidates...');
    const candidates = await queryOne<QueueUnofficialTrapperCandidatesResult>(
      `SELECT * FROM sot.queue_unofficial_trapper_candidates()`
    );
    if (candidates) {
      linking.trapper_candidates_found = candidates.candidates_found;
      linking.trapper_candidates_queued = candidates.candidates_queued;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    linkingErrors.push({ step: 'queue_unofficial_trapper_candidates', error: msg });
    console.error('queue_unofficial_trapper_candidates failed (non-fatal):', err);
  }
}

// ================================================================
// Beacon Enrichment (Phase D) — runs after entity linking
// Each step non-fatal (crons are safety net).
// ================================================================
async function runBeaconEnrichment(
  uploadId: string,
  results: Record<string, unknown>,
  saveProgress: (step?: string) => Promise<void>
) {
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
    }).catch(() => { /* fire-and-forget */ });
    results.geocoding_triggered = true;
  } catch {
    /* non-fatal: geocoding trigger failure doesn't block ingest */
  }

  // Beacon enrichment: birth events from lactating appointments
  const birthIntervalDays = await getServerConfig("beacon.birth_interval_days", 42);
  try {
    await saveProgress('Creating birth events from lactating appointments...');
    const birthResult = await query(`
      WITH lactating_mothers AS (
        SELECT DISTINCT ON (a.cat_id)
          a.appointment_id,
          a.appointment_date,
          a.cat_id,
          (
            SELECT cp.place_id
            FROM sot.cat_place cp
            WHERE cp.cat_id = a.cat_id
            ORDER BY cp.created_at DESC
            LIMIT 1
          ) as place_id
        FROM ops.appointments a
        JOIN sot.cats c ON c.cat_id = a.cat_id
        LEFT JOIN sot.cat_birth_events be ON be.mother_cat_id = a.cat_id AND be.deleted_at IS NULL
        WHERE a.is_lactating = true
          AND c.sex = 'Female'
          AND be.birth_event_id IS NULL
        ORDER BY a.cat_id, a.appointment_date DESC
        LIMIT 100
      )
      INSERT INTO sot.cat_birth_events (
        cat_id, mother_cat_id, birth_date, birth_date_precision,
        birth_year, birth_month, birth_season, place_id,
        source_system, source_record_id, reported_by, notes
      )
      SELECT
        NULL, cat_id,
        appointment_date - INTERVAL '${birthIntervalDays} days',
        'estimated',
        EXTRACT(YEAR FROM appointment_date - INTERVAL '${birthIntervalDays} days')::INT,
        EXTRACT(MONTH FROM appointment_date - INTERVAL '${birthIntervalDays} days')::INT,
        CASE
          WHEN EXTRACT(MONTH FROM appointment_date - INTERVAL '${birthIntervalDays} days') IN (3,4,5) THEN 'spring'
          WHEN EXTRACT(MONTH FROM appointment_date - INTERVAL '${birthIntervalDays} days') IN (6,7,8) THEN 'summer'
          WHEN EXTRACT(MONTH FROM appointment_date - INTERVAL '${birthIntervalDays} days') IN (9,10,11) THEN 'fall'
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

  // Beacon enrichment: mortality events from Death Type field (FFS-401)
  try {
    await saveProgress('Creating mortality events from Death Type...');
    const deathTypeResult = await query(`
      WITH death_type_appointments AS (
        SELECT DISTINCT ON (a.cat_id)
          a.appointment_id,
          a.appointment_date,
          a.cat_id,
          a.death_type,
          CASE
            WHEN LOWER(a.death_type) LIKE '%pre%' THEN 'pre_operative'
            WHEN LOWER(a.death_type) LIKE '%post%' THEN 'post_operative'
            ELSE 'unspecified'
          END AS mortality_timing
        FROM ops.appointments a
        JOIN sot.cats c ON c.cat_id = a.cat_id
        LEFT JOIN sot.cat_mortality_events me ON me.cat_id = a.cat_id AND me.deleted_at IS NULL
        WHERE a.death_type IS NOT NULL
          AND TRIM(a.death_type) != ''
          AND me.event_id IS NULL
        ORDER BY a.cat_id, a.appointment_date DESC
      )
      INSERT INTO sot.cat_mortality_events (
        cat_id, mortality_type, event_date, cause,
        mortality_timing, source_system, source_record_id, notes
      )
      SELECT
        cat_id, 'euthanasia', appointment_date, 'clinichq_death_type',
        mortality_timing, 'clinichq', appointment_id::TEXT,
        'Auto-created from ClinicHQ Death Type: ' || death_type
      FROM death_type_appointments
      ON CONFLICT (cat_id, event_date, mortality_type) DO NOTHING
    `);
    results.mortality_events_death_type = deathTypeResult.rowCount || 0;
  } catch (err) {
    console.error('Death Type mortality events failed (non-fatal):', err);
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
            WHEN LOWER(a.medical_notes) LIKE '%hit by car%' OR LOWER(a.medical_notes) LIKE '%hbc%' THEN 'trauma'
            WHEN LOWER(a.medical_notes) LIKE '%died%' THEN 'unknown'
            ELSE 'unknown'
          END AS mortality_type,
          CASE
            WHEN LOWER(a.medical_notes) LIKE '%humanely euthanized%' THEN 'euthanasia_medical_notes'
            WHEN LOWER(a.medical_notes) LIKE '%euthanasia%' THEN 'euthanasia_medical_notes'
            WHEN LOWER(a.medical_notes) LIKE '%hit by car%' OR LOWER(a.medical_notes) LIKE '%hbc%' THEN 'vehicle_collision'
            WHEN LOWER(a.medical_notes) LIKE '%died%' THEN 'died_medical_notes'
            ELSE 'unknown'
          END AS cause
        FROM ops.appointments a
        JOIN sot.cats c ON c.cat_id = a.cat_id
        LEFT JOIN sot.cat_mortality_events me ON me.cat_id = a.cat_id AND me.deleted_at IS NULL
        WHERE (
            LOWER(a.medical_notes) LIKE '%euthanized%'
            OR LOWER(a.medical_notes) LIKE '%euthanasia%'
            OR LOWER(a.medical_notes) LIKE '%died%'
            OR LOWER(a.medical_notes) LIKE '%hit by car%'
            OR LOWER(a.medical_notes) LIKE '%hbc%'
          )
          AND me.event_id IS NULL
        ORDER BY a.cat_id, a.appointment_date DESC
        LIMIT 50
      )
      INSERT INTO sot.cat_mortality_events (
        cat_id, mortality_type, event_date, cause,
        source_system, source_record_id, notes
      )
      SELECT
        cat_id, mortality_type, appointment_date, cause,
        'clinichq', appointment_id::TEXT,
        'Auto-created from clinic notes: ' || LEFT(medical_notes, 200)
      FROM death_appointments
      ON CONFLICT (cat_id, event_date, mortality_type) DO NOTHING
    `);
    results.mortality_events_created = mortalityResult.rowCount || 0;
  } catch (err) {
    console.error('Inline mortality events failed (non-fatal):', err);
  }

  // Mark ALL cats with mortality events as deceased
  try {
    const deceasedResult = await query(`
      UPDATE sot.cats c
      SET is_deceased = true, deceased_at = me.event_date::timestamptz, updated_at = NOW()
      FROM sot.cat_mortality_events me
      WHERE c.cat_id = me.cat_id
        AND me.deleted_at IS NULL
        AND (c.is_deceased IS NULL OR c.is_deceased = false)
    `);
    results.cats_marked_deceased = deceasedResult.rowCount || 0;
  } catch (err) {
    console.error('Mark cats deceased failed (non-fatal):', err);
  }

  // Disease status computation: run after test results created
  try {
    await saveProgress('Computing place disease status...');
    const diseaseResult = await query(`
      SELECT * FROM ops.run_disease_status_computation()
    `);
    if (diseaseResult.rows?.[0]) {
      results.disease_computation = diseaseResult.rows[0];
    }
  } catch (err) {
    console.error('Disease status computation failed (non-fatal):', err);
  }
}

// ================================================================
// Google Maps KMZ/KML processing (unchanged)
// ================================================================
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
      `UPDATE ops.file_uploads SET status = 'failed', error_message = $2 WHERE upload_id = $1`,
      [uploadId, "Google Maps files must be .kmz or .kml"]
    );
    return apiBadRequest("Google Maps files must be .kmz or .kml");
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
        `UPDATE ops.file_uploads SET status = 'failed', error_message = $2 WHERE upload_id = $1`,
        [uploadId, `Failed to extract KMZ: ${error instanceof Error ? error.message : "Unknown error"}`]
      );
      return apiServerError("Failed to extract KMZ file");
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
      `UPDATE ops.file_uploads SET status = 'failed', error_message = $2 WHERE upload_id = $1`,
      [uploadId, `Failed to parse KML: ${error instanceof Error ? error.message : "Unknown error"}`]
    );
    return apiServerError("Failed to parse KML file");
  }

  if (placemarks.length === 0) {
    await query(
      `UPDATE ops.file_uploads SET status = 'failed', error_message = $2 WHERE upload_id = $1`,
      [uploadId, "No placemarks found. If using a link from Google Maps, download the full KMZ export instead."]
    );
    return apiBadRequest("No placemarks found in the file. It may be a NetworkLink file - please download the full KMZ export.");
  }

  // Stage the import using the centralized pattern
  const importResult = await queryOne<{ import_id: string }>(`
    INSERT INTO ops.staged_google_maps_imports (
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
      `UPDATE ops.file_uploads SET status = 'failed', error_message = $2 WHERE upload_id = $1`,
      [uploadId, "Failed to stage import"]
    );
    return apiServerError("Failed to stage import");
  }

  // Process the import through the centralized function
  const processResult = await queryOne<{ result: { success: boolean; updated: number; inserted: number; not_matched: number; error?: string } }>(`
    SELECT ops.process_google_maps_import($1) as result
  `, [importResult.import_id]);

  if (!processResult?.result?.success) {
    await query(
      `UPDATE ops.file_uploads SET status = 'failed', error_message = $2 WHERE upload_id = $1`,
      [uploadId, processResult?.result?.error || "Processing failed"]
    );
    return apiServerError(processResult?.result?.error || "Processing failed");
  }

  // Mark file upload as completed
  await query(
    `UPDATE ops.file_uploads
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

  return apiSuccess({
    success: true,
    upload_id: uploadId,
    import_id: importResult.import_id,
    rows_total: placemarks.length,
    rows_inserted: processResult.result.inserted,
    rows_updated: processResult.result.updated,
    rows_skipped: processResult.result.not_matched,
  });
}
