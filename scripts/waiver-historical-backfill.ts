#!/usr/bin/env npx tsx
/**
 * Historical Waiver Backfill — Download + link all SharePoint waivers to cats
 *
 * Steps 1-2 only (FREE — no AI/OCR):
 *   1. Walk SharePoint year/month/day folders for all years (2021-2026)
 *   2. Download each PDF → ops.file_uploads
 *   3. Parse filename → ops.waiver_scans (last4 chip, date, owner name)
 *   4. Match to cat via chip last4 + date → matched_cat_id
 *
 * Usage:
 *   npx tsx scripts/waiver-historical-backfill.ts [--dry-run] [--year YYYY] [--limit N]
 *
 * Requires: DATABASE_URL, SHAREPOINT_* env vars
 * Idempotent: skips files already in ops.sharepoint_synced_files
 */

import { Pool } from "pg";
import { createHash } from "crypto";

// ── DB ──────────────────────────────────────────────────────

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
  max: 5,
});

async function queryOne<T>(sql: string, params: unknown[] = []): Promise<T | null> {
  const r = await pool.query(sql, params);
  return r.rows[0] ?? null;
}
async function queryRows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query(sql, params)).rows;
}
async function execute(sql: string, params: unknown[] = []): Promise<void> {
  await pool.query(sql, params);
}

// ── SharePoint API ──────────────────────────────────────────

const TENANT_ID = process.env.SHAREPOINT_TENANT_ID || process.env.MICROSOFT_TENANT_ID || "";
const CLIENT_ID = process.env.SHAREPOINT_CLIENT_ID || process.env.MICROSOFT_CLIENT_ID || "";
const CLIENT_SECRET = process.env.SHAREPOINT_CLIENT_SECRET || process.env.MICROSOFT_CLIENT_SECRET || "";
const DRIVE_ID = process.env.SHAREPOINT_DRIVE_ID || "";
const WAIVER_PATH = process.env.SHAREPOINT_WAIVER_PATH || "Spay Neuter Clinics/Clinic HQ Waivers";

let cachedToken: string | null = null;
let tokenExpiry = 0;

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: "https://graph.microsoft.com/.default",
  });
  const resp = await fetch(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    { method: "POST", body }
  );
  const data = await resp.json();
  if (!data.access_token) throw new Error(`Auth failed: ${data.error_description}`);
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + 3500 * 1000; // ~58 min
  return cachedToken!;
}

interface SPItem {
  id: string;
  name: string;
  size?: number;
  lastModifiedDateTime: string;
  folder?: { childCount: number };
}

async function listById(itemId: string): Promise<SPItem[]> {
  const token = await getToken();
  const url = `https://graph.microsoft.com/v1.0/drives/${DRIVE_ID}/items/${itemId}/children?$top=200&$select=name,id,folder,lastModifiedDateTime,size`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) return [];
  return (await resp.json()).value || [];
}

async function listByPath(path: string): Promise<SPItem[]> {
  const token = await getToken();
  const url = `https://graph.microsoft.com/v1.0/drives/${DRIVE_ID}/root:/${path}:/children?$top=200&$select=name,id,folder,lastModifiedDateTime,size`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) return [];
  return (await resp.json()).value || [];
}

async function downloadFile(itemId: string): Promise<Buffer> {
  const token = await getToken();
  const url = `https://graph.microsoft.com/v1.0/drives/${DRIVE_ID}/items/${itemId}/content`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
  return Buffer.from(await resp.arrayBuffer());
}

// ── Filename Parser (inline, same logic as waiver-filename-parser.ts) ───

interface ParseResult {
  success: boolean;
  lastName?: string;
  description?: string;
  last4Chip?: string;
  date?: string;
  error?: string;
}

const SKIP_PATTERNS = [
  /staff\s+roster/i, /master\s+list/i, /clinic\s+roster/i,
  /green\s+sheet/i, /protocol/i, /schedule/i,
];

