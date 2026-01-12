import { NextRequest, NextResponse } from "next/server";
import { queryRows, query } from "@/lib/db";

interface AppointmentListRow {
  appointment_id: string;
  scheduled_at: string;
  scheduled_date: string;
  status: string;
  appointment_type: string;
  cat_id: string | null;
  cat_name: string | null;
  person_id: string | null;
  person_name: string | null;
  place_id: string | null;
  place_name: string | null;
  provider_name: string | null;
  source_system: string;
  created_at: string;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const catId = searchParams.get("cat_id");
  const personId = searchParams.get("person_id");
  const placeId = searchParams.get("place_id");
  const status = searchParams.get("status");
  const fromDate = searchParams.get("from_date");
  const toDate = searchParams.get("to_date");
  const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 200);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (catId) {
    conditions.push(`cat_id = $${paramIndex}`);
    params.push(catId);
    paramIndex++;
  }

  if (personId) {
    conditions.push(`person_id = $${paramIndex}`);
    params.push(personId);
    paramIndex++;
  }

  if (placeId) {
    conditions.push(`place_id = $${paramIndex}`);
    params.push(placeId);
    paramIndex++;
  }

  if (status) {
    conditions.push(`status = $${paramIndex}`);
    params.push(status);
    paramIndex++;
  }

  if (fromDate) {
    conditions.push(`scheduled_date >= $${paramIndex}`);
    params.push(fromDate);
    paramIndex++;
  }

  if (toDate) {
    conditions.push(`scheduled_date <= $${paramIndex}`);
    params.push(toDate);
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  try {
    const sql = `
      SELECT
        appointment_id,
        scheduled_at,
        scheduled_date::TEXT,
        status,
        appointment_type,
        cat_id,
        cat_name,
        person_id,
        person_name,
        place_id,
        place_name,
        provider_name,
        source_system,
        created_at
      FROM trapper.v_appointment_list
      ${whereClause}
      ORDER BY scheduled_date DESC, scheduled_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    const countSql = `
      SELECT COUNT(*) as total
      FROM trapper.v_appointment_list
      ${whereClause}
    `;

    params.push(limit, offset);

    const [dataResult, countResult] = await Promise.all([
      queryRows<AppointmentListRow>(sql, params),
      query(countSql, params.slice(0, -2)),
    ]);

    return NextResponse.json({
      appointments: dataResult,
      total: parseInt(countResult.rows[0]?.total || "0", 10),
      limit,
      offset,
    });
  } catch (error) {
    console.error("Error fetching appointments:", error);
    return NextResponse.json(
      { error: "Failed to fetch appointments" },
      { status: 500 }
    );
  }
}
