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
  waiver_color: string | null;  // "blue" = foster, "white" = regular
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

const OCR_PROMPT = `Extract ALL structured data from this veterinary clinic waiver form.

MICROCHIP INSTRUCTIONS (critical — read carefully):
- PetLink microchip stickers show a 15-digit number, usually starting with 981020, 985113, or 900
- The number is ONLY digits (0-9). If you see what looks like a letter, it's a misread digit:
  O = 0, I = 1, l = 1, S = 5, B = 8, Z = 2, G = 6, T = 7, A = 4 (in digit context)
- Read each digit carefully. Spaces in the printed number are formatting, not part of the value
- There may be MULTIPLE chips: a PetLink sticker (new) AND a handwritten pre-existing chip
- Return the raw digits only, no spaces or dashes

CLINIC NUMBER (critical — common misread):
- The big clinic number is usually top-right, handwritten or stamped, 1-3 digits
- It indicates the surgery order for that day (1 = first cat, 2 = second, etc.)
- Typical range is 1-55 for a normal clinic day
- COMMON ERROR: Do NOT read this as "50" unless you are very confident — "50" is frequently a misread of other 2-digit numbers (like 5, 30, 40, 20). Look carefully at the handwriting.
- If the number is ambiguous, prefer a lower number (1-55 range) over exactly 50

OTHER FIELDS:
- Owner info, cat info, procedures, notes
- Weight in pounds (to 2 decimal places)
- Any handwritten corrections or cross-outs
- The form color/paper color (blue = foster cat, white = regular)

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
  "microchip_numbers": ["<all chip numbers visible, digits only, no spaces>"],
  "microchip_last4": "<last 4 digits or null>",
  "spay_or_neuter": "<spay or neuter or null>",
  "ear_tip": "<left/right/both/none or null>",
  "vaccines": ["<list>"],
  "felv_fiv": "<positive/negative/not_tested or null>",
  "vet_initials": "<string or null>",
  "notes": "<any handwritten notes, corrections, or cross-outs>",
  "waiver_color": "<blue or white or unknown>"
}`;

const OCR_MODEL = "claude-haiku-4-5-20251001";

// ── Chip Normalization ──────────────────────────────────────

/** Common OCR letter→digit substitutions for PetLink microchips */
const CHIP_SUBS: Record<string, string> = {
  O: "0", o: "0",
  I: "1", i: "1", l: "1",
  S: "5", s: "5",
  B: "8", b: "8",
  Z: "2", z: "2",
  G: "6", g: "6",
  T: "7", t: "7",
  A: "4", // only in digit context (PetLink is all digits)
};

/**
 * Normalize an OCR'd microchip: strip whitespace/punctuation,
 * apply common letter→digit OCR corrections.
 * Returns null if result isn't a plausible chip (< 9 digits).
 */
export function normalizeChip(raw: string): string | null {
  // Strip spaces, dashes, dots, underscores, zero-width chars
  let cleaned = raw.replace(/[\s\-._​\u200B]/g, "");

  // Apply letter→digit substitutions
  cleaned = cleaned
    .split("")
    .map((ch) => CHIP_SUBS[ch] ?? ch)
    .join("");

  // Strip any remaining non-digits
  const digitsOnly = cleaned.replace(/[^0-9]/g, "");

  // PetLink chips are 15 digits; some older chips are 9-10
  if (digitsOnly.length < 9 || digitsOnly.length > 16) return null;

  return digitsOnly;
}

// ── Composite Matching ──────────────────────────────────────

interface CandidateAppointment {
  appointment_id: string;
  cat_id: string;
  microchip: string | null;
  cat_name: string | null;
  cat_sex: string | null;
  cat_color: string | null;
  cat_breed: string | null;
  client_name: string | null;
  weight_lbs: number | null;
}

interface MatchScore {
  appointment_id: string;
  cat_id: string;
  score: number;
  signals: Record<string, number>;
  method: string;
}

/**
 * Score a waiver against a candidate appointment using ALL available signals.
 * Returns 0.0–1.0 composite score.
 */
