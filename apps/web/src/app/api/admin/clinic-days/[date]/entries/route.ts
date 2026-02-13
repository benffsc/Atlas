import { NextRequest, NextResponse } from "next/server";
import { query, queryOne, queryRows } from "@/lib/db";
import { getSession } from "@/lib/auth";

interface RouteParams {
  params: Promise<{ date: string }>;
}

/**
 * GET /api/admin/clinic-days/[date]/entries
 * List entries for a clinic day
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    // Require auth
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { date } = await params;

    const entries = await queryRows(
      `SELECT * FROM ops.v_clinic_day_entries WHERE clinic_date = $1 ORDER BY created_at`,
      [date]
    );

    return NextResponse.json({ entries });
  } catch (error) {
    console.error("Clinic day entries error:", error);
    return NextResponse.json(
      { error: "Failed to fetch entries" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/clinic-days/[date]/entries
 * Add an entry to a clinic day
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    // Require auth
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { date } = await params;
    const body = await request.json();

    const {
      trapper_person_id,
      place_id,
      request_id,
      source_description,
      cat_count,
      female_count,
      male_count,
      unknown_sex_count,
      status,
      notes,
    } = body;

    // Validate cat_count
    if (cat_count === undefined || cat_count === null) {
      return NextResponse.json(
        { error: "cat_count is required" },
        { status: 400 }
      );
    }

    // Get or create clinic day
    let clinicDay = await queryOne<{ clinic_day_id: string }>(
      `SELECT clinic_day_id FROM trapper.clinic_days WHERE clinic_date = $1`,
      [date]
    );

    if (!clinicDay) {
      // Auto-create clinic day
      clinicDay = await queryOne<{ clinic_day_id: string }>(
        `INSERT INTO trapper.clinic_days (clinic_date) VALUES ($1) RETURNING clinic_day_id`,
        [date]
      );
    }

    if (!clinicDay) {
      return NextResponse.json(
        { error: "Failed to get or create clinic day" },
        { status: 500 }
      );
    }

    // Validate status if provided
    const validStatuses = ["completed", "no_show", "cancelled", "partial", "pending"];
    if (status && !validStatuses.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` },
        { status: 400 }
      );
    }

    // Insert entry
    const entry = await queryOne<{ entry_id: string; created_at: string }>(
      `
      INSERT INTO trapper.clinic_day_entries (
        clinic_day_id,
        trapper_person_id,
        place_id,
        request_id,
        source_description,
        cat_count,
        female_count,
        male_count,
        unknown_sex_count,
        status,
        notes,
        entered_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING entry_id, created_at
      `,
      [
        clinicDay.clinic_day_id,
        trapper_person_id || null,
        place_id || null,
        request_id || null,
        source_description || null,
        cat_count,
        female_count || 0,
        male_count || 0,
        unknown_sex_count || 0,
        status || "completed",
        notes || null,
        session.staff_id,
      ]
    );

    if (!entry) {
      return NextResponse.json(
        { error: "Failed to create entry" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      entry_id: entry.entry_id,
      clinic_day_id: clinicDay.clinic_day_id,
    });
  } catch (error) {
    console.error("Clinic day entry create error:", error);
    return NextResponse.json(
      { error: "Failed to create entry" },
      { status: 500 }
    );
  }
}
