#!/usr/bin/env npx tsx
/**
 * Waiver CDN + Weight Extraction — Extract clinic number AND weight from waivers
 *
 * Sends waiver PDF to Claude Haiku, asks for clinic day number and weight.
 * For waivers already matched to cats (have chip) but missing clinic_number.
 *
 * Lessons learned (FFS-1319, 2026-04-20):
 * - Haiku reads "50" for various numbers ~5% of the time
 * - The BIGGEST handwritten number in top-right is the clinic number
 * - Weight is printed on the form (from scale) — much more reliable than CDN
 * - CDN must be validated: reject > entry count for that date
 * - Weight serves as cross-reference: if weight matches cat_vitals, the CDN is for that cat
 *
 * Usage:
 *   npx tsx scripts/waiver-cdn-extract.ts [--dry-run] [--limit N] [--year YYYY]
 *
 * Cost: ~$0.001/waiver (~$4 for 4,091 2025 waivers)
 */

import Anthropic from "@anthropic-ai/sdk";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost") ? false : { rejectUnauthorized: false },
  max: 3,
});

async function queryOne<T>(sql: string, params: unknown[] = []): Promise<T | null> {
  return (await pool.query(sql, params)).rows[0] ?? null;
}
async function queryRows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query(sql, params)).rows;
}
async function execute(sql: string, params: unknown[] = []): Promise<void> {
  await pool.query(sql, params);
}

const EXTRACT_PROMPT = `This is an FFSC Spay/Neuter Waiver form. Extract TWO values:

1. CLINIC DAY NUMBER
   WHERE: Top-right corner. It's the BIGGEST handwritten number on the page, often circled or in an open area.
   WHAT: A sequential number (1 through ~60) assigned to each cat that day.
   NOT: trap number (smaller printed field), appointment number (format "26-1234"), phone number, zip code, or microchip (15 digits).
   RANGE: Almost always 1–60. If you see a number above 60, you're reading the wrong field — return null.

2. WEIGHT
   WHERE: The "Weight" field on the form. Usually printed/typed, sometimes handwritten.
   WHAT: Cat's weight in pounds (lbs), typically 3.0 to 20.0 for cats.
   FORMAT: May show "lbs" or just a number with 1-2 decimals.

Return ONLY valid JSON: {"clinic_number": <integer 1-60 or null>, "weight_lbs": <number or null>}`;

// Cache entry counts per date to validate CDNs
const entryCountCache = new Map<string, number>();