function scoreWaiverMatch(
  ocr: WaiverOCRResult,
  candidate: CandidateAppointment,
  filenameLast4: string | null
): MatchScore {
  const signals: Record<string, number> = {};
  let totalWeight = 0;

  // 1. Chip match (0.30 weight)
  const chipWeight = 0.30;
  totalWeight += chipWeight;
  if (candidate.microchip) {
    const normalizedChips = ocr.microchip_numbers
      .map(normalizeChip)
      .filter((c): c is string => c !== null);

    if (normalizedChips.includes(candidate.microchip)) {
      signals.chip = chipWeight; // exact full match
    } else {
      const candidateLast4 = candidate.microchip.slice(-4);
      // Check OCR last4
      const ocrLast4s = normalizedChips.map((c) => c.slice(-4));
      if (ocrLast4s.includes(candidateLast4)) {
        signals.chip = chipWeight * 0.85; // last4 from OCR
      } else if (filenameLast4 && candidateLast4 === filenameLast4) {
        signals.chip = chipWeight * 0.80; // last4 from filename
      } else {
        signals.chip = 0;
      }
    }
  } else {
    signals.chip = 0;
  }

  // 2. Weight match (0.25 weight — near-unique per clinic day)
  const weightWeight = 0.25;
  totalWeight += weightWeight;
  if (ocr.weight_lbs && candidate.weight_lbs && ocr.weight_lbs > 0 && candidate.weight_lbs > 0) {
    const diff = Math.abs(ocr.weight_lbs - candidate.weight_lbs);
    if (diff < 0.1) {
      signals.weight = weightWeight; // exact match (within rounding)
    } else if (diff < 0.5) {
      signals.weight = weightWeight * 0.8; // close
    } else if (diff < 2.0) {
      signals.weight = weightWeight * 0.3; // plausible (scale variance)
    } else {
      signals.weight = 0;
    }
  } else {
    // No weight data — don't penalize, just skip this signal
    totalWeight -= weightWeight;
  }

  // 3. Sex match (0.10 weight)
  const sexWeight = 0.10;
  totalWeight += sexWeight;
  if (ocr.sex && candidate.cat_sex) {
    const ocrSex = ocr.sex.toUpperCase().charAt(0);
    const catSex = candidate.cat_sex.toUpperCase().charAt(0);
    signals.sex = ocrSex === catSex ? sexWeight : 0;
  } else {
    totalWeight -= sexWeight;
  }

  // 4. Description/color/breed match (0.15 weight)
  const descWeight = 0.15;
  totalWeight += descWeight;
  if (ocr.description && (candidate.cat_color || candidate.cat_breed)) {
    const descLower = ocr.description.toLowerCase();
    const colorMatch = candidate.cat_color && descLower.includes(candidate.cat_color.toLowerCase());
    const breedMatch = candidate.cat_breed && descLower.includes(candidate.cat_breed.toLowerCase().replace("domestic ", "d"));
    if (colorMatch && breedMatch) {
      signals.description = descWeight;
    } else if (colorMatch || breedMatch) {
      signals.description = descWeight * 0.6;
    } else {
      signals.description = 0;
    }
  } else {
    totalWeight -= descWeight;
  }

  // 5. Owner name match (0.15 weight)
  const ownerWeight = 0.15;
  totalWeight += ownerWeight;
  if (ocr.owner_last_name && candidate.client_name) {
    const ocrOwner = ocr.owner_last_name.toLowerCase();
    const clientLower = candidate.client_name.toLowerCase();
    if (clientLower.includes(ocrOwner) || ocrOwner.includes(clientLower.split(" ").pop() || "")) {
      signals.owner = ownerWeight;
    } else {
      signals.owner = 0;
    }
  } else {
    totalWeight -= ownerWeight;
  }

  // 6. Cat name match (0.05 weight)
  const nameWeight = 0.05;
  totalWeight += nameWeight;
  if (ocr.cat_name && candidate.cat_name) {
    const ocrName = ocr.cat_name.toLowerCase();
    const catName = candidate.cat_name.toLowerCase();
    if (catName.includes(ocrName) || ocrName.includes(catName)) {
      signals.cat_name = nameWeight;
    } else {
      signals.cat_name = 0;
    }
  } else {
    totalWeight -= nameWeight;
  }

  // Normalize score to 0.0-1.0 based on signals that actually had data
  const rawScore = Object.values(signals).reduce((a, b) => a + b, 0);
  const normalizedScore = totalWeight > 0 ? rawScore / totalWeight : 0;

  // Determine method label
  let method = "composite";
  if (signals.chip >= chipWeight * 0.99) method = "ocr_chip_full";
  else if (signals.chip >= chipWeight * 0.79) method = "ocr_chip_last4";

  return {
    appointment_id: candidate.appointment_id,
    cat_id: candidate.cat_id,
    score: Math.round(normalizedScore * 100) / 100,
    signals,
    method,
  };
}

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

  // Post-OCR validation: sanitize clinic_number
  let clinicNumber: number | null = parsed.clinic_number ?? null;
  if (clinicNumber !== null) {
    // Must be a positive integer in reasonable range
    if (!Number.isInteger(clinicNumber) || clinicNumber < 1 || clinicNumber > 99) {
      clinicNumber = null;
    }
  }

  return {
    clinic_number: clinicNumber,
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
    waiver_color: parsed.waiver_color ?? null,
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

  // 4. Match waiver → cat via composite scoring
  // Load ALL candidate appointments on this date, then score each
  let matchedCatId: string | null = waiver.matched_cat_id;
  let matchedApptId: string | null = waiver.matched_appointment_id;
  let matchMethod: string | null = null;
  let matchConfidence: number = 0;

  if (waiver.parsed_date) {
    // First try: deterministic chip match (normalized)
    const normalizedChips = ocrResult.microchip_numbers
      .map(normalizeChip)
      .filter((c): c is string => c !== null);

    for (const chip of normalizedChips) {
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
        matchConfidence = 1.0;
        break;
      }
    }

    // Second try: composite scoring against all candidates on this date
    if (!matchedCatId) {
      const candidates = await queryRows<CandidateAppointment>(
        `SELECT a.appointment_id, a.cat_id::text, c.microchip,
                c.name AS cat_name, c.sex AS cat_sex,
                COALESCE(c.primary_color, c.color) AS cat_color,
                c.breed AS cat_breed,
                a.client_name,
                (SELECT cv.weight_lbs FROM ops.cat_vitals cv
                 WHERE cv.cat_id = a.cat_id AND cv.weight_lbs IS NOT NULL
                   AND cv.weight_lbs < 50
                 ORDER BY cv.recorded_at DESC LIMIT 1
                ) AS weight_lbs
         FROM ops.appointments a
         JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
         WHERE a.appointment_date = $1
           AND a.merged_into_appointment_id IS NULL
           AND a.cat_id IS NOT NULL`,
        [waiver.parsed_date]
      );

      if (candidates.length > 0) {
        const scores = candidates.map((c) =>
          scoreWaiverMatch(ocrResult, c, waiver.parsed_last4_chip)
        );

        // Sort by score descending
        scores.sort((a, b) => b.score - a.score);

        const best = scores[0];
        const second = scores[1];

        // Accept if: score >= 0.60 AND (no runner-up OR clear margin)
        const margin = second ? best.score - second.score : 1.0;
        if (best.score >= 0.60 && margin >= 0.10) {
          matchedCatId = best.cat_id;
          matchedApptId = best.appointment_id;
          matchMethod = best.method;
          matchConfidence = best.score;
        }
      }
    }
  }

  // Update match
  if (matchedCatId && matchMethod) {
    const shouldUpdate =
      !waiver.matched_cat_id ||
      matchMethod === "ocr_chip_full" ||
      matchConfidence > (waiver.matched_cat_id ? 0.95 : 0);

    if (shouldUpdate) {
      await execute(
        `UPDATE ops.waiver_scans SET
           matched_cat_id = $2,
           matched_appointment_id = $3,
           match_method = $4,
           match_confidence = $5
         WHERE waiver_id = $1`,
        [waiverId, matchedCatId, matchedApptId, matchMethod, matchConfidence]
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
