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

    // Get clinic day summary
    const comparison = await queryOne(
      `SELECT * FROM trapper.v_clinic_day_comparison WHERE clinic_date = $1`,
      [date]
    );

    // Get clinic day entries (our logged data)
    const loggedEntries = await queryRows(
      `SELECT * FROM trapper.v_clinic_day_entries WHERE clinic_date = $1 ORDER BY created_at`,
      [date]
    );

    // Get ClinicHQ appointments for comparison
    const clinichqAppointments = await queryRows<ClinicHQAppointment>(
      `
      SELECT
        a.appointment_id,
        a.cat_id,
        c.display_name as cat_name,
        c.sex as cat_sex,
        a.trapper_person_id,
        t.display_name as trapper_name,
        p.place_id,
        p.formatted_address as place_address,
        a.service_type,
        per.display_name as owner_name
      FROM trapper.sot_appointments a
      LEFT JOIN trapper.sot_cats c ON c.cat_id = a.cat_id
      LEFT JOIN trapper.sot_people t ON t.person_id = a.trapper_person_id
      LEFT JOIN trapper.places p ON p.place_id = a.place_id
      LEFT JOIN trapper.sot_people per ON per.person_id = a.person_id
      WHERE a.appointment_date = $1
      ORDER BY t.display_name, c.display_name
      `,
      [date]
    );

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