function parseWaiverFilename(filename: string): ParseResult {
  const name = filename.replace(/\.pdf$/i, "").trim();
  if (!name) return { success: false, error: "empty" };
  if (SKIP_PATTERNS.some((p) => p.test(name))) return { success: false, error: "skip" };

  // Pattern 1/2: {stuff} {4-digit chip} {M.D.YY or M.D.YYYY}
  const m1 = name.match(/^(.+?)\s+(\d{4})\s+(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (m1) {
    const [, nameAndDesc, chip, mo, da, yr] = m1;
    const date = parseDate(mo, da, yr);
    if (!date) return { success: false, error: "bad date" };
    const sp = nameAndDesc.indexOf(" ");
    return {
      success: true,
      lastName: sp > 0 ? nameAndDesc.slice(0, sp) : nameAndDesc,
      description: sp > 0 ? nameAndDesc.slice(sp + 1) : "",
      last4Chip: chip,
      date,
    };
  }

  // Pattern 3/4: {stuff} {M.D.YY or M.D.YYYY} (no chip)
  const m2 = name.match(/^(.+?)\s+(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (m2) {
    const [, nameAndDesc, mo, da, yr] = m2;
    const date = parseDate(mo, da, yr);
    if (!date) return { success: false, error: "bad date" };
    const sp = nameAndDesc.indexOf(" ");
    return {
      success: true,
      lastName: sp > 0 ? nameAndDesc.slice(0, sp) : nameAndDesc,
      description: sp > 0 ? nameAndDesc.slice(sp + 1) : "",
      last4Chip: "",
      date,
    };
  }

  return { success: false, error: "no pattern match" };
}

function parseDate(mo: string, da: string, yr: string): string | null {
  let year = parseInt(yr);
  if (yr.length === 2) year = year < 50 ? 2000 + year : 1900 + year;
  const month = parseInt(mo);
  const day = parseInt(da);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// ── Main ────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const yearIdx = args.indexOf("--year");
  const yearFilter = yearIdx >= 0 ? parseInt(args[yearIdx + 1]) : 0;
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 0;

  console.log(`Historical Waiver Backfill${dryRun ? " (DRY RUN)" : ""}`);
  console.log(`  Year: ${yearFilter || "all (2021-2026)"}`);
  console.log(`  Limit: ${limit || "none"}`);

  if (!DRIVE_ID || !CLIENT_ID) {
    console.error("Missing SHAREPOINT_* env vars");
    process.exit(1);
  }

  const years = yearFilter ? [yearFilter] : [2024, 2025, 2026, 2023, 2022, 2021];
  // Process 2024-2026 first (most data, modern filename format)

  const stats = {
    foldersScanned: 0,
    filesFound: 0,
    filesSkipped: 0,
    filesAlreadySynced: 0,
    filesDownloaded: 0,
    filesParsed: 0,
    filesMatched: 0,
    errors: 0,
  };
  let totalProcessed = 0;

  for (const year of years) {
    const yearPath = `${WAIVER_PATH}/${year} Waivers`;
    const months = await listByPath(yearPath);
    if (months.length === 0) {
      console.log(`\n${year}: no folder`);
      continue;
    }

    console.log(`\n=== ${year} (${months.length} months) ===`);

    for (const month of months.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!month.folder) continue;

      // List clinic day folders
      const days = await listById(month.id);
      const dayFolders = days.filter((d) => d.folder && (d.folder.childCount || 0) > 0);

      for (const day of dayFolders) {
        if (limit > 0 && totalProcessed >= limit) break;

        stats.foldersScanned++;
        const files = await listById(day.id);
        const pdfs = files.filter(
          (f) => !f.folder && f.name.toLowerCase().endsWith(".pdf")
        );

        for (const pdf of pdfs) {
          if (limit > 0 && totalProcessed >= limit) break;
          stats.filesFound++;

          // Skip non-waiver files
          if (SKIP_PATTERNS.some((p) => p.test(pdf.name))) {
            stats.filesSkipped++;
            continue;
          }

          // Already synced?
          const existing = await queryOne<{ synced_file_id: string }>(
            `SELECT synced_file_id FROM ops.sharepoint_synced_files WHERE drive_id = $1 AND item_id = $2`,
            [DRIVE_ID, pdf.id]
          );
          if (existing) {
            stats.filesAlreadySynced++;
            continue;
          }

          totalProcessed++;

          if (dryRun) {
            const parsed = parseWaiverFilename(pdf.name);
            console.log(
              `  [DRY] ${pdf.name} → ${parsed.success ? `${parsed.date} chip=${parsed.last4Chip || "none"}` : parsed.error}`
            );
            continue;
          }

          try {
            // Download
            const content = await downloadFile(pdf.id);
            stats.filesDownloaded++;

            // Hash for dedup
            const fileHash = createHash("sha256").update(content).digest("hex");

            // Check hash dedup
            let uploadId: string;
            const existingUpload = await queryOne<{ upload_id: string }>(
              `SELECT upload_id FROM ops.file_uploads WHERE file_hash = $1`,
              [fileHash]
            );

            if (existingUpload) {
              uploadId = existingUpload.upload_id;
            } else {
              const ts = new Date().toISOString().replace(/[:.]/g, "-");
              const storedFilename = `clinic_waiver_waiver_scan_${ts}_${fileHash.slice(0, 8)}.pdf`;
              const upload = await queryOne<{ upload_id: string }>(
                `INSERT INTO ops.file_uploads (
                   source_system, source_table, original_filename, stored_filename,
                   file_content, file_size_bytes, file_hash, status, rows_total
                 ) VALUES ('clinic_waiver', 'waiver_scan', $1, $2, $3, $4, $5, 'completed', 1)
                 RETURNING upload_id`,
                [pdf.name, storedFilename, content, content.length, fileHash]
              );
              uploadId = upload!.upload_id;
            }

            // Parse filename
            const parsed = parseWaiverFilename(pdf.name);
            let waiverId: string | null = null;

            if (parsed.success) {
              stats.filesParsed++;

              // Match to appointment by chip + date
              let matchResult: { appointment_id: string; cat_id: string | null } | null = null;
              if (parsed.last4Chip && parsed.date) {
                matchResult = await queryOne<{ appointment_id: string; cat_id: string | null }>(
                  `SELECT a.appointment_id, a.cat_id
                   FROM ops.appointments a
                   JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
                   WHERE c.microchip IS NOT NULL
                     AND RIGHT(c.microchip, 4) = $1
                     AND a.appointment_date = $2
                     AND a.merged_into_appointment_id IS NULL
                   ORDER BY a.created_at DESC LIMIT 1`,
                  [parsed.last4Chip, parsed.date]
                );
              }

              if (matchResult) stats.filesMatched++;

              const waiver = await queryOne<{ waiver_id: string }>(
                `INSERT INTO ops.waiver_scans (
                   file_upload_id,
                   parsed_last_name, parsed_description, parsed_last4_chip, parsed_date,
                   matched_appointment_id, matched_cat_id, match_method,
                   match_confidence, ocr_status, review_status, enrichment_status
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', 'pending', 'pending')
                 ON CONFLICT (file_upload_id) DO NOTHING
                 RETURNING waiver_id`,
                [
                  uploadId,
                  parsed.lastName,
                  parsed.description,
                  parsed.last4Chip || null,
                  parsed.date,
                  matchResult?.appointment_id || null,
                  matchResult?.cat_id || null,
                  matchResult ? "chip_date" : null,
                  matchResult ? 0.95 : null,
                ]
              );
              waiverId = waiver?.waiver_id || null;
            } else {
              // Unparseable — still create waiver_scan
              const waiver = await queryOne<{ waiver_id: string }>(
                `INSERT INTO ops.waiver_scans (file_upload_id, ocr_status, review_status, enrichment_status)
                 VALUES ($1, 'pending', 'pending', 'pending')
                 ON CONFLICT (file_upload_id) DO NOTHING
                 RETURNING waiver_id`,
                [uploadId]
              );
              waiverId = waiver?.waiver_id || null;
            }

            // Track synced file
            await execute(
              `INSERT INTO ops.sharepoint_synced_files (
                 drive_id, item_id, file_name, file_size,
                 sharepoint_modified_at, file_upload_id, waiver_scan_id
               ) VALUES ($1, $2, $3, $4, $5, $6, $7)
               ON CONFLICT (drive_id, item_id) DO NOTHING`,
              [DRIVE_ID, pdf.id, pdf.name, pdf.size, pdf.lastModifiedDateTime, uploadId, waiverId]
            );

            // Set waiver_scan_id on appointment (look up from waiver_scans)
            if (waiverId) {
              const ws = await queryOne<{ matched_appointment_id: string | null }>(
                `SELECT matched_appointment_id FROM ops.waiver_scans WHERE waiver_id = $1`,
                [waiverId]
              );
              if (ws?.matched_appointment_id) {
                await execute(
                  `UPDATE ops.appointments SET waiver_scan_id = $2
                   WHERE appointment_id = $1 AND waiver_scan_id IS NULL`,
                  [ws.matched_appointment_id, waiverId]
                );
              }
            }

            // Check if this specific waiver matched
            const thisMatched = waiverId ? await queryOne<{ m: boolean }>(
              `SELECT matched_cat_id IS NOT NULL AS m FROM ops.waiver_scans WHERE waiver_id = $1`, [waiverId]
            ) : null;
            const matchInfo = thisMatched?.m ? `→ matched` : parsed.success ? `(no match)` : `(unparseable)`;
            if (totalProcessed % 100 === 0 || thisMatched?.m) {
              console.log(`  [${totalProcessed}] ${pdf.name} ${matchInfo}`);
            }
          } catch (err) {
            stats.errors++;
            console.error(`  ERROR: ${pdf.name}: ${err instanceof Error ? err.message : err}`);
          }
        }
        if (limit > 0 && totalProcessed >= limit) break;
      }
      if (limit > 0 && totalProcessed >= limit) break;
    }
    if (limit > 0 && totalProcessed >= limit) break;
  }

  console.log("\n=== Summary ===");
  console.log(`  Folders scanned:  ${stats.foldersScanned}`);
  console.log(`  Files found:      ${stats.filesFound}`);
  console.log(`  Already synced:   ${stats.filesAlreadySynced}`);
  console.log(`  Skipped (admin):  ${stats.filesSkipped}`);
  console.log(`  Downloaded:       ${stats.filesDownloaded}`);
  console.log(`  Parsed:           ${stats.filesParsed}`);
  console.log(`  Matched to cat:   ${stats.filesMatched}`);
  console.log(`  Errors:           ${stats.errors}`);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
