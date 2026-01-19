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
  month: number;
  period: string;
  season: string;
  clinic_appointments: number;
  alterations: number;
  kitten_procedures: number;
  pregnant_cats: number;
  intake_requests: number;
  urgent_requests: number;
  kitten_intake_mentions: number;
  is_breeding_season: boolean;
  demand_supply_ratio: number | null;
}

interface BreedingIndicator {
  year: number;
  month: number;
  period: string;
  pregnant_count: number;
  lactating_count: number;
  in_heat_count: number;
  breeding_active_pct: number;
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
         month,
         period,
         season,
         clinic_appointments,
         alterations,
         kitten_procedures,
         pregnant_cats,
         intake_requests,
         urgent_requests,
         kitten_intake_mentions,
         is_breeding_season,
         demand_supply_ratio
       FROM trapper.v_seasonal_dashboard
       WHERE year >= $1
       ORDER BY year, month`,
      [startYear]
    );

    // Get breeding indicators
    const breedingIndicators = await queryRows<BreedingIndicator>(
      `SELECT
         year,
         month,
         period,
         pregnant_count,
         lactating_count,
         in_heat_count,
         breeding_active_pct
       FROM trapper.v_breeding_season_indicators
       WHERE year >= $1
       ORDER BY year, month`,
      [startYear]
    );

    // Get kitten surge analysis
    const kittenSurge = await queryRows<{
      year: number;
      month: number;
      month_name: string;
      kitten_appointments: number;
      historical_avg: number;
      z_score: number;
      is_surge_month: boolean;
    }>(
      `SELECT
         year,
         month,
         month_name,
         kitten_appointments,
         historical_avg,
         z_score,
         is_surge_month
       FROM trapper.v_kitten_surge_prediction
       WHERE year >= $1
       ORDER BY year, month`,
      [startYear]
    );

    // Calculate summary stats
    const currentYear = new Date().getFullYear();
    const currentYearData = monthlyData.filter((d) => d.year === currentYear);
    const prevYearData = monthlyData.filter((d) => d.year === currentYear - 1);

    const ytdAlterations = currentYearData.reduce((sum, d) => sum + (d.alterations || 0), 0);
    const prevYtdAlterations = prevYearData
      .filter((d) => d.month <= new Date().getMonth() + 1)
      .reduce((sum, d) => sum + (d.alterations || 0), 0);

    const ytdRequests = currentYearData.reduce((sum, d) => sum + (d.intake_requests || 0), 0);
    const prevYtdRequests = prevYearData
      .filter((d) => d.month <= new Date().getMonth() + 1)
      .reduce((sum, d) => sum + (d.intake_requests || 0), 0);

    const summary = {
      ytd_alterations: ytdAlterations,
      prev_ytd_alterations: prevYtdAlterations,
      ytd_requests: ytdRequests,
      prev_ytd_requests: prevYtdRequests,
      alterations_yoy_change:
        prevYtdAlterations > 0
          ? Math.round(((ytdAlterations - prevYtdAlterations) / prevYtdAlterations) * 100)
          : null,
      requests_yoy_change:
        prevYtdRequests > 0
          ? Math.round(((ytdRequests - prevYtdRequests) / prevYtdRequests) * 100)
          : null,
      peak_kitten_months: kittenSurge
        .filter((k) => k.is_surge_month && k.year === currentYear)
        .map((k) => k.month_name),
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
