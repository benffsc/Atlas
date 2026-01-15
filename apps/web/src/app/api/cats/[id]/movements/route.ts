import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";

interface MovementEvent {
  movement_id: string;
  cat_id: string;
  microchip: string | null;
  from_place_id: string | null;
  from_place_name: string | null;
  from_address: string | null;
  to_place_id: string;
  to_place_name: string | null;
  to_address: string | null;
  event_date: string;
  previous_event_date: string | null;
  days_since_previous: number | null;
  distance_meters: number | null;
  distance_category: string | null;
  movement_type: string;
  source_type: string;
  notes: string | null;
  created_at: string;
}

interface MovementPattern {
  cat_id: string;
  cat_name: string;
  microchip: string | null;
  total_movements: number;
  unique_places: number;
  first_seen: string;
  last_seen: string;
  tracking_duration_days: number;
  avg_days_between_visits: number | null;
  avg_distance_meters: number | null;
  max_distance_meters: number | null;
  return_visits: number;
  new_locations: number;
  movement_pattern: string;
  primary_place_id: string | null;
  primary_place_name: string | null;
  primary_address: string | null;
}

// GET /api/cats/[id]/movements - Get movement history and patterns
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Cat ID is required" },
      { status: 400 }
    );
  }

  try {
    // Get movement timeline
    const timelineSql = `
      SELECT
        movement_id,
        cat_id,
        microchip,
        from_place_id,
        from_place_name,
        from_address,
        to_place_id,
        to_place_name,
        to_address,
        event_date,
        previous_event_date,
        days_since_previous,
        distance_meters,
        distance_category,
        movement_type,
        source_type,
        notes,
        created_at
      FROM trapper.v_cat_movement_timeline
      WHERE cat_id = $1
      ORDER BY event_date DESC
      LIMIT 100
    `;

    const timeline = await queryRows<MovementEvent>(timelineSql, [id]);

    // Get movement pattern summary
    const patternSql = `
      SELECT
        cat_id,
        cat_name,
        microchip,
        total_movements,
        unique_places,
        first_seen,
        last_seen,
        tracking_duration_days,
        avg_days_between_visits,
        avg_distance_meters,
        max_distance_meters,
        return_visits,
        new_locations,
        movement_pattern,
        primary_place_id,
        primary_place_name,
        primary_address
      FROM trapper.v_cat_movement_patterns
      WHERE cat_id = $1
    `;

    const pattern = await queryOne<MovementPattern>(patternSql, [id]);

    return NextResponse.json({
      timeline,
      pattern: pattern || null,
      has_movements: timeline.length > 0,
    });
  } catch (error) {
    console.error("Error fetching cat movements:", error);
    return NextResponse.json(
      { error: "Failed to fetch movements" },
      { status: 500 }
    );
  }
}

// POST /api/cats/[id]/movements - Record a manual movement event
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Cat ID is required" },
      { status: 400 }
    );
  }

  try {
    const body = await request.json();

    const { to_place_id, event_date, notes, recorded_by } = body;

    if (!to_place_id) {
      return NextResponse.json(
        { error: "to_place_id is required" },
        { status: 400 }
      );
    }

    const result = await queryOne<{ record_cat_movement: string }>(
      `SELECT trapper.record_cat_movement($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        to_place_id,
        event_date || new Date().toISOString().split("T")[0],
        "manual",
        null,
        notes || null,
        recorded_by || "web_app",
      ]
    );

    return NextResponse.json({
      success: true,
      movement_id: result?.record_cat_movement,
    });
  } catch (error) {
    console.error("Error recording movement:", error);
    return NextResponse.json(
      { error: "Failed to record movement" },
      { status: 500 }
    );
  }
}
