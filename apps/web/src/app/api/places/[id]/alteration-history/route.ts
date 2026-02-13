import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";

interface YearlyBreakdown {
  requests: number;
  caught: number;
  altered: number;
}

interface AlterationHistoryRow {
  place_id: string;
  place_name: string;
  formatted_address: string | null;
  service_zone: string | null;
  total_requests: number;
  total_cats_caught: number;
  total_cats_altered: number;
  total_already_altered: number;
  total_males: number;
  total_females: number;
  place_alteration_rate_pct: number | null;
  first_request_date: string | null;
  latest_request_date: string | null;
  yearly_breakdown: Record<string, YearlyBreakdown> | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Place ID is required" },
      { status: 400 }
    );
  }

  try {
    const sql = `
      SELECT
        place_id,
        place_name,
        formatted_address,
        service_zone,
        total_requests,
        total_cats_caught,
        total_cats_altered,
        total_already_altered,
        total_males,
        total_females,
        place_alteration_rate_pct,
        first_request_date,
        latest_request_date,
        yearly_breakdown
      FROM sot.v_place_alteration_history
      WHERE place_id = $1
    `;

    const history = await queryOne<AlterationHistoryRow>(sql, [id]);

    if (!history) {
      // Place exists but has no requests with alteration data
      // Return empty stats
      return NextResponse.json({
        place_id: id,
        place_name: null,
        formatted_address: null,
        service_zone: null,
        total_requests: 0,
        total_cats_caught: 0,
        total_cats_altered: 0,
        total_already_altered: 0,
        total_males: 0,
        total_females: 0,
        place_alteration_rate_pct: null,
        first_request_date: null,
        latest_request_date: null,
        yearly_breakdown: {},
        has_data: false,
      });
    }

    // Parse yearly_breakdown if it's a string
    const yearlyBreakdown = typeof history.yearly_breakdown === "string"
      ? JSON.parse(history.yearly_breakdown)
      : history.yearly_breakdown || {};

    return NextResponse.json({
      place_id: history.place_id,
      place_name: history.place_name,
      formatted_address: history.formatted_address,
      service_zone: history.service_zone,
      total_requests: history.total_requests,
      total_cats_caught: history.total_cats_caught,
      total_cats_altered: history.total_cats_altered,
      total_already_altered: history.total_already_altered,
      total_males: history.total_males,
      total_females: history.total_females,
      place_alteration_rate_pct: history.place_alteration_rate_pct,
      first_request_date: history.first_request_date,
      latest_request_date: history.latest_request_date,
      yearly_breakdown: yearlyBreakdown,
      has_data: true,
    });
  } catch (error) {
    console.error("Error fetching place alteration history:", error);
    return NextResponse.json(
      { error: "Failed to fetch alteration history" },
      { status: 500 }
    );
  }
}
