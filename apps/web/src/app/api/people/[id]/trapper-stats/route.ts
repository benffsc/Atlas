import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { requireValidUUID } from "@/lib/api-validation";
import { apiSuccess, apiNotFound, apiServerError, apiBadRequest } from "@/lib/api-response";

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

  try {
    requireValidUUID(id, "person");

    // First check if this person is a trapper
    const trapperCheck = await queryOne<{ is_trapper: boolean }>(
      `SELECT (ops.get_trapper_info($1)).is_trapper AS is_trapper`,
      [id]
    );

    if (!trapperCheck?.is_trapper) {
      return apiNotFound("Trapper", id);
    }

    // Get full trapper stats
    const stats = await queryOne<TrapperStatsRow>(
      `SELECT * FROM ops.v_trapper_full_stats WHERE person_id = $1`,
      [id]
    );

    if (!stats) {
      return apiNotFound("Trapper stats", id);
    }

    return apiSuccess(stats);
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") {
      return apiBadRequest(error.message);
    }
    console.error("Error fetching trapper stats:", error);
    return apiServerError("Failed to fetch trapper stats");
  }
}
