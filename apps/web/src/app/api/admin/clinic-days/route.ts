import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";
import { getSession } from "@/lib/auth";

interface ClinicDay {
  clinic_day_id: string;
  clinic_date: string;
  // Clinic type fields (MIG_456)
  clinic_type: "regular" | "tame_only" | "mass_trapping" | "emergency" | "mobile";
  clinic_type_label?: string;
  target_place_id: string | null;
  target_place_name?: string | null;
  target_place_address?: string | null;
  max_capacity: number | null;
  vet_name: string | null;
  day_of_week?: number;
  // Stats
  total_cats: number;
  total_females: number;
  total_males: number;
  total_unknown_sex: number;
  total_no_shows: number;
  total_cancelled: number;
  notes: string | null;
  finalized_at: string | null;
  finalized_by: string | null;
  created_at: string;
  // From comparison view
  clinichq_cats?: number;
  clinichq_females?: number;
  clinichq_males?: number;
  variance?: number;
}

/**
 * GET /api/admin/clinic-days
 * List clinic days from actual ClinicHQ appointment data
 */
export async function GET(request: NextRequest) {
  try {
    // Require auth
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get("start_date");
    const endDate = searchParams.get("end_date");
    const limit = parseInt(searchParams.get("limit") || "30");
    const offset = parseInt(searchParams.get("offset") || "0");

    // Build WHERE clause for date filtering
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (startDate) {
      conditions.push(`a.appointment_date >= $${paramIndex++}`);
      params.push(startDate);
    }
    if (endDate) {
      conditions.push(`a.appointment_date <= $${paramIndex++}`);
      params.push(endDate);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Get clinic days directly from appointments (actual ClinicHQ data)
    const clinicDays = await queryRows<ClinicDay>(
      `
      SELECT
        COALESCE(cd.clinic_day_id, gen_random_uuid()) AS clinic_day_id,
        a.appointment_date AS clinic_date,
        COALESCE(cd.clinic_type, 'regular') AS clinic_type,
        CASE COALESCE(cd.clinic_type, 'regular')
          WHEN 'regular' THEN 'Regular'
          WHEN 'tame_only' THEN 'Tame Only'
          WHEN 'mass_trapping' THEN 'Mass Trapping'
          WHEN 'emergency' THEN 'Emergency'
          WHEN 'mobile' THEN 'Mobile'
          ELSE 'Regular'
        END AS clinic_type_label,
        cd.target_place_id,
        tp.display_name AS target_place_name,
        tp.formatted_address AS target_place_address,
        cd.max_capacity,
        cd.vet_name,
        EXTRACT(DOW FROM a.appointment_date)::INT AS day_of_week,
        COUNT(*)::INT AS total_cats,
        COUNT(*) FILTER (WHERE c.sex = 'Female' OR a.is_spay = TRUE)::INT AS total_females,
        COUNT(*) FILTER (WHERE c.sex = 'Male' OR a.is_neuter = TRUE)::INT AS total_males,
        COUNT(*) FILTER (WHERE c.sex IS NULL OR c.sex NOT IN ('Female', 'Male'))::INT AS total_unknown_sex,
        0 AS total_no_shows,
        0 AS total_cancelled,
        cd.notes,
        cd.finalized_at,
        NULL AS finalized_by,
        COALESCE(cd.created_at, MIN(a.created_at)) AS created_at,
        COUNT(*)::INT AS clinichq_cats,
        COUNT(*) FILTER (WHERE a.cat_id IS NOT NULL AND ci.id_value IS NOT NULL)::INT AS chipped_count,
        COUNT(*) FILTER (WHERE a.cat_id IS NOT NULL AND ci.id_value IS NULL AND c.needs_microchip = TRUE)::INT AS unchipped_count,
        COUNT(*) FILTER (WHERE a.cat_id IS NULL)::INT AS unlinked_count
      FROM trapper.sot_appointments a
      LEFT JOIN trapper.sot_cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
      LEFT JOIN trapper.cat_identifiers ci ON ci.cat_id = a.cat_id AND ci.id_type = 'microchip'
      LEFT JOIN trapper.clinic_days cd ON cd.clinic_date = a.appointment_date
      LEFT JOIN trapper.places tp ON tp.place_id = cd.target_place_id
      ${whereClause}
      GROUP BY
        a.appointment_date,
        cd.clinic_day_id,
        cd.clinic_type,
        cd.target_place_id,
        tp.display_name,
        tp.formatted_address,
        cd.max_capacity,
        cd.vet_name,
        cd.notes,
        cd.finalized_at,
        cd.created_at
      ORDER BY a.appointment_date DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex}
      `,
      [...params, limit, offset]
    );

    return NextResponse.json({
      clinic_days: clinicDays,
      pagination: {
        limit,
        offset,
        hasMore: clinicDays.length === limit,
      },
    });
  } catch (error) {
    console.error("Clinic days list error:", error);
    return NextResponse.json(
      { error: "Failed to fetch clinic days" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/clinic-days
 * Create a new clinic day
 */
export async function POST(request: NextRequest) {
  try {
    // Require auth
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const {
      clinic_date,
      clinic_type,
      target_place_id,
      max_capacity,
      vet_name,
      notes
    } = body;

    if (!clinic_date) {
      return NextResponse.json(
        { error: "clinic_date is required" },
        { status: 400 }
      );
    }

    // Check if day already exists
    const existing = await queryOne<{ clinic_day_id: string }>(
      `SELECT clinic_day_id FROM trapper.clinic_days WHERE clinic_date = $1`,
      [clinic_date]
    );

    if (existing) {
      return NextResponse.json(
        { error: "Clinic day already exists for this date", clinic_day_id: existing.clinic_day_id },
        { status: 409 }
      );
    }

    // Determine clinic type - use provided or default based on day of week
    const finalClinicType = clinic_type || null; // Let DB use default function if not provided

    // Create clinic day with type info
    const clinicDay = await queryOne<{ clinic_day_id: string; clinic_type: string; created_at: string }>(
      `
      INSERT INTO trapper.clinic_days (
        clinic_date,
        clinic_type,
        target_place_id,
        max_capacity,
        vet_name,
        notes
      )
      VALUES (
        $1,
        COALESCE($2, trapper.get_default_clinic_type($1::DATE)),
        $3,
        $4,
        $5,
        $6
      )
      RETURNING clinic_day_id, clinic_type, created_at
      `,
      [
        clinic_date,
        finalClinicType,
        target_place_id || null,
        max_capacity || null,
        vet_name || null,
        notes || null
      ]
    );

    if (!clinicDay) {
      return NextResponse.json(
        { error: "Failed to create clinic day" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      clinic_day_id: clinicDay.clinic_day_id,
      clinic_date,
      clinic_type: clinicDay.clinic_type,
    });
  } catch (error) {
    console.error("Clinic day create error:", error);
    return NextResponse.json(
      { error: "Failed to create clinic day" },
      { status: 500 }
    );
  }
}
