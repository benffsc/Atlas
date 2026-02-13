import { NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";

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
    appointments: number;
    alterations: number;
    requests: number;
  };
  previous_year: {
    year: number;
    appointments: number;
    alterations: number;
    requests: number;
  };
  change_pct: {
    appointments: number | null;
    alterations: number | null;
    requests: number | null;
  };
}

interface YoYSummary {
  ytd_alterations_current: number;
  ytd_alterations_previous: number;
  ytd_appointments_current: number;
  ytd_appointments_previous: number;
  ytd_change_pct: number | null;
  appointments_change_pct: number | null;
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
      month: number;
      month_name: string;
      current_appointments: number;
      prev_year_appointments: number | null;
      current_alterations: number;
      prev_year_alterations: number | null;
      appointments_yoy_pct: number | null;
      alterations_yoy_pct: number | null;
    }>(
      `SELECT *
       FROM ops.v_yoy_activity_comparison
       WHERE current_year IN ($1, $2)
       ORDER BY current_year, month`,
      [currentYear, previousYear]
    );

    // Get request counts by month for both years
    const requestData = await queryRows<{
      year: number;
      month: number;
      request_count: number;
    }>(
      `SELECT
         EXTRACT(YEAR FROM created_at)::INT AS year,
         EXTRACT(MONTH FROM created_at)::INT AS month,
         COUNT(*)::INT AS request_count
       FROM ops.requests
       WHERE EXTRACT(YEAR FROM created_at) IN ($1, $2)
       GROUP BY 1, 2
       ORDER BY 1, 2`,
      [currentYear, previousYear]
    );

    // Build comparison data
    const comparison: MonthlyComparison[] = [];
    const currentYearData = yoyData.filter(d => d.current_year === currentYear);
    const prevYearData = yoyData.filter(d => d.current_year === previousYear);

    for (let month = 1; month <= 12; month++) {
      const currMonth = currentYearData.find(d => d.month === month);
      const prevMonth = prevYearData.find(d => d.month === month);

      const currRequests = requestData.find(r => r.year === currentYear && r.month === month);
      const prevRequests = requestData.find(r => r.year === previousYear && r.month === month);

      const currAppts = currMonth?.current_appointments || 0;
      const prevAppts = currMonth?.prev_year_appointments || prevMonth?.current_appointments || 0;

      const currAlts = currMonth?.current_alterations || 0;
      const prevAlts = currMonth?.prev_year_alterations || prevMonth?.current_alterations || 0;

      const currReqs = currRequests?.request_count || 0;
      const prevReqs = prevRequests?.request_count || 0;

      comparison.push({
        month,
        month_name: MONTH_NAMES[month - 1],
        current_year: {
          year: currentYear,
          appointments: currAppts,
          alterations: currAlts,
          requests: currReqs,
        },
        previous_year: {
          year: previousYear,
          appointments: prevAppts,
          alterations: prevAlts,
          requests: prevReqs,
        },
        change_pct: {
          appointments: prevAppts > 0
            ? Math.round(((currAppts - prevAppts) / prevAppts) * 100)
            : null,
          alterations: prevAlts > 0
            ? Math.round(((currAlts - prevAlts) / prevAlts) * 100)
            : null,
          requests: prevReqs > 0
            ? Math.round(((currReqs - prevReqs) / prevReqs) * 100)
            : null,
        },
      });
    }

    // Calculate YTD summary (only up to current month)
    const ytdCurrentAlterations = comparison
      .filter(c => c.month <= currentMonth)
      .reduce((sum, c) => sum + c.current_year.alterations, 0);

    const ytdPreviousAlterations = comparison
      .filter(c => c.month <= currentMonth)
      .reduce((sum, c) => sum + c.previous_year.alterations, 0);

    const ytdCurrentAppointments = comparison
      .filter(c => c.month <= currentMonth)
      .reduce((sum, c) => sum + c.current_year.appointments, 0);

    const ytdPreviousAppointments = comparison
      .filter(c => c.month <= currentMonth)
      .reduce((sum, c) => sum + c.previous_year.appointments, 0);

    const ytdChangePct = ytdPreviousAlterations > 0
      ? Math.round(((ytdCurrentAlterations - ytdPreviousAlterations) / ytdPreviousAlterations) * 100)
      : null;

    const appointmentsChangePct = ytdPreviousAppointments > 0
      ? Math.round(((ytdCurrentAppointments - ytdPreviousAppointments) / ytdPreviousAppointments) * 100)
      : null;

    let trend: "up" | "down" | "stable" = "stable";
    if (ytdChangePct !== null) {
      if (ytdChangePct >= 5) trend = "up";
      else if (ytdChangePct <= -5) trend = "down";
    }

    const monthsWithData = comparison.filter(c =>
      c.current_year.appointments > 0 || c.current_year.alterations > 0
    ).length;

    const summary: YoYSummary = {
      ytd_alterations_current: ytdCurrentAlterations,
      ytd_alterations_previous: ytdPreviousAlterations,
      ytd_appointments_current: ytdCurrentAppointments,
      ytd_appointments_previous: ytdPreviousAppointments,
      ytd_change_pct: ytdChangePct,
      appointments_change_pct: appointmentsChangePct,
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
        change_pct: c.change_pct.alterations || 0,
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
