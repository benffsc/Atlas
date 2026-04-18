#!/usr/bin/env npx tsx
/**
 * Manual SharePoint Master List Sync
 *
 * Calls the SharePoint Graph API directly to find and ingest master lists
 * that the cron hasn't picked up yet.
 *
 * Usage:
 *   npx tsx scripts/sync-sharepoint-master-lists.ts
 *
 * Requires: DATABASE_URL, SHAREPOINT_DRIVE_ID, SHAREPOINT_CLIENT_ID,
 *           SHAREPOINT_CLIENT_SECRET, SHAREPOINT_TENANT_ID
 */

import { Pool } from "pg";
import * as xlsx from "xlsx";
import { createHash } from "crypto";

// ── DB ──────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost") ? false : { rejectUnauthorized: false },
  max: 5,
});

async function queryOne<T>(sql: string, params: unknown[] = []): Promise<T | null> {
  const result = await pool.query(sql, params);
  return result.rows[0] || null;
}

async function queryRows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool.query(sql, params);
  return result.rows;
}

// ── Microsoft Graph Auth ────────────────────────────────────

const TENANT_ID = process.env.SHAREPOINT_TENANT_ID || process.env.MICROSOFT_TENANT_ID;
const CLIENT_ID = process.env.SHAREPOINT_CLIENT_ID || process.env.MICROSOFT_CLIENT_ID;
const CLIENT_SECRET = process.env.SHAREPOINT_CLIENT_SECRET || process.env.MICROSOFT_CLIENT_SECRET;
const DRIVE_ID = process.env.SHAREPOINT_DRIVE_ID;

if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET || !DRIVE_ID) {
  console.error("Missing SharePoint env vars");
  process.exit(1);
}

let accessToken: string | null = null;

async function getToken(): Promise<string> {
  if (accessToken) return accessToken;

  const resp = await fetch(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID!,
        client_secret: CLIENT_SECRET!,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    }
  );

  const data = await resp.json();
  if (!data.access_token) throw new Error(`Auth failed: ${JSON.stringify(data)}`);
  accessToken = data.access_token;
  return accessToken;
}

async function graphGet(url: string): Promise<unknown> {
  const token = await getToken();
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error(`Graph ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

async function downloadFile(itemId: string): Promise<Buffer> {
  const token = await getToken();
  const resp = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${DRIVE_ID}/items/${itemId}/content`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!resp.ok) throw new Error(`Download ${resp.status}`);
  return Buffer.from(await resp.arrayBuffer());
}

// ── Master List filename parser ─────────────────────────────

function parseMasterListFilename(filename: string): { date: string; isTemplate: boolean } | null {
  const months: Record<string, number> = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  };

  // Match month + day + year anywhere in the filename
  // Handles: "Master List April 8, 2026", "Master List Template April 2, 2026",
  //          "Master List March 2nd 2026"
  const match = filename.match(/(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d+)(?:st|nd|rd|th)?,?\s*(\d{4})/i);
  if (!match) return null;

  const month = months[match[1].toLowerCase()];
  if (!month) return null;

  const day = parseInt(match[2], 10);
  const year = parseInt(match[3], 10);

  return {
    date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    isTemplate: false,
  };
}

// ── Main ────────────────────────────────────────────────────

