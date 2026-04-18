#!/usr/bin/env npx tsx
/**
 * Waiver OCR Backfill — Process existing waivers through Claude OCR
 *
 * Part of CDS V2: Waiver OCR Ground Truth Pipeline (FFS-1287)
 *
 * Usage:
 *   npx tsx scripts/waiver-ocr-backfill.ts [--dry-run] [--limit N] [--date YYYY-MM-DD]
 *
 * Requires: DATABASE_URL, ANTHROPIC_API_KEY
 *
 * Processes all waivers with ocr_status='pending'. Most recent dates first.
 * Rate limited: 10 API calls then 1s pause.
 * Idempotent: skips already-processed waivers.
 *
 * Estimated cost: ~$0.01/waiver × 626 waivers ≈ $6.26 total
 * Estimated time: ~10-15 minutes
 */

import Anthropic from "@anthropic-ai/sdk";
import { Pool } from "pg";

// ── DB ──────────────────────────────────────────────────────

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
  max: 3,
});

async function queryRows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool.query(sql, params);
  return result.rows;
}

async function queryOne<T>(sql: string, params: unknown[] = []): Promise<T | null> {
  const result = await pool.query(sql, params);
  return result.rows[0] ?? null;
}

async function execute(sql: string, params: unknown[] = []): Promise<void> {
  await pool.query(sql, params);
}

// ── OCR ─────────────────────────────────────────────────────

const OCR_MODEL = "claude-haiku-4-5-20251001";

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

interface WaiverOCRResult {
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

async function extractOCR(pdfBase64: string, client: Anthropic): Promise<WaiverOCRResult> {
  const response = await client.messages.create({
    model: OCR_MODEL,
    max_tokens: 1024,
    messages: [{
      role: "user",
      content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
        { type: "text", text: OCR_PROMPT },
      ],
    }],
  });

  const text = response.content.find((c) => c.type === "text")?.text || "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`No JSON in response: ${text.slice(0, 200)}`);

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
    microchip_numbers: Array.isArray(parsed.microchip_numbers) ? parsed.microchip_numbers : [],
    microchip_last4: parsed.microchip_last4 ?? null,
    spay_or_neuter: parsed.spay_or_neuter ?? null,
    ear_tip: parsed.ear_tip ?? null,
    vaccines: Array.isArray(parsed.vaccines) ? parsed.vaccines : [],
    felv_fiv: parsed.felv_fiv ?? null,
    vet_initials: parsed.vet_initials ?? null,
    notes: parsed.notes ?? null,
  };
}

