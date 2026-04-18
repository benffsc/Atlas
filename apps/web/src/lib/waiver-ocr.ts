/**
 * Waiver OCR Extraction + Matching Library
 *
 * Extracts structured data from FFSC waiver PDFs using Claude vision,
 * then matches to cats and bridges clinic day numbers.
 *
 * Part of CDS V2: Waiver OCR Ground Truth Pipeline (FFS-1287)
 *
 * Key insight: waivers are irrefutable proof — microchip Z on cat X has
 * clinic number Y. Clinic number Y = master list line Y. Therefore
 * ML line Y = cat with chip Z. This is deterministic.
 */

import Anthropic from "@anthropic-ai/sdk";
import { queryOne, queryRows, execute } from "@/lib/db";

// ── Types ────────────────────────────────────────────────────

export interface WaiverOCRResult {
  clinic_number: number | null;
  date: string | null;
  owner_last_name: string | null;
  owner_first_name: string | null;
  cat_name: string | null;
  description: string | null;
  sex: string | null;
  weight_lbs: number | null;
  microchip_numbers: string[];
  microchip_last4: string | null;
  spay_or_neuter: string | null;
  ear_tip: string | null;
  vaccines: string[];
  felv_fiv: string | null;
  vet_initials: string | null;
  notes: string | null;
}

export interface ProcessResult {
  success: boolean;
  waiver_id: string;
  ocr_result: WaiverOCRResult | null;
  matched_cat_id: string | null;
  matched_appointment_id: string | null;
  cdn_set: boolean;
  error?: string;
}

// ── OCR Prompt ──────────────────────────────────────────────

const OCR_PROMPT = `Extract ALL structured data from this veterinary clinic waiver form. Look for:
- The big clinic number (usually top-right, handwritten or stamped)
- ALL microchip numbers (PetLink stickers, handwritten, printed - could be multiple)
- Owner info, cat info, procedures, notes
- Any handwritten corrections or cross-outs

Return ONLY valid JSON:
{
  "clinic_number": <integer or null>,
  "date": "<date as written>",
  "owner_last_name": "<string or null>",
  "owner_first_name": "<string or null>",
  "cat_name": "<string or null>",
  "description": "<breed/color or null>",
  "sex": "<M or F or null>",
  "weight_lbs": <number or null>,
  "microchip_numbers": ["<all chip numbers visible>"],
  "microchip_last4": "<last 4 digits or null>",
  "spay_or_neuter": "<spay or neuter or null>",
  "ear_tip": "<left/right/both/none or null>",
  "vaccines": ["<list>"],
  "felv_fiv": "<positive/negative/not_tested or null>",
  "vet_initials": "<string or null>",
  "notes": "<any handwritten notes, corrections, or cross-outs>"
}`;

const OCR_MODEL = "claude-haiku-4-5-20251001";

// ── Core Functions ──────────────────────────────────────────

/**
 * Extract structured data from a waiver PDF using Claude vision.
 */
export async function extractWaiverOCR(
  pdfBase64: string,
  client: Anthropic
): Promise<WaiverOCRResult> {
  const response = await client.messages.create({
    model: OCR_MODEL,
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: pdfBase64,
            },
          },
          { type: "text", text: OCR_PROMPT },
        ],
      },
    ],
  });

  const text =
    response.content.find((c) => c.type === "text")?.text || "";

  // Parse JSON from response (may be wrapped in markdown code block)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`No JSON in OCR response: ${text.slice(0, 200)}`);
  }

  const parsed = JSON.parse(jsonMatch[0]);

  return {
    clinic_number: parsed.clinic_number ?? null,
    date: parsed.date ?? null,
    owner_last_name: parsed.owner_last_name ?? null,
    owner_first_name: parsed.owner_first_name ?? null,
    cat_name: parsed.cat_name ?? null,
    description: parsed.description ?? null,
    sex: parsed.sex ?? null,
    weight_lbs: parsed.weight_lbs ?? null,
    microchip_numbers: Array.isArray(parsed.microchip_numbers)
      ? parsed.microchip_numbers
      : [],
    microchip_last4: parsed.microchip_last4 ?? null,
    spay_or_neuter: parsed.spay_or_neuter ?? null,
    ear_tip: parsed.ear_tip ?? null,
    vaccines: Array.isArray(parsed.vaccines) ? parsed.vaccines : [],
    felv_fiv: parsed.felv_fiv ?? null,
    vet_initials: parsed.vet_initials ?? null,
    notes: parsed.notes ?? null,
  };
}

/**
 * Process a single waiver: OCR extract → match cat → bridge CDN.
 *
 * Idempotent: skips waivers already processed (ocr_status != 'pending').
 */
