import { NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";

/**
 * GET /api/beacon/seasonal-alerts
 *
 * Returns seasonal alerts and breeding season indicators.
 * Used by Beacon to display warnings about kitten surges and capacity pressure.
 */

interface SeasonalAlert {
  alert_type: string;
  severity: "high" | "medium" | "info";
  message: string;
  metric_name: string;
  current_value: number;
  threshold: number;
  recommendation?: string;
}

interface CurrentSeason {
  is_breeding_season: boolean;
  breeding_active_pct: number;
  demand_supply_ratio: number | null;
  current_month: number;
  current_month_name: string;
  season: string;
}

interface Prediction {
  kitten_surge_expected: boolean;
  surge_confidence: "high" | "medium" | "low";
  expected_timing: string;
  reasoning: string;
}

const ALERT_RECOMMENDATIONS: Record<string, string> = {
  kitten_surge: "Consider increasing clinic capacity and recruiting additional foster homes.",
  capacity_pressure: "Prioritize appointments for high-colony-size locations. Consider adding clinic days.",
  breeding_peak: "This is normal seasonal activity. Ensure foster network is prepared for increased intake.",
};

export async function GET() {
  try {
    // Get active alerts from the database function
    const alertsRaw = await queryRows<{
      alert_type: string;
      severity: string;
      message: string;
      metric_name: string;
      current_value: number;
      threshold: number;
    }>(
      `SELECT * FROM trapper.get_seasonal_alerts()`,
      []
    );

    // Enrich alerts with recommendations
    const alerts: SeasonalAlert[] = alertsRaw.map((alert) => ({
      alert_type: alert.alert_type,
      severity: alert.severity as "high" | "medium" | "info",
      message: alert.message,
      metric_name: alert.metric_name,
      current_value: alert.current_value,
      threshold: alert.threshold,
      recommendation: ALERT_RECOMMENDATIONS[alert.alert_type],
    }));

    // Get current season data
    const currentData = await queryOne<{
      year: number;
      month: number;
      season: string;
      is_breeding_season: boolean;
      demand_supply_ratio: number | null;
      pregnant_cats: number;
      clinic_appointments: number;
    }>(
      `SELECT *
       FROM trapper.v_seasonal_dashboard
       WHERE year = EXTRACT(YEAR FROM CURRENT_DATE)
         AND month = EXTRACT(MONTH FROM CURRENT_DATE)`,
      []
    );

    // Get breeding indicators for current month
    const breedingIndicators = await queryOne<{
      pregnant_count: number;
      lactating_count: number;
      in_heat_count: number;
      female_cats_spayed: number;
      breeding_active_pct: number;
    }>(
      `SELECT *
       FROM trapper.v_breeding_season_indicators
       WHERE year = EXTRACT(YEAR FROM CURRENT_DATE)
         AND month = EXTRACT(MONTH FROM CURRENT_DATE)`,
      []
    );

    // Build current season info
    const currentMonth = new Date().getMonth() + 1;
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    const currentSeason: CurrentSeason = {
      is_breeding_season: currentMonth >= 2 && currentMonth <= 11,
      breeding_active_pct: breedingIndicators?.breeding_active_pct || 0,
      demand_supply_ratio: currentData?.demand_supply_ratio || null,
      current_month: currentMonth,
      current_month_name: monthNames[currentMonth - 1],
      season: currentData?.season || getSeasonName(currentMonth),
    };

    // Build prediction based on breeding indicators
    let prediction: Prediction;

    if (breedingIndicators && breedingIndicators.breeding_active_pct > 50) {
      prediction = {
        kitten_surge_expected: true,
        surge_confidence: breedingIndicators.breeding_active_pct > 70 ? "high" : "medium",
        expected_timing: "2-3 months",
        reasoning: `${breedingIndicators.breeding_active_pct}% of spayed females showed breeding indicators (pregnant/lactating/in-heat).`,
      };
    } else if (breedingIndicators && breedingIndicators.breeding_active_pct > 30) {
      prediction = {
        kitten_surge_expected: true,
        surge_confidence: "low",
        expected_timing: "3-4 months",
        reasoning: `${breedingIndicators.breeding_active_pct}% breeding activity suggests moderate kitten intake ahead.`,
      };
    } else if (currentMonth >= 3 && currentMonth <= 5) {
      // Spring kitten season
      prediction = {
        kitten_surge_expected: true,
        surge_confidence: "medium",
        expected_timing: "Now through June",
        reasoning: "Historical patterns show spring kitten season peaks April-June.",
      };
    } else if (currentMonth >= 9 && currentMonth <= 10) {
      // Fall kitten season
      prediction = {
        kitten_surge_expected: true,
        surge_confidence: "medium",
        expected_timing: "Now through November",
        reasoning: "Historical patterns show fall kitten season peaks September-October.",
      };
    } else {
      prediction = {
        kitten_surge_expected: false,
        surge_confidence: "low",
        expected_timing: "N/A",
        reasoning: "No significant breeding indicators detected.",
      };
    }

    // Get monthly breeding data for chart (last 12 months)
    const breedingHistory = await queryRows<{
      year: number;
      month: number;
      period: string;
      breeding_active_pct: number;
    }>(
      `SELECT year, month, period, breeding_active_pct
       FROM trapper.v_breeding_season_indicators
       WHERE (year = EXTRACT(YEAR FROM CURRENT_DATE) AND month <= EXTRACT(MONTH FROM CURRENT_DATE))
          OR (year = EXTRACT(YEAR FROM CURRENT_DATE) - 1 AND month > EXTRACT(MONTH FROM CURRENT_DATE))
       ORDER BY year, month`,
      []
    );

    return NextResponse.json({
      alerts,
      current_season: currentSeason,
      predictions: prediction,
      breeding_history: breedingHistory,
      breeding_indicators: breedingIndicators
        ? {
            pregnant: breedingIndicators.pregnant_count,
            lactating: breedingIndicators.lactating_count,
            in_heat: breedingIndicators.in_heat_count,
            total_females_processed: breedingIndicators.female_cats_spayed,
          }
        : null,
    });
  } catch (error) {
    console.error("Error fetching seasonal alerts:", error);
    return NextResponse.json(
      { error: "Failed to fetch seasonal alerts" },
      { status: 500 }
    );
  }
}

function getSeasonName(month: number): string {
  if (month >= 3 && month <= 5) return "spring";
  if (month >= 6 && month <= 8) return "summer";
  if (month >= 9 && month <= 11) return "fall";
  return "winter";
}
