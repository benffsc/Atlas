import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { apiSuccess, apiServerError, apiError } from "@/lib/api-response";

/**
 * Community Trapper Agreement Sync (FFS-474)
 *
 * Pull-based sync matching the intake submission pattern:
 *   1. Poll Airtable "Community Trapper Agreements" for Sync Status = pending
 *   2. For each record: resolve identity → create trapper role + profile
 *   3. Write back to Airtable: Sync Status = synced/error + Atlas Person ID
 *
 * Airtable table fields:
 *   first_name, last_name, Email, Phone, address, availability, Signature
 *   Sync Status (pending/synced/error), Sync Error, Atlas Person ID, Synced At
 *
 * Vercel Cron: Add to vercel.json:
 *   { "path": "/api/cron/trapper-agreement-sync", "schedule": "every-30-min" }
 *
 * Environment Variables:
 *   AIRTABLE_PAT       — Airtable Personal Access Token
 *   CRON_SECRET         — Auth for manual trigger
 */

export const maxDuration = 60;

const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const ATLAS_SYNC_BASE_ID = "appwFuRddph1krmcd";
const TRAPPER_AGREEMENTS_TABLE = "Community Trapper Agreements";
const CRON_SECRET = process.env.CRON_SECRET;

interface AirtableTrapperRecord {
  id: string;
  createdTime: string;
  fields: {
    first_name?: string;
    last_name?: string;
    Email?: string;
    Phone?: string;
    address?: string;
    availability?: string;
    Signature?: string;
    "Sync Status"?: string;
    "Sync Error"?: string;
    "Atlas Person ID"?: string;
    "Synced At"?: string;
  };
}

interface SyncResult {
  success: boolean;
  recordId: string;
  personId?: string;
  matchType?: string;
  error?: string;
}

async function airtableFetch(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = endpoint.startsWith("http")
    ? endpoint
    : `https://api.airtable.com/v0${endpoint}`;

  return fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${AIRTABLE_PAT}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
}

async function getPendingRecords(): Promise<AirtableTrapperRecord[]> {
  const records: AirtableTrapperRecord[] = [];
  let offset: string | undefined;

  // Fetch records with Sync Status = pending, error, or blank (retry errors automatically)
  const filterFormula = `OR({Sync Status}='pending', {Sync Status}='error', {Sync Status}=BLANK())`;

  do {
    const url = new URL(
      `https://api.airtable.com/v0/${ATLAS_SYNC_BASE_ID}/${encodeURIComponent(TRAPPER_AGREEMENTS_TABLE)}`
    );
    url.searchParams.set("filterByFormula", filterFormula);
    url.searchParams.set("pageSize", "100");
    if (offset) url.searchParams.set("offset", offset);

    const res = await airtableFetch(url.toString());
    const data = await res.json();

    if (data.error) {
      console.error("[TRAPPER-SYNC] Airtable API error:", data.error);
      break;
    }

    records.push(...(data.records || []));
    offset = data.offset;
  } while (offset);

  return records;
}

async function updateAirtableRecord(
  recordId: string,
  fields: Record<string, unknown>
): Promise<void> {
  await airtableFetch(
    `/${ATLAS_SYNC_BASE_ID}/${encodeURIComponent(TRAPPER_AGREEMENTS_TABLE)}/${recordId}`,
    {
      method: "PATCH",
      body: JSON.stringify({ fields }),
    }
  );
}

