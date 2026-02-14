import { NextRequest, NextResponse } from "next/server";
import { queryRows } from "@/lib/db";

interface SeasonalDashboard {
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
  season: string;
  pregnant_count: number;
  lactating_count: number;
  in_heat_count: number;
  female_cats_spayed: number;
  breeding_active_pct: number;
  is_breeding_season: boolean;
}

interface KittenSurge {
  year: number;
  month: number;
  month_name: string;
  season: string;
  kitten_appointments: number;
  total_appointments: number;
  kitten_pct: number;
  historical_avg: number;
  z_score: number;
  is_surge_month: boolean;
}

interface YoYComparison {
  current_year: number;
  month: number;
  month_name: string;
  current_appointments: number;
  prev_year_appointments: number | null;
  current_alterations: number;
  prev_year_alterations: number | null;
  appointments_yoy_pct: number | null;
  alterations_yoy_pct: number | null;
}

interface SeasonalAlert {
  alert_type: string;
  severity: string;
  message: string;
  metric_name: string;
  current_value: number;
  threshold: number;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const view = searchParams.get("view") || "dashboard";
  const year = searchParams.get("year");

  try {
    let yearFilter = "";
    const params: unknown[] = [];

    if (year) {
      yearFilter = " WHERE year = $1";
      params.push(parseInt(year));
    }

    if (view === "dashboard") {
      const sql = `
        SELECT
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
        FROM ops.v_seasonal_dashboard
        ${yearFilter}
        ORDER BY year DESC, month DESC
        LIMIT 36
      `;
      const rows = await queryRows<SeasonalDashboard>(sql, params);
      return NextResponse.json({ data: rows, view: "dashboard" });
    }

    if (view === "breeding") {
      const sql = `
        SELECT
          year,
          month,
          period,
          season,
          pregnant_count,
          lactating_count,
          in_heat_count,
          female_cats_spayed,
          breeding_active_pct,
          is_breeding_season
        FROM ops.v_breeding_season_indicators
        ${yearFilter}
        ORDER BY year DESC, month DESC
        LIMIT 36
      `;
      const rows = await queryRows<BreedingIndicator>(sql, params);
      return NextResponse.json({ data: rows, view: "breeding" });
    }

    if (view === "kittens") {
      const sql = `
        SELECT
          year,
          month,
          month_name,
          season,
          kitten_appointments,
          total_appointments,
          kitten_pct,
          historical_avg,
          z_score,
          is_surge_month
        FROM ops.v_kitten_surge_prediction
        ${yearFilter}
        ORDER BY year DESC, month DESC
        LIMIT 36
      `;
      const rows = await queryRows<KittenSurge>(sql, params);
      return NextResponse.json({ data: rows, view: "kittens" });
    }

    if (view === "yoy") {
      const sql = `
        SELECT
          current_year,
          month,
          month_name,
          current_appointments,
          prev_year_appointments,
          current_alterations,
          prev_year_alterations,
          appointments_yoy_pct,
          alterations_yoy_pct
        FROM ops.v_yoy_activity_comparison
        ${year ? " WHERE current_year = $1" : ""}
        ORDER BY current_year DESC, month DESC
        LIMIT 24
      `;
      const rows = await queryRows<YoYComparison>(sql, params);
      return NextResponse.json({ data: rows, view: "yoy" });
    }

    if (view === "alerts") {
      const sql = `SELECT * FROM ops.get_seasonal_alerts()`;
      const rows = await queryRows<SeasonalAlert>(sql, []);
      return NextResponse.json({ data: rows, view: "alerts" });
    }

    return NextResponse.json({ error: "Invalid view" }, { status: 400 });
  } catch (error) {
    console.error("Error fetching seasonal data:", error);
    return NextResponse.json(
      { error: "Failed to fetch seasonal data" },
      { status: 500 }
    );
  }
}
