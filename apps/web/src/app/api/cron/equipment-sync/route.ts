import { NextRequest } from "next/server";
import { createHash } from "crypto";
import { query, queryOne } from "@/lib/db";
import { apiSuccess, apiError, apiServerError } from "@/lib/api-response";

/**
 * Equipment Sync Cron — RETIRED 2026-04-08
 *
 * This cron used to sync 3 Airtable tables → Atlas every 4 hours:
 *   1. Equipment        (tblQ9fsfQUVpiI7VL) → ops.equipment
 *   2. Check-Out Log    (tbl7KMM4RC7EnnWYN) → ops.equipment_events
 *   3. Collections      (tblzczCz5LcNmNcwy) → ops.equipment_collection_tasks
 *
 * It was retired because:
 * - Airtable equipment tracking is no longer in use; the kiosk add-equipment
 *   flow at /kiosk/equipment/add writes natively to ops.equipment with
 *   source_system='atlas_ui' and never touches Airtable
 * - The cron silently overwrote kiosk-recorded custodian names every 4 hours
 *   (trap 0106 audit, MIG_3064): for example, when staff checked out trap
 *   0106 to Krystianna Enriquez via the kiosk, the cron would clobber
 *   current_holder_name back to "Danielle Hall" from Airtable's stale
 *   "Current Holder" field on the next run. Three confirmed stale traps
 *   (0106, 0176, 0208) were healed by MIG_3064.
 * - Multi-writer contention with no coordination is fundamentally unsafe;
 *   making Atlas the only writer eliminates an entire class of silent data
 *   corruption.
 *
 * The cron entry has been removed from apps/web/vercel.json. The handler
 * below now returns 410 Gone immediately so any stale scheduler probe,
 * manual curl, or external pingback gets a clear "this is dead" signal
 * instead of silently re-running the corruption.
 *
 * If you need to re-import historical Airtable data for some one-off audit,
 * write a one-time script in scripts/ingest/ that explicitly opts in. Do
 * NOT re-enable this cron without designing the writer-contention model
 * first (see column comments on ops.equipment from MIG_3064).
 */

export const maxDuration = 120;

const RETIRED = true;
const RETIRED_AT = "2026-04-08";
const RETIRED_REASON = "Atlas is the source of truth for equipment. See MIG_3064 + cron file header.";

const CRON_SECRET = process.env.CRON_SECRET;
const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

const EQUIPMENT_TABLE_ID = "tblQ9fsfQUVpiI7VL";
const CHECKOUT_LOG_TABLE_ID = "tbl7KMM4RC7EnnWYN";
const COLLECTIONS_TABLE_ID = "tblcznCz5LcNmNcwy";

interface AirtableRecord {
  id: string;
  fields: Record<string, unknown>;
  createdTime: string;
}

