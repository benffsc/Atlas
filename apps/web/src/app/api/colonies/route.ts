import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";

interface Colony {
  colony_id: string;
  colony_name: string;
  status: string;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  place_count: number;
  request_count: number;
  linked_community_cats: number;
  linked_owned_cats: number;
  linked_community_altered: number;
  observation_total_cats: number | null;
  total_cats_confidence: string | null;
  observation_fixed_cats: number | null;
  fixed_cats_confidence: string | null;
  latest_observation_date: string | null;
  has_count_discrepancy: boolean;
}

// GET /api/colonies - List colonies with optional filters
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const hasDiscrepancy = searchParams.get("hasDiscrepancy");
    const search = searchParams.get("search");

    let whereClause = "1=1";
    const params: (string | boolean)[] = [];
    let paramIndex = 1;

    if (status) {
      whereClause += ` AND status = $${paramIndex++}`;
      params.push(status);
    }

    if (hasDiscrepancy === "true") {
      whereClause += ` AND has_count_discrepancy = TRUE`;
    }

    if (search) {
      whereClause += ` AND colony_name ILIKE $${paramIndex++}`;
      params.push(`%${search}%`);
    }

    const colonies = await queryRows<Colony>(
      `SELECT
        colony_id,
        colony_name,
        status,
        colony_notes as notes,
        created_by,
        created_at,
        updated_at,
        place_count,
        request_count,
        linked_community_cats,
        linked_owned_cats,
        linked_community_altered,
        observation_total_cats,
        total_cats_confidence,
        observation_fixed_cats,
        fixed_cats_confidence,
        latest_observation_date,
        has_count_discrepancy
      FROM ops.v_colony_stats
      WHERE ${whereClause}
      ORDER BY colony_name`,
      params
    );

    // Get summary counts
    const summary = await queryOne<{
      total: number;
      active: number;
      with_discrepancy: number;
    }>(
      `SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'active') as active,
        COUNT(*) FILTER (WHERE has_count_discrepancy) as with_discrepancy
      FROM ops.v_colony_stats`
    );

    return NextResponse.json({
      colonies,
      summary,
    });
  } catch (error) {
    console.error("Error fetching colonies:", error);
    return NextResponse.json(
      { error: "Failed to fetch colonies" },
      { status: 500 }
    );
  }
}

// POST /api/colonies - Create a new colony
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { colony_name, status = "active", notes, created_by } = body;

    if (!colony_name?.trim()) {
      return NextResponse.json(
        { error: "Colony name is required" },
        { status: 400 }
      );
    }

    if (!created_by?.trim()) {
      return NextResponse.json(
        { error: "Created by is required" },
        { status: 400 }
      );
    }

    const validStatuses = ["active", "monitored", "resolved", "inactive"];
    if (!validStatuses.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` },
        { status: 400 }
      );
    }

    const colony = await queryOne<{ colony_id: string }>(
      `INSERT INTO sot.colonies (colony_name, status, notes, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING colony_id`,
      [colony_name.trim(), status, notes?.trim() || null, created_by.trim()]
    );

    if (!colony) {
      return NextResponse.json(
        { error: "Failed to create colony" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      colony_id: colony.colony_id,
    });
  } catch (error) {
    console.error("Error creating colony:", error);
    return NextResponse.json(
      { error: "Failed to create colony" },
      { status: 500 }
    );
  }
}
