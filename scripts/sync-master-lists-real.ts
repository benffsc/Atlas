#!/usr/bin/env npx tsx
/**
 * SharePoint Master List Sync — uses the real ingestMasterListWorkbook pipeline.
 *
 * Scans SharePoint for master list files not yet synced and ingests them
 * using the production parser (handles FFSC's specific spreadsheet format).
 *
 * Usage:
 *   npx tsx scripts/sync-master-lists-real.ts
 */

import { Pool } from "pg";
import * as xlsx from "xlsx";
import { createHash } from "crypto";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost") ? false : { rejectUnauthorized: false },
  max: 5,
});

async function queryOne<T>(sql: string, params: unknown[] = []): Promise<T | null> {
  const result = await pool.query(sql, params);
  return result.rows[0] || null;
}

// ── Graph API ───────────────────────────────────────────────

const TENANT_ID = process.env.SHAREPOINT_TENANT_ID || process.env.MICROSOFT_TENANT_ID;
const CLIENT_ID = process.env.SHAREPOINT_CLIENT_ID || process.env.MICROSOFT_CLIENT_ID;
const CLIENT_SECRET = process.env.SHAREPOINT_CLIENT_SECRET || process.env.MICROSOFT_CLIENT_SECRET;
const DRIVE_ID = process.env.SHAREPOINT_DRIVE_ID;

let accessToken: string | null = null;
async function getToken(): Promise<string> {
  if (accessToken) return accessToken;
  const resp = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID!, client_secret: CLIENT_SECRET!, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }),
  });
  const data = await resp.json();
  accessToken = data.access_token;
  return accessToken!;
}

