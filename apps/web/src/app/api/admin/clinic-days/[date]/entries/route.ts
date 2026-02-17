import { NextRequest, NextResponse } from "next/server";
import { queryRows } from "@/lib/db";
import { getSession } from "@/lib/auth";

interface RouteParams {
  params: Promise<{ date: string }>;
}

interface ClinicDayEntry {
  entry_id: string;
  clinic_day_id: string;
  line_number: number | null;
  raw_client_name: string | null;
  parsed_owner_name: string | null;
  parsed_cat_name: string | null;
  parsed_trapper_alias: string | null;
  trapper_person_id: string | null;
  trapper_name: string | null;
  cat_count: number;
  female_count: number;
  male_count: number;
  was_altered: boolean;
  is_walkin: boolean;
  is_already_altered: boolean;
  fee_code: string | null;
  notes: string | null;
  status: string | null;
  matched_appointment_id: string | null;
  match_confidence: string | null;
  match_reason: string | null;
  matched_at: string | null;
  // Matched appointment details
  matched_cat_name: string | null;
  matched_cat_sex: string | null;
  matched_microchip: string | null;
}

/**
 * GET /api/admin/clinic-days/[date]/entries
 * Returns master list entries for a clinic day (imported from Excel)
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { date } = await params;

    const entries = await queryRows<ClinicDayEntry>(
      `
      SELECT
        e.entry_id,
        e.clinic_day_id,
        e.line_number,
        e.raw_client_name,
        e.parsed_owner_name,
        e.parsed_cat_name,
        e.parsed_trapper_alias,
        e.trapper_person_id,
        trapper.display_name AS trapper_name,
        COALESCE(e.cat_count, 1) AS cat_count,
        COALESCE(e.female_count, 0) AS female_count,
        COALESCE(e.male_count, 0) AS male_count,
        COALESCE(e.was_altered, TRUE) AS was_altered,
        COALESCE(e.is_walkin, FALSE) AS is_walkin,
        COALESCE(e.is_already_altered, FALSE) AS is_already_altered,
        e.fee_code,
        e.notes,
        e.status,
        e.matched_appointment_id,
        e.match_confidence,
        e.match_reason,
        e.matched_at::TEXT,
        -- Matched appointment details
        c.name AS matched_cat_name,
        c.sex AS matched_cat_sex,
        c.microchip AS matched_microchip
      FROM ops.clinic_day_entries e
      JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
      LEFT JOIN sot.people trapper ON trapper.person_id = e.trapper_person_id
        AND trapper.merged_into_person_id IS NULL
      LEFT JOIN ops.appointments a ON a.appointment_id = e.matched_appointment_id
      LEFT JOIN sot.cats c ON c.cat_id = a.cat_id
        AND c.merged_into_cat_id IS NULL
      WHERE cd.clinic_date = $1
      ORDER BY e.line_number NULLS LAST, e.created_at
      `,
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
 * V2: Not supported - entries come from ClinicHQ uploads
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // V2: Manual entry creation not supported - data comes from ClinicHQ uploads
    return NextResponse.json(
      { error: "Manual entry creation not available in V2. Upload ClinicHQ data instead." },
      { status: 400 }
    );
  } catch (error) {
    console.error("Clinic day entry create error:", error);
    return NextResponse.json(
      { error: "Failed to create entry" },
      { status: 500 }
    );
  }
}