async function main() {
  const year = new Date().getFullYear();
  const folders = [
    // New files get dropped here before being sorted into year subfolder
    `Spay Neuter Clinics/Master Numbered Forms`,
    `Spay Neuter Clinics/Master Numbered Forms/${year} Completed Master List`,
    `Spay Neuter Clinics/Master Numbered Forms/${year - 1} Completed Master List`,
  ];

  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (const folderPath of folders) {
    console.log(`\nScanning: ${folderPath}`);

    let items: Array<{ id: string; name: string; size: number; lastModifiedDateTime: string; folder?: unknown }>;
    try {
      const encodedPath = encodeURIComponent(folderPath).replace(/%2F/g, "/");
      const data = await graphGet(
        `https://graph.microsoft.com/v1.0/drives/${DRIVE_ID}/root:/${encodedPath}:/children?$top=200`
      ) as { value: typeof items };
      items = data.value;
    } catch (err) {
      console.log(`  SKIP: ${err instanceof Error ? err.message : err}`);
      continue;
    }

    const xlsxFiles = items.filter((f) => !f.folder && /\.xlsx?$/i.test(f.name));
    console.log(`  ${xlsxFiles.length} Excel files found`);

    for (const file of xlsxFiles) {
      const parsed = parseMasterListFilename(file.name);
      if (!parsed || parsed.isTemplate) {
        console.log(`  SKIP: ${file.name}`);
        continue;
      }

      // Check if already synced
      const existing = await queryOne<{ synced_file_id: string }>(
        `SELECT synced_file_id FROM ops.sharepoint_synced_files WHERE drive_id = $1 AND item_id = $2`,
        [DRIVE_ID, file.id]
      );
      if (existing) continue;

      // Check if clinic_day_entries already exist for this date
      const hasEntries = await queryOne<{ cnt: number }>(
        `SELECT COUNT(*)::int AS cnt FROM ops.clinic_day_entries e
         JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
         WHERE cd.clinic_date = $1`,
        [parsed.date]
      );
      if ((hasEntries?.cnt ?? 0) > 0) {
        console.log(`  SKIP (already has entries): ${file.name} → ${parsed.date}`);
        skipped++;
        continue;
      }

      // Download + ingest
      console.log(`  Processing: ${file.name} → ${parsed.date}`);
      try {
        const content = await downloadFile(file.id);
        const fileHash = createHash("sha256").update(content).digest("hex");

        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        const storedFilename = `master_list_sharepoint_${ts}_${fileHash.slice(0, 8)}.xlsx`;

        const uploadRow = await queryOne<{ upload_id: string }>(
          `INSERT INTO ops.file_uploads (
             source_system, source_table, original_filename, stored_filename,
             file_content, file_size_bytes, file_hash, status, rows_total
           ) VALUES ('master_list', 'sharepoint_master_list', $1, $2, $3, $4, $5, 'pending', 0)
           RETURNING upload_id`,
          [file.name, storedFilename, content, content.length, fileHash]
        );

        // Parse workbook
        const workbook = xlsx.read(content, { type: "buffer", sheetRows: 200 });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = xlsx.utils.sheet_to_json<Record<string, unknown>>(sheet);

        // Create clinic_day if needed
        await queryOne(
          `INSERT INTO ops.clinic_days (clinic_date) VALUES ($1) ON CONFLICT DO NOTHING`,
          [parsed.date]
        );

        const clinicDay = await queryOne<{ clinic_day_id: string }>(
          `SELECT clinic_day_id FROM ops.clinic_days WHERE clinic_date = $1`,
          [parsed.date]
        );

        if (!clinicDay) {
          console.log(`    ERROR: Could not create clinic_day for ${parsed.date}`);
          errors++;
          continue;
        }

        // Insert entries
        let lineNum = 0;
        for (const row of rows) {
          // Master list columns vary but typically: line number, client name, cat name, sex, weight
          const lineNumber = row["#"] || row["Line"] || row["No"] || ++lineNum;
          const clientName = row["Client Name"] || row["Client"] || row["Name"] || row["Owner"] || "";
          const catName = row["Cat Name"] || row["Cat"] || row["Animal"] || row["Pet Name"] || "";

          if (!clientName && !catName) continue;

          await queryOne(
            `INSERT INTO ops.clinic_day_entries (
               clinic_day_id, line_number, raw_client_name, parsed_owner_name, parsed_cat_name
             ) VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT DO NOTHING`,
            [
              clinicDay.clinic_day_id,
              typeof lineNumber === "number" ? lineNumber : parseInt(String(lineNumber)) || lineNum,
              String(clientName).trim(),
              String(clientName).trim(),
              String(catName).trim() || null,
            ]
          );
        }

        // Mark upload completed
        await queryOne(
          `UPDATE ops.file_uploads SET status = 'completed', processed_at = NOW(), rows_total = $2
           WHERE upload_id = $1`,
          [uploadRow!.upload_id, rows.length]
        );

        // Track synced file
        await queryOne(
          `INSERT INTO ops.sharepoint_synced_files (
             drive_id, item_id, file_name, file_size, sharepoint_modified_at, file_upload_id
           ) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (drive_id, item_id) DO NOTHING`,
          [DRIVE_ID, file.id, file.name, content.length, file.lastModifiedDateTime, uploadRow!.upload_id]
        );

        imported++;
        console.log(`    OK: ${rows.length} rows → ${parsed.date}`);
      } catch (err) {
        errors++;
        console.log(`    ERROR: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  console.log(`\nDone: ${imported} imported, ${skipped} skipped, ${errors} errors`);
  await pool.end();
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
