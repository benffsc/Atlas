import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { apiSuccess, apiBadRequest, apiUnauthorized, apiForbidden, apiNotFound, apiServerError } from "@/lib/api-response";

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
      return apiUnauthorized();
    }

    const { date } = await params;

    // FFS-103: Read from ops.clinic_days first, fall back to appointment-derived stats
    const clinicDay = await queryOne(
      `
      WITH clinic_day_record AS (
        SELECT clinic_day_id, clinic_date, clinic_type, max_appointments, notes
        FROM ops.clinic_days
        WHERE clinic_date = $1
      ),
      appt_stats AS (
        SELECT
          a.appointment_date AS clinic_date,
          MAX(a.vet_name) AS vet_name,
          EXTRACT(DOW FROM a.appointment_date)::INT AS day_of_week,
          COUNT(*)::INT AS total_cats,
          COUNT(*) FILTER (WHERE c.sex = 'Female' OR a.is_spay = TRUE)::INT AS total_females,
          COUNT(*) FILTER (WHERE c.sex = 'Male' OR a.is_neuter = TRUE)::INT AS total_males,
          COUNT(*) FILTER (WHERE c.sex IS NULL OR c.sex NOT IN ('Female', 'Male'))::INT AS total_unknown_sex,
          COUNT(*)::INT AS clinichq_cats,
          COUNT(*)::INT AS clinichq_appointments
        FROM ops.appointments a
        LEFT JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
        WHERE a.appointment_date = $1
        GROUP BY a.appointment_date
      )
      SELECT
        COALESCE(cd.clinic_day_id, gen_random_uuid()) AS clinic_day_id,
        COALESCE(cd.clinic_date, s.clinic_date) AS clinic_date,
        COALESCE(cd.clinic_type, 'regular') AS clinic_type,
        INITCAP(REPLACE(COALESCE(cd.clinic_type, 'regular'), '_', ' ')) AS clinic_type_label,
        NULL AS target_place_id,
        NULL AS target_place_name,
        cd.max_appointments AS max_capacity,
        s.vet_name,
        s.day_of_week,
        COALESCE(s.total_cats, 0) AS total_cats,
        COALESCE(s.total_females, 0) AS total_females,
        COALESCE(s.total_males, 0) AS total_males,
        COALESCE(s.total_unknown_sex, 0) AS total_unknown_sex,
        cd.notes,
        NULL AS finalized_at,
        COALESCE(s.clinichq_cats, 0) AS clinichq_cats,
        COALESCE(s.clinichq_appointments, 0) AS clinichq_appointments
      FROM appt_stats s
      FULL OUTER JOIN clinic_day_record cd ON cd.clinic_date = s.clinic_date
      `,
      [date]
    );

    if (!clinicDay) {
      return apiNotFound("clinic day", `date ${date}`);
    }

    // V2: No separate entries table - entries are the appointments themselves
    // Return empty array for backward compatibility
    const entries: ClinicDayEntry[] = [];

    return apiSuccess({
      clinic_day: clinicDay,
      entries,
    });
  } catch (error) {
    console.error("Clinic day fetch error:", error);
    return apiServerError("Failed to fetch clinic day");
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
      return apiUnauthorized();
    }

    // V2: Clinic days are derived from ops.appointments
    // Metadata updates not yet supported - would need ops.clinic_day_metadata table
    return apiSuccess({
      message: "Clinic day metadata updates not yet available in V2"
    });
  } catch (error) {
    console.error("Clinic day update error:", error);
    return apiServerError("Failed to update clinic day");
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
      return apiForbidden("Admin access required");
    }

    // V2: Cannot delete clinic days - they're derived from appointments
    return apiBadRequest("Cannot delete clinic days in V2 - they are derived from appointments");
  } catch (error) {
    console.error("Clinic day delete error:", error);
    return apiServerError("Failed to delete clinic day");
  }
}