async function getEntryCount(date: string): Promise<number> {
  if (entryCountCache.has(date)) return entryCountCache.get(date)!;
  const r = await queryOne<{ cnt: number }>(
    `SELECT COUNT(*)::int AS cnt FROM ops.clinic_day_entries e
     JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
     WHERE cd.clinic_date = $1::date`, [date]
  );
  const cnt = r?.cnt ?? 60;
  entryCountCache.set(date, cnt);
  return cnt;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 0;
  const yearIdx = args.indexOf("--year");
  const yearFilter = yearIdx >= 0 ? parseInt(args[yearIdx + 1]) : 0;

  console.log(`Waiver CDN + Weight Extract${dryRun ? " (DRY RUN)" : ""}`);
  console.log(`Year: ${yearFilter || "all"}, Limit: ${limit || "none"}`);
  if (!process.env.ANTHROPIC_API_KEY) { console.error("Missing ANTHROPIC_API_KEY"); process.exit(1); }
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Find waivers needing extraction (missing CDN OR missing weight)
  let sql = `
    SELECT ws.waiver_id, ws.file_upload_id, ws.parsed_date::text AS parsed_date,
           ws.matched_cat_id::text, fu.original_filename
    FROM ops.waiver_scans ws
    JOIN ops.file_uploads fu ON fu.upload_id = ws.file_upload_id
    WHERE ws.matched_cat_id IS NOT NULL
      AND (ws.ocr_clinic_number IS NULL OR ws.ocr_weight_lbs IS NULL)
  `;
  const params: unknown[] = [];
  if (yearFilter) {
    params.push(yearFilter);
    sql += ` AND EXTRACT(YEAR FROM ws.parsed_date) = $${params.length}`;
  }
  sql += ` ORDER BY ws.parsed_date DESC`;
  if (limit > 0) {
    params.push(limit);
    sql += ` LIMIT $${params.length}`;
  }

  const waivers = await queryRows<{
    waiver_id: string; file_upload_id: string; parsed_date: string;
    matched_cat_id: string; original_filename: string;
  }>(sql, params);

  console.log(`Found ${waivers.length} waivers needing extraction`);
  if (waivers.length === 0) { await pool.end(); return; }

  let cdnExtracted = 0, weightExtracted = 0, cdnRejected = 0, errors = 0, apiCalls = 0;

  for (let i = 0; i < waivers.length; i++) {
    const w = waivers[i];
    if (dryRun) { continue; }

    try {
      const upload = await queryOne<{ file_content: Buffer }>(
        `SELECT file_content FROM ops.file_uploads WHERE upload_id = $1`, [w.file_upload_id]
      );
      if (!upload?.file_content) { errors++; continue; }

      apiCalls++;
      const pdfBase64 = Buffer.from(upload.file_content).toString("base64");
      const response = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 100,
        messages: [{
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
            { type: "text", text: EXTRACT_PROMPT },
          ],
        }],
      });

      const text = response.content.find(c => c.type === "text")?.text || "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) { errors++; continue; }

      const parsed = JSON.parse(jsonMatch[0]);
      let cdn = parsed.clinic_number;
      const weight = parsed.weight_lbs;

      // Validate CDN against entry count for this date
      if (cdn != null && typeof cdn === "number") {
        const maxEntries = await getEntryCount(w.parsed_date);
        if (cdn <= 0 || cdn > Math.max(maxEntries, 60)) {
          cdnRejected++;
          cdn = null; // reject impossible CDN
        }
      }

      // Build update
      const updates: string[] = [];
      const updateParams: unknown[] = [w.waiver_id];

      if (cdn != null && typeof cdn === "number" && cdn > 0) {
        updateParams.push(cdn);
        updates.push(`ocr_clinic_number = $${updateParams.length}`);
        cdnExtracted++;
      }
      if (weight != null && typeof weight === "number" && weight > 0 && weight < 50) {
        updateParams.push(weight);
        updates.push(`ocr_weight_lbs = $${updateParams.length}`);
        weightExtracted++;
      }

      if (updates.length > 0) {
        updates.push(`ocr_status = 'extracted'`);
        updates.push(`ocr_processed_at = NOW()`);
        updates.push(`ocr_model = 'claude-haiku-4-5-20251001'`);

        await execute(
          `UPDATE ops.waiver_scans SET ${updates.join(", ")} WHERE waiver_id = $1`,
          updateParams
        );

        // Bridge CDN to appointment (find appointment for this cat on this date)
        if (cdn != null) {
          const appt = await queryOne<{ appointment_id: string }>(
            `SELECT a.appointment_id::text FROM ops.appointments a
             WHERE a.cat_id = $1::UUID AND a.appointment_date = $2::date
               AND a.merged_into_appointment_id IS NULL
             LIMIT 1`,
            [w.matched_cat_id, w.parsed_date]
          );
          if (appt) {
            await queryOne(
              `SELECT ops.set_clinic_day_number($1::UUID, $2::INTEGER, 'waiver_ocr'::ops.clinic_day_number_source, NULL)`,
              [appt.appointment_id, cdn]
            ).catch(() => {});
          }
        }
      }

      if ((i + 1) % 100 === 0) {
        console.log(`  [${i + 1}/${waivers.length}] CDN: ${cdnExtracted}, Weight: ${weightExtracted}, Rejected: ${cdnRejected}, Errors: ${errors}`);
      }

      // Rate limit: pause every 10 calls
      if (apiCalls % 10 === 0) await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      errors++;
      if (String(err).includes("credit balance") || String(err).includes("insufficient")) {
        console.error("API credits exhausted, stopping.");
        break;
      }
      if (String(err).includes("rate_limit") || String(err).includes("429")) {
        console.log("  Rate limited, waiting 30s...");
        await new Promise(r => setTimeout(r, 30000));
        i--; // retry
        continue;
      }
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`  Processed: ${apiCalls}`);
  console.log(`  CDNs extracted: ${cdnExtracted}`);
  console.log(`  Weights extracted: ${weightExtracted}`);
  console.log(`  CDNs rejected (out of range): ${cdnRejected}`);
  console.log(`  Errors: ${errors}`);
  console.log(`  Cost: ~$${(apiCalls * 0.001).toFixed(2)}`);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
