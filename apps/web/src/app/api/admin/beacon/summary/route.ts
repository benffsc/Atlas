import { NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";

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
  recent_estimates: number; // Last 30 days
  recent_reproduction_flags: number;
}

interface SeasonalAlert {
  alert_type: string;
  severity: string;
  message: string;
}

export async function GET() {
  try {
    // Fetch all summary stats in parallel
    const [
      colonyStats,
      reproductionStats,
      mortalityStats,
      birthStats,
      alertsData,
      recentActivity,
    ] = await Promise.all([
      // Colony estimates
      queryOne<{
        total: number;
        places: number;
        avg_size: number;
        high_confidence: number;
      }>(`
        SELECT
          COUNT(*)::INT AS total,
          COUNT(DISTINCT pce.place_id)::INT AS places,
          COALESCE(AVG(pce.total_cats), 0)::NUMERIC(5,1) AS avg_size,
          COUNT(*) FILTER (WHERE csc.base_confidence > 0.7)::INT AS high_confidence
        FROM sot.place_colony_estimates pce
        LEFT JOIN sot.colony_source_confidence csc ON csc.source_type = pce.source_type
      `, []),

      // Reproduction stats (from vitals)
      queryOne<{
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
      `, []),

      // Mortality stats
      queryOne<{
        total: number;
        this_year: number;
      }>(`
        SELECT
          COUNT(*)::INT AS total,
          COUNT(*) FILTER (
            WHERE EXTRACT(YEAR FROM COALESCE(death_date, created_at)) = EXTRACT(YEAR FROM CURRENT_DATE)
          )::INT AS this_year
        FROM sot.cat_mortality_events
      `, []),

      // Birth stats
      queryOne<{
        births: number;
        litters: number;
      }>(`
        SELECT
          COUNT(*)::INT AS births,
          COUNT(DISTINCT litter_id)::INT AS litters
        FROM sot.cat_birth_events
      `, []),

      // Seasonal alerts
      queryRows<SeasonalAlert>(`
        SELECT alert_type, severity, message
        FROM trapper.get_seasonal_alerts()
        WHERE severity IN ('high', 'medium')
      `, []),

      // Recent activity (last 30 days)
      queryOne<{
        recent_estimates: number;
        recent_reproduction: number;
      }>(`
        SELECT
          (SELECT COUNT(*)::INT FROM sot.place_colony_estimates
           WHERE created_at >= CURRENT_DATE - INTERVAL '30 days') AS recent_estimates,
          (SELECT COUNT(*)::INT FROM ops.cat_vitals
           WHERE recorded_at >= CURRENT_DATE - INTERVAL '30 days'
           AND (is_pregnant OR is_lactating OR is_in_heat)) AS recent_reproduction
      `, []),
    ]);

    const summary: BeaconSummary = {
      total_colony_estimates: colonyStats?.total || 0,
      places_with_estimates: colonyStats?.places || 0,
      avg_colony_size: colonyStats?.avg_size || 0,
      high_confidence_estimates: colonyStats?.high_confidence || 0,

      cats_with_reproduction_data: reproductionStats?.cats_with_data || 0,
      pregnant_cats: reproductionStats?.pregnant || 0,
      lactating_cats: reproductionStats?.lactating || 0,
      cats_in_heat: reproductionStats?.in_heat || 0,

      mortality_events: mortalityStats?.total || 0,
      deaths_this_year: mortalityStats?.this_year || 0,

      birth_events: birthStats?.births || 0,
      litters_tracked: birthStats?.litters || 0,

      active_alerts: alertsData.length,

      recent_estimates: recentActivity?.recent_estimates || 0,
      recent_reproduction_flags: recentActivity?.recent_reproduction || 0,
    };

    return NextResponse.json({
      summary,
      alerts: alertsData,
    });
  } catch (error) {
    console.error("Error fetching Beacon summary:", error);
    return NextResponse.json(
      { error: "Failed to fetch Beacon summary" },
      { status: 500 }
    );
  }
}