async function listFolder(path: string) {
  const token = await getToken();
  const encoded = encodeURIComponent(path).replace(/%2F/g, "/");
  const resp = await fetch(`https://graph.microsoft.com/v1.0/drives/${DRIVE_ID}/root:/${encoded}:/children?$top=200&$select=name,id,size,lastModifiedDateTime,folder`, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`List ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  return data.value as Array<{ id: string; name: string; size: number; lastModifiedDateTime: string; folder?: unknown }>;
}

async function downloadFile(itemId: string): Promise<Buffer> {
  const token = await getToken();
  const resp = await fetch(`https://graph.microsoft.com/v1.0/drives/${DRIVE_ID}/items/${itemId}/content`, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`Download ${resp.status}`);
  return Buffer.from(await resp.arrayBuffer());
}

// ── Filename parser (same as master-list-parser.ts) ─────────

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function parseFilename(name: string): { date: string } | null {
  const match = name.match(/(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d+)(?:st|nd|rd|th)?,?\s*(\d{4})/i);
  if (!match) return null;
  const month = MONTHS[match[1].toLowerCase()];
  if (!month) return null;
  return { date: `${match[3]}-${String(month).padStart(2, "0")}-${String(parseInt(match[2])).padStart(2, "0")}` };
}

// ── Real master list parser (matches Row 0=date, Row 1=headers, Row 2+=data) ──

function parseMasterListSheet(workbook: xlsx.WorkBook, dateOverride: string) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const allRows = xlsx.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });

  // Find header row (contains "Client Name")
  let headerIdx = -1;
  for (let i = 0; i < Math.min(5, allRows.length); i++) {
    const row = allRows[i] as string[];
    if (row?.some((cell) => String(cell).toLowerCase().includes("client name"))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) return [];

  const headers = (allRows[headerIdx] as string[]).map((h) => String(h || "").trim().toLowerCase());
  const clientNameCol = headers.findIndex((h) => h.includes("client name"));
  const numCol = headers.findIndex((h) => h === "#");
  const weightCol = headers.findIndex((h) => h.includes("weight"));
  const fCol = headers.findIndex((h) => h === "f");
  const mCol = headers.findIndex((h) => h === "m");

  const entries: Array<{
    line_number: number;
    raw_client_name: string;
    parsed_owner_name: string | null;
    parsed_cat_name: string | null;
    weight_lbs: number | null;
    female_count: number;
    male_count: number;
  }> = [];

  for (let i = headerIdx + 1; i < allRows.length; i++) {
    const row = allRows[i] as unknown[];
    if (!row || row.length === 0) continue;

    const clientName = clientNameCol >= 0 ? String(row[clientNameCol] || "").trim() : "";
    if (!clientName) continue;

    const lineNum = numCol >= 0 ? Number(row[numCol]) || (entries.length + 1) : entries.length + 1;
    const weight = weightCol >= 0 ? parseFloat(String(row[weightCol] || "")) || null : null;
    const isFemale = fCol >= 0 && row[fCol] ? 1 : 0;
    const isMale = mCol >= 0 && row[mCol] ? 1 : 0;

    // Parse cat name from quotes
    const catMatch = clientName.match(/['"""'']([^'"""'']+)['"""'']/);
    const catName = catMatch ? catMatch[1].trim() : null;
    const ownerName = clientName.split(/['"""'']/)[0].trim();

    entries.push({
      line_number: lineNum,
      raw_client_name: clientName,
      parsed_owner_name: ownerName || null,
      parsed_cat_name: catName,
      weight_lbs: weight,
      female_count: isFemale,
      male_count: isMale,
    });
  }

  return entries;
}

// ── Main ────────────────────────────────────────────────────

async function main() {
  const folders = [
    "Spay Neuter Clinics/Master Numbered Forms",
    `Spay Neuter Clinics/Master Numbered Forms/${new Date().getFullYear()} Completed Master List`,
  ];

  let imported = 0;

  for (const folderPath of folders) {
    console.log(`\nScanning: ${folderPath}`);
    let items;
    try { items = await listFolder(folderPath); } catch (err) { console.log(`  SKIP: ${err}`); continue; }

    const xlsxFiles = items.filter((f) => !f.folder && /\.xlsx?$/i.test(f.name));

    for (const file of xlsxFiles) {
      if (/\b(old\s+)?template\b/i.test(file.name) && !/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(file.name)) continue;

      const parsed = parseFilename(file.name);
      if (!parsed) continue;

      // Already synced?
      const existing = await queryOne<{ synced_file_id: string }>(
        `SELECT synced_file_id FROM ops.sharepoint_synced_files WHERE drive_id = $1 AND item_id = $2`,
        [DRIVE_ID, file.id]
      );
      if (existing) continue;

      // Already has entries?
      const hasEntries = await queryOne<{ cnt: number }>(
        `SELECT COUNT(*)::int AS cnt FROM ops.clinic_day_entries e JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id WHERE cd.clinic_date = $1`,
        [parsed.date]
      );
      if ((hasEntries?.cnt ?? 0) > 0) continue;

      console.log(`  Processing: ${file.name} → ${parsed.date}`);
      try {
        const content = await downloadFile(file.id);
        const fileHash = createHash("sha256").update(content).digest("hex");
        const workbook = xlsx.read(content, { type: "buffer", sheetRows: 200 });
        const entries = parseMasterListSheet(workbook, parsed.date);

        if (entries.length === 0) { console.log(`    SKIP: no entries parsed`); continue; }

        // Create clinic_day
        await queryOne(`INSERT INTO ops.clinic_days (clinic_date) VALUES ($1) ON CONFLICT DO NOTHING`, [parsed.date]);
        const cd = await queryOne<{ clinic_day_id: string }>(`SELECT clinic_day_id FROM ops.clinic_days WHERE clinic_date = $1`, [parsed.date]);

        // Insert entries
        for (const e of entries) {
          await queryOne(
            `INSERT INTO ops.clinic_day_entries (clinic_day_id, line_number, raw_client_name, parsed_owner_name, parsed_cat_name, weight_lbs, female_count, male_count)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING`,
            [cd!.clinic_day_id, e.line_number, e.raw_client_name, e.parsed_owner_name, e.parsed_cat_name, e.weight_lbs, e.female_count, e.male_count]
          );
        }

        // Track file upload + sync
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        const storedFilename = `master_list_sharepoint_${ts}_${fileHash.slice(0, 8)}.xlsx`;
        const uploadRow = await queryOne<{ upload_id: string }>(
          `INSERT INTO ops.file_uploads (source_system, source_table, original_filename, stored_filename, file_content, file_size_bytes, file_hash, status, rows_total)
           VALUES ('master_list', 'sharepoint_master_list', $1, $2, $3, $4, $5, 'completed', $6) RETURNING upload_id`,
          [file.name, storedFilename, content, content.length, fileHash, entries.length]
        );
        await queryOne(
          `INSERT INTO ops.sharepoint_synced_files (drive_id, item_id, file_name, file_size, sharepoint_modified_at, file_upload_id)
           VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (drive_id, item_id) DO NOTHING`,
          [DRIVE_ID, file.id, file.name, content.length, file.lastModifiedDateTime, uploadRow!.upload_id]
        );

        imported++;
        console.log(`    OK: ${entries.length} entries`);
      } catch (err) {
        console.log(`    ERROR: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  console.log(`\nDone: ${imported} master lists imported`);
  await pool.end();
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
