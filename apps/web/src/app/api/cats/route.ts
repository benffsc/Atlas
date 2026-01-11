import { NextRequest, NextResponse } from "next/server";
import { queryRows, query } from "@/lib/db";

interface CatListRow {
  cat_id: string;
  display_name: string;
  sex: string | null;
  altered_status: string | null;
  breed: string | null;
  microchip: string | null;
  quality_tier: string;
  quality_reason: string;
  has_microchip: boolean;
  owner_count: number;
  owner_names: string | null;
  primary_place_id: string | null;
  primary_place_label: string | null;
  place_kind: string | null;
  has_place: boolean;
  created_at: string;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const q = searchParams.get("q") || null;
  const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 100);
  const offset = parseInt(searchParams.get("offset") || "0", 10);
  const hasPlace = searchParams.get("has_place");
  const sex = searchParams.get("sex");
  const alteredStatus = searchParams.get("altered_status");

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  // Search query (name or microchip)
  if (q) {
    conditions.push(`(
      display_name ILIKE $${paramIndex}
      OR microchip ILIKE $${paramIndex}
    )`);
    params.push(`%${q}%`);
    paramIndex++;
  }

  // Filter: has_place
  if (hasPlace === "true") {
    conditions.push("has_place = true");
  } else if (hasPlace === "false") {
    conditions.push("has_place = false");
  }

  // Filter: sex
  if (sex) {
    conditions.push(`sex ILIKE $${paramIndex}`);
    params.push(sex);
    paramIndex++;
  }

  // Filter: altered_status
  if (alteredStatus) {
    conditions.push(`altered_status ILIKE $${paramIndex}`);
    params.push(alteredStatus);
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  try {
    // Get data - order by quality tier then name (high confidence first)
    const sql = `
      SELECT
        cat_id,
        display_name,
        sex,
        altered_status,
        breed,
        microchip,
        quality_tier,
        quality_reason,
        has_microchip,
        owner_count,
        owner_names,
        primary_place_id,
        primary_place_label,
        place_kind,
        has_place,
        created_at
      FROM trapper.v_cat_list
      ${whereClause}
      ORDER BY quality_tier ASC, display_name ASC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    const countSql = `
      SELECT COUNT(*) as total
      FROM trapper.v_cat_list
      ${whereClause}
    `;

    params.push(limit, offset);

    const [dataResult, countResult] = await Promise.all([
      queryRows<CatListRow>(sql, params),
      query(countSql, params.slice(0, -2)),
    ]);

    return NextResponse.json({
      cats: dataResult,
      total: parseInt(countResult.rows[0]?.total || "0", 10),
      limit,
      offset,
    });
  } catch (error) {
    console.error("Error fetching cats:", error);
    return NextResponse.json(
      { error: "Failed to fetch cats" },
      { status: 500 }
    );
  }
}
