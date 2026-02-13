import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";

interface EcologyConfig {
  config_key: string;
  config_value: number;
  unit: string;
  description: string;
  config_category: string;
  scientific_reference: string | null;
}

interface PlaceForecast {
  place_id: string;
  display_name: string;
  formatted_address: string;
  service_zone: string;

  // Current state
  a_known: number; // Verified altered
  n_recent_max: number; // Recent max colony size
  n_hat_chapman: number | null; // Chapman estimate if available
  p_lower: number | null; // Lower-bound alteration rate
  estimation_method: string;

  // Forecast metrics
  estimated_remaining: number;
  current_tnr_intensity: string; // 'high', 'low', 'none'
  estimated_cycles_to_complete: number | null;
  estimated_months_to_complete: number | null;
  forecast_confidence: string;

  // Activity metrics
  cats_altered_last_6mo: number;
  cats_altered_last_12mo: number;
  last_altered_at: string | null;
}

interface ForecastSummary {
  total_places_with_data: number;
  total_population_estimate: number;
  total_altered: number;
  overall_alteration_rate: number;
  places_near_completion: number; // >75% altered
  places_needs_attention: number; // <25% altered with activity
  avg_months_to_complete: number | null;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const view = searchParams.get("view") || "forecasts";
  const limit = parseInt(searchParams.get("limit") || "50");

