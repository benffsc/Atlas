import { NextRequest, NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";
import { getSession } from "@/lib/auth";

interface RouteParams {
  params: Promise<{ date: string }>;
}

interface ClinicHQAppointment {
  appointment_id: string;
  cat_id: string | null;
  cat_name: string | null;
  cat_sex: string | null;
  trapper_person_id: string | null;
  trapper_name: string | null;
  place_id: string | null;
  place_address: string | null;
  service_type: string | null;
  owner_name: string | null;
}

interface LoggedEntry {
  entry_id: string;
  line_number: number | null;
  raw_client_name: string | null;
  parsed_owner_name: string | null;
  parsed_cat_name: string | null;
  parsed_trapper_alias: string | null;
  trapper_name: string | null;
  female_count: number;
  male_count: number;
  cat_count: number;
  matched_appointment_id: string | null;
  match_confidence: string | null;
  match_reason: string | null;
}

interface ComparisonStats {
  logged_total: number;
  logged_females: number;
  logged_males: number;
}

/**
 * GET /api/admin/clinic-days/[date]/compare
 * Compare clinic day logs vs ClinicHQ appointments
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    // Require auth
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { date } = await params;

    // Get logged entries from master list imports
    const loggedEntries = await queryRows<LoggedEntry>(
      `
      SELECT
        e.entry_id,
        e.line_number,
        e.raw_client_name,
        e.parsed_owner_name,
        e.parsed_cat_name,
        e.parsed_trapper_alias,
        trapper.display_name AS trapper_name,
        COALESCE(e.female_count, 0) AS female_count,
        COALESCE(e.male_count, 0) AS male_count,
        COALESCE(e.cat_count, 1) AS cat_count,
        e.matched_appointment_id,
        e.match_confidence,
        e.match_reason
      FROM ops.clinic_day_entries e
      JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
      LEFT JOIN sot.people trapper ON trapper.person_id = e.trapper_person_id
        AND trapper.merged_into_person_id IS NULL
      WHERE cd.clinic_date = $1
      ORDER BY e.line_number NULLS LAST, e.created_at
      `,
      [date]
    );

    // Calculate logged entry stats
    const comparisonStats = await queryOne<ComparisonStats>(
      `
      SELECT
        COUNT(*)::INT AS logged_total,
        COALESCE(SUM(female_count), 0)::INT AS logged_females,
        COALESCE(SUM(male_count), 0)::INT AS logged_males
      FROM ops.clinic_day_entries e
      JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
      WHERE cd.clinic_date = $1
      `,
      [date]
    );

    // Get ClinicHQ appointments (V2 uses ops.appointments)
    const clinichqAppointments = await queryRows<ClinicHQAppointment>(
      `
      SELECT
        a.appointment_id,
        a.cat_id,
        c.name as cat_name,
        c.sex as cat_sex,
        NULL as trapper_person_id,
        NULL as trapper_name,
        COALESCE(a.inferred_place_id, a.place_id) as place_id,
        p.formatted_address as place_address,
        a.service_type,
        per.display_name as owner_name
      FROM ops.appointments a
      LEFT JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
      LEFT JOIN sot.places p ON p.place_id = COALESCE(a.inferred_place_id, a.place_id) AND p.merged_into_place_id IS NULL
      LEFT JOIN sot.people per ON per.person_id = a.person_id AND per.merged_into_person_id IS NULL
      WHERE a.appointment_date = $1
      ORDER BY c.name NULLS LAST
      `,
      [date]
    );

    // Use actual logged entry stats
    const comparison = {
      logged_total: comparisonStats?.logged_total || 0,
      logged_females: comparisonStats?.logged_females || 0,
      logged_males: comparisonStats?.logged_males || 0,
    };

    // Group ClinicHQ by trapper for easier comparison
    const clinichqByTrapper = clinichqAppointments.reduce((acc, appt) => {
      const key = appt.trapper_person_id || "unknown";
      if (!acc[key]) {
        acc[key] = {
          trapper_id: appt.trapper_person_id,
          trapper_name: appt.trapper_name || "Unknown",
          cats: [],
          total: 0,
          females: 0,
          males: 0,
        };
      }
      acc[key].cats.push(appt);
      acc[key].total++;
      if (appt.cat_sex === "female") acc[key].females++;
      if (appt.cat_sex === "male") acc[key].males++;
      return acc;
    }, {} as Record<string, { trapper_id: string | null; trapper_name: string; cats: ClinicHQAppointment[]; total: number; females: number; males: number }>);

    // Summary stats
    const summary = {
      logged_total: comparison?.logged_total || 0,
      logged_females: comparison?.logged_females || 0,
      logged_males: comparison?.logged_males || 0,
      clinichq_total: clinichqAppointments.length,
      clinichq_females: clinichqAppointments.filter(a => a.cat_sex === "female").length,
      clinichq_males: clinichqAppointments.filter(a => a.cat_sex === "male").length,
      variance: (comparison?.logged_total || 0) - clinichqAppointments.length,
      is_match: (comparison?.logged_total || 0) === clinichqAppointments.length,
    };

    return NextResponse.json({
      date,
      summary,
      logged_entries: loggedEntries,
      clinichq_appointments: clinichqAppointments,
      clinichq_by_trapper: Object.values(clinichqByTrapper),
    });
  } catch (error) {
    console.error("Clinic day compare error:", error);
    return NextResponse.json(
      { error: "Failed to compare clinic day" },
      { status: 500 }
    );
  }
}
