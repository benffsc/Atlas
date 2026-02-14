import { NextRequest, NextResponse } from "next/server";
import { queryOne, query, queryRows } from "@/lib/db";

/**
 * Test Mode API
 *
 * Enables a "test mode" that snapshots key database tables,
 * allowing staff to make test changes that can be reverted.
 *
 * SECURITY: This endpoint is DISABLED in production unless ALLOW_TEST_MODE=true
 *
 * Tables backed up:
 * - web_intake_submissions
 * - sot_requests
 * - journal_entries
 * - place_colony_estimates
 * - cat_reunifications
 * - cat_movement_events
 * - colony_override_history
 */

// Production guard - prevent destructive operations in production
function checkTestModeAllowed(): NextResponse | null {
  // Allow in development
  if (process.env.NODE_ENV === "development") {
    return null;
  }

  // In production, only allow if explicitly enabled
  if (process.env.ALLOW_TEST_MODE !== "true") {
    return NextResponse.json(
      {
        error: "Test mode is disabled in production",
        hint: "Set ALLOW_TEST_MODE=true to enable (NOT RECOMMENDED for production databases)",
      },
      { status: 403 }
    );
  }

  return null;
}

const BACKUP_TABLES = [
  "web_intake_submissions",
  "sot_requests",
  "journal_entries",
  "place_colony_estimates",
  "cat_reunifications",
  "cat_movement_events",
  "colony_override_history",
  "places",  // For colony overrides
];

// GET - Check test mode status
export async function GET() {
  try {
    // Check if test_mode_state table exists and has active session
    const result = await queryOne<{
      is_active: boolean;
      started_at: string;
      started_by: string;
      tables_backed_up: string[];
    }>(`
      SELECT
        is_active,
        started_at,
        started_by,
        tables_backed_up
      FROM ops.test_mode_state
      WHERE is_active = TRUE
      ORDER BY started_at DESC
      LIMIT 1
    `);

    if (!result) {
      return NextResponse.json({
        test_mode_active: false,
        message: "Test mode is not active",
      });
    }

    return NextResponse.json({
      test_mode_active: result.is_active,
      started_at: result.started_at,
      started_by: result.started_by,
      tables_backed_up: result.tables_backed_up,
    });
  } catch (error) {
    // Table might not exist yet
    return NextResponse.json({
      test_mode_active: false,
      message: "Test mode not initialized",
    });
  }
}

// POST - Enable test mode (create snapshots)
export async function POST(request: NextRequest) {
  // SECURITY: Block in production unless explicitly enabled
  const blocked = checkTestModeAllowed();
  if (blocked) return blocked;

  try {
    const body = await request.json().catch(() => ({}));
    const startedBy = body.started_by || "admin";

    // First, ensure test_mode_state table exists
    await query(`
      CREATE TABLE IF NOT EXISTS ops.test_mode_state (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        started_by TEXT NOT NULL,
        ended_at TIMESTAMPTZ,
        tables_backed_up TEXT[] NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Check if test mode is already active
    const existing = await queryOne<{ is_active: boolean }>(`
      SELECT is_active FROM ops.test_mode_state WHERE is_active = TRUE LIMIT 1
    `);

    if (existing?.is_active) {
      return NextResponse.json(
        { error: "Test mode is already active. Disable it first before starting a new session." },
        { status: 400 }
      );
    }

    // Create backup tables
    const backedUpTables: string[] = [];
    const errors: string[] = [];

    for (const table of BACKUP_TABLES) {
      const backupName = `_testmode_backup_${table}`;

      try {
        // Check if source table exists
        const tableExists = await queryOne<{ exists: boolean }>(`
          SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema IN ('sot', 'ops') AND table_name = $1
          )
        `, [table]);

        if (!tableExists?.exists) {
          continue; // Skip non-existent tables
        }

        // Drop existing backup if exists
        await query(`DROP TABLE IF EXISTS ops._backup_${backupName} CASCADE`);

        // Create backup as exact copy
        await query(`CREATE TABLE ops._backup_${table} AS SELECT * FROM ops.${table}`);

        backedUpTables.push(table);
      } catch (err) {
        errors.push(`${table}: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    }

    // Record the test mode session
    await query(`
      INSERT INTO ops.test_mode_state (is_active, started_by, tables_backed_up)
      VALUES (TRUE, $1, $2)
    `, [startedBy, backedUpTables]);

    return NextResponse.json({
      success: true,
      test_mode_active: true,
      tables_backed_up: backedUpTables,
      errors: errors.length > 0 ? errors : undefined,
      message: `Test mode enabled. ${backedUpTables.length} tables backed up.`,
    });
  } catch (error) {
    console.error("Error enabling test mode:", error);
    return NextResponse.json(
      { error: "Failed to enable test mode" },
      { status: 500 }
    );
  }
}

// DELETE - Disable test mode (restore from snapshots)
export async function DELETE(request: NextRequest) {
  // SECURITY: Block in production unless explicitly enabled
  const blocked = checkTestModeAllowed();
  if (blocked) return blocked;

  try {
    const body = await request.json().catch(() => ({}));
    const keepChanges = body.keep_changes === true;

    // Get active test mode session
    const session = await queryOne<{
      id: string;
      tables_backed_up: string[];
      started_at: string;
    }>(`
      SELECT id, tables_backed_up, started_at
      FROM ops.test_mode_state
      WHERE is_active = TRUE
      ORDER BY started_at DESC
      LIMIT 1
    `);

    if (!session) {
      return NextResponse.json(
        { error: "No active test mode session to disable" },
        { status: 400 }
      );
    }

    const restoredTables: string[] = [];
    const errors: string[] = [];

    if (!keepChanges) {
      // Restore from backups
      for (const table of session.tables_backed_up) {
        const backupName = `_testmode_backup_${table}`;

        try {
          // Check if backup exists
          const backupExists = await queryOne<{ exists: boolean }>(`
            SELECT EXISTS (
              SELECT 1 FROM information_schema.tables
              WHERE table_schema IN ('sot', 'ops') AND table_name = $1
            )
          `, [backupName]);

          if (!backupExists?.exists) {
            errors.push(`${table}: Backup not found`);
            continue;
          }

          // Truncate original and restore from backup
          await query(`TRUNCATE ops.${table} CASCADE`);
          await query(`INSERT INTO ops.${table} SELECT * FROM ops._backup_${table}`);

          restoredTables.push(table);
        } catch (err) {
          errors.push(`${table}: ${err instanceof Error ? err.message : "Unknown error"}`);
        }
      }
    }

    // Clean up backup tables
    for (const table of session.tables_backed_up) {
      const backupName = `_testmode_backup_${table}`;
      try {
        await query(`DROP TABLE IF EXISTS ops._backup_${backupName} CASCADE`);
      } catch {
        // Ignore cleanup errors
      }
    }

    // Mark session as ended
    await query(`
      UPDATE ops.test_mode_state
      SET is_active = FALSE, ended_at = NOW()
      WHERE id = $1
    `, [session.id]);

    return NextResponse.json({
      success: true,
      test_mode_active: false,
      changes_kept: keepChanges,
      tables_restored: keepChanges ? [] : restoredTables,
      errors: errors.length > 0 ? errors : undefined,
      message: keepChanges
        ? "Test mode disabled. Changes were kept."
        : `Test mode disabled. ${restoredTables.length} tables restored to original state.`,
    });
  } catch (error) {
    console.error("Error disabling test mode:", error);
    return NextResponse.json(
      { error: "Failed to disable test mode" },
      { status: 500 }
    );
  }
}
