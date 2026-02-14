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

    // Get clinic days directly from V2 ops.appointments
    const clinicDays = await queryRows<ClinicDay>(
      `
      SELECT
        gen_random_uuid() AS clinic_day_id,
        a.appointment_date AS clinic_date,
        'regular' AS clinic_type,
        'Regular' AS clinic_type_label,
        NULL AS target_place_id,
        NULL AS target_place_name,
        NULL AS target_place_address,
        NULL AS max_capacity,
        MAX(a.vet_name) AS vet_name,
        EXTRACT(DOW FROM a.appointment_date)::INT AS day_of_week,
        COUNT(*)::INT AS total_cats,
        COUNT(*) FILTER (WHERE c.sex = 'Female' OR a.is_spay = TRUE)::INT AS total_females,
        COUNT(*) FILTER (WHERE c.sex = 'Male' OR a.is_neuter = TRUE)::INT AS total_males,
        COUNT(*) FILTER (WHERE c.sex IS NULL OR c.sex NOT IN ('Female', 'Male'))::INT AS total_unknown_sex,
        0 AS total_no_shows,
        0 AS total_cancelled,
        NULL AS notes,
        NULL AS finalized_at,
        NULL AS finalized_by,
        MIN(a.created_at) AS created_at,
        COUNT(*)::INT AS clinichq_cats,
        COUNT(*) FILTER (WHERE a.cat_id IS NOT NULL AND ci.id_value IS NOT NULL)::INT AS chipped_count,
        -- V2: sot.cats doesn't have needs_microchip column, just count cats without microchip
        COUNT(*) FILTER (WHERE a.cat_id IS NOT NULL AND ci.id_value IS NULL)::INT AS unchipped_count,
        COUNT(*) FILTER (WHERE a.cat_id IS NULL)::INT AS unlinked_count
      FROM ops.appointments a
      LEFT JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
      LEFT JOIN sot.cat_identifiers ci ON ci.cat_id = a.cat_id AND ci.id_type = 'microchip'
      ${whereClause}
      GROUP BY a.appointment_date
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

    // Check if appointments exist for this date
    const existing = await queryOne<{ count: number }>(
      `SELECT COUNT(*)::INT as count FROM ops.appointments WHERE appointment_date = $1`,
      [clinic_date]
    );

    if (existing && existing.count > 0) {
      return NextResponse.json(
        { error: "Appointments already exist for this date", appointment_count: existing.count },
        { status: 409 }
      );
    }

    // V2: We don't have a separate clinic_days table
    // Clinic days are derived from ops.appointments
    // This endpoint now just returns success with the date info
    // Future: Consider adding ops.clinic_day_metadata table if needed

    return NextResponse.json({
      success: true,
      clinic_day_id: null, // No separate table in V2
      clinic_date,
      clinic_type: clinic_type || "regular",
      message: "Clinic day noted. Appointments will be ingested via ClinicHQ upload."
    });
  } catch (error) {
    console.error("Clinic day create error:", error);
    return NextResponse.json(
      { error: "Failed to create clinic day" },
      { status: 500 }
    );
  }
}