// ── Main ────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 0;
  const dateIdx = args.indexOf("--date");
  const dateFilter = dateIdx >= 0 ? args[dateIdx + 1] : null;

  console.log(`Waiver OCR Backfill${dryRun ? " (DRY RUN)" : ""}`);
  console.log(`  Limit: ${limit || "none"}`);
  console.log(`  Date filter: ${dateFilter || "all"}`);
  console.log("");

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Missing ANTHROPIC_API_KEY");
    process.exit(1);
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Load pending waivers (most recent dates first)
  let sql = `
    SELECT ws.waiver_id, ws.file_upload_id, ws.parsed_date::text AS parsed_date,
           ws.parsed_last4_chip, ws.parsed_last_name,
           fu.original_filename
    FROM ops.waiver_scans ws
    JOIN ops.file_uploads fu ON fu.upload_id = ws.file_upload_id
    WHERE ws.ocr_status = 'pending'
  `;
  const params: unknown[] = [];

  if (dateFilter) {
    params.push(dateFilter);
    sql += ` AND ws.parsed_date = $${params.length}`;
  }

  sql += ` ORDER BY ws.parsed_date DESC NULLS LAST, ws.created_at`;

  if (limit > 0) {
    params.push(limit);
    sql += ` LIMIT $${params.length}`;
  }

  const waivers = await queryRows<{
    waiver_id: string;
    file_upload_id: string;
    parsed_date: string | null;
    parsed_last4_chip: string | null;
    parsed_last_name: string | null;
    original_filename: string;
  }>(sql, params);

  console.log(`Found ${waivers.length} pending waivers`);
  if (waivers.length === 0) {
    await pool.end();
    return;
  }

  const stats = {
    processed: 0,
    extracted: 0,
    matched_cat: 0,
    matched_appt: 0,
    cdn_set: 0,
    errors: 0,
    skipped: 0,
  };

  let apiCalls = 0;

  for (let i = 0; i < waivers.length; i++) {
    const w = waivers[i];
    const progress = `[${i + 1}/${waivers.length}]`;

    if (dryRun) {
      console.log(`${progress} Would process: ${w.original_filename} (${w.parsed_date})`);
      stats.skipped++;
      continue;
    }

    try {
      // Load PDF content
      const upload = await queryOne<{ file_content: Buffer }>(
        `SELECT file_content FROM ops.file_uploads WHERE upload_id = $1`,
        [w.file_upload_id]
      );

      if (!upload?.file_content) {
        console.log(`${progress} SKIP: No file content for ${w.original_filename}`);
        await execute(
          `UPDATE ops.waiver_scans SET ocr_status = 'failed', ocr_error = 'No file content' WHERE waiver_id = $1`,
          [w.waiver_id]
        );
        stats.errors++;
        continue;
      }

      // Mark as extracting
      await execute(
        `UPDATE ops.waiver_scans SET ocr_status = 'extracting' WHERE waiver_id = $1`,
        [w.waiver_id]
      );

      // OCR extract
      const pdfBase64 = Buffer.from(upload.file_content).toString("base64");
      const ocr = await extractOCR(pdfBase64, client);
      apiCalls++;
      stats.extracted++;

      // Pick primary chip
      const primaryChip =
        ocr.microchip_numbers
          .filter((c) => c && c.length >= 9)
          .sort((a, b) => b.length - a.length)[0] || null;
      const chipLast4 = primaryChip ? primaryChip.slice(-4) : ocr.microchip_last4;

      // Store OCR results
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
          w.waiver_id,
          JSON.stringify(ocr),
          ocr.clinic_number,
          primaryChip,
          chipLast4,
          ocr.cat_name,
          ocr.owner_last_name,
          ocr.sex,
          ocr.weight_lbs,
          ocr.date,
          OCR_MODEL,
        ]
      );

      // Match cat via full chip
      let matchedCatId: string | null = null;
      let matchedApptId: string | null = null;
      let matchMethod: string | null = null;

      const chipsToTry = ocr.microchip_numbers.filter((c) => c && c.length >= 9);
      for (const chip of chipsToTry) {
        const catMatch = await queryOne<{ cat_id: string; appointment_id: string | null }>(
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
          [chip, w.parsed_date]
        );
        if (catMatch) {
          matchedCatId = catMatch.cat_id;
          matchedApptId = catMatch.appointment_id;
          matchMethod = "ocr_chip_full";
          break;
        }
      }

      // Fallback: last4 + date
      if (!matchedCatId && chipLast4 && w.parsed_date) {
        const last4Match = await queryOne<{ cat_id: string; appointment_id: string }>(
          `SELECT a.cat_id, a.appointment_id
           FROM ops.appointments a
           JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
           WHERE c.microchip IS NOT NULL
             AND RIGHT(c.microchip, 4) = $1
             AND a.appointment_date = $2
             AND a.merged_into_appointment_id IS NULL
           ORDER BY a.created_at DESC LIMIT 1`,
          [chipLast4, w.parsed_date]
        );
        if (last4Match) {
          matchedCatId = last4Match.cat_id;
          matchedApptId = last4Match.appointment_id;
          matchMethod = "ocr_chip_last4";
        }
      }

      if (matchedCatId && matchMethod) {
        stats.matched_cat++;
        await execute(
          `UPDATE ops.waiver_scans SET
             matched_cat_id = $2,
             matched_appointment_id = $3,
             match_method = $4,
             match_confidence = CASE WHEN $4 = 'ocr_chip_full' THEN 1.00 ELSE 0.95 END
           WHERE waiver_id = $1`,
          [w.waiver_id, matchedCatId, matchedApptId, matchMethod]
        );
      }

      if (matchedApptId) {
        stats.matched_appt++;

        // Bridge CDN
        if (ocr.clinic_number) {
          const cdnResult = await queryOne<{ set_clinic_day_number: boolean }>(
            `SELECT ops.set_clinic_day_number(
               $1::UUID, $2::INTEGER,
               'waiver_ocr'::ops.clinic_day_number_source, NULL
             )`,
            [matchedApptId, ocr.clinic_number]
          );
          if (cdnResult?.set_clinic_day_number) {
            stats.cdn_set++;
          }
        }

        // Set waiver_scan_id on appointment
        await execute(
          `UPDATE ops.appointments SET waiver_scan_id = $2
           WHERE appointment_id = $1 AND waiver_scan_id IS NULL`,
          [matchedApptId, w.waiver_id]
        );
      }

      stats.processed++;

      const cdnInfo = ocr.clinic_number ? ` CDN=${ocr.clinic_number}` : "";
      const chipInfo = primaryChip ? ` chip=${primaryChip}` : "";
      const matchInfo = matchMethod ? ` → ${matchMethod}` : " (no match)";
      console.log(`${progress} ${w.original_filename}:${chipInfo}${cdnInfo}${matchInfo}`);

      // Rate limit: pause every 10 calls
      if (apiCalls % 10 === 0) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`${progress} ERROR: ${w.original_filename}: ${errMsg}`);
      await execute(
        `UPDATE ops.waiver_scans SET ocr_status = 'failed', ocr_error = $2 WHERE waiver_id = $1`,
        [w.waiver_id, errMsg.slice(0, 1000)]
      );
      stats.errors++;
    }
  }

  console.log("\n=== Summary ===");
  console.log(`  Processed:    ${stats.processed}/${waivers.length}`);
  console.log(`  Extracted:    ${stats.extracted}`);
  console.log(`  Matched cat:  ${stats.matched_cat}`);
  console.log(`  Matched appt: ${stats.matched_appt}`);
  console.log(`  CDN set:      ${stats.cdn_set}`);
  console.log(`  Errors:       ${stats.errors}`);
  if (dryRun) console.log(`  Skipped (dry): ${stats.skipped}`);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