async function fetchAirtableTable(tableId: string): Promise<AirtableRecord[]> {
  if (!AIRTABLE_PAT || !AIRTABLE_BASE_ID) {
    throw new Error("Missing AIRTABLE_PAT or AIRTABLE_BASE_ID env vars");
  }

  const records: AirtableRecord[] = [];
  let offset: string | undefined;

  do {
    const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${tableId}`);
    url.searchParams.set("pageSize", "100");
    if (offset) url.searchParams.set("offset", offset);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${AIRTABLE_PAT}` },
    });

    if (!res.ok) {
      throw new Error(`Airtable API error: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();
    records.push(...(data.records || []));
    offset = data.offset;
  } while (offset);

  return records;
}

function extractAttachmentUrl(field: unknown): string | null {
  if (!Array.isArray(field) || field.length === 0) return null;
  return field[0]?.url || null;
}

/** Safely extract a trimmed string from Airtable fields, returns null if empty */
function getStr(fields: Record<string, unknown>, key: string): string | null {
  const v = fields[key];
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed || null;
}

/** Safely extract an array field, returns null if not an array or empty */
function asArray(field: unknown): string[] | null {
  if (!Array.isArray(field) || field.length === 0) return null;
  return field as string[];
}

/** Compute MD5 hash for staged_records row_hash column */
function rowHash(payload: string): string {
  return createHash("md5").update(payload).digest("hex");
}

async function syncEquipment(records: AirtableRecord[]): Promise<{ staged: number; upserted: number; skipped_custody: number }> {
  let staged = 0;
  let upserted = 0;
  let skippedCustody = 0;

  for (const rec of records) {
    const f = rec.fields;

    // Stage raw record (unique on source_system, source_table, row_hash)
    const payloadStr = JSON.stringify(f);
    await query(
      `INSERT INTO ops.staged_records (source_system, source_table, source_row_id, row_hash, payload, is_processed, created_at)
       VALUES ('airtable', 'equipment', $1, $2, $3::jsonb, true, $4)
       ON CONFLICT (source_system, source_table, row_hash)
       DO UPDATE SET payload = EXCLUDED.payload, source_row_id = EXCLUDED.source_row_id, updated_at = NOW()`,
      [rec.id, rowHash(payloadStr), payloadStr, rec.createdTime]
    );
    staged++;

    // Upsert into ops.equipment
    // Field names: Airtable API returns exact field names from the base.
    // Original import script uses f['Type'], f['Condition'], f['Available'], f['Checked Out']
    // Newer fields (from API exploration): "Barcode Number", "Item Type", "Size", etc.
    const barcodeNumber = getStr(f, "Barcode Number");
    const photoUrl = extractAttachmentUrl(f["Photos"]);
    const barcodeImageUrl = extractAttachmentUrl(f["Barcode"]);
    const functionalStatusRaw = getStr(f, "Functional Status");
    const functionalStatus = functionalStatusRaw
      ? (functionalStatusRaw.toLowerCase().includes("needs") ? "needs_repair" : "functional")
      : "functional";
    const expectedReturnDate = getStr(f, "Expected Return Date");
    // Airtable "Status" field: "Checked Out", "Available", "Missing"
    // This is the CUSTODY status, not condition. Original import mapped it to condition column by mistake.
    const statusRaw = getStr(f, "Status");
    const custodyStatus = statusRaw === "Available" ? "available"
      : statusRaw === "Checked Out" ? "checked_out"
      : statusRaw === "Missing" ? "missing"
      : null;

    // Trap-0106 stale-holder-name fix (2026-04-08):
    // The Airtable "Current Holder" field is a stale legacy mirror. When the
    // kiosk records a fresh check_out via the events trigger, it sets
    // current_holder_name on ops.equipment. Then this cron used to blindly
    // overwrite that name back to whatever Airtable still had — silently
    // reverting every kiosk reassignment every 4 hours.
    //
    // Custody_status already had a "recent atlas_ui event" guard (preserved
    // below). Apply the same guard to current_holder_name so kiosk activity
    // wins over stale Airtable data.
    const result = await queryOne<{ equipment_id: string; custody_was_skipped: boolean }>(
      `UPDATE ops.equipment SET
         barcode = CASE
           WHEN $2::text IS NULL THEN barcode
           WHEN EXISTS (SELECT 1 FROM ops.equipment e2 WHERE e2.barcode = $2::text AND e2.equipment_id != ops.equipment.equipment_id)
             THEN barcode
           ELSE $2::text
         END,
         item_type = $3,
         size = $4,
         functional_status = $5,
         current_holder_name = CASE
           WHEN EXISTS (
             SELECT 1 FROM ops.equipment_events
             WHERE equipment_id = ops.equipment.equipment_id
               AND source_system = 'atlas_ui'
               AND created_at > COALESCE(
                 (SELECT (value#>>'{}')::timestamptz FROM ops.app_config WHERE key = 'equipment.last_sync_at'),
                 '2020-01-01'
               )
           ) THEN current_holder_name
           ELSE COALESCE($6, current_holder_name)
         END,
         expected_return_date = $7::date,
         photo_url = $8,
         barcode_image_url = $9,
         custody_status = CASE
           WHEN EXISTS (
             SELECT 1 FROM ops.equipment_events
             WHERE equipment_id = ops.equipment.equipment_id
               AND source_system = 'atlas_ui'
               AND created_at > COALESCE(
                 (SELECT (value#>>'{}')::timestamptz FROM ops.app_config WHERE key = 'equipment.last_sync_at'),
                 '2020-01-01'
               )
           ) THEN custody_status
           ELSE COALESCE($10, custody_status)
         END,
         updated_at = NOW()
       WHERE source_record_id = $1
         AND source_system = 'airtable'
       RETURNING equipment_id,
         CASE
           WHEN EXISTS (
             SELECT 1 FROM ops.equipment_events
             WHERE equipment_id = ops.equipment.equipment_id
               AND source_system = 'atlas_ui'
               AND created_at > COALESCE(
                 (SELECT (value#>>'{}')::timestamptz FROM ops.app_config WHERE key = 'equipment.last_sync_at'),
                 '2020-01-01'
               )
           ) THEN true ELSE false
         END as custody_was_skipped`,
      [
        rec.id,
        barcodeNumber,
        getStr(f, "Item Type"),
        getStr(f, "Size"),
        functionalStatus,
        getStr(f, "Current Holder"),
        expectedReturnDate,
        photoUrl,
        barcodeImageUrl,
        custodyStatus,
      ]
    );

    if (result) {
      upserted++;
      if (result.custody_was_skipped) skippedCustody++;
    }
  }

  return { staged, upserted, skipped_custody: skippedCustody };
}

async function syncCheckoutLog(records: AirtableRecord[]): Promise<{ new_events: number }> {
  let newEvents = 0;

  for (const rec of records) {
    const f = rec.fields;

    // Stage raw record
    const checkoutPayloadStr = JSON.stringify(f);
    await query(
      `INSERT INTO ops.staged_records (source_system, source_table, source_row_id, row_hash, payload, is_processed, created_at)
       VALUES ('airtable', 'checkout_log', $1, $2, $3::jsonb, true, $4)
       ON CONFLICT (source_system, source_table, row_hash)
       DO UPDATE SET payload = EXCLUDED.payload, source_row_id = EXCLUDED.source_row_id, updated_at = NOW()`,
      [rec.id, rowHash(checkoutPayloadStr), checkoutPayloadStr, rec.createdTime]
    );

    // Check if we already have this event
    const existing = await queryOne<{ event_id: string }>(
      `SELECT event_id FROM ops.equipment_events WHERE source_record_id = $1 AND source_system = 'airtable'`,
      [rec.id]
    );
    if (existing) continue;

    // Determine action and find equipment
    const action = typeof f["Action"] === "string" ? f["Action"] : "";
    const isCheckIn = action.toLowerCase().includes("check-in") || action.toLowerCase().includes("checkin");
    const eventType = isCheckIn ? "check_in" : "check_out";

    // Equipment links: Check-Outs use "Equipment", Check-Ins use "Equipment Check in " (trailing space!)
    // Original script only checked f['Equipment'] || f['Unified Links'], missing the check-in field.
    const equipmentLinks = isCheckIn
      ? (asArray(f["Equipment Check in "]) || asArray(f["Equipment Check in"]) || asArray(f["Equipment"]) || [])
      : (asArray(f["Equipment"]) || []);

    // Fall back to Unified Links
    const links = equipmentLinks.length > 0 ? equipmentLinks : (asArray(f["Unified Links"]) || []);

    if (links.length === 0) continue;

    const timestamp = typeof f["Timestamp"] === "string" ? f["Timestamp"] : rec.createdTime;
    const personName = typeof f["Name"] === "string" ? f["Name"] : null;
    const notes = typeof f["Notes"] === "string" ? f["Notes"] : null;
    const dueDate = typeof f["Expected Return Date"] === "string" ? f["Expected Return Date"] : null;

    for (const equipRecId of links) {
      if (typeof equipRecId !== "string") continue;

      // Find equipment by Airtable record ID
      const equip = await queryOne<{ equipment_id: string }>(
        `SELECT equipment_id FROM ops.equipment WHERE source_record_id = $1 AND source_system = 'airtable'`,
        [equipRecId]
      );
      if (!equip) continue;

      const eventNotes = [personName ? `Name: ${personName}` : null, notes].filter(Boolean).join(" — ") || null;

      await query(
        `INSERT INTO ops.equipment_events (
           equipment_id, event_type, notes, due_date,
           source_system, source_record_id, created_at
         ) VALUES ($1, $2, $3, $4::date, 'airtable', $5, $6::timestamptz)`,
        [equip.equipment_id, eventType, eventNotes, dueDate, rec.id, timestamp]
      );
      newEvents++;
    }
  }

  return { new_events: newEvents };
}

async function syncCollections(records: AirtableRecord[]): Promise<{ upserted: number }> {
  let upserted = 0;

  for (const rec of records) {
    const f = rec.fields;

    // Stage raw record
    const collPayloadStr = JSON.stringify(f);
    await query(
      `INSERT INTO ops.staged_records (source_system, source_table, source_row_id, row_hash, payload, is_processed, created_at)
       VALUES ('airtable', 'equipment_collections', $1, $2, $3::jsonb, true, $4)
       ON CONFLICT (source_system, source_table, row_hash)
       DO UPDATE SET payload = EXCLUDED.payload, source_row_id = EXCLUDED.source_row_id, updated_at = NOW()`,
      [rec.id, rowHash(collPayloadStr), collPayloadStr, rec.createdTime]
    );

    const statusRaw = typeof f["Status"] === "string" ? f["Status"] : "";
    let collectionStatus = "pending";
    if (statusRaw.toLowerCase().includes("do not collect")) collectionStatus = "do_not_collect";
    else if (statusRaw.toLowerCase().includes("called") || statusRaw.toLowerCase().includes("emailed")) collectionStatus = "contacted";
    else if (statusRaw.toLowerCase().includes("will bring")) collectionStatus = "will_return";
    else if (statusRaw.toLowerCase().includes("has no traps")) collectionStatus = "no_traps";
    else if (statusRaw.toLowerCase().includes("collected")) collectionStatus = "collected";

    await query(
      `INSERT INTO ops.equipment_collection_tasks (
         person_name, phone, equipment_description, trap_count,
         collection_status, notes, traps_returned,
         source_system, source_record_id, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'airtable', $8, $9::timestamptz, NOW())
       ON CONFLICT (source_system, source_record_id) WHERE source_record_id IS NOT NULL
       DO UPDATE SET
         person_name = EXCLUDED.person_name,
         phone = EXCLUDED.phone,
         equipment_description = EXCLUDED.equipment_description,
         trap_count = EXCLUDED.trap_count,
         collection_status = EXCLUDED.collection_status,
         notes = EXCLUDED.notes,
         traps_returned = EXCLUDED.traps_returned,
         updated_at = NOW()`,
      [
        typeof f["Name"] === "string" ? f["Name"] : "Unknown",
        typeof f["Phone"] === "string" ? f["Phone"] : null,
        typeof f["Equipment Info"] === "string" ? f["Equipment Info"] : null,
        typeof f["# of traps"] === "number" ? f["# of traps"] : null,
        collectionStatus,
        typeof f["Notes"] === "string" ? f["Notes"] : null,
        typeof f["Returned or added"] === "number" ? f["Returned or added"] : 0,
        rec.id,
        typeof f["Last Modified"] === "string" ? f["Last Modified"] : rec.createdTime,
      ]
    );
    upserted++;
  }

  return { upserted };
}

export async function GET(_request: NextRequest) {
  // RETIRED 2026-04-08 — see file header. This handler returns 410 Gone
  // so stale schedulers / probes get a clear "this is dead" response.
  if (RETIRED) {
    console.error(
      `[equipment-sync] RETIRED ${RETIRED_AT} — refusing to run. ${RETIRED_REASON}`,
    );
    return apiError(
      `equipment-sync cron retired on ${RETIRED_AT}. ${RETIRED_REASON}`,
      410,
    );
  }

  // ── DEAD CODE BELOW (kept for one-off audit reference, not reachable) ──
  const authHeader = _request.headers.get("authorization");
  const cronHeader = _request.headers.get("x-vercel-cron");

  if (!cronHeader && CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return apiError("Unauthorized", 401);
  }

  if (!AIRTABLE_PAT || !AIRTABLE_BASE_ID) {
    return apiError("Missing AIRTABLE_PAT or AIRTABLE_BASE_ID environment variables", 500);
  }

  const startTime = Date.now();

  try {
    // Fetch all 3 tables from Airtable
    const [equipmentRecords, checkoutRecords, collectionRecords] = await Promise.all([
      fetchAirtableTable(EQUIPMENT_TABLE_ID),
      fetchAirtableTable(CHECKOUT_LOG_TABLE_ID),
      fetchAirtableTable(COLLECTIONS_TABLE_ID),
    ]);

    // Sync in order: equipment first, then events (need equipment IDs), then collections
    const equipResult = await syncEquipment(equipmentRecords);
    const checkoutResult = await syncCheckoutLog(checkoutRecords);
    const collectionResult = await syncCollections(collectionRecords);

    const durationMs = Date.now() - startTime;

    // Write sync metadata to app_config
    const syncResult = {
      fetched: equipmentRecords.length,
      upserted: equipResult.upserted,
      skipped_custody: equipResult.skipped_custody,
      new_events: checkoutResult.new_events,
      collections: collectionResult.upserted,
      duration_ms: durationMs,
    };

    await query(
      `UPDATE ops.app_config SET value = to_jsonb($1::text), updated_at = NOW() WHERE key = 'equipment.last_sync_at'`,
      [new Date().toISOString()]
    );

    await query(
      `UPDATE ops.app_config SET value = $1::jsonb, updated_at = NOW() WHERE key = 'equipment.last_sync_result'`,
      [JSON.stringify(syncResult)]
    );

    return apiSuccess({
      sync: "equipment",
      duration_ms: durationMs,
      equipment: { fetched: equipmentRecords.length, ...equipResult },
      checkout_log: { fetched: checkoutRecords.length, ...checkoutResult },
      collections: { fetched: collectionRecords.length, ...collectionResult },
    });
  } catch (err) {
    return apiServerError(err instanceof Error ? err.message : "Equipment sync failed");
  }
}
