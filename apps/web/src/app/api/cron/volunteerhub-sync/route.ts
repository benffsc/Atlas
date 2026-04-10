import { NextRequest } from "next/server";
import { queryOne, queryRows, execute } from "@/lib/db";
import { apiSuccess, apiServerError, apiError } from "@/lib/api-response";

// VolunteerHub API Sync Cron Job
//
// Runs daily to sync user groups and volunteers from VolunteerHub API.
// Full sync on Sundays, incremental otherwise.
// The full 52-field extraction lives in scripts/ingest/volunteerhub_api_sync.mjs;
// this cron handles the essentials: groups, user basics, and role processing.
//
// Vercel Cron: Add to vercel.json:
//   "crons": [{ "path": "/api/cron/volunteerhub-sync", "schedule": "0 7 * * *" }]
//
// Environment Variables Required:
//   - VOLUNTEERHUB_USERNAME: VH account username (e.g., 'benffsc')
//   - VOLUNTEERHUB_PASSWORD: VH account password (MUST be < 16 characters per VH support)
//   - VOLUNTEERHUB_API_KEY: Fallback — base64(username:password) or raw key
//   - CRON_SECRET: Optional secret for manual trigger security
//
// NOTE: VH API uses HTTP Basic Auth with username:password.
// The API Keys in VH Settings → API Keys are for Zapier ONLY, not the REST API.
// Per Jennifer Udan (VH support, 2026-04-01): password must be < 16 characters.

export const maxDuration = 300;

const VOLUNTEERHUB_USERNAME = process.env.VOLUNTEERHUB_USERNAME;
const VOLUNTEERHUB_PASSWORD = process.env.VOLUNTEERHUB_PASSWORD;
const VOLUNTEERHUB_API_KEY = process.env.VOLUNTEERHUB_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const API_BASE = "https://forgottenfelines.volunteerhub.com";
const RATE_LIMIT_MS = 250;
const SOURCE_SYSTEM = "volunteerhub";

// ============================================
// API Client
// ============================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Build Basic Auth header from username + password, falling back to API key */
function getAuthHeader(): string {
  // Preferred: explicit username + password → Basic base64(user:pass)
  if (VOLUNTEERHUB_USERNAME && VOLUNTEERHUB_PASSWORD) {
    const encoded = Buffer.from(`${VOLUNTEERHUB_USERNAME}:${VOLUNTEERHUB_PASSWORD}`).toString("base64");
    return `Basic ${encoded}`;
  }
  // Fallback: API key (may be pre-encoded base64 of user:pass)
  if (VOLUNTEERHUB_API_KEY) {
    return `Basic ${VOLUNTEERHUB_API_KEY}`;
  }
  throw new Error("No VH credentials: set VOLUNTEERHUB_USERNAME + VOLUNTEERHUB_PASSWORD");
}

