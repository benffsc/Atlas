import { NextRequest } from "next/server";
import { query, queryOne } from "@/lib/db";
import { apiSuccess, apiBadRequest, apiServerError, apiNotFound } from "@/lib/api-response";
import { requireValidUUID } from "@/lib/api-validation";
import { parseWaiverFilename } from "@/lib/waiver-filename-parser";

/**
 * POST /api/ingest/process-waiver
 *
 * Processes uploaded waiver PDFs:
 * 1. Parses filename to extract lastName, description, last4Chip, date
 * 2. Matches to existing appointment via last4 chip + date
 * 3. Creates ops.waiver_scans record with match result
 *
 * Body: { upload_id: string } or { upload_ids: string[] }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const uploadIds: string[] = body.upload_ids || (body.upload_id ? [body.upload_id] : []);

    if (uploadIds.length === 0) {
      return apiBadRequest("upload_id or upload_ids is required");
    }

    const results: ProcessResult[] = [];

    for (const uploadId of uploadIds) {
      requireValidUUID(uploadId, "upload");
      const result = await processOneWaiver(uploadId);
      results.push(result);
    }

    const matched = results.filter((r) => r.matched).length;
    const parsed = results.filter((r) => r.parsed).length;
    const errors = results.filter((r) => r.error).length;

    return apiSuccess({
      total: results.length,
      parsed,
      matched,
      errors,
      results,
    });
  } catch (error) {
    console.error("[PROCESS-WAIVER] Error:", error);
    return apiServerError(
      error instanceof Error ? error.message : "Processing failed"
    );
  }
}

interface ProcessResult {
  upload_id: string;
  waiver_id: string | null;
  filename: string;
  parsed: boolean;
  matched: boolean;
  error?: string;
  parsed_data?: {
    lastName: string;
    description: string;
    last4Chip: string;
    date: string;
  };
  match_data?: {
    appointment_id: string;
    cat_id: string | null;
    cat_name: string | null;
    microchip: string | null;
    client_name: string | null;
    appointment_date: string;
    match_method: string;
    confidence: number;
  };
}

async function processOneWaiver(uploadId: string): Promise<ProcessResult> {
  // 1. Fetch the upload record
  const upload = await queryOne<{
    upload_id: string;
    original_filename: string;
    status: string;
    source_system: string;
  }>(
    `SELECT upload_id, original_filename, status, source_system
     FROM ops.file_uploads
     WHERE upload_id = $1`,
    [uploadId]
  );

  if (!upload) {
    return {
      upload_id: uploadId,
      waiver_id: null,
      filename: "",
      parsed: false,
      matched: false,
      error: "Upload not found",
    };
  }

  const filename = upload.original_filename;

  // Check for existing waiver_scan for this upload
  const existing = await queryOne<{ waiver_id: string }>(
    `SELECT waiver_id FROM ops.waiver_scans WHERE file_upload_id = $1`,
    [uploadId]
  );
  if (existing) {
    return {
      upload_id: uploadId,
      waiver_id: existing.waiver_id,
      filename,
      parsed: false,
      matched: false,
      error: "Waiver already processed",
    };
  }

  // 2. Parse the filename
  const parseResult = parseWaiverFilename(filename);

  if (!parseResult.success) {
    // Create waiver_scan record with parse failure
    const waiver = await queryOne<{ waiver_id: string }>(
      `INSERT INTO ops.waiver_scans (file_upload_id, ocr_status, review_status, enrichment_status)
       VALUES ($1, 'pending', 'pending', 'pending')
       RETURNING waiver_id`,
      [uploadId]
    );

    // Mark file upload as processed
    await query(
      `UPDATE ops.file_uploads SET status = 'completed' WHERE upload_id = $1`,
      [uploadId]
    );

    return {
      upload_id: uploadId,
      waiver_id: waiver?.waiver_id || null,
      filename,
      parsed: false,
      matched: false,
      error: parseResult.error,
    };
  }

  const { lastName, description, last4Chip, date } = parseResult.data;

  // 3. Match to appointment via last4 chip + date
  // Look for appointments where the cat's microchip ends with these 4 digits
  // AND the appointment date matches
  const matchResult = await queryOne<{
    appointment_id: string;
    cat_id: string | null;
    cat_name: string | null;
    microchip: string | null;
    client_name: string | null;
    appointment_date: string;
  }>(
    `SELECT
       a.appointment_id,
       a.cat_id,
       c.name AS cat_name,
       c.microchip,
       a.client_name,
       a.appointment_date::text
     FROM ops.appointments a
     LEFT JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
     WHERE c.microchip IS NOT NULL
       AND RIGHT(c.microchip, 4) = $1
       AND a.appointment_date = $2
     ORDER BY a.created_at DESC
     LIMIT 1`,
    [last4Chip, date]
  );

  const matched = !!matchResult;
  let matchMethod: string | null = null;
  let matchConfidence = 0;

  if (matched) {
    matchMethod = "chip_date";
    // High confidence: exact chip suffix + exact date
    matchConfidence = 0.95;

    // Bonus: check if last name matches client name
    if (matchResult.client_name) {
      const clientLower = matchResult.client_name.toLowerCase();
      if (clientLower.includes(lastName.toLowerCase())) {
        matchConfidence = 1.0;
      }
    }
  }

  // 4. Create waiver_scan record
  const waiver = await queryOne<{ waiver_id: string }>(
    `INSERT INTO ops.waiver_scans (
       file_upload_id,
       parsed_last_name, parsed_description, parsed_last4_chip, parsed_date,
       matched_appointment_id, matched_cat_id, match_method, match_confidence,
       ocr_status, review_status, enrichment_status
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', 'pending', 'pending')
     RETURNING waiver_id`,
    [
      uploadId,
      lastName,
      description,
      last4Chip,
      date,
      matchResult?.appointment_id || null,
      matchResult?.cat_id || null,
      matchMethod,
      matchConfidence > 0 ? matchConfidence : null,
    ]
  );

  // Mark file upload as completed
  await query(
    `UPDATE ops.file_uploads SET status = 'completed' WHERE upload_id = $1`,
    [uploadId]
  );

  const result: ProcessResult = {
    upload_id: uploadId,
    waiver_id: waiver?.waiver_id || null,
    filename,
    parsed: true,
    matched,
    parsed_data: { lastName, description, last4Chip, date },
  };

  if (matched && matchResult) {
    result.match_data = {
      appointment_id: matchResult.appointment_id,
      cat_id: matchResult.cat_id,
      cat_name: matchResult.cat_name,
      microchip: matchResult.microchip,
      client_name: matchResult.client_name,
      appointment_date: matchResult.appointment_date,
      match_method: matchMethod!,
      confidence: matchConfidence,
    };
  }

  return result;
}

export const maxDuration = 60;
