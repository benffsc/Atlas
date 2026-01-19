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
 * List clinic days with optional date range filter
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
    const includeComparison = searchParams.get("include_comparison") === "true";

    // Build WHERE clause
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (startDate) {
      conditions.push(`cd.clinic_date >= $${paramIndex++}`);
      params.push(startDate);
    }
    if (endDate) {
      conditions.push(`cd.clinic_date <= $${paramIndex++}`);
      params.push(endDate);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    let clinicDays: ClinicDay[];

    if (includeComparison) {
      // Use the comparison view with schedule info
      clinicDays = await queryRows<ClinicDay>(
        `
        SELECT
          cs.clinic_day_id,
          cs.clinic_date,
          cs.clinic_type,
          cs.clinic_type_label,
          cs.target_place_id,
          cs.target_place_name,
          cs.target_place_address,
          cs.max_capacity,
          cs.vet_name,
          cs.day_of_week,
          cs.total_cats,
          cs.total_females,
          cs.total_males,
          cs.total_unknown_sex,
          cs.total_no_shows,
          cs.total_cancelled,
          cs.notes,
          cs.finalized_at,
          cs.finalized_by,
          cs.created_at,
          cmp.clinichq_cats,
          cmp.clinichq_females,
          cmp.clinichq_males,
          cmp.variance
        FROM trapper.v_clinic_schedule cs
        LEFT JOIN trapper.v_clinic_day_comparison cmp ON cmp.clinic_day_id = cs.clinic_day_id
        ${whereClause.replace(/cd\./g, "cs.")}
        ORDER BY cs.clinic_date DESC
        LIMIT $${paramIndex++} OFFSET $${paramIndex}
        `,
        [...params, limit, offset]
      );
    } else {
      // Use schedule view for type info
      clinicDays = await queryRows<ClinicDay>(
        `
        SELECT *
        FROM trapper.v_clinic_schedule cs
        ${whereClause.replace(/cd\./g, "cs.")}
        ORDER BY cs.clinic_date DESC
        LIMIT $${paramIndex++} OFFSET $${paramIndex}
        `,
        [...params, limit, offset]
      );
    }

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
