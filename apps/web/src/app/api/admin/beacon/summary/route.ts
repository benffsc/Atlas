import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";

interface BeaconSummary {
  // Colony estimates
  total_colony_estimates: number;
  places_with_estimates: number;
  avg_colony_size: number;
  high_confidence_estimates: number;

  // Reproduction
  cats_with_reproduction_data: number;
  pregnant_cats: number;
  lactating_cats: number;
  cats_in_heat: number;

  // Mortality
  mortality_events: number;
  deaths_this_year: number;

  // Birth events
  birth_events: number;
  litters_tracked: number;

  // Seasonal alerts
  active_alerts: number;

  // Recent activity
  recent_estimates: number;
  recent_reproduction_flags: number;
}

// Helper to safely run query, returning null on error
async function safeQueryOne<T>(sql: string): Promise<T | null> {
  try {
    return await queryOne<T>(sql, []);
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    // Fetch all summary stats with graceful fallbacks for missing tables
    const [
      colonyStats,
      reproductionStats,
      mortalityStats,
      birthStats,
      recentActivity,
    ] = await Promise.all([
      // Colony estimates (no JOIN to missing table)
      safeQueryOne<{
        total: number;
        places: number;
        avg_size: number;
      }>(`
        SELECT
          COUNT(*)::INT AS total,
          COUNT(DISTINCT place_id)::INT AS places,
          COALESCE(AVG(total_cats), 0)::NUMERIC(5,1) AS avg_size
        FROM sot.place_colony_estimates
      `),

      // Reproduction stats (from vitals)
      safeQueryOne<{
        cats_with_data: number;
        pregnant: number;
        lactating: number;
        in_heat: number;
      }>(`
        SELECT
          COUNT(DISTINCT cat_id)::INT AS cats_with_data,
          COUNT(*) FILTER (WHERE is_pregnant)::INT AS pregnant,
          COUNT(*) FILTER (WHERE is_lactating)::INT AS lactating,
          COUNT(*) FILTER (WHERE is_in_heat)::INT AS in_heat
        FROM ops.cat_vitals
        WHERE is_pregnant OR is_lactating OR is_in_heat
      `),

      // Mortality stats
      safeQueryOne<{
        total: number;
        this_year: number;
      }>(`
        SELECT
          COUNT(*)::INT AS total,
          COUNT(*) FILTER (
            WHERE EXTRACT(YEAR FROM COALESCE(death_date, created_at)) = EXTRACT(YEAR FROM CURRENT_DATE)
          )::INT AS this_year
        FROM sot.cat_mortality_events
      `),

      // Birth stats - cat_birth_events may not exist in V2
      safeQueryOne<{
        births: number;
        litters: number;
      }>(`
        SELECT
          COUNT(*)::INT AS births,
          COUNT(DISTINCT litter_id)::INT AS litters
        FROM sot.cat_birth_events
      `),

      // Recent activity (last 30 days)
      safeQueryOne<{
        recent_estimates: number;
        recent_reproduction: number;
      }>(`
        SELECT
          (SELECT COUNT(*)::INT FROM sot.place_colony_estimates
           WHERE created_at >= CURRENT_DATE - INTERVAL '30 days') AS recent_estimates,
          (SELECT COUNT(*)::INT FROM ops.cat_vitals
           WHERE recorded_at >= CURRENT_DATE - INTERVAL '30 days'
           AND (is_pregnant OR is_lactating OR is_in_heat)) AS recent_reproduction
      `),
    ]);

    const summary: BeaconSummary = {
      total_colony_estimates: colonyStats?.total || 0,
      places_with_estimates: colonyStats?.places || 0,
      avg_colony_size: colonyStats?.avg_size || 0,
      high_confidence_estimates: 0, // Can't calculate without colony_source_confidence

      cats_with_reproduction_data: reproductionStats?.cats_with_data || 0,
      pregnant_cats: reproductionStats?.pregnant || 0,
      lactating_cats: reproductionStats?.lactating || 0,
      cats_in_heat: reproductionStats?.in_heat || 0,

      mortality_events: mortalityStats?.total || 0,
      deaths_this_year: mortalityStats?.this_year || 0,

      birth_events: birthStats?.births || 0,
      litters_tracked: birthStats?.litters || 0,

      active_alerts: 0,

      recent_estimates: recentActivity?.recent_estimates || 0,
      recent_reproduction_flags: recentActivity?.recent_reproduction || 0,
    };

    return NextResponse.json({
      summary,
      alerts: [],
    });
  } catch (error) {
    console.error("Error fetching Beacon summary:", error);
    return NextResponse.json(
      { error: "Failed to fetch Beacon summary" },
      { status: 500 }
    );
  }
}
