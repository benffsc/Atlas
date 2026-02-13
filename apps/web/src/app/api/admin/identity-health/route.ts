import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";

/**
 * GET /api/admin/identity-health
 *
 * Returns identity resolution health metrics from the database.
 * Uses the check_identity_health() function created in MIG_364.
 */
export async function GET() {
  try {
    const result = await queryOne<{ check_identity_health: unknown }>(
      `SELECT ops.check_identity_health() as check_identity_health`
    );

    if (!result) {
      return NextResponse.json(
        { error: "Failed to fetch health data" },
        { status: 500 }
      );
    }

    return NextResponse.json(result.check_identity_health);
  } catch (error) {
    console.error("Identity health check error:", error);

    // If the function doesn't exist yet (migrations not run), return placeholder
    return NextResponse.json({
      status: "unknown",
      checked_at: new Date().toISOString(),
      metrics: {
        total_active_people: 0,
        unique_names: 0,
        duplication_ratio: 0,
        people_without_identifiers: 0,
        doubled_names: 0,
        pending_merge_candidates: 0,
        person_count: 0,
        organization_count: 0,
        auto_matches_24h: 0,
        new_entities_24h: 0,
        reviews_pending_24h: 0,
        auto_match_rate_24h_pct: null,
        checked_at: new Date().toISOString(),
      },
      issues: [
        {
          issue: "migrations_not_run",
          value: 1,
          threshold: 0,
        },
      ],
    });
  }
}
