import { NextResponse } from "next/server";
import { queryRows } from "@/lib/db";

/**
 * GET /api/beacon/yoy-comparison
 *
 * Returns year-over-year comparison data for trending visualization.
 */

interface MonthlyComparison {
  month: number;
  month_name: string;
  current_year: {
    year: number;
    alterations: number;
  };
  previous_year: {
    year: number;
    alterations: number;
  };
  change_pct: number | null;
}

interface YoYSummary {
  ytd_alterations_current: number;
  ytd_alterations_previous: number;
  ytd_change_pct: number | null;
  trend: "up" | "down" | "stable";
  current_year: number;
  previous_year: number;
  months_with_data: number;
}

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

export async function GET() {
  try {
    const currentYear = new Date().getFullYear();
    const previousYear = currentYear - 1;
    const currentMonth = new Date().getMonth() + 1;

    // Get YoY comparison data from the view
    const yoyData = await queryRows<{
      current_year: number;
      previous_year: number;
      month: number;
      current_year_alterations: number;
      previous_year_alterations: number;
      yoy_change_pct: number | null;
    }>(
      `SELECT current_year, previous_year, month,
              current_year_alterations, previous_year_alterations, yoy_change_pct
       FROM ops.v_yoy_activity_comparison
       WHERE current_year = $1
       ORDER BY month`,
      [currentYear]
    );

    // Build comparison data
    const comparison: MonthlyComparison[] = [];

    for (let month = 1; month <= 12; month++) {
      const monthData = yoyData.find(d => d.month === month);

      comparison.push({
        month,
        month_name: MONTH_NAMES[month - 1],
        current_year: {
          year: currentYear,
          alterations: monthData?.current_year_alterations || 0,
        },
        previous_year: {
          year: previousYear,
          alterations: monthData?.previous_year_alterations || 0,
        },
        change_pct: monthData?.yoy_change_pct ?? null,
      });
    }

    // Calculate YTD summary (only up to current month)
    const ytdCurrentAlterations = comparison
      .filter(c => c.month <= currentMonth)
      .reduce((sum, c) => sum + c.current_year.alterations, 0);

    const ytdPreviousAlterations = comparison
      .filter(c => c.month <= currentMonth)
      .reduce((sum, c) => sum + c.previous_year.alterations, 0);

    const ytdChangePct = ytdPreviousAlterations > 0
      ? Math.round(((ytdCurrentAlterations - ytdPreviousAlterations) / ytdPreviousAlterations) * 100)
      : null;

    let trend: "up" | "down" | "stable" = "stable";
    if (ytdChangePct !== null) {
      if (ytdChangePct >= 5) trend = "up";
      else if (ytdChangePct <= -5) trend = "down";
    }

    const monthsWithData = comparison.filter(c =>
      c.current_year.alterations > 0
    ).length;

    const summary: YoYSummary = {
      ytd_alterations_current: ytdCurrentAlterations,
      ytd_alterations_previous: ytdPreviousAlterations,
      ytd_change_pct: ytdChangePct,
      trend,
      current_year: currentYear,
      previous_year: previousYear,
      months_with_data: monthsWithData,
    };

    // Calculate best/worst months
    const significantMonths = comparison
      .filter(c => c.previous_year.alterations > 0 && c.current_year.alterations > 0)
      .map(c => ({
        month: c.month,
        month_name: c.month_name,
        change_pct: c.change_pct || 0,
      }))
      .sort((a, b) => (b.change_pct || 0) - (a.change_pct || 0));

    const highlights = {
      best_month: significantMonths[0] || null,
      worst_month: significantMonths[significantMonths.length - 1] || null,
      consistent_growth: significantMonths.filter(m => m.change_pct > 0).length,
      consistent_decline: significantMonths.filter(m => m.change_pct < 0).length,
    };

    return NextResponse.json({
      comparison,
      summary,
      highlights,
    });
  } catch (error) {
    console.error("Error fetching YoY comparison:", error);
    return NextResponse.json(
      { error: "Failed to fetch YoY comparison data" },
      { status: 500 }
    );
  }
}
