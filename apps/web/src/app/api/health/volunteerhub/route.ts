import { NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";

/**
 * VolunteerHub Health Check Endpoint
 *
 * Returns sync statistics and health status for the VolunteerHub integration:
 * - Total volunteers and matching rates
 * - Active volunteer counts
 * - Group membership breakdown
 * - Trapper reconciliation with Airtable
 * - Sync recency and health status
 */

interface GroupBreakdown {
  name: string;
  active_members: number;
}

interface TrapperReconciliation {
  [key: string]: unknown;
}

export async function GET() {
  try {
    // Core volunteer counts
    const totalResult = await queryOne<{ count: number }>(
      `SELECT COUNT(*)::int as count FROM source.volunteerhub_volunteers`
    );

    const matchedResult = await queryOne<{ count: number }>(
      `SELECT COUNT(*)::int as count FROM source.volunteerhub_volunteers WHERE matched_person_id IS NOT NULL`
    );

    const activeResult = await queryOne<{ count: number }>(
      `SELECT COUNT(*)::int as count FROM source.volunteerhub_volunteers WHERE is_active = true`
    );

    // Group membership breakdown
    const groupBreakdown = await queryRows<GroupBreakdown>(`
      SELECT vug.name, COUNT(*)::int as active_members
      FROM source.volunteerhub_group_memberships vgm
      JOIN source.volunteerhub_user_groups vug ON vug.user_group_uid = vgm.user_group_uid
      WHERE vgm.left_at IS NULL
      GROUP BY vug.name
      ORDER BY active_members DESC
    `);

    // Trapper reconciliation (function may not exist yet)
    let trapperReconciliation: TrapperReconciliation[] | null = null;
    try {
      trapperReconciliation = await queryRows<TrapperReconciliation>(
        `SELECT * FROM trapper.cross_reference_vh_trappers_with_airtable()`
      );
    } catch {
      trapperReconciliation = null;
    }

    // Last sync timestamp
    const lastSyncResult = await queryOne<{ last_sync: string | null }>(
      `SELECT MAX(last_api_sync_at) as last_sync FROM source.volunteerhub_volunteers`
    );

    // Recent membership changes
    const joinedResult = await queryOne<{ count: number }>(
      `SELECT COUNT(*)::int as count FROM source.volunteerhub_group_memberships WHERE joined_at > NOW() - INTERVAL '30 days'`
    );

    const leftResult = await queryOne<{ count: number }>(
      `SELECT COUNT(*)::int as count FROM source.volunteerhub_group_memberships WHERE left_at > NOW() - INTERVAL '30 days'`
    );

    // Compute sync health
    const lastSync = lastSyncResult?.last_sync ?? null;
    let hoursSinceLastSync: number | null = null;
    let syncStatus: "healthy" | "stale" | "never_synced" = "never_synced";

    if (lastSync) {
      const lastSyncDate = new Date(lastSync);
      hoursSinceLastSync = Math.round(
        (Date.now() - lastSyncDate.getTime()) / (1000 * 60 * 60)
      );
      syncStatus = hoursSinceLastSync <= 24 ? "healthy" : "stale";
    }

    return NextResponse.json({
      total_vh_volunteers: totalResult?.count ?? 0,
      matched_to_atlas: matchedResult?.count ?? 0,
      active_volunteers: activeResult?.count ?? 0,
      group_breakdown: groupBreakdown,
      trapper_reconciliation: trapperReconciliation,
      last_sync: lastSync,
      recent_changes: {
        joined_last_30d: joinedResult?.count ?? 0,
        left_last_30d: leftResult?.count ?? 0,
      },
      sync_health: {
        hours_since_last_sync: hoursSinceLastSync,
        status: syncStatus,
      },
    });
  } catch (error) {
    console.error("VolunteerHub health check error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