async function syncTrapperRecord(record: AirtableTrapperRecord): Promise<SyncResult> {
  const f = record.fields;

  try {
    // Validate required fields
    const firstName = f.first_name?.trim();
    const lastName = f.last_name?.trim();
    const email = f.Email?.trim()?.toLowerCase();

    if (!firstName || !lastName) {
      return {
        success: false,
        recordId: record.id,
        error: "Missing required fields: first_name and last_name",
      };
    }

    if (!email || !email.includes("@")) {
      return {
        success: false,
        recordId: record.id,
        error: "Missing or invalid email address",
      };
    }

    // Step 1: Resolve identity (creates person if new, matches if existing)
    const identityResult = await queryOne<{
      person_id: string;
      match_type: string;
    }>(
      `SELECT * FROM sot.data_engine_resolve_identity($1, $2, $3, $4, $5, $6)`,
      [
        email,
        f.Phone?.trim() || null,
        firstName,
        lastName,
        f.address?.trim() || null,
        "atlas_sync",
      ]
    );

    if (!identityResult) {
      return {
        success: false,
        recordId: record.id,
        error: "Identity resolution returned no result",
      };
    }

    const personId = identityResult.person_id;

    // Step 2: Add trapper role (idempotent)
    await queryOne(
      `INSERT INTO sot.person_roles (person_id, role, source_system)
       VALUES ($1, 'trapper', 'atlas_sync')
       ON CONFLICT DO NOTHING
       RETURNING person_id`,
      [personId]
    );

    // Step 3: Create/update trapper profile
    const profileNotes = [
      f.availability ? `Availability: ${f.availability}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const hasSigned = !!f.Signature;

    await queryOne(
      `INSERT INTO sot.trapper_profiles (
         person_id, trapper_type, is_active,
         has_signed_contract, contract_signed_date, contract_areas,
         notes, source_system
       ) VALUES (
         $1, 'community_trapper', true,
         $2, $3, NULL,
         $4, 'atlas_sync'
       )
       ON CONFLICT (person_id) DO UPDATE SET
         has_signed_contract = EXCLUDED.has_signed_contract OR sot.trapper_profiles.has_signed_contract,
         contract_signed_date = COALESCE(EXCLUDED.contract_signed_date, sot.trapper_profiles.contract_signed_date),
         notes = CASE
           WHEN sot.trapper_profiles.notes IS NULL THEN EXCLUDED.notes
           WHEN EXCLUDED.notes IS NULL THEN sot.trapper_profiles.notes
           ELSE sot.trapper_profiles.notes || E'\n[Agreement Sync] ' || EXCLUDED.notes
         END,
         updated_at = NOW()
       RETURNING person_id`,
      [
        personId,
        hasSigned,
        hasSigned ? new Date().toISOString().slice(0, 10) : null,
        profileNotes || null,
      ]
    );

    // Step 4: Audit trail
    await queryOne(
      `INSERT INTO sot.entity_edits (
         entity_type, entity_id, edit_type, field_name,
         new_value, edit_source, reason
       ) VALUES (
         'person', $1, 'create', 'trapper_onboarding',
         $2, 'trapper-agreement-sync',
         'Community trapper agreement synced from Airtable'
       )`,
      [
        personId,
        JSON.stringify({
          airtable_record_id: record.id,
          email,
          match_type: identityResult.match_type,
          has_signature: hasSigned,
          availability: f.availability || null,
        }),
      ]
    );

    return {
      success: true,
      recordId: record.id,
      personId,
      matchType: identityResult.match_type,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[TRAPPER-SYNC] Error for record ${record.id}:`, errorMessage);
    return {
      success: false,
      recordId: record.id,
      error: `Sync failed: ${errorMessage}`,
    };
  }
}

// Main sync handler (both GET for cron and POST for manual trigger)
async function handleSync(request: NextRequest) {
  // Verify auth
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-vercel-cron");

  if (!cronHeader && CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return apiError("Unauthorized", 401);
  }

  if (!AIRTABLE_PAT) {
    return apiServerError("AIRTABLE_PAT not configured");
  }

  const startTime = Date.now();
  const results: SyncResult[] = [];

  try {
    const pendingRecords = await getPendingRecords();
    console.error(`[TRAPPER-SYNC] Found ${pendingRecords.length} pending records`);

    if (pendingRecords.length === 0) {
      return apiSuccess({
        message: "No pending trapper agreements to sync",
        synced: 0,
        errors: 0,
        duration_ms: Date.now() - startTime,
      });
    }

    // Process each record
    for (const record of pendingRecords) {
      const result = await syncTrapperRecord(record);
      results.push(result);

      // Update Airtable with sync result
      if (result.success) {
        await updateAirtableRecord(record.id, {
          "Sync Status": "synced",
          "Atlas Person ID": result.personId,
          "Synced At": new Date().toISOString(),
          "Sync Error": null,
        });
      } else {
        await updateAirtableRecord(record.id, {
          "Sync Status": "error",
          "Sync Error": result.error,
          "Synced At": new Date().toISOString(),
        });
      }
    }

    const synced = results.filter((r) => r.success).length;
    const errors = results.filter((r) => !r.success).length;

    return apiSuccess({
      message: `Synced ${synced} trapper agreements, ${errors} errors`,
      synced,
      errors,
      duration_ms: Date.now() - startTime,
      results: results.map((r) => ({
        recordId: r.recordId,
        success: r.success,
        personId: r.personId,
        matchType: r.matchType,
        error: r.error,
      })),
    });
  } catch (error) {
    console.error("[TRAPPER-SYNC] Fatal error:", error);
    return apiServerError("Trapper agreement sync failed");
  }
}

export async function GET(request: NextRequest) {
  return handleSync(request);
}

export async function POST(request: NextRequest) {
  return handleSync(request);
}
