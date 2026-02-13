import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";

interface TrapperStatsRow {
  person_id: string;
  display_name: string;
  trapper_type: string;
  is_ffsc_trapper: boolean;
  active_assignments: number;
  completed_assignments: number;
  total_site_visits: number;
  assessment_visits: number;
  first_visit_success_rate_pct: number | null;
  cats_from_visits: number;
  cats_from_assignments: number;
  cats_altered_from_assignments: number;
  manual_catches: number;
  total_cats_caught: number;
  total_clinic_cats: number;
  unique_clinic_days: number;
  avg_cats_per_day: number;
  spayed_count: number;
  neutered_count: number;
  total_altered: number;
  felv_tested_count: number;
  felv_positive_count: number;
  felv_positive_rate_pct: number | null;
  first_clinic_date: string | null;
  last_clinic_date: string | null;
  first_activity_date: string | null;
  last_activity_date: string | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Person ID is required" },
      { status: 400 }
    );
  }

  try {
    // First check if this person is a trapper
    const trapperCheck = await queryOne<{ is_trapper: boolean }>(
      `SELECT (trapper.get_trapper_info($1)).is_trapper AS is_trapper`,
      [id]
    );

    if (!trapperCheck?.is_trapper) {
      return NextResponse.json(
        { error: "Person is not a trapper" },
        { status: 404 }
      );
    }

    // Get full trapper stats
    const stats = await queryOne<TrapperStatsRow>(
      `SELECT * FROM ops.v_trapper_full_stats WHERE person_id = $1`,
      [id]
    );

    if (!stats) {
      return NextResponse.json(
        { error: "Trapper stats not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(stats);
  } catch (error) {
    console.error("Error fetching trapper stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch trapper stats" },
      { status: 500 }
    );
  }
}
