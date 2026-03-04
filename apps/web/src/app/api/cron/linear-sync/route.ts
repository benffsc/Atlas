import { NextRequest } from "next/server";
import { queryOne, queryRows, execute } from "@/lib/db";
import { apiSuccess, apiServerError, apiError } from "@/lib/api-response";
import crypto from "crypto";
import { getLinearClient } from "@/lib/linear/client";
import type {
  LinearIssue,
  LinearProject,
  LinearCycle,
  LinearUser,
  LinearLabel,
} from "@/lib/linear/types";

/**
 * Linear Sync Cron Job
 *
 * Syncs issues, projects, cycles, labels, and team members from Linear.
 * Stores raw data in source.linear_raw for immutable history.
 * Processes to ops.linear_* tables for querying.
 *
 * Vercel Cron: Add to vercel.json:
 *   "crons": [{ "path": "/api/cron/linear-sync", "schedule": "0 * * * *" }]
 *
 * Environment Variables Required:
 *   - LINEAR_API_KEY: Linear personal API key
 *   - CRON_SECRET: Optional secret for manual trigger security
 */

// Allow up to 300 seconds for API pagination
export const maxDuration = 300;

const CRON_SECRET = process.env.CRON_SECRET;

// ============================================
// Utilities
// ============================================

function computeRowHash(record: unknown): string {
  const obj = record as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    let value = obj[key];
    if (typeof value === "string") {
      value = value.trim();
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

// ============================================
// Sync State Management
// ============================================

interface SyncState {
  last_sync_cursor: string | null;
  last_sync_at: Date | null;
  records_synced: number;
}

async function getSyncState(syncType: string): Promise<SyncState> {
  const result = await queryOne<SyncState>(
    `SELECT last_sync_cursor, last_sync_at, records_synced
     FROM source.linear_sync_state
     WHERE sync_type = $1`,
    [syncType]
  );
  return result || { last_sync_cursor: null, last_sync_at: null, records_synced: 0 };
}

async function updateSyncState(
  syncType: string,
  cursor: string | null,
  recordsSynced: number,
  error: string | null = null
): Promise<void> {
  await execute(
    `INSERT INTO source.linear_sync_state (sync_type, last_sync_cursor, last_sync_at, records_synced, error_message, updated_at)
     VALUES ($1, $2, NOW(), $3, $4, NOW())
     ON CONFLICT (sync_type) DO UPDATE SET
       last_sync_cursor = EXCLUDED.last_sync_cursor,
       last_sync_at = EXCLUDED.last_sync_at,
       records_synced = source.linear_sync_state.records_synced + EXCLUDED.records_synced,
       error_message = EXCLUDED.error_message,
       updated_at = NOW()`,
    [syncType, cursor, recordsSynced, error]
  );
}

// ============================================
// Raw Storage
// ============================================

interface StageResult {
  id: string;
  was_inserted: boolean;
}

async function storeRawRecord(
  recordType: string,
  sourceRecordId: string,
  payload: unknown,
  syncRunId: string
): Promise<StageResult> {
  const rowHash = computeRowHash(payload);

  const result = await queryOne<StageResult>(
    `INSERT INTO source.linear_raw (
      record_type, source_record_id, payload, row_hash, fetched_at, sync_run_id
    ) VALUES ($1, $2, $3, $4, NOW(), $5)
    ON CONFLICT (record_type, source_record_id, row_hash)
    DO UPDATE SET fetched_at = NOW()
    RETURNING id::text, (xmax = 0) AS was_inserted`,
    [recordType, sourceRecordId, JSON.stringify(payload), rowHash, syncRunId]
  );

  return result || { id: "", was_inserted: false };
}

// ============================================
// Issue Processing
// ============================================

async function processIssueToOps(issue: LinearIssue, sourceRawId: string): Promise<void> {
  await execute(
    `INSERT INTO ops.linear_issues (
      linear_id, identifier, title, description,
      state_id, state_name, state_type,
      priority, priority_label,
      project_id, project_name,
      cycle_id, cycle_name,
      assignee_id, assignee_name,
      creator_id, creator_name,
      labels, estimate, due_date,
      created_at, updated_at, started_at, completed_at, canceled_at, archived_at,
      url, source_raw_id, synced_at
    ) VALUES (
      $1, $2, $3, $4,
      $5, $6, $7,
      $8, $9,
      $10, $11,
      $12, $13,
      $14, $15,
      $16, $17,
      $18, $19, $20,
      $21, $22, $23, $24, $25, $26,
      $27, $28, NOW()
    )
    ON CONFLICT (linear_id) DO UPDATE SET
      identifier = EXCLUDED.identifier,
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      state_id = EXCLUDED.state_id,
      state_name = EXCLUDED.state_name,
      state_type = EXCLUDED.state_type,
      priority = EXCLUDED.priority,
      priority_label = EXCLUDED.priority_label,
      project_id = EXCLUDED.project_id,
      project_name = EXCLUDED.project_name,
      cycle_id = EXCLUDED.cycle_id,
      cycle_name = EXCLUDED.cycle_name,
      assignee_id = EXCLUDED.assignee_id,
      assignee_name = EXCLUDED.assignee_name,
      creator_id = EXCLUDED.creator_id,
      creator_name = EXCLUDED.creator_name,
      labels = EXCLUDED.labels,
      estimate = EXCLUDED.estimate,
      due_date = EXCLUDED.due_date,
      updated_at = EXCLUDED.updated_at,
      started_at = EXCLUDED.started_at,
      completed_at = EXCLUDED.completed_at,
      canceled_at = EXCLUDED.canceled_at,
      archived_at = EXCLUDED.archived_at,
      url = EXCLUDED.url,
      source_raw_id = EXCLUDED.source_raw_id,
      synced_at = NOW()`,
    [
      issue.id,
      issue.identifier,
      issue.title,
      issue.description,
      issue.state?.id || null,
      issue.state?.name || null,
      issue.state?.type || null,
      issue.priority,
      issue.priorityLabel,
      issue.project?.id || null,
      issue.project?.name || null,
      issue.cycle?.id || null,
      issue.cycle?.name || null,
      issue.assignee?.id || null,
      issue.assignee?.displayName || issue.assignee?.name || null,
      issue.creator?.id || null,
      issue.creator?.displayName || issue.creator?.name || null,
      JSON.stringify(issue.labels?.nodes || []),
      issue.estimate,
      issue.dueDate,
      issue.createdAt,
      issue.updatedAt,
      issue.startedAt,
      issue.completedAt,
      issue.canceledAt,
      issue.archivedAt,
      issue.url,
      sourceRawId,
    ]
  );
}

// ============================================
// Project Processing
// ============================================

async function processProjectToOps(project: LinearProject, sourceRawId: string): Promise<void> {
  await execute(
    `INSERT INTO ops.linear_projects (
      linear_id, name, description, state, icon, color,
      slug_id, url, target_date, start_date,
      created_at, updated_at, synced_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
    ON CONFLICT (linear_id) DO UPDATE SET
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      state = EXCLUDED.state,
      icon = EXCLUDED.icon,
      color = EXCLUDED.color,
      slug_id = EXCLUDED.slug_id,
      url = EXCLUDED.url,
      target_date = EXCLUDED.target_date,
      start_date = EXCLUDED.start_date,
      updated_at = EXCLUDED.updated_at,
      synced_at = NOW()`,
    [
      project.id,
      project.name,
      project.description,
      project.state,
      project.icon,
      project.color,
      project.slugId,
      project.url,
      project.targetDate,
      project.startDate,
      project.createdAt,
      project.updatedAt,
    ]
  );
}

// ============================================
// Cycle Processing
// ============================================

async function processCycleToOps(cycle: LinearCycle, sourceRawId: string): Promise<void> {
  await execute(
    `INSERT INTO ops.linear_cycles (
      linear_id, name, number, starts_at, ends_at, completed_at,
      progress, created_at, updated_at, synced_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
    ON CONFLICT (linear_id) DO UPDATE SET
      name = EXCLUDED.name,
      number = EXCLUDED.number,
      starts_at = EXCLUDED.starts_at,
      ends_at = EXCLUDED.ends_at,
      completed_at = EXCLUDED.completed_at,
      progress = EXCLUDED.progress,
      updated_at = EXCLUDED.updated_at,
      synced_at = NOW()`,
    [
      cycle.id,
      cycle.name,
      cycle.number,
      cycle.startsAt,
      cycle.endsAt,
      cycle.completedAt,
      cycle.progress,
      cycle.createdAt,
      cycle.updatedAt,
    ]
  );
}

// ============================================
// User Processing
// ============================================

async function processUserToOps(user: LinearUser, sourceRawId: string): Promise<void> {
  await execute(
    `INSERT INTO ops.linear_team_members (
      linear_id, name, display_name, email, avatar_url,
      is_active, admin, created_at, synced_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
    ON CONFLICT (linear_id) DO UPDATE SET
      name = EXCLUDED.name,
      display_name = EXCLUDED.display_name,
      email = EXCLUDED.email,
      avatar_url = EXCLUDED.avatar_url,
      is_active = EXCLUDED.is_active,
      admin = EXCLUDED.admin,
      synced_at = NOW()`,
    [
      user.id,
      user.name,
      user.displayName,
      user.email,
      user.avatarUrl,
      user.active,
      user.admin,
      user.createdAt,
    ]
  );
}

// ============================================
// Label Processing
// ============================================

async function processLabelToOps(label: LinearLabel, sourceRawId: string): Promise<void> {
  await execute(
    `INSERT INTO ops.linear_labels (
      linear_id, name, color, description, parent_id,
      created_at, synced_at
    ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
    ON CONFLICT (linear_id) DO UPDATE SET
      name = EXCLUDED.name,
      color = EXCLUDED.color,
      description = EXCLUDED.description,
      parent_id = EXCLUDED.parent_id,
      synced_at = NOW()`,
    [
      label.id,
      label.name,
      label.color,
      label.description,
      label.parent?.id || null,
      label.createdAt,
    ]
  );
}

// ============================================
// Sync Functions
// ============================================

interface SyncResult {
  fetched: number;
  inserted: number;
  updated: number;
  errors: number;
}

async function syncIssues(syncRunId: string): Promise<SyncResult> {
  const client = getLinearClient();
  const result: SyncResult = { fetched: 0, inserted: 0, updated: 0, errors: 0 };

  try {
    const issues = await client.getAllIssues(undefined, (count) => {
      console.error(`[LINEAR-SYNC] Fetched ${count} issues...`);
    });
    result.fetched = issues.length;

    for (const issue of issues) {
      try {
        const stageResult = await storeRawRecord("issue", issue.id, issue, syncRunId);
        if (stageResult.was_inserted) {
          result.inserted++;
        } else {
          result.updated++;
        }
        await processIssueToOps(issue, stageResult.id);
      } catch (err) {
        console.error("Error processing issue:", issue.id, err);
        result.errors++;
      }
    }

    await updateSyncState("issues", null, result.fetched);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateSyncState("issues", null, 0, msg);
    throw err;
  }

  return result;
}

async function syncProjects(syncRunId: string): Promise<SyncResult> {
  const client = getLinearClient();
  const result: SyncResult = { fetched: 0, inserted: 0, updated: 0, errors: 0 };

  try {
    const projects = await client.getAllProjects();
    result.fetched = projects.length;

    for (const project of projects) {
      try {
        const stageResult = await storeRawRecord("project", project.id, project, syncRunId);
        if (stageResult.was_inserted) {
          result.inserted++;
        } else {
          result.updated++;
        }
        await processProjectToOps(project, stageResult.id);
      } catch (err) {
        console.error("Error processing project:", project.id, err);
        result.errors++;
      }
    }

    await updateSyncState("projects", null, result.fetched);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateSyncState("projects", null, 0, msg);
    throw err;
  }

  return result;
}

async function syncCycles(syncRunId: string): Promise<SyncResult> {
  const client = getLinearClient();
  const result: SyncResult = { fetched: 0, inserted: 0, updated: 0, errors: 0 };

  try {
    const cycles = await client.getAllCycles();
    result.fetched = cycles.length;

    for (const cycle of cycles) {
      try {
        const stageResult = await storeRawRecord("cycle", cycle.id, cycle, syncRunId);
        if (stageResult.was_inserted) {
          result.inserted++;
        } else {
          result.updated++;
        }
        await processCycleToOps(cycle, stageResult.id);
      } catch (err) {
        console.error("Error processing cycle:", cycle.id, err);
        result.errors++;
      }
    }

    await updateSyncState("cycles", null, result.fetched);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateSyncState("cycles", null, 0, msg);
    throw err;
  }

  return result;
}

async function syncUsers(syncRunId: string): Promise<SyncResult> {
  const client = getLinearClient();
  const result: SyncResult = { fetched: 0, inserted: 0, updated: 0, errors: 0 };

  try {
    const users = await client.getAllUsers();
    result.fetched = users.length;

    for (const user of users) {
      try {
        const stageResult = await storeRawRecord("user", user.id, user, syncRunId);
        if (stageResult.was_inserted) {
          result.inserted++;
        } else {
          result.updated++;
        }
        await processUserToOps(user, stageResult.id);
      } catch (err) {
        console.error("Error processing user:", user.id, err);
        result.errors++;
      }
    }

    await updateSyncState("team_members", null, result.fetched);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateSyncState("team_members", null, 0, msg);
    throw err;
  }

  return result;
}

async function syncLabels(syncRunId: string): Promise<SyncResult> {
  const client = getLinearClient();
  const result: SyncResult = { fetched: 0, inserted: 0, updated: 0, errors: 0 };

  try {
    const labels = await client.getAllLabels();
    result.fetched = labels.length;

    for (const label of labels) {
      try {
        const stageResult = await storeRawRecord("label", label.id, label, syncRunId);
        if (stageResult.was_inserted) {
          result.inserted++;
        } else {
          result.updated++;
        }
        await processLabelToOps(label, stageResult.id);
      } catch (err) {
        console.error("Error processing label:", label.id, err);
        result.errors++;
      }
    }

    await updateSyncState("labels", null, result.fetched);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateSyncState("labels", null, 0, msg);
    throw err;
  }

  return result;
}

// ============================================
// Route Handlers
// ============================================

export async function GET(request: NextRequest) {
  // Verify this is from Vercel Cron or has valid secret
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-vercel-cron");

  if (!cronHeader && CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return apiError("Unauthorized", 401);
  }

  if (!process.env.LINEAR_API_KEY) {
    return apiServerError("LINEAR_API_KEY not configured");
  }

  const startTime = Date.now();
  const url = new URL(request.url);
  const syncType = url.searchParams.get("type"); // 'issues', 'projects', 'cycles', 'users', 'labels', or null for all
  const syncRunId = crypto.randomUUID();

  try {
    const results: Record<string, SyncResult> = {};

    // Verify API connection first
    const client = getLinearClient();
    const viewer = await client.verifyAuth();
    console.error(`[LINEAR-SYNC] Starting as: ${viewer.name} (${viewer.email})`);

    // Sync in order: users first (for name resolution), then projects, cycles, labels, finally issues
    if (!syncType || syncType === "users") {
      console.error("[LINEAR-SYNC] Syncing team members...");
      results.users = await syncUsers(syncRunId);
    }

    if (!syncType || syncType === "projects") {
      console.error("[LINEAR-SYNC] Syncing projects...");
      results.projects = await syncProjects(syncRunId);
    }

    if (!syncType || syncType === "cycles") {
      console.error("[LINEAR-SYNC] Syncing cycles...");
      results.cycles = await syncCycles(syncRunId);
    }

    if (!syncType || syncType === "labels") {
      console.error("[LINEAR-SYNC] Syncing labels...");
      results.labels = await syncLabels(syncRunId);
    }

    if (!syncType || syncType === "issues") {
      console.error("[LINEAR-SYNC] Syncing issues...");
      results.issues = await syncIssues(syncRunId);
    }

    // Get current sync status
    const syncStatus = await queryRows<{
      sync_type: string;
      last_sync_at: Date | null;
      records_synced: number;
      sync_health: string;
    }>(
      `SELECT sync_type, last_sync_at, records_synced::int, sync_health
       FROM ops.v_linear_sync_status`
    );

    // Calculate totals
    const totalFetched = Object.values(results).reduce((sum, r) => sum + r.fetched, 0);
    const totalInserted = Object.values(results).reduce((sum, r) => sum + r.inserted, 0);
    const totalUpdated = Object.values(results).reduce((sum, r) => sum + r.updated, 0);
    const totalErrors = Object.values(results).reduce((sum, r) => sum + r.errors, 0);

    return apiSuccess({
      message: `Synced ${totalFetched} records (${totalInserted} new, ${totalUpdated} updated, ${totalErrors} errors)`,
      viewer: { name: viewer.name, email: viewer.email },
      sync_run_id: syncRunId,
      results,
      totals: {
        fetched: totalFetched,
        inserted: totalInserted,
        updated: totalUpdated,
        errors: totalErrors,
      },
      sync_status: syncStatus,
      duration_ms: Date.now() - startTime,
    });
  } catch (error) {
    console.error("Linear sync error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return apiServerError(errorMessage);
  }
}

// POST endpoint for manual triggers with same logic
export async function POST(request: NextRequest) {
  return GET(request);
}