async function vhFetch(
  path: string,
  params: Record<string, string | number> = {}
): Promise<unknown> {
  const url = new URL(`${API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: getAuthHeader(),
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`VH API ${response.status}: ${path} - ${text.substring(0, 200)}`);
  }

  await sleep(RATE_LIMIT_MS);
  return response.json();
}

// ============================================
// Types
// ============================================

interface VHUserGroup {
  UserGroupUid: string;
  Name: string;
  Description?: string;
  ParentUserGroupUid?: string | null;
}

interface VHUserGroupMembership {
  UserGroupUid: string;
}

interface VHFormAnswerName {
  FormQuestionUid: string;
  FormQuestionText?: string;
  FirstName?: string;
  LastName?: string;
}

interface VHFormAnswerPhone {
  FormQuestionUid: string;
  FormQuestionText?: string;
  PhoneNumber?: string;
}

interface VHFormAnswerEmail {
  FormQuestionUid: string;
  FormQuestionText?: string;
  EmailAddress?: string;
}

type VHFormAnswer = VHFormAnswerName | VHFormAnswerPhone | VHFormAnswerEmail | Record<string, unknown>;

interface VHUser {
  UserId: string;
  FirstName?: string;
  LastName?: string;
  EmailAddress?: string;
  IsActive?: boolean;
  UserGroupMemberships?: VHUserGroupMembership[];
  FormAnswers?: VHFormAnswer[];
}

// Event API types (VH /api/v1/events)
interface VHUserRegistration {
  UserUid: string;
  Hours?: number | null;
  RegistrationDate?: string;
  Deleted?: boolean;
  Waitlisted?: boolean;
}

interface VHUserGroupRegistration {
  UserGroupUid: string;
  UserRegistrations?: VHUserRegistration[];
}

interface VHEvent {
  EventUid: string;
  Title?: string;
  Description?: string;
  Time?: string;
  EndTime?: string;
  Location?: string;
  Version?: number;
  UserGroupRegistrations?: VHUserGroupRegistration[];
}

// ============================================
// Group Sync
// ============================================

async function syncUserGroups(): Promise<{ fetched: number; upserted: number }> {
  const allGroups: VHUserGroup[] = [];
  let page = 0;

  // Paginate through all groups
  while (true) {
    const data = (await vhFetch("/api/v1/userGroups", {
      pageSize: 100,
      page,
    })) as { UserGroups?: VHUserGroup[] };

    const groups = data.UserGroups || [];
    if (groups.length === 0) break;

    allGroups.push(...groups);
    if (groups.length < 100) break;
    page++;
  }

  // Upsert each group
  let upserted = 0;
  for (const group of allGroups) {
    await execute(
      `INSERT INTO source.volunteerhub_user_groups
         (user_group_uid, name, description, parent_user_group_uid, synced_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (user_group_uid) DO UPDATE SET
         name = $2, description = $3, parent_user_group_uid = $4, synced_at = NOW()`,
      [
        group.UserGroupUid,
        group.Name || "",
        group.Description || "",
        group.ParentUserGroupUid || null,
      ]
    );
    upserted++;
  }

  return { fetched: allGroups.length, upserted };
}

// ============================================
// User Sync
// ============================================

function extractContactFromFormAnswers(formAnswers: VHFormAnswer[]): {
  formEmail: string | null;
  formPhone: string | null;
  formFirstName: string | null;
  formLastName: string | null;
} {
  let formEmail: string | null = null;
  let formPhone: string | null = null;
  let formFirstName: string | null = null;
  let formLastName: string | null = null;

  for (const answer of formAnswers) {
    const a = answer as Record<string, unknown>;

    // FormAnswerName
    if (a.FirstName !== undefined || a.lastName !== undefined) {
      formFirstName = ((a.FirstName || a.firstName) as string) || null;
      formLastName = ((a.LastName || a.lastName) as string) || null;
    }

    // FormAnswerPhone
    if (a.PhoneNumber !== undefined || a.phoneNumber !== undefined) {
      formPhone = ((a.PhoneNumber || a.phoneNumber) as string) || null;
    }

    // FormAnswerEmail
    if (a.EmailAddress !== undefined && a.FormQuestionUid !== undefined) {
      formEmail = ((a.EmailAddress || a.emailAddress) as string) || null;
    }
  }

  return { formEmail, formPhone, formFirstName, formLastName };
}

interface UserSyncStats {
  fetched: number;
  inserted: number;
  updated: number;
  rolesProcessed: number;
  placesLinked: number;
  errors: number;
  apiPages: number;
}

async function syncUsers(
  incrementalCutoff: string | null
): Promise<UserSyncStats> {
  const stats: UserSyncStats = {
    fetched: 0,
    inserted: 0,
    updated: 0,
    rolesProcessed: 0,
    placesLinked: 0,
    errors: 0,
    apiPages: 0,
  };

  let page = 0;

  while (true) {
    const params: Record<string, string | number> = {
      pageSize: 100,
      page,
    };

    if (incrementalCutoff) {
      params.query = "LastUpdate";
      params.earliestLastUpdate = incrementalCutoff;
    }

    const data = (await vhFetch("/api/v2/users", params)) as {
      Users?: VHUser[];
    };
    stats.apiPages++;

    const users = data.Users || [];
    if (users.length === 0) break;

    stats.fetched += users.length;

    for (const user of users) {
      try {
        const formAnswers = user.FormAnswers || [];
        const { formEmail, formPhone, formFirstName, formLastName } =
          extractContactFromFormAnswers(formAnswers);

        const firstName = user.FirstName || formFirstName || "";
        const lastName = user.LastName || formLastName || "";
        const displayName = `${firstName} ${lastName}`.trim();
        const email =
          (user.EmailAddress || formEmail || "").toLowerCase().trim() || null;
        const phone = formPhone || null;
        const status = user.IsActive !== false ? "active" : "inactive";

        // Extract group UIDs
        const groupUids = (user.UserGroupMemberships || []).map(
          (m) => m.UserGroupUid
        );

        // Upsert into volunteerhub_volunteers (basic fields only)
        const result = await queryOne<{ was_inserted: boolean }>(
          `INSERT INTO source.volunteerhub_volunteers (
             volunteerhub_id, display_name, email, phone, first_name, last_name,
             status, is_active, user_group_uids, last_api_sync_at, synced_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
           ON CONFLICT (volunteerhub_id) DO UPDATE SET
             display_name = EXCLUDED.display_name,
             email = COALESCE(EXCLUDED.email, volunteerhub_volunteers.email),
             phone = COALESCE(EXCLUDED.phone, volunteerhub_volunteers.phone),
             first_name = EXCLUDED.first_name,
             last_name = EXCLUDED.last_name,
             status = EXCLUDED.status,
             is_active = EXCLUDED.is_active,
             user_group_uids = EXCLUDED.user_group_uids,
             last_api_sync_at = NOW(),
             synced_at = NOW()
           RETURNING (xmax = 0) AS was_inserted`,
          [
            user.UserId,
            displayName,
            email,
            phone,
            firstName,
            lastName,
            status,
            user.IsActive !== false,
            groupUids,
          ]
        );

        if (result?.was_inserted) {
          stats.inserted++;

          // New volunteer: run identity matching (respects match_locked + soft blacklist)
          try {
            await execute(
              `SELECT sot.match_volunteerhub_volunteer($1)`,
              [user.UserId]
            );
          } catch (matchErr) {
            console.error(
              `Match error for new volunteer ${user.UserId}:`,
              matchErr instanceof Error ? matchErr.message : matchErr
            );
          }
        } else {
          stats.updated++;
        }

        // Process roles for matched volunteers
        const matched = await queryOne<{ matched_person_id: string }>(
          `SELECT matched_person_id FROM source.volunteerhub_volunteers
           WHERE volunteerhub_id = $1 AND matched_person_id IS NOT NULL`,
          [user.UserId]
        );

        if (matched) {
          try {
            await execute(
              `SELECT sot.sync_volunteer_group_memberships($1, $2)`,
              [user.UserId, groupUids]
            );
            await execute(
              `SELECT ops.process_volunteerhub_group_roles($1, $2)`,
              [matched.matched_person_id, user.UserId]
            );
            stats.rolesProcessed++;

            // Link volunteer to their home place (uses VH address data)
            const linkResult = await queryOne<{ result: string }>(
              `SELECT sot.link_vh_volunteer_to_place($1)::text AS result`,
              [user.UserId]
            );
            if (linkResult?.result?.includes('"linked"')) {
              stats.placesLinked++;
            }
          } catch (roleErr) {
            console.error(
              `Role processing error for ${user.UserId}:`,
              roleErr instanceof Error ? roleErr.message : roleErr
            );
          }
        }
      } catch (err) {
        stats.errors++;
        console.error(
          `Error processing user ${user.UserId}:`,
          err instanceof Error ? err.message : err
        );
      }
    }

    if (users.length < 100) break;
    page++;
  }

  return stats;
}

// ============================================
// Event Sync
// ============================================

interface EventSyncStats {
  eventsFetched: number;
  eventsUpserted: number;
  registrationsUpserted: number;
  registrationsSkipped: number;
  apiPages: number;
  hoursBackfilled: { updated_count: number; total_hours: number; total_events: number } | null;
}

async function syncEvents(
  isFullSync: boolean,
  timeBudgetMs: number = 200_000
): Promise<EventSyncStats> {
  const syncStart = Date.now();
  const stats: EventSyncStats = {
    eventsFetched: 0,
    eventsUpserted: 0,
    registrationsUpserted: 0,
    registrationsSkipped: 0,
    apiPages: 0,
    hoursBackfilled: null,
  };

  // Determine date range: incremental = last 30 days, full = all
  const params: Record<string, string | number> = { pageSize: 100 };
  if (!isFullSync) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    params.earliestTime = `${thirtyDaysAgo.getMonth() + 1}/${thirtyDaysAgo.getDate()}/${thirtyDaysAgo.getFullYear()}`;
  }

  // Collect known volunteer IDs for FK safety
  const knownVolunteers = new Set<string>();
  const volRows = await queryRows<{ volunteerhub_id: string }>(
    `SELECT volunteerhub_id FROM source.volunteerhub_volunteers`
  );
  for (const row of volRows) {
    knownVolunteers.add(row.volunteerhub_id);
  }

  let page = 0;

  while (true) {
    // Time budget check
    if (Date.now() - syncStart > timeBudgetMs) {
      console.error(`[VH-SYNC] Event sync: time budget reached after ${stats.apiPages} pages, stopping`);
      break;
    }

    const data = (await vhFetch("/api/v1/events", { ...params, page })) as {
      Events?: VHEvent[];
    };
    stats.apiPages++;

    const events = data.Events || [];
    if (events.length === 0) break;

    stats.eventsFetched += events.length;

    for (const event of events) {
      // Upsert event
      const groupUid = event.UserGroupRegistrations?.[0]?.UserGroupUid || null;

      await execute(
        `INSERT INTO source.volunteerhub_events
           (event_uid, title, description, event_date, event_end_date, location, user_group_uid, vh_version, raw_data, synced_at)
         VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6, $7, $8, $9, NOW())
         ON CONFLICT (event_uid) DO UPDATE SET
           title = EXCLUDED.title,
           description = EXCLUDED.description,
           event_date = EXCLUDED.event_date,
           event_end_date = EXCLUDED.event_end_date,
           location = EXCLUDED.location,
           user_group_uid = EXCLUDED.user_group_uid,
           vh_version = EXCLUDED.vh_version,
           raw_data = EXCLUDED.raw_data,
           synced_at = NOW()`,
        [
          event.EventUid,
          event.Title || null,
          event.Description || null,
          event.Time || null,
          event.EndTime || null,
          event.Location || null,
          groupUid,
          event.Version || null,
          JSON.stringify(event),
        ]
      );
      stats.eventsUpserted++;

      // Walk nested registrations
      for (const groupReg of event.UserGroupRegistrations || []) {
        for (const userReg of groupReg.UserRegistrations || []) {
          // FK safety: skip unknown volunteers
          if (!knownVolunteers.has(userReg.UserUid)) {
            stats.registrationsSkipped++;
            continue;
          }

          await execute(
            `INSERT INTO source.volunteerhub_event_registrations
               (event_uid, volunteerhub_id, hours, registration_date, is_deleted, is_waitlisted, updated_at)
             VALUES ($1, $2, $3, $4::timestamptz, $5, $6, NOW())
             ON CONFLICT (event_uid, volunteerhub_id) DO UPDATE SET
               hours = EXCLUDED.hours,
               registration_date = EXCLUDED.registration_date,
               is_deleted = EXCLUDED.is_deleted,
               is_waitlisted = EXCLUDED.is_waitlisted,
               updated_at = NOW()`,
            [
              event.EventUid,
              userReg.UserUid,
              userReg.Hours ?? null,
              userReg.RegistrationDate || null,
              userReg.Deleted ?? false,
              userReg.Waitlisted ?? false,
            ]
          );
          stats.registrationsUpserted++;
        }
      }
    }

    if (events.length < 100) break;
    page++;
  }

  // Backfill hours onto volunteerhub_volunteers
  if (stats.eventsUpserted > 0) {
    try {
      const backfill = await queryOne<{
        updated_count: number;
        total_hours: number;
        total_events: number;
      }>(
        `SELECT * FROM source.backfill_volunteer_hours_from_events()`
      );
      stats.hoursBackfilled = backfill || null;
    } catch (err) {
      console.error(
        "Hours backfill error:",
        err instanceof Error ? err.message : err
      );
    }
  }

  // Update sync state
  await execute(
    `INSERT INTO source.volunteerhub_sync_state (sync_type, last_sync_at, records_synced, metadata, updated_at)
     VALUES ('events', NOW(), $1, $2, NOW())
     ON CONFLICT (sync_type) DO UPDATE SET
       last_sync_at = NOW(),
       records_synced = source.volunteerhub_sync_state.records_synced + $1,
       metadata = $2,
       updated_at = NOW()`,
    [
      stats.eventsUpserted,
      JSON.stringify({
        pages: stats.apiPages,
        registrations: stats.registrationsUpserted,
        skipped: stats.registrationsSkipped,
        full_sync: isFullSync,
      }),
    ]
  );

  return stats;
}

// ============================================
// Route Handler
// ============================================

export async function GET(request: NextRequest) {
  // Auth check
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-vercel-cron");

  if (!cronHeader && CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return apiError("Unauthorized", 401);
  }

  if (!VOLUNTEERHUB_API_KEY) {
    return apiServerError("VOLUNTEERHUB_API_KEY not configured");
  }

  const startTime = Date.now();

  try {
    // Determine sync mode: full sync on Sundays, incremental otherwise
    const dayOfWeek = new Date().getDay();
    const forceMode = new URL(request.url).searchParams.get("mode");
    const isFullSync =
      forceMode === "full" || (forceMode !== "incremental" && dayOfWeek === 0);

    console.error(
      `[VH-SYNC] Starting ${isFullSync ? "full" : "incremental"} sync...`
    );

    // Step 1: Verify API auth
    await vhFetch("/api/v1/organization");

    // Step 2: Sync user groups
    const groupResult = await syncUserGroups();

    // Step 3: Determine incremental cutoff
    let incrementalCutoff: string | null = null;
    if (!isFullSync) {
      const lastSync = await queryOne<{ last_sync: string }>(
        `SELECT MAX(last_api_sync_at)::text AS last_sync
         FROM source.volunteerhub_volunteers
         WHERE last_api_sync_at IS NOT NULL`
      );
      if (lastSync?.last_sync) {
        // 1-day overlap for safety
        const d = new Date(lastSync.last_sync);
        d.setDate(d.getDate() - 1);
        incrementalCutoff = `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
      } else {
        // No previous sync found, doing full sync
      }
    }

    // Step 4: Sync users
    const userStats = await syncUsers(incrementalCutoff);

    // Step 4.5: Sync events (hours live in /api/v1/events)
    let eventStats: EventSyncStats | null = null;
    try {
      // Time budget: leave 80s for remaining steps (reconciliation + enrichment + logging)
      const elapsed = Date.now() - startTime;
      const timeBudget = Math.max(30_000, 200_000 - elapsed);
      eventStats = await syncEvents(isFullSync, timeBudget);
      console.error(
        `[VH-SYNC] Events: ${eventStats.eventsUpserted} events, ${eventStats.registrationsUpserted} registrations` +
          (eventStats.hoursBackfilled
            ? `, ${eventStats.hoursBackfilled.updated_count} volunteers updated with hours`
            : "")
      );
    } catch (eventErr) {
      console.error(
        "Event sync error:",
        eventErr instanceof Error ? eventErr.message : eventErr
      );
    }

    // Step 5: Reconcile — deactivate roles not backed by current VH groups
    let reconciliation: { deactivated: number } | null = null;
    try {
      const result = await queryOne<{ result: string }>(
        `SELECT sot.enforce_vh_role_authority(p_dry_run := false)::text AS result`
      );
      if (result?.result) {
        reconciliation = JSON.parse(result.result);
        console.error(
          `[VH-SYNC] Role reconciliation: ${reconciliation?.deactivated ?? 0} roles deactivated`
        );
      }
    } catch (reconcileErr) {
      console.error(
        "Role reconciliation error:",
        reconcileErr instanceof Error ? reconcileErr.message : reconcileErr
      );
    }

    // Step 6: Enrich skeleton people (MIG_2516)
    let enrichment: { enriched_count: number; skipped_count: number; error_count: number } | null = null;
    try {
      const enrichResult = await queryOne<{
        enriched_count: number;
        skipped_count: number;
        error_count: number;
      }>(
        `SELECT enriched_count, skipped_count, error_count FROM sot.enrich_skeleton_people()`
      );
      if (enrichResult) {
        enrichment = enrichResult;
        console.error(
          `[VH-SYNC] Skeleton enrichment: ${enrichment.enriched_count} enriched, ${enrichment.skipped_count} skipped, ${enrichment.error_count} errors`
        );
      }
    } catch (enrichErr) {
      console.error(
        "Skeleton enrichment error:",
        enrichErr instanceof Error ? enrichErr.message : enrichErr
      );
    }

    // Step 7: Log to ingest_runs
    const durationMs = Date.now() - startTime;
    try {
      await execute(
        `INSERT INTO ops.ingest_runs (
           source_system, source_table, run_type, status,
           records_fetched, records_created, records_updated, records_errored,
           duration_ms, metadata, started_at, completed_at
         ) VALUES (
           $1, 'users', $2, $3,
           $4, $5, $6, $7,
           $8, $9, NOW() - ($8 || ' milliseconds')::interval, NOW()
         )`,
        [
          SOURCE_SYSTEM,
          isFullSync ? "full" : "incremental",
          userStats.errors > 0 ? "completed_with_errors" : "completed",
          userStats.fetched,
          userStats.inserted,
          userStats.updated,
          userStats.errors,
          durationMs,
          JSON.stringify({
            groups: groupResult,
            roles_processed: userStats.rolesProcessed,
            api_pages: userStats.apiPages,
            incremental_cutoff: incrementalCutoff,
            events: eventStats
              ? {
                  events_fetched: eventStats.eventsFetched,
                  events_upserted: eventStats.eventsUpserted,
                  registrations: eventStats.registrationsUpserted,
                  skipped: eventStats.registrationsSkipped,
                  hours_backfilled: eventStats.hoursBackfilled,
                }
              : null,
            reconciliation: reconciliation
              ? { roles_deactivated: reconciliation.deactivated }
              : null,
            enrichment: enrichment
              ? {
                  enriched: enrichment.enriched_count,
                  skipped: enrichment.skipped_count,
                  errors: enrichment.error_count,
                }
              : null,
          }),
        ]
      );
    } catch (logErr) {
      console.error(
        "Failed to log ingest run:",
        logErr instanceof Error ? logErr.message : logErr
      );
    }

    return apiSuccess({
      mode: isFullSync ? "full" : "incremental",
      incremental_cutoff: incrementalCutoff,
      groups: groupResult,
      users: {
        fetched: userStats.fetched,
        inserted: userStats.inserted,
        updated: userStats.updated,
        roles_processed: userStats.rolesProcessed,
        places_linked: userStats.placesLinked,
        errors: userStats.errors,
        api_pages: userStats.apiPages,
      },
      events: eventStats
        ? {
            events_upserted: eventStats.eventsUpserted,
            registrations: eventStats.registrationsUpserted,
            skipped: eventStats.registrationsSkipped,
            hours_backfilled: eventStats.hoursBackfilled,
          }
        : null,
      reconciliation: reconciliation
        ? { roles_deactivated: reconciliation.deactivated }
        : null,
      enrichment: enrichment
        ? {
            enriched: enrichment.enriched_count,
            skipped: enrichment.skipped_count,
            errors: enrichment.error_count,
          }
        : null,
      duration_ms: durationMs,
    });
  } catch (error) {
    console.error("VolunteerHub sync error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return apiServerError(errorMessage);
  }
}

// POST endpoint for manual triggers
export async function POST(request: NextRequest) {
  return GET(request);
}
