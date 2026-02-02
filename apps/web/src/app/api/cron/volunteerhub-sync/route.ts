import { NextRequest, NextResponse } from "next/server";
import { queryOne, queryRows, execute } from "@/lib/db";

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
//   - VOLUNTEERHUB_API_KEY: Basic auth credential for VH API
//   - CRON_SECRET: Optional secret for manual trigger security

export const maxDuration = 300;

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
      Authorization: `basic ${VOLUNTEERHUB_API_KEY}`,
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
      `INSERT INTO trapper.volunteerhub_user_groups
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
          `INSERT INTO trapper.volunteerhub_volunteers (
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
              `SELECT trapper.match_volunteerhub_volunteer($1)`,
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
          `SELECT matched_person_id FROM trapper.volunteerhub_volunteers
           WHERE volunteerhub_id = $1 AND matched_person_id IS NOT NULL`,
          [user.UserId]
        );

        if (matched) {
          try {
            await execute(
              `SELECT trapper.sync_volunteer_group_memberships($1, $2)`,
              [user.UserId, groupUids]
            );
            await execute(
              `SELECT trapper.process_volunteerhub_group_roles($1, $2)`,
              [matched.matched_person_id, user.UserId]
            );
            stats.rolesProcessed++;

            // Link volunteer to their home place (uses VH address data)
            const linkResult = await queryOne<{ result: string }>(
              `SELECT trapper.link_vh_volunteer_to_place($1)::text AS result`,
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
// Route Handler
// ============================================

export async function GET(request: NextRequest) {
  // Auth check
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-vercel-cron");

  if (!cronHeader && CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!VOLUNTEERHUB_API_KEY) {
    return NextResponse.json(
      { error: "VOLUNTEERHUB_API_KEY not configured" },
      { status: 500 }
    );
  }

  const startTime = Date.now();

  try {
    // Determine sync mode: full sync on Sundays, incremental otherwise
    const dayOfWeek = new Date().getDay();
    const forceMode = new URL(request.url).searchParams.get("mode");
    const isFullSync =
      forceMode === "full" || (forceMode !== "incremental" && dayOfWeek === 0);

    console.log(
      `VolunteerHub sync starting (${isFullSync ? "full" : "incremental"})...`
    );

    // Step 1: Verify API auth
    await vhFetch("/api/v1/organization");
    console.log("VH API auth verified");

    // Step 2: Sync user groups
    const groupResult = await syncUserGroups();
    console.log(
      `Groups synced: ${groupResult.fetched} fetched, ${groupResult.upserted} upserted`
    );

    // Step 3: Determine incremental cutoff
    let incrementalCutoff: string | null = null;
    if (!isFullSync) {
      const lastSync = await queryOne<{ last_sync: string }>(
        `SELECT MAX(last_api_sync_at)::text AS last_sync
         FROM trapper.volunteerhub_volunteers
         WHERE last_api_sync_at IS NOT NULL`
      );
      if (lastSync?.last_sync) {
        // 1-day overlap for safety
        const d = new Date(lastSync.last_sync);
        d.setDate(d.getDate() - 1);
        incrementalCutoff = `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
        console.log(`Incremental cutoff: ${incrementalCutoff}`);
      } else {
        console.log("No previous sync found, doing full sync");
      }
    }

    // Step 4: Sync users
    const userStats = await syncUsers(incrementalCutoff);
    console.log(
      `Users synced: ${userStats.fetched} fetched, ${userStats.inserted} new, ${userStats.updated} updated`
    );

    // Step 5: Reconcile — deactivate roles not backed by current VH groups
    let reconciliation: { deactivated: number } | null = null;
    try {
      const result = await queryOne<{ result: string }>(
        `SELECT trapper.enforce_vh_role_authority(p_dry_run := false)::text AS result`
      );
      if (result?.result) {
        reconciliation = JSON.parse(result.result);
        console.log(
          `Role reconciliation: ${reconciliation?.deactivated ?? 0} roles deactivated`
        );
      }
    } catch (reconcileErr) {
      console.error(
        "Role reconciliation error:",
        reconcileErr instanceof Error ? reconcileErr.message : reconcileErr
      );
    }

    // Step 6: Log to ingest_runs
    const durationMs = Date.now() - startTime;
    try {
      await execute(
        `INSERT INTO trapper.ingest_runs (
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
            reconciliation: reconciliation
              ? { roles_deactivated: reconciliation.deactivated }
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

    return NextResponse.json({
      success: true,
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
      reconciliation: reconciliation
        ? { roles_deactivated: reconciliation.deactivated }
        : null,
      duration_ms: durationMs,
    });
  } catch (error) {
    console.error("VolunteerHub sync error:", error);
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

// POST endpoint for manual triggers
export async function POST(request: NextRequest) {
  return GET(request);
}
