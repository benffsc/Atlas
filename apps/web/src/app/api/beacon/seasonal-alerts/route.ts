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
    // Build alerts from breeding indicators and seasonal data
    const alerts: SeasonalAlert[] = [];

    const currentMonth = new Date().getMonth() + 1;
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    // Get current season data - use month_num for filtering
    const currentData = await queryOne<{
      year: number;
      month_num: number;
      season: string;
      is_breeding_season: boolean;
      total_appointments: number;
      alterations: number;
    }>(
      `SELECT year, month_num, season, is_breeding_season, total_appointments, alterations
       FROM ops.v_seasonal_dashboard
       WHERE year = EXTRACT(YEAR FROM CURRENT_DATE)::INT
         AND month_num = EXTRACT(MONTH FROM CURRENT_DATE)::INT
       LIMIT 1`,
      []
    );

    // Get breeding indicators for current month - month is a date column
    const breedingIndicators = await queryOne<{
      pregnant_count: number;
      lactating_count: number;
      pregnancy_rate_pct: number;
      lactation_rate_pct: number;
      breeding_intensity: number;
      breeding_phase: string;
      total_female_appts: number;
    }>(
      `SELECT pregnant_count, lactating_count, pregnancy_rate_pct, lactation_rate_pct,
              breeding_intensity, breeding_phase, total_female_appts
       FROM ops.v_breeding_season_indicators
       WHERE EXTRACT(YEAR FROM month)::INT = EXTRACT(YEAR FROM CURRENT_DATE)::INT
         AND EXTRACT(MONTH FROM month)::INT = EXTRACT(MONTH FROM CURRENT_DATE)::INT
       LIMIT 1`,
      []
    );

    // Calculate breeding active percentage from available data
    const breedingActivePct = breedingIndicators
      ? ((breedingIndicators.pregnancy_rate_pct || 0) + (breedingIndicators.lactation_rate_pct || 0)) / 2
      : 0;

    // Generate alerts based on breeding indicators
    if (breedingIndicators) {
      if (breedingActivePct > 50) {
        alerts.push({
          alert_type: "kitten_surge",
          severity: breedingActivePct > 70 ? "high" : "medium",
          message: `High breeding activity detected: ${breedingActivePct.toFixed(1)}% breeding rate`,
          metric_name: "breeding_active_pct",
          current_value: breedingActivePct,
          threshold: 50,
          recommendation: ALERT_RECOMMENDATIONS.kitten_surge,
        });
      }
      if (breedingIndicators.pregnant_count > 10) {
        alerts.push({
          alert_type: "breeding_peak",
          severity: "medium",
          message: `${breedingIndicators.pregnant_count} pregnant cats processed this month`,
          metric_name: "pregnant_count",
          current_value: Number(breedingIndicators.pregnant_count),
          threshold: 10,
          recommendation: ALERT_RECOMMENDATIONS.breeding_peak,
        });
      }
    }

    // Build current season info
    const currentSeason: CurrentSeason = {
      is_breeding_season: currentMonth >= 2 && currentMonth <= 11,
      breeding_active_pct: breedingActivePct,
      demand_supply_ratio: null,
      current_month: currentMonth,
      current_month_name: monthNames[currentMonth - 1],
      season: currentData?.season || getSeasonName(currentMonth),
    };

    // Build prediction based on breeding indicators
    let prediction: Prediction;

    if (breedingActivePct > 50) {
      prediction = {
        kitten_surge_expected: true,
        surge_confidence: breedingActivePct > 70 ? "high" : "medium",
        expected_timing: "2-3 months",
        reasoning: `${breedingActivePct.toFixed(1)}% breeding rate indicates likely kitten surge.`,
      };
    } else if (breedingActivePct > 30) {
      prediction = {
        kitten_surge_expected: true,
        surge_confidence: "low",
        expected_timing: "3-4 months",
        reasoning: `${breedingActivePct.toFixed(1)}% breeding activity suggests moderate kitten intake ahead.`,
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
      month: string;
      pregnancy_rate_pct: number;
      lactation_rate_pct: number;
    }>(
      `SELECT TO_CHAR(month, 'YYYY-MM') as month, pregnancy_rate_pct, lactation_rate_pct
       FROM ops.v_breeding_season_indicators
       WHERE month >= CURRENT_DATE - INTERVAL '12 months'
       ORDER BY month`,
      []
    );

    return NextResponse.json({
      alerts,
      current_season: currentSeason,
      predictions: prediction,
      breeding_history: breedingHistory,
      breeding_indicators: breedingIndicators
        ? {
            pregnant: Number(breedingIndicators.pregnant_count),
            lactating: Number(breedingIndicators.lactating_count),
            pregnancy_rate: breedingIndicators.pregnancy_rate_pct,
            lactation_rate: breedingIndicators.lactation_rate_pct,
            total_females_processed: Number(breedingIndicators.total_female_appts),
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