export async function processWaiverOCR(
  waiverId: string,
  client: Anthropic,
  log?: (msg: string) => void
): Promise<ProcessResult> {
  const _log = log ?? console.log;

  // 1. Load waiver + file content
  const waiver = await queryOne<{
    waiver_id: string;
    file_upload_id: string;
    parsed_date: string | null;
    parsed_last4_chip: string | null;
    parsed_last_name: string | null;
    ocr_status: string;
    matched_cat_id: string | null;
    matched_appointment_id: string | null;
  }>(
    `SELECT ws.waiver_id, ws.file_upload_id, ws.parsed_date::text,
            ws.parsed_last4_chip, ws.parsed_last_name, ws.ocr_status,
            ws.matched_cat_id, ws.matched_appointment_id
     FROM ops.waiver_scans ws
     WHERE ws.waiver_id = $1`,
    [waiverId]
  );

  if (!waiver) {
    return {
      success: false,
      waiver_id: waiverId,
      ocr_result: null,
      matched_cat_id: null,
      matched_appointment_id: null,
      cdn_set: false,
      error: "Waiver not found",
    };
  }

  // Skip if already processed
  if (waiver.ocr_status === "extracted") {
    _log(`  [${waiverId}] already extracted, skipping`);
    return {
      success: true,
      waiver_id: waiverId,
      ocr_result: null,
      matched_cat_id: waiver.matched_cat_id,
      matched_appointment_id: waiver.matched_appointment_id,
      cdn_set: false,
    };
  }

  // Load PDF content
  const upload = await queryOne<{ file_content: Buffer }>(
    `SELECT file_content FROM ops.file_uploads WHERE upload_id = $1`,
    [waiver.file_upload_id]
  );

  if (!upload?.file_content) {
    await execute(
      `UPDATE ops.waiver_scans SET ocr_status = 'failed', ocr_error = 'No file content' WHERE waiver_id = $1`,
      [waiverId]
    );
    return {
      success: false,
      waiver_id: waiverId,
      ocr_result: null,
      matched_cat_id: null,
      matched_appointment_id: null,
      cdn_set: false,
      error: "No file content",
    };
  }

  // 2. Run OCR extraction
  let ocrResult: WaiverOCRResult;
  try {
    await execute(
      `UPDATE ops.waiver_scans SET ocr_status = 'extracting' WHERE waiver_id = $1`,
      [waiverId]
    );

    const pdfBase64 = Buffer.from(upload.file_content).toString("base64");
    ocrResult = await extractWaiverOCR(pdfBase64, client);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    _log(`  [${waiverId}] OCR failed: ${errMsg}`);
    await execute(
      `UPDATE ops.waiver_scans SET ocr_status = 'failed', ocr_error = $2 WHERE waiver_id = $1`,
      [waiverId, errMsg.slice(0, 1000)]
    );
    return {
      success: false,
      waiver_id: waiverId,
      ocr_result: null,
      matched_cat_id: null,
      matched_appointment_id: null,
      cdn_set: false,
      error: errMsg,
    };
  }

  // 3. Store full OCR result + denormalized fields
  // Pick the primary chip: prefer the longest (full 15-digit) chip
  const primaryChip =
    ocrResult.microchip_numbers
      .filter((c) => c && c.length >= 9)
      .sort((a, b) => b.length - a.length)[0] || null;

  const chipLast4 = primaryChip ? primaryChip.slice(-4) : ocrResult.microchip_last4;

  await execute(
    `UPDATE ops.waiver_scans SET
       ocr_status = 'extracted',
       ocr_extracted_data = $2,
       ocr_clinic_number = $3,
       ocr_microchip = $4,
       ocr_microchip_last4 = $5,
       ocr_cat_name = $6,
       ocr_owner_last_name = $7,
       ocr_sex = $8,
       ocr_weight_lbs = $9,
       ocr_date = $10,
       ocr_processed_at = NOW(),
       ocr_model = $11,
       ocr_error = NULL
     WHERE waiver_id = $1`,
    [
      waiverId,
      JSON.stringify(ocrResult),
      ocrResult.clinic_number,
      primaryChip,
      chipLast4,
      ocrResult.cat_name,
      ocrResult.owner_last_name,
      ocrResult.sex,
      ocrResult.weight_lbs,
      ocrResult.date,
      OCR_MODEL,
    ]
  );

  // 4. Match waiver → cat via full chip
  let matchedCatId: string | null = waiver.matched_cat_id;
  let matchedApptId: string | null = waiver.matched_appointment_id;
  let matchMethod: string | null = null;

  // Try each OCR chip (full match first)
  const chipsToTry = ocrResult.microchip_numbers.filter(
    (c) => c && c.length >= 9
  );

  for (const chip of chipsToTry) {
    const catMatch = await queryOne<{
      cat_id: string;
      appointment_id: string | null;
    }>(
      `SELECT ci.cat_id,
              (SELECT a.appointment_id
               FROM ops.appointments a
               WHERE a.cat_id = ci.cat_id
                 AND a.appointment_date = $2
                 AND a.merged_into_appointment_id IS NULL
               ORDER BY a.created_at DESC LIMIT 1
              ) AS appointment_id
       FROM sot.cat_identifiers ci
       JOIN sot.cats c ON c.cat_id = ci.cat_id AND c.merged_into_cat_id IS NULL
       WHERE ci.id_type = 'microchip' AND ci.id_value = $1
       LIMIT 1`,
      [chip, waiver.parsed_date]
    );

    if (catMatch) {
      matchedCatId = catMatch.cat_id;
      matchedApptId = catMatch.appointment_id;
      matchMethod = "ocr_chip_full";
      break;
    }
  }

  // Fallback: last4 + date (same logic as filename matching but from OCR)
  if (!matchedCatId && chipLast4 && waiver.parsed_date) {
    const last4Match = await queryOne<{
      cat_id: string;
      appointment_id: string;
    }>(
      `SELECT a.cat_id, a.appointment_id
       FROM ops.appointments a
       JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
       WHERE c.microchip IS NOT NULL
         AND RIGHT(c.microchip, 4) = $1
         AND a.appointment_date = $2
         AND a.merged_into_appointment_id IS NULL
       ORDER BY a.created_at DESC LIMIT 1`,
      [chipLast4, waiver.parsed_date]
    );

    if (last4Match) {
      matchedCatId = last4Match.cat_id;
      matchedApptId = last4Match.appointment_id;
      matchMethod = "ocr_chip_last4";
    }
  }

  // Update match if OCR found a better one (full chip > last4 from filename)
  if (matchedCatId && matchMethod) {
    const shouldUpdate =
      !waiver.matched_cat_id ||
      matchMethod === "ocr_chip_full";

    if (shouldUpdate) {
      await execute(
        `UPDATE ops.waiver_scans SET
           matched_cat_id = $2,
           matched_appointment_id = $3,
           match_method = $4,
           match_confidence = CASE WHEN $4 = 'ocr_chip_full' THEN 1.00 ELSE 0.95 END
         WHERE waiver_id = $1`,
        [waiverId, matchedCatId, matchedApptId, matchMethod]
      );
    }
  }

  // 5. Bridge CDN: waiver clinic_number → appointment
  let cdnSet = false;
  if (ocrResult.clinic_number && matchedApptId) {
    const result = await queryOne<{ set_clinic_day_number: boolean }>(
      `SELECT ops.set_clinic_day_number(
         $1::UUID,
         $2::INTEGER,
         'waiver_ocr'::ops.clinic_day_number_source,
         NULL
       )`,
      [matchedApptId, ocrResult.clinic_number]
    );
    cdnSet = result?.set_clinic_day_number ?? false;

    if (cdnSet) {
      _log(
        `  [${waiverId}] CDN ${ocrResult.clinic_number} → appointment ${matchedApptId}`
      );
    }
  }

  // 6. Set appointment.waiver_scan_id (FK from MIG_3040)
  if (matchedApptId) {
    await execute(
      `UPDATE ops.appointments SET waiver_scan_id = $2
       WHERE appointment_id = $1 AND waiver_scan_id IS NULL`,
      [matchedApptId, waiverId]
    );
  }

  return {
    success: true,
    waiver_id: waiverId,
    ocr_result: ocrResult,
    matched_cat_id: matchedCatId,
    matched_appointment_id: matchedApptId,
    cdn_set: cdnSet,
  };
}

