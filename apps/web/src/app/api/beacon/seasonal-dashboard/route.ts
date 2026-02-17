import { NextRequest, NextResponse } from "next/server";
import { queryRows } from "@/lib/db";

/**
 * GET /api/beacon/seasonal-dashboard
 *
 * Returns monthly seasonal data for charting.
 * Includes clinic activity, request intake, and breeding indicators.
 */

interface MonthlyData {
  year: number;
  month_num: number;
  month_label: string;
  season: string;
  total_appointments: number;
  alterations: number;
  is_breeding_season: boolean;
}

interface BreedingIndicator {
  month: string;
  pregnant_count: number;
  lactating_count: number;
  pregnancy_rate_pct: number;
  lactation_rate_pct: number;
  breeding_intensity: number;
  breeding_phase: string;
}

interface KittenSurge {
  prediction_date: string;
  current_pregnant: number;
  current_lactating: number;
  estimated_kittens_2mo: number;
  surge_risk_level: string;
  is_breeding_season: boolean;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const yearsBack = parseInt(searchParams.get("years") || "2");
  const startYear = new Date().getFullYear() - yearsBack;

  try {
    // Get monthly dashboard data
    const monthlyData = await queryRows<MonthlyData>(
      `SELECT
         year,
         month_num,
         month_label,
         season,
         total_appointments::INT,
         alterations::INT,
         is_breeding_season
       FROM ops.v_seasonal_dashboard
       WHERE year >= $1
       ORDER BY year, month_num`,
      [startYear]
    );

    // Get breeding indicators
    const breedingIndicators = await queryRows<BreedingIndicator>(
      `SELECT
         TO_CHAR(month, 'YYYY-MM') as month,
         pregnant_count::INT,
         lactating_count::INT,
         pregnancy_rate_pct,
         lactation_rate_pct,
         breeding_intensity::INT,
         breeding_phase
       FROM ops.v_breeding_season_indicators
       WHERE EXTRACT(YEAR FROM month) >= $1
       ORDER BY month`,
      [startYear]
    );

    // Get kitten surge analysis
    const kittenSurge = await queryRows<KittenSurge>(
      `SELECT
         TO_CHAR(prediction_date, 'YYYY-MM-DD') as prediction_date,
         current_pregnant::INT,
         current_lactating::INT,
         estimated_kittens_2mo,
         surge_risk_level,
         is_breeding_season
       FROM ops.v_kitten_surge_prediction
       WHERE EXTRACT(YEAR FROM prediction_date) >= $1
       ORDER BY prediction_date`,
      [startYear]
    );

    // Calculate summary stats
    const currentYear = new Date().getFullYear();
    const currentYearData = monthlyData.filter((d) => d.year === currentYear);
    const prevYearData = monthlyData.filter((d) => d.year === currentYear - 1);

    const ytdAlterations = currentYearData.reduce((sum, d) => sum + (d.alterations || 0), 0);
    const prevYtdAlterations = prevYearData
      .filter((d) => d.month_num <= new Date().getMonth() + 1)
      .reduce((sum, d) => sum + (d.alterations || 0), 0);

    const summary = {
      ytd_alterations: ytdAlterations,
      prev_ytd_alterations: prevYtdAlterations,
      alterations_yoy_change:
        prevYtdAlterations > 0
          ? Math.round(((ytdAlterations - prevYtdAlterations) / prevYtdAlterations) * 100)
          : null,
      peak_risk_months: kittenSurge
        .filter((k) => k.surge_risk_level === "high")
        .map((k) => k.prediction_date),
    };

    return NextResponse.json({
      monthly_data: monthlyData,
      breeding_indicators: breedingIndicators,
      kitten_surge_analysis: kittenSurge,
      summary,
    });
  } catch (error) {
    console.error("Error fetching seasonal dashboard:", error);
    return NextResponse.json(
      { error: "Failed to fetch seasonal dashboard data" },
      { status: 500 }
    );
  }
}
