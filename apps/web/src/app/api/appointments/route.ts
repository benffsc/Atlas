import { NextRequest, NextResponse } from "next/server";
import { queryRows, query } from "@/lib/db";

interface AppointmentListRow {
  appointment_id: string;
  appointment_date: string;
  appointment_number: string;
  appointment_category: string;
  service_type: string | null;
  is_spay: boolean;
  is_neuter: boolean;
  vet_name: string | null;
  cat_id: string | null;
  cat_name: string | null;
  cat_microchip: string | null;
  cat_photo_url: string | null;
  person_id: string | null;
  person_name: string | null;
  place_id: string | null;
  vaccines: string[];
  treatments: string[];
  source_system: string | null;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const catId = searchParams.get("cat_id");
  const personId = searchParams.get("person_id");
  const placeId = searchParams.get("place_id");
  const fromDate = searchParams.get("from_date");
  const toDate = searchParams.get("to_date");
  const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 200);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (catId) {
    conditions.push(`v.cat_id = $${paramIndex}`);
    params.push(catId);
    paramIndex++;
  }

  if (personId) {
    conditions.push(`v.person_id = $${paramIndex}`);
    params.push(personId);
    paramIndex++;
  }

  if (placeId) {
    conditions.push(`v.place_id = $${paramIndex}`);
    params.push(placeId);
    paramIndex++;
  }

  if (fromDate) {
    conditions.push(`v.appointment_date >= $${paramIndex}::DATE`);
    params.push(fromDate);
    paramIndex++;
  }

  if (toDate) {
    conditions.push(`v.appointment_date <= $${paramIndex}::DATE`);
    params.push(toDate);
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  try {
    const sql = `
      SELECT
        v.appointment_id,
        v.appointment_date::TEXT,
        v.appointment_number,
        CASE
          WHEN v.service_type ILIKE '%spay%' OR v.service_type ILIKE '%neuter%' THEN 'Spay/Neuter'
          WHEN v.service_type ILIKE '%examination%' OR v.service_type ILIKE '%exam%feral%'
               OR v.service_type ILIKE '%exam fee%' THEN 'Wellness'
          WHEN v.service_type ILIKE '%recheck%' THEN 'Recheck'
          WHEN v.service_type ILIKE '%euthanasia%' THEN 'Euthanasia'
          ELSE 'Other'
        END as appointment_category,
        v.service_type,
        COALESCE(v.is_spay, false) as is_spay,
        COALESCE(v.is_neuter, false) as is_neuter,
        v.vet_name,
        v.cat_id,
        v.cat_name,
        v.cat_microchip,
        v.person_id,
        v.person_name,
        v.place_id,
        ARRAY_REMOVE(ARRAY[
          CASE WHEN v.service_type ILIKE '%rabies%3%year%' THEN 'Rabies (3yr)' END,
          CASE WHEN v.service_type ILIKE '%rabies%1%year%' THEN 'Rabies (1yr)' END,
          CASE WHEN v.service_type ILIKE '%fvrcp%' THEN 'FVRCP' END
        ], NULL) as vaccines,
        ARRAY_REMOVE(ARRAY[
          CASE WHEN v.service_type ILIKE '%revolution%' THEN 'Revolution' END,
          CASE WHEN v.service_type ILIKE '%advantage%' THEN 'Advantage' END,
          CASE WHEN v.service_type ILIKE '%activyl%' THEN 'Activyl' END,
          CASE WHEN v.service_type ILIKE '%convenia%' THEN 'Convenia' END,
          CASE WHEN v.service_type ILIKE '%praziquantel%' OR v.service_type ILIKE '%droncit%' THEN 'Dewormer' END
        ], NULL) as treatments,
        cat_photo.storage_path as cat_photo_url,
        v.source_system
      FROM ops.v_appointment_detail v
      LEFT JOIN LATERAL (
        SELECT rm.storage_path
        FROM ops.request_media rm
        WHERE rm.direct_cat_id = v.cat_id
          AND NOT rm.is_archived
        ORDER BY COALESCE(rm.is_hero, FALSE) DESC, rm.uploaded_at DESC
        LIMIT 1
      ) cat_photo ON true
      ${whereClause}
      ORDER BY v.appointment_date DESC, v.appointment_number DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    const countSql = `
      SELECT COUNT(*) as total
      FROM ops.v_appointment_detail v
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
