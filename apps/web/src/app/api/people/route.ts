import { NextRequest, NextResponse } from "next/server";
import { queryRows, query } from "@/lib/db";

interface PersonListRow {
  person_id: string;
  display_name: string;
  account_type: string | null;
  surface_quality: string | null;
  quality_reason: string | null;
  has_email: boolean;
  has_phone: boolean;
  cat_count: number;
  place_count: number;
  cat_names: string | null;
  primary_place: string | null;
  created_at: string;
  source_quality: string;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const q = searchParams.get("q") || null;
  const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 100);
  const offset = parseInt(searchParams.get("offset") || "0", 10);
  const deepSearch = searchParams.get("deep_search") === "true";

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  // Search query
  if (q) {
    conditions.push(`display_name ILIKE $${paramIndex}`);
    params.push(`%${q}%`);
    paramIndex++;
  }

  // Default: only high-quality canonical people
  // Deep Search: show everything including low quality and non-person accounts
  if (!deepSearch) {
    conditions.push(`account_type = 'person'`);
    conditions.push(`surface_quality != 'Low'`);
    conditions.push(`(data_quality IS NULL OR data_quality != 'low')`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  try {
    // Order by surface quality (High first), then name
    const sql = `
      SELECT
        person_id,
        display_name,
        account_type,
        surface_quality,
        quality_reason,
        has_email,
        has_phone,
        cat_count,
        place_count,
        cat_names,
        primary_place,
        created_at,
        source_quality
      FROM trapper.v_person_list_v2
      ${whereClause}
      ORDER BY
        CASE surface_quality WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END,
        display_name ASC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    const countSql = `
      SELECT COUNT(*) as total
      FROM trapper.v_person_list_v2
      ${whereClause}
    `;

    params.push(limit, offset);

    const [dataResult, countResult] = await Promise.all([
      queryRows<PersonListRow>(sql, params),
      query(countSql, params.slice(0, -2)),
    ]);

    return NextResponse.json({
      people: dataResult,
      total: parseInt(countResult.rows[0]?.total || "0", 10),
      limit,
      offset,
    });
  } catch (error) {
    console.error("Error fetching people:", error);
    return NextResponse.json(
      { error: "Failed to fetch people" },
      { status: 500 }
    );
  }
}
