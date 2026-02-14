import { NextRequest, NextResponse } from "next/server";
import { query, queryOne, queryRows } from "@/lib/db";
import { getSession } from "@/lib/auth";

interface RouteParams {
  params: Promise<{ date: string }>;
}

interface ClinicDayEntry {
  entry_id: string;
  clinic_day_id: string;
  clinic_date: string;
  trapper_person_id: string | null;
  trapper_name: string | null;
  place_id: string | null;
  place_label: string | null;
  place_address: string | null;
  request_id: string | null;
  request_address: string | null;
  source_description: string | null;
  cat_count: number;
  female_count: number;
  male_count: number;
  unknown_sex_count: number;
  status: string;
  notes: string | null;
  entered_by: string | null;
  entered_by_name: string | null;
  created_at: string;
}

/**
 * GET /api/admin/clinic-days/[date]
 * Get a specific clinic day with entries (V2 - derived from ops.appointments)
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    // Require auth
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { date } = await params;

    // V2: Get clinic day stats directly from appointments
    const clinicDay = await queryOne(
      `
      SELECT
        gen_random_uuid() AS clinic_day_id,
        a.appointment_date AS clinic_date,
        'regular' AS clinic_type,
        'Regular' AS clinic_type_label,
        NULL AS target_place_id,
        NULL AS target_place_name,
        NULL AS max_capacity,
        MAX(a.vet_name) AS vet_name,
        EXTRACT(DOW FROM a.appointment_date)::INT AS day_of_week,
        COUNT(*)::INT AS total_cats,
        COUNT(*) FILTER (WHERE c.sex = 'Female' OR a.is_spay = TRUE)::INT AS total_females,
        COUNT(*) FILTER (WHERE c.sex = 'Male' OR a.is_neuter = TRUE)::INT AS total_males,
        COUNT(*) FILTER (WHERE c.sex IS NULL OR c.sex NOT IN ('Female', 'Male'))::INT AS total_unknown_sex,
        NULL AS notes,
        NULL AS finalized_at,
        COUNT(*)::INT AS clinichq_cats,
        COUNT(*)::INT AS clinichq_appointments
      FROM ops.appointments a
      LEFT JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
      WHERE a.appointment_date = $1
      GROUP BY a.appointment_date
      `,
      [date]
    );

    if (!clinicDay) {
      return NextResponse.json({ error: "Clinic day not found" }, { status: 404 });
    }

    // V2: No separate entries table - entries are the appointments themselves
    // Return empty array for backward compatibility
    const entries: ClinicDayEntry[] = [];

    return NextResponse.json({
      clinic_day: clinicDay,
      entries,
    });
  } catch (error) {
    console.error("Clinic day fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch clinic day" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/admin/clinic-days/[date]
 * Update clinic day - V2: Not supported (clinic days derived from appointments)
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // V2: Clinic days are derived from ops.appointments
    // Metadata updates not yet supported - would need ops.clinic_day_metadata table
    return NextResponse.json({
      success: true,
      message: "Clinic day metadata updates not yet available in V2"
    });
  } catch (error) {
    console.error("Clinic day update error:", error);
    return NextResponse.json(
      { error: "Failed to update clinic day" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/clinic-days/[date]
 * Delete a clinic day - V2: Not supported (clinic days derived from appointments)
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession(request);
    if (!session || session.auth_role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    // V2: Cannot delete clinic days - they're derived from appointments
    return NextResponse.json(
      { error: "Cannot delete clinic days in V2 - they are derived from appointments" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Clinic day delete error:", error);
    return NextResponse.json(
      { error: "Failed to delete clinic day" },
      { status: 500 }
    );
  }
}
