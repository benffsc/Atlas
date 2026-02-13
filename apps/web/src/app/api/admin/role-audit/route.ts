import { NextResponse } from "next/server";
import { queryRows } from "@/lib/db";

/**
 * GET /api/admin/role-audit
 *
 * Returns role audit dashboard data including stale roles, missing volunteer
 * roles, source conflicts, unmatched fosters, and recent reconciliations.
 *
 * Each query is wrapped in try/catch so the endpoint works even if
 * underlying views/tables have not been created yet.
 */
export async function GET() {
  try {
    // 1. Stale volunteer roles (active VH roles with no current group membership)
    let staleRoles: Array<{
      role_id: string;
      person_id: string;
      display_name: string;
      role: string;
      trapper_type: string | null;
      days_since_departure: number | null;
      groups_left: string[];
    }> = [];
    try {
      staleRoles = await queryRows(
        `SELECT role_id::text, person_id::text, display_name, role, trapper_type,
                days_since_departure, groups_left
         FROM ops.v_stale_volunteer_roles
         LIMIT 50`
      );
    } catch {
      // View may not exist yet
    }

    // 2. Missing volunteer role (foster/trapper without volunteer role)
    let missingVolunteer: Array<{
      person_id: string;
      display_name: string;
      roles_without_volunteer: string[];
      role_sources: string[];
      has_vh_record: boolean;
    }> = [];
    try {
      missingVolunteer = await queryRows(
        `SELECT person_id::text, display_name, roles_without_volunteer,
                role_sources, has_vh_record
         FROM ops.v_role_without_volunteer
         LIMIT 50`
      );
    } catch {
      // View may not exist yet
    }

    // 3. Source conflicts (role-source mismatches)
    let sourceConflicts: Array<{
      person_id: string;
      display_name: string;
      role: string;
      atlas_status: string;
      source_status: string;
    }> = [];
    try {
      sourceConflicts = await queryRows(
        `SELECT person_id::text, display_name, role, atlas_status, source_status
         FROM ops.v_role_source_conflicts
         LIMIT 50`
      );
    } catch {
      // View may not exist yet
    }

    // 4. Unmatched fosters (ShelterLuv unmatched fosters queue)
    let unmatchedFosters: Array<{
      id: string;
      hold_for_name: string;
      foster_email: string | null;
      cat_name: string | null;
      match_attempt: string;
      created_at: string;
    }> = [];
    try {
      unmatchedFosters = await queryRows(
        `SELECT id::text, hold_for_name, foster_email, cat_name,
                match_attempt, created_at::text
         FROM source.shelterluv_unmatched_fosters
         WHERE resolved_at IS NULL
         ORDER BY created_at DESC
         LIMIT 50`
      );
    } catch {
      // Table may not exist yet
    }

    // 5. Recent reconciliations
    let recentReconciliations: Array<{
      person_id: string;
      display_name: string;
      role: string;
      previous_status: string;
      new_status: string;
      reason: string;
      created_at: string;
    }> = [];
    try {
      recentReconciliations = await queryRows(
        `SELECT rl.person_id::text, sp.display_name, rl.role,
                rl.previous_status, rl.new_status, rl.reason,
                rl.created_at::text
         FROM trapper.role_reconciliation_log rl
         JOIN sot.people sp ON sp.person_id = rl.person_id
         ORDER BY rl.created_at DESC
         LIMIT 20`
      );
    } catch {
      // Table may not exist yet
    }

    // Build summary from array lengths
    const summary = {
      stale_roles: staleRoles.length,
      missing_volunteer: missingVolunteer.length,
      source_conflicts: sourceConflicts.length,
      unmatched_fosters: unmatchedFosters.length,
    };

    return NextResponse.json({
      summary,
      stale_roles: staleRoles,
      missing_volunteer: missingVolunteer,
      source_conflicts: sourceConflicts,
      unmatched_fosters: unmatchedFosters,
      recent_reconciliations: recentReconciliations,
    });
  } catch (error) {
    console.error("Role audit error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
