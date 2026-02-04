import { NextRequest, NextResponse } from "next/server";
import { queryOne, queryRows, execute } from "@/lib/db";
import crypto from "crypto";

// ShelterLuv API Sync Cron Job
//
// Runs daily to sync animals, people, and events from ShelterLuv API.
// Supports incremental sync using the `after` parameter.
//
// Vercel Cron: Add to vercel.json:
//   "crons": [{ "path": "/api/cron/shelterluv-sync", "schedule": "0 6 * * *" }]
//
// Environment Variables Required:
//   - SHELTERLUV_API_KEY: Format "accountid|token"
//   - CRON_SECRET: Optional secret for manual trigger security

// Allow up to 300 seconds for API pagination
export const maxDuration = 300;

const SHELTERLUV_API_KEY = process.env.SHELTERLUV_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const API_BASE_URL = "https://www.shelterluv.com/api/v1";
const RATE_LIMIT_DELAY_MS = 250;
const SOURCE_SYSTEM = "shelterluv";

// ============================================
// API Client
// ============================================

async function shelterLuvFetch(
  endpoint: string,
  params: Record<string, string | number> = {}
): Promise<unknown> {
  const url = new URL(`${API_BASE_URL}${endpoint}`);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url.toString(), {
    headers: {
      "X-Api-Key": SHELTERLUV_API_KEY!,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API error ${response.status}: ${text}`);
  }

  // Rate limiting
  await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_DELAY_MS));

  return response.json();
}

interface FetchAllResult {
  records: unknown[];
  totalCount: number;
  apiRequests: number;
}

async function fetchAllRecords(
  endpoint: string,
  recordsKey: string,
  afterTimestamp: number | null,
  limit: number = 0
): Promise<FetchAllResult> {
  const allRecords: unknown[] = [];
  let offset = 0;
  const pageSize = 100;
  let apiRequests = 0;
  let totalCount = 0;

  while (true) {
    const params: Record<string, string | number> = { offset };
    if (afterTimestamp) {
      params.after = afterTimestamp;
    }

    const data = (await shelterLuvFetch(endpoint, params)) as Record<
      string,
      unknown
    >;
    apiRequests++;

    const records = (data[recordsKey] || []) as unknown[];
    totalCount = (data.total_count as number) || 0;

    if (records.length === 0) {
      break;
    }

    allRecords.push(...records);

    // Check if we've hit the limit
    if (limit > 0 && allRecords.length >= limit) {
      return {
        records: allRecords.slice(0, limit),
        totalCount,
        apiRequests,
      };
    }

    // Check if we've fetched all records
    if (allRecords.length >= totalCount || records.length < pageSize) {
      break;
    }

    offset += pageSize;
  }

  return { records: allRecords, totalCount, apiRequests };
}

// ============================================
// Database Operations
// ============================================

function computeRowHash(row: unknown): string {
  const obj = row as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    let value = obj[key];
    if (typeof value === "string") {
      value = value.trim().toLowerCase();
    } else if (typeof value === "object" && value !== null) {
      value = JSON.stringify(value);
    }
    if (value !== "" && value !== null && value !== undefined) {
      normalized[key] = value;
    }
  }
  const json = JSON.stringify(normalized);
  return crypto.createHash("sha256").update(json).digest("hex").substring(0, 32);
}

interface SyncState {
  last_sync_timestamp: number | null;
  last_sync_at: Date | null;
  records_synced: number;
}

async function getSyncState(syncType: string): Promise<SyncState> {
  const result = await queryOne<SyncState>(
    `SELECT last_sync_timestamp, last_sync_at, records_synced
     FROM trapper.shelterluv_sync_state
     WHERE sync_type = $1`,
    [syncType]
  );
  return result || { last_sync_timestamp: null, last_sync_at: null, records_synced: 0 };
}

async function updateSyncState(
  syncType: string,
  lastTimestamp: number | null,
  recordsSynced: number,
  totalRecords: number,
  error: string | null = null
): Promise<void> {
  await execute(
    `SELECT trapper.update_shelterluv_sync_state($1, $2, $3, $4, $5)`,
    [syncType, lastTimestamp, recordsSynced, totalRecords, error]
  );
}

interface StageResult {
  id: number;
  was_inserted: boolean;
}

async function stageRecord(
  sourceTable: string,
  record: unknown,
  sourceRowId: string
): Promise<StageResult> {
  const rowHash = computeRowHash(record);

  const result = await queryOne<StageResult>(
    `INSERT INTO trapper.staged_records (
      source_system, source_table, source_row_id, row_hash, payload,
      created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
    ON CONFLICT (source_system, source_table, row_hash)
    DO UPDATE SET updated_at = NOW()
    RETURNING id, (xmax = 0) AS was_inserted`,
    [SOURCE_SYSTEM, sourceTable, sourceRowId, rowHash, JSON.stringify(record)]
  );

  return result || { id: 0, was_inserted: false };
}

// ============================================
// Sync Functions
// ============================================

interface SyncResult {
  inserted: number;
  skipped: number;
  total: number;
  apiRequests: number;
  lastTimestamp: number | null;
}

async function syncEndpoint(
  endpoint: string,
  recordsKey: string,
  sourceTable: string,
  idField: string,
  timestampField: string,
  incremental: boolean
): Promise<SyncResult> {
  let afterTimestamp: number | null = null;

  if (incremental) {
    const state = await getSyncState(sourceTable);
    afterTimestamp = state.last_sync_timestamp;
  }

  const { records, totalCount, apiRequests } = await fetchAllRecords(
    endpoint,
    recordsKey,
    afterTimestamp
  );

  let inserted = 0;
  let skipped = 0;
  let lastTimestamp = afterTimestamp;

  for (const record of records) {
    const rec = record as Record<string, unknown>;
    const sourceRowId = String(rec[idField] || rec["Internal-ID"] || rec.ID);

    // Track latest timestamp for incremental sync
    const ts = rec[timestampField];
    if (ts) {
      const timestamp = parseInt(String(ts), 10);
      if (!lastTimestamp || timestamp > lastTimestamp) {
        lastTimestamp = timestamp;
      }
    }

    const result = await stageRecord(sourceTable, record, sourceRowId);
    if (result.was_inserted) {
      inserted++;
    } else {
      skipped++;
    }
  }

  if (records.length > 0) {
    await updateSyncState(sourceTable, lastTimestamp, records.length, totalCount);
  }

  return {
    inserted,
    skipped,
    total: records.length,
    apiRequests,
    lastTimestamp,
  };
}

// ============================================
// Route Handlers
// ============================================

export async function GET(request: NextRequest) {
  // Verify this is from Vercel Cron or has valid secret
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-vercel-cron");

  if (!cronHeader && CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!SHELTERLUV_API_KEY) {
    return NextResponse.json(
      { error: "SHELTERLUV_API_KEY not configured" },
      { status: 500 }
    );
  }

  const startTime = Date.now();
  const url = new URL(request.url);
  const incremental = url.searchParams.get("incremental") !== "false";
  const syncType = url.searchParams.get("type"); // 'animals', 'people', 'events', or null for all

  try {
    const results: Record<string, SyncResult> = {};
    let totalApiRequests = 0;

    // Sync in order: people first (for identity resolution), then animals, then events
    if (!syncType || syncType === "people") {
      console.log("Syncing people...");
      results.people = await syncEndpoint(
        "/people",
        "people",
        "people",
        "Internal-ID",
        "LastUpdatedUnixTime",
        incremental
      );
      totalApiRequests += results.people.apiRequests;
    }

    if (!syncType || syncType === "animals") {
      console.log("Syncing animals...");
      results.animals = await syncEndpoint(
        "/animals",
        "animals",
        "animals",
        "Internal-ID",
        "LastUpdatedUnixTime",
        incremental
      );
      totalApiRequests += results.animals.apiRequests;
    }

    if (!syncType || syncType === "events") {
      console.log("Syncing events...");
      results.events = await syncEndpoint(
        "/events",
        "events",
        "events",
        "Internal-ID",
        "Time",
        incremental
      );
      totalApiRequests += results.events.apiRequests;
    }

    // Process staged records through Data Engine processors
    // Always process unprocessed records (catches backfills + resets)
    const processing: Record<string, unknown> = {};

    // Process people first (identity resolution)
    if (!syncType || syncType === "people") {
      const unprocessedPeople = await queryOne<{ count: number }>(
        `SELECT COUNT(*)::int as count FROM trapper.staged_records
         WHERE source_system = 'shelterluv' AND source_table = 'people'
           AND is_processed IS NOT TRUE`
      );
      if (unprocessedPeople && unprocessedPeople.count > 0) {
        console.log(`Processing ${unprocessedPeople.count} people through Data Engine...`);
        const peopleResult = await queryOne<{
          records_processed: number;
          people_created: number;
          people_updated: number;
          errors: number;
        }>(
          `SELECT * FROM trapper.process_shelterluv_people_batch($1)`,
          [500]
        );
        processing.people = peopleResult;
      }
    }

    // Process animals (creates cats + detects fosters)
    if (!syncType || syncType === "animals") {
      const animalBatchSize = 100;
      const unprocessedAnimals = await queryRows<{ id: string }>(
        `SELECT id::text FROM trapper.staged_records
         WHERE source_system = 'shelterluv'
           AND source_table = 'animals'
           AND is_processed IS NOT TRUE
         LIMIT $1`,
        [animalBatchSize]
      );

      if (unprocessedAnimals.length > 0) {
        console.log(`Processing ${unprocessedAnimals.length} animals through Data Engine...`);
        let animalsProcessed = 0;
        for (const animal of unprocessedAnimals) {
          try {
            await execute(
              `SELECT trapper.process_shelterluv_animal($1::uuid)`,
              [animal.id]
            );
            animalsProcessed++;
          } catch (err) {
            console.error("Error processing animal:", animal.id, err);
          }
        }
        processing.animals = { processed: animalsProcessed };
      }
    }

    // Process outcome events (adoptions, fosters, TNR, mortality, relocations)
    if (!syncType || syncType === "events") {
      const unprocessedOutcomes = await queryOne<{ count: number }>(
        `SELECT COUNT(*)::int as count FROM trapper.staged_records
         WHERE source_system = 'shelterluv' AND source_table = 'events'
           AND is_processed IS NOT TRUE
           AND payload->>'Type' LIKE 'Outcome.%'`
      );
      if (unprocessedOutcomes && unprocessedOutcomes.count > 0) {
        console.log(`Processing ${unprocessedOutcomes.count} outcome events...`);
        const eventsResult = await queryOne<{
          events_processed: number;
          adoptions_created: number;
          fosters_created: number;
          tnr_releases: number;
          mortality_events: number;
          returns_processed: number;
          transfers_logged: number;
          errors: number;
        }>(
          `SELECT * FROM trapper.process_shelterluv_events($1)`,
          [500]
        );
        processing.events = eventsResult;
      }

      // Process intake events (FeralWildlife, OwnerSurrender, Stray, etc.)
      const unprocessedIntake = await queryOne<{ count: number }>(
        `SELECT COUNT(*)::int as count FROM trapper.staged_records
         WHERE source_system = 'shelterluv' AND source_table = 'events'
           AND is_processed IS NOT TRUE
           AND payload->>'Type' LIKE 'Intake.%'`
      );
      if (unprocessedIntake && unprocessedIntake.count > 0) {
        console.log(`Processing ${unprocessedIntake.count} intake events...`);
        const intakeResult = await queryOne<{
          events_processed: number;
          intake_created: number;
          animals_matched: number;
          animals_unmatched: number;
          owner_surrenders_linked: number;
          errors: number;
        }>(
          `SELECT * FROM trapper.process_shelterluv_intake_events($1)`,
          [500]
        );
        processing.intake = intakeResult;
      }
    }

    // Get current sync status
    const syncStatus = await queryRows<{
      sync_type: string;
      last_sync_at: Date | null;
      records_synced: number;
      pending_processing: number;
      sync_health: string;
    }>(
      `SELECT sync_type, last_sync_at, records_synced::int, pending_processing::int, sync_health
       FROM trapper.v_shelterluv_sync_status`
    );

    // Calculate totals
    const totalInserted = Object.values(results).reduce((sum, r) => sum + r.inserted, 0);
    const totalSkipped = Object.values(results).reduce((sum, r) => sum + r.skipped, 0);
    const totalRecords = Object.values(results).reduce((sum, r) => sum + r.total, 0);

    return NextResponse.json({
      success: true,
      message: `Synced ${totalRecords} records (${totalInserted} new, ${totalSkipped} unchanged)`,
      incremental,
      staging: {
        animals: results.animals || null,
        people: results.people || null,
        events: results.events || null,
      },
      processing,
      totals: {
        inserted: totalInserted,
        skipped: totalSkipped,
        total: totalRecords,
        api_requests: totalApiRequests,
      },
      sync_status: syncStatus,
      duration_ms: Date.now() - startTime,
    });
  } catch (error) {
    console.error("ShelterLuv sync error:", error);

    // Update sync state with error
    const errorMessage = error instanceof Error ? error.message : String(error);

    return NextResponse.json(
      {
        error: "Sync failed",
        message: errorMessage,
        duration_ms: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}

// POST endpoint for manual triggers with same logic
export async function POST(request: NextRequest) {
  return GET(request);
}
