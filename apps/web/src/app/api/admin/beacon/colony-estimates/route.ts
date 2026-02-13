import { NextRequest, NextResponse } from "next/server";
import { queryRows, query } from "@/lib/db";

interface ColonyEstimate {
  estimate_id: string;
  place_id: string;
  place_name: string;
  place_address: string;
  total_cats: number | null;
  eartip_count_observed: number | null;
  altered_count: number | null;
  source_type: string;
  source_system: string;
  observation_date: string;
  notes: string | null;
  created_at: string;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sourceType = searchParams.get("source_type");
    const limit = parseInt(searchParams.get("limit") || "200", 10);
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    let whereClause = "";
    const params: (string | number)[] = [];

    if (sourceType && sourceType !== "all") {
      params.push(sourceType);
      whereClause = `WHERE pce.source_type = $${params.length}`;
    }

    params.push(limit, offset);

    const sql = `
      SELECT
        pce.estimate_id::TEXT,
        pce.place_id::TEXT,
        p.display_name AS place_name,
        p.street_address AS place_address,
        pce.total_cats,
        pce.eartip_count_observed,
        pce.altered_count,
        pce.source_type,
        pce.source_system,
        pce.observation_date::TEXT,
        pce.notes,
        pce.created_at::TEXT
      FROM sot.place_colony_estimates pce
      JOIN sot.places p ON p.place_id = pce.place_id
      ${whereClause}
      ORDER BY pce.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;

    const estimates = await queryRows<ColonyEstimate>(sql, params);

    return NextResponse.json({ estimates });
  } catch (error) {
    console.error("Colony estimates fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch colony estimates" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { estimate_id, total_cats, eartip_count_observed, altered_count, notes } = body;

    if (!estimate_id) {
      return NextResponse.json({ error: "Missing estimate ID" }, { status: 400 });
    }

    // Build dynamic update
    const updates: string[] = [];
    const params: (string | number | null)[] = [];
    let paramIndex = 1;

    if (total_cats !== undefined) {
      updates.push(`total_cats = $${paramIndex++}`);
      params.push(total_cats === "" ? null : total_cats);
    }
    if (eartip_count_observed !== undefined) {
      updates.push(`eartip_count_observed = $${paramIndex++}`);
      params.push(eartip_count_observed === "" ? null : eartip_count_observed);
    }
    if (altered_count !== undefined) {
      updates.push(`altered_count = $${paramIndex++}`);
      params.push(altered_count === "" ? null : altered_count);
    }
    if (notes !== undefined) {
      updates.push(`notes = $${paramIndex++}`);
      params.push(notes || null);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    updates.push(`updated_at = NOW()`);
    params.push(estimate_id);

    await query(
      `UPDATE sot.place_colony_estimates SET ${updates.join(", ")} WHERE estimate_id = $${paramIndex}`,
      params
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Colony estimate update error:", error);
    return NextResponse.json(
      { error: "Failed to update estimate" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const estimateId = searchParams.get("id");

    if (!estimateId) {
      return NextResponse.json({ error: "Missing estimate ID" }, { status: 400 });
    }

    await query(
      `DELETE FROM sot.place_colony_estimates WHERE estimate_id = $1`,
      [estimateId]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Colony estimate delete error:", error);
    return NextResponse.json(
      { error: "Failed to delete estimate" },
      { status: 500 }
    );
  }
}
