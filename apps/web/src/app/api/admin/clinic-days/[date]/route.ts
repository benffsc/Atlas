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
 * Get a specific clinic day with entries
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    // Require auth
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { date } = await params;

    // Get clinic day with schedule info (includes type fields from MIG_456)
    const clinicDay = await queryOne(
      `
      SELECT
        cs.*,
        cmp.clinichq_appointments,
        cmp.clinichq_cats,
        cmp.clinichq_females,
        cmp.clinichq_males,
        cmp.variance,
        cmp.variance_direction
      FROM ops.v_clinic_schedule cs
      LEFT JOIN ops.v_clinic_day_comparison cmp ON cmp.clinic_day_id = cs.clinic_day_id
      WHERE cs.clinic_date = $1
      `,
      [date]
    );

    if (!clinicDay) {
      return NextResponse.json({ error: "Clinic day not found" }, { status: 404 });
    }

    // Get entries
    const entries = await queryRows<ClinicDayEntry>(
      `SELECT * FROM ops.v_clinic_day_entries WHERE clinic_date = $1 ORDER BY created_at`,
      [date]
    );

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
 * Update clinic day (notes, finalize)
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    // Require auth
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { date } = await params;
    const body = await request.json();
    const {
      notes,
      finalize,
      clinic_type,
      target_place_id,
      max_capacity,
      vet_name
    } = body;

    // Get clinic day
    const clinicDay = await queryOne<{ clinic_day_id: string }>(
      `SELECT clinic_day_id FROM trapper.clinic_days WHERE clinic_date = $1`,
      [date]
    );

    if (!clinicDay) {
      return NextResponse.json({ error: "Clinic day not found" }, { status: 404 });
    }

    // Build update
    const updates: string[] = [];
    const updateParams: (string | number | null)[] = [];
    let paramIndex = 1;

    if (notes !== undefined) {
      updates.push(`notes = $${paramIndex++}`);
      updateParams.push(notes);
    }

    // Clinic type fields (MIG_456)
    if (clinic_type !== undefined) {
      updates.push(`clinic_type = $${paramIndex++}`);
      updateParams.push(clinic_type);
    }

    if (target_place_id !== undefined) {
      updates.push(`target_place_id = $${paramIndex++}`);
      updateParams.push(target_place_id);
    }

    if (max_capacity !== undefined) {
      updates.push(`max_capacity = $${paramIndex++}`);
      updateParams.push(max_capacity);
    }

    if (vet_name !== undefined) {
      updates.push(`vet_name = $${paramIndex++}`);
      updateParams.push(vet_name);
    }

    if (finalize === true) {
      updates.push(`finalized_at = NOW()`);
      updates.push(`finalized_by = $${paramIndex++}`);
      updateParams.push(session.staff_id);
    } else if (finalize === false) {
      updates.push(`finalized_at = NULL`);
      updates.push(`finalized_by = NULL`);
    }

    updates.push(`updated_at = NOW()`);

    if (updates.length > 1) {
      await query(
        `UPDATE trapper.clinic_days SET ${updates.join(", ")} WHERE clinic_day_id = $${paramIndex}`,
        [...updateParams, clinicDay.clinic_day_id]
      );
    }

    return NextResponse.json({ success: true });
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
 * Delete a clinic day (only if empty)
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    // Require admin auth
    const session = await getSession(request);
    if (!session || session.auth_role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { date } = await params;

    // Get clinic day with entry count
    const clinicDay = await queryOne<{ clinic_day_id: string; entry_count: number }>(
      `
      SELECT cd.clinic_day_id, COUNT(e.entry_id)::INT as entry_count
      FROM trapper.clinic_days cd
      LEFT JOIN trapper.clinic_day_entries e ON e.clinic_day_id = cd.clinic_day_id
      WHERE cd.clinic_date = $1
      GROUP BY cd.clinic_day_id
      `,
      [date]
    );

    if (!clinicDay) {
      return NextResponse.json({ error: "Clinic day not found" }, { status: 404 });
    }

    if (clinicDay.entry_count > 0) {
      return NextResponse.json(
        { error: "Cannot delete clinic day with entries. Delete entries first." },
        { status: 400 }
      );
    }

    await query(
      `DELETE FROM trapper.clinic_days WHERE clinic_day_id = $1`,
      [clinicDay.clinic_day_id]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Clinic day delete error:", error);
    return NextResponse.json(
      { error: "Failed to delete clinic day" },
      { status: 500 }
    );
  }
}
