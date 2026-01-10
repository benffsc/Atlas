import { NextRequest, NextResponse } from "next/server";
import { queryRows, query } from "@/lib/db";

interface PlaceListRow {
  place_id: string;
  display_name: string;
  formatted_address: string | null;
  place_kind: string | null;
  locality: string | null;
  postal_code: string | null;
  cat_count: number;
  person_count: number;
  has_cat_activity: boolean;
  created_at: string;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const q = searchParams.get("q") || null;
  const placeKind = searchParams.get("place_kind");
  const hasCats = searchParams.get("has_cats");
  const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 100);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (q) {
    conditions.push(`(
      display_name ILIKE $${paramIndex}
      OR formatted_address ILIKE $${paramIndex}
      OR locality ILIKE $${paramIndex}
    )`);
    params.push(`%${q}%`);
    paramIndex++;
  }

  if (placeKind) {
    conditions.push(`place_kind = $${paramIndex}`);
    params.push(placeKind);
    paramIndex++;
  }

  if (hasCats === "true") {
    conditions.push("cat_count > 0");
  } else if (hasCats === "false") {
    conditions.push("cat_count = 0");
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  try {
    const sql = `
      SELECT
        place_id,
        display_name,
        formatted_address,
        place_kind,
        locality,
        postal_code,
        cat_count,
        person_count,
        has_cat_activity,
        created_at
      FROM trapper.v_place_list
      ${whereClause}
      ORDER BY display_name ASC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    const countSql = `
      SELECT COUNT(*) as total
      FROM trapper.v_place_list
      ${whereClause}
    `;

    params.push(limit, offset);

    const [dataResult, countResult] = await Promise.all([
      queryRows<PlaceListRow>(sql, params),
      query(countSql, params.slice(0, -2)),
    ]);

    return NextResponse.json({
      places: dataResult,
      total: parseInt(countResult.rows[0]?.total || "0", 10),
      limit,
      offset,
    });
  } catch (error) {
    console.error("Error fetching places:", error);
    return NextResponse.json(
      { error: "Failed to fetch places" },
      { status: 500 }
    );
  }
}