  try {
    if (view === "parameters") {
      // Return Vortex model parameters
      const sql = `
        SELECT
          config_key,
          config_value,
          unit,
          description,
          config_category,
          scientific_reference
        FROM trapper.ecology_config
        ORDER BY config_category, config_key
      `;
      const rows = await queryRows<EcologyConfig>(sql, []);

      // Group by category
      const grouped: Record<string, EcologyConfig[]> = {};
      for (const row of rows) {
        const cat = row.config_category || "general";
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(row);
      }

      return NextResponse.json({ parameters: grouped });
    }

    if (view === "forecasts") {
      // Get Vortex parameters for calculations
      const params = await queryOne<{
        tnr_time_step_months: number;
        tnr_high_intensity_rate: number;
        tnr_low_intensity_rate: number;
      }>(`
        SELECT
          (SELECT config_value FROM trapper.ecology_config WHERE config_key = 'tnr_time_step_months') AS tnr_time_step_months,
          (SELECT config_value FROM trapper.ecology_config WHERE config_key = 'tnr_high_intensity_rate') AS tnr_high_intensity_rate,
          (SELECT config_value FROM trapper.ecology_config WHERE config_key = 'tnr_low_intensity_rate') AS tnr_low_intensity_rate
      `, []);

      const tnrTimeStep = params?.tnr_time_step_months || 6;
      const highIntensityThreshold = params?.tnr_high_intensity_rate || 0.75;
      const lowIntensityThreshold = params?.tnr_low_intensity_rate || 0.50;

      // Get place forecasts using ecology stats
      const sql = `
        WITH ecology AS (
          SELECT
            e.place_id,
            e.display_name,
            e.formatted_address,
            e.service_zone,
            e.a_known,
            e.n_recent_max,
            e.n_hat_chapman,
            e.p_lower,
            e.estimation_method::TEXT,
            e.last_altered_at::TEXT
          FROM sot.v_place_ecology_stats e
          WHERE e.a_known > 0 OR e.n_recent_max > 0
        ),
        recent_activity AS (
          SELECT
            cpr.place_id,
            COUNT(*) FILTER (WHERE cp.procedure_date >= CURRENT_DATE - INTERVAL '6 months') AS cats_6mo,
            COUNT(*) FILTER (WHERE cp.procedure_date >= CURRENT_DATE - INTERVAL '12 months') AS cats_12mo
          FROM ops.cat_procedures cp
          JOIN sot.cat_place_relationships cpr ON cpr.cat_id = cp.cat_id
          WHERE cp.is_spay OR cp.is_neuter
          GROUP BY cpr.place_id
        )
        SELECT
          e.*,
          COALESCE(ra.cats_6mo, 0) AS cats_altered_last_6mo,
          COALESCE(ra.cats_12mo, 0) AS cats_altered_last_12mo
        FROM ecology e
        LEFT JOIN recent_activity ra ON ra.place_id = e.place_id
        ORDER BY
          CASE WHEN e.p_lower IS NOT NULL AND e.p_lower < 0.5 THEN 0 ELSE 1 END,
          COALESCE(e.n_hat_chapman, e.n_recent_max, e.a_known) DESC
        LIMIT $1
      `;

      const rows = await queryRows<{
        place_id: string;
        display_name: string;
        formatted_address: string;
        service_zone: string;
        a_known: number;
        n_recent_max: number;
        n_hat_chapman: number | null;
        p_lower: number | null;
        estimation_method: string;
        last_altered_at: string | null;
        cats_altered_last_6mo: number;
        cats_altered_last_12mo: number;
      }>(sql, [limit]);

      // Calculate forecasts for each place
      const forecasts: PlaceForecast[] = rows.map((row) => {
        const population = row.n_hat_chapman || row.n_recent_max || row.a_known;
        const alterationRate = row.p_lower || (population > 0 ? row.a_known / population : 0);
        const remaining = Math.max(0, Math.round(population * (1 - alterationRate)));

        // Calculate TNR intensity based on recent activity
        const intensityRate = population > 0 ? row.cats_altered_last_6mo / population : 0;
        let tnrIntensity = "none";
        if (intensityRate >= highIntensityThreshold) tnrIntensity = "high";
        else if (intensityRate >= lowIntensityThreshold) tnrIntensity = "low";
        else if (row.cats_altered_last_6mo > 0) tnrIntensity = "minimal";

        // Estimate time to completion
        let cyclesToComplete: number | null = null;
        let monthsToComplete: number | null = null;
        if (remaining > 0 && row.cats_altered_last_6mo > 0) {
          // At current rate, how many 6-month cycles?
          cyclesToComplete = Math.ceil(remaining / row.cats_altered_last_6mo);
          monthsToComplete = cyclesToComplete * tnrTimeStep;
        }

        // Forecast confidence based on data quality
        let confidence = "low";
        if (row.n_hat_chapman) confidence = "high"; // Chapman estimate available
        else if (row.n_recent_max > 0 && row.a_known > 0) confidence = "medium";

        return {
          place_id: row.place_id,
          display_name: row.display_name,
          formatted_address: row.formatted_address,
          service_zone: row.service_zone,
          a_known: row.a_known,
          n_recent_max: row.n_recent_max,
          n_hat_chapman: row.n_hat_chapman,
          p_lower: row.p_lower,
          estimation_method: row.estimation_method,
          estimated_remaining: remaining,
          current_tnr_intensity: tnrIntensity,
          estimated_cycles_to_complete: cyclesToComplete,
          estimated_months_to_complete: monthsToComplete,
          forecast_confidence: confidence,
          cats_altered_last_6mo: row.cats_altered_last_6mo,
          cats_altered_last_12mo: row.cats_altered_last_12mo,
          last_altered_at: row.last_altered_at,
        };
      });

      // Calculate summary
      const summary: ForecastSummary = {
        total_places_with_data: forecasts.length,
        total_population_estimate: forecasts.reduce(
          (sum, f) => sum + (f.n_hat_chapman || f.n_recent_max || f.a_known),
          0
        ),
        total_altered: forecasts.reduce((sum, f) => sum + f.a_known, 0),
        overall_alteration_rate: 0,
        places_near_completion: forecasts.filter((f) => f.p_lower && f.p_lower >= 0.75).length,
        places_needs_attention: forecasts.filter(
          (f) => f.p_lower && f.p_lower < 0.25 && f.cats_altered_last_12mo > 0
        ).length,
        avg_months_to_complete: null,
      };

      if (summary.total_population_estimate > 0) {
        summary.overall_alteration_rate = summary.total_altered / summary.total_population_estimate;
      }

      const withMonths = forecasts.filter((f) => f.estimated_months_to_complete !== null);
      if (withMonths.length > 0) {
        summary.avg_months_to_complete =
          withMonths.reduce((sum, f) => sum + (f.estimated_months_to_complete || 0), 0) /
          withMonths.length;
      }

      return NextResponse.json({ forecasts, summary });
    }

    return NextResponse.json({ error: "Invalid view" }, { status: 400 });
  } catch (error) {
    console.error("Error fetching forecasts:", error);
    return NextResponse.json(
      { error: "Failed to fetch forecast data" },
      { status: 500 }
    );
  }
}