/**
 * Process all pending waivers for a specific date.
 * Returns count of waivers processed.
 */
export async function processWaiversForDate(
  clinicDate: string,
  client: Anthropic,
  log?: (msg: string) => void
): Promise<{ processed: number; matched: number; cdnSet: number; errors: number }> {
  const _log = log ?? console.log;

  const pending = await queryRows<{ waiver_id: string }>(
    `SELECT waiver_id FROM ops.waiver_scans
     WHERE parsed_date = $1
       AND ocr_status = 'pending'
     ORDER BY created_at`,
    [clinicDate]
  );

  if (pending.length === 0) return { processed: 0, matched: 0, cdnSet: 0, errors: 0 };

  _log(`Processing ${pending.length} waivers for ${clinicDate}`);

  let processed = 0;
  let matched = 0;
  let cdnSet = 0;
  let errors = 0;

  for (let i = 0; i < pending.length; i++) {
    const result = await processWaiverOCR(pending[i].waiver_id, client, _log);

    if (result.success) {
      processed++;
      if (result.matched_cat_id) matched++;
      if (result.cdn_set) cdnSet++;
    } else {
      errors++;
    }

    // Rate limit: pause every 10 calls
    if ((i + 1) % 10 === 0) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  return { processed, matched, cdnSet, errors };
}
