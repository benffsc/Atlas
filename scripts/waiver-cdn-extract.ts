#!/usr/bin/env npx tsx
/**
 * Waiver CDN-Only Extraction — Extract JUST the clinic number from waivers
 *
 * Much simpler than full OCR: sends PDF, asks for one number.
 * For waivers already matched to cats (have chip) but missing clinic_number.
 *
 * Usage:
 *   npx tsx scripts/waiver-cdn-extract.ts [--dry-run] [--limit N] [--year YYYY]
 *
 * Cost: ~$0.005/waiver (smaller prompt, smaller response than full OCR)
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

const CDN_PROMPT = `Look at this veterinary clinic waiver form. Find the clinic number — it's the large handwritten or stamped number in the top-right area of the form, usually inside a circle or box. It's typically 1-3 digits (1 through ~60).

Do NOT read the trap number, appointment number, or any other number. ONLY the big clinic day number in the top-right.

Return ONLY a JSON object: {"clinic_number": <integer or null>}`;

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 0;
  const yearIdx = args.indexOf("--year");
  const yearFilter = yearIdx >= 0 ? parseInt(args[yearIdx + 1]) : 0;

  console.log(`Waiver CDN-Only Extract${dryRun ? " (DRY RUN)" : ""}`);
  if (!process.env.ANTHROPIC_API_KEY) { console.error("Missing ANTHROPIC_API_KEY"); process.exit(1); }
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  let sql = `
    SELECT ws.waiver_id, ws.file_upload_id, ws.parsed_date::text AS parsed_date,
           ws.matched_cat_id::text, fu.original_filename
    FROM ops.waiver_scans ws
    JOIN ops.file_uploads fu ON fu.upload_id = ws.file_upload_id
    WHERE ws.matched_cat_id IS NOT NULL
      AND ws.ocr_clinic_number IS NULL
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

  console.log(`Found ${waivers.length} waivers needing CDN extraction`);
  if (waivers.length === 0) { await pool.end(); return; }

  let extracted = 0, errors = 0, apiCalls = 0;

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
        max_tokens: 64,
        messages: [{
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
            { type: "text", text: CDN_PROMPT },
          ],
        }],
      });

      const text = response.content.find(c => c.type === "text")?.text || "";
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) { errors++; continue; }

      const parsed = JSON.parse(match[0]);
      const cdn = parsed.clinic_number;

      if (cdn != null && typeof cdn === "number" && cdn > 0 && cdn < 200) {
        await execute(
          `UPDATE ops.waiver_scans SET ocr_clinic_number = $2, ocr_status = 'extracted',
           ocr_processed_at = NOW(), ocr_model = 'claude-haiku-4-5-20251001'
           WHERE waiver_id = $1`,
          [w.waiver_id, cdn]
        );
        extracted++;

        // Bridge CDN to appointment
        await queryOne(
          `SELECT ops.set_clinic_day_number($1::UUID, $2::INTEGER, 'waiver_ocr'::ops.clinic_day_number_source, NULL)`,
          [w.matched_cat_id, cdn]
        ).catch(() => {});

        if ((i + 1) % 50 === 0) console.log(`  [${i + 1}/${waivers.length}] ${extracted} CDNs extracted`);
      } else {
        errors++;
      }

      if (apiCalls % 10 === 0) await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      errors++;
      if (String(err).includes("credit balance")) {
        console.error("API credits exhausted, stopping.");
        break;
      }
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`  Processed: ${apiCalls}`);
  console.log(`  CDNs extracted: ${extracted}`);
  console.log(`  Errors: ${errors}`);
  console.log(`  Cost: ~$${(apiCalls * 0.005).toFixed(2)}`);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
