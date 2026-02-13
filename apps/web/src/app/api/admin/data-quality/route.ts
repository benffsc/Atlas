import { NextRequest, NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";

/**
 * Data Quality API
 *
 * GET: Comprehensive data quality metrics from v_data_quality_dashboard
 */

interface DataQualityDashboard {
  // Cat-place coverage (critical for Beacon)
  total_cats: number;
  cats_with_places: number;
  cat_place_coverage_pct: number;

  // People quality
  total_people: number;
  valid_people: number;
  invalid_people: number;
  orgs_as_people: number;
  garbage_people: number;
  non_canonical_people: number;

  // External Organizations
  total_external_organizations: number;
  people_needing_org_conversion: number;

  // Data Engine health
  total_de_decisions: number;
  de_decisions_24h: number;
  pending_reviews: number;
  auto_matches: number;
  new_entities: number;

  // Household coverage
  total_households: number;
  people_in_households: number;
  household_coverage_pct: number;

  // Geocoding status
  total_places: number;
  geocoded_places: number;
  geocoding_queue: number;
  geocoding_coverage_pct: number;

  // Appointment linking
  total_appointments: number;
  appointments_with_person: number;
  appointments_with_trapper: number;
  appointment_person_pct: number;

  // Identity coverage
  people_with_identifiers: number;
  identity_coverage_pct: number;

  // Recent activity
  people_created_24h: number;
  invalid_people_created_24h: number;
  cats_created_24h: number;
  records_staged_24h: number;

  // Soft blacklist
  soft_blacklist_count: number;

  // Timestamp
  checked_at: string;
}

interface DataQualityProblem {
  problem_type: string;
  severity: "critical" | "warning";
  count: string;
  description: string;
}

interface DataQualitySnapshot {
  snapshot_time: string;
  cat_place_coverage_pct: number;
  invalid_people: number;
  pending_reviews: number;
  geocoding_queue: number;
  household_coverage_pct: number;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const includeHistory = searchParams.get("history") === "true";

  try {
    // Get current dashboard metrics
    const dashboard = await queryOne<DataQualityDashboard>(`
      SELECT * FROM ops.v_data_quality_dashboard
    `);

    // Get current problems
    const problems = await queryRows<DataQualityProblem>(`
      SELECT * FROM ops.v_data_quality_problems
      ORDER BY
        CASE severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END,
        count::int DESC
    `);

    // Get recent history if requested
    let history: DataQualitySnapshot[] = [];
    if (includeHistory) {
      history = await queryRows<DataQualitySnapshot>(`
        SELECT
          snapshot_time,
          cat_place_coverage_pct,
          invalid_people,
          pending_reviews,
          geocoding_queue,
          household_coverage_pct
        FROM trapper.data_quality_snapshots
        ORDER BY snapshot_time DESC
        LIMIT 30
      `);
    }

    // Calculate status
    const hasCritical = problems.some((p) => p.severity === "critical");
    const hasWarnings = problems.some((p) => p.severity === "warning");

    return NextResponse.json({
      status: hasCritical ? "critical" : hasWarnings ? "warning" : "healthy",
      generated_at: new Date().toISOString(),
      dashboard,
      problems,
      history: includeHistory ? history : undefined,
      summary: {
        cat_place_coverage: dashboard?.cat_place_coverage_pct ?? 0,
        cats_without_places:
          (dashboard?.total_cats ?? 0) - (dashboard?.cats_with_places ?? 0),
        invalid_people: dashboard?.invalid_people ?? 0,
        orgs_as_people: dashboard?.orgs_as_people ?? 0,
        pending_reviews: dashboard?.pending_reviews ?? 0,
        geocoding_queue: dashboard?.geocoding_queue ?? 0,
        household_coverage: dashboard?.household_coverage_pct ?? 0,
      },
    });
  } catch (error) {
    console.error("Error fetching data quality metrics:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

/**
 * POST: Take a quality snapshot
 */
export async function POST() {
  try {
    const result = await queryOne<{ take_quality_snapshot: string }>(`
      SELECT trapper.take_quality_snapshot('api')
    `);

    return NextResponse.json({
      success: true,
      snapshot_id: result?.take_quality_snapshot,
      message: "Quality snapshot taken",
    });
  } catch (error) {
    console.error("Error taking quality snapshot:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
