import { NextRequest } from "next/server";
import { queryRows, queryOne } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { apiSuccess, apiBadRequest, apiUnauthorized, apiConflict, apiServerError } from "@/lib/api-response";

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
      return apiUnauthorized();
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

    // FFS-103: Use ops.clinic_days if record exists, fall back to appointment-derived
    const clinicDays = await queryRows<ClinicDay>(
      `
      SELECT
        COALESCE(cd.clinic_day_id, gen_random_uuid()) AS clinic_day_id,
        a.appointment_date AS clinic_date,
        COALESCE(cd.clinic_type, 'regular') AS clinic_type,
        INITCAP(REPLACE(COALESCE(cd.clinic_type, 'regular'), '_', ' ')) AS clinic_type_label,
        cd.target_place_id,
        tp.display_name AS target_place_name,
        tp.formatted_address AS target_place_address,
        cd.max_appointments AS max_capacity,
        MAX(a.vet_name) AS vet_name,
        EXTRACT(DOW FROM a.appointment_date)::INT AS day_of_week,
        COUNT(*)::INT AS total_cats,
        COUNT(*) FILTER (WHERE c.sex = 'Female' OR a.is_spay = TRUE)::INT AS total_females,
        COUNT(*) FILTER (WHERE c.sex = 'Male' OR a.is_neuter = TRUE)::INT AS total_males,
        COUNT(*) FILTER (WHERE c.sex IS NULL OR c.sex NOT IN ('Female', 'Male'))::INT AS total_unknown_sex,
        0 AS total_no_shows,
        0 AS total_cancelled,
        cd.notes,
        NULL AS finalized_at,
        NULL AS finalized_by,
        MIN(a.created_at) AS created_at,
        COUNT(*)::INT AS clinichq_cats,
        -- FFS-96: Use LIMIT 1 subquery instead of JOIN to prevent cartesian product
        COUNT(*) FILTER (WHERE a.cat_id IS NOT NULL AND (
          SELECT ci.id_value FROM sot.cat_identifiers ci
          WHERE ci.cat_id = a.cat_id AND ci.id_type = 'microchip' LIMIT 1
        ) IS NOT NULL)::INT AS chipped_count,
        COUNT(*) FILTER (WHERE a.cat_id IS NOT NULL AND (
          SELECT ci.id_value FROM sot.cat_identifiers ci
          WHERE ci.cat_id = a.cat_id AND ci.id_type = 'microchip' LIMIT 1
        ) IS NULL)::INT AS unchipped_count,
        COUNT(*) FILTER (WHERE a.cat_id IS NULL)::INT AS unlinked_count
      FROM ops.appointments a
      LEFT JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
      LEFT JOIN ops.clinic_days cd ON cd.clinic_date = a.appointment_date
      LEFT JOIN sot.places tp ON tp.place_id = cd.target_place_id
      ${whereClause}
      GROUP BY a.appointment_date, cd.clinic_day_id, cd.clinic_type, cd.target_place_id, tp.display_name, tp.formatted_address, cd.max_appointments, cd.notes
      ORDER BY a.appointment_date DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex}
      `,
      [...params, limit, offset]
    );

    return apiSuccess({
      clinic_days: clinicDays,
      pagination: {
        limit,
        offset,
        hasMore: clinicDays.length === limit,
      },
    });
  } catch (error) {
    console.error("Clinic days list error:", error);
    return apiServerError("Failed to fetch clinic days");
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
      return apiUnauthorized();
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
      return apiBadRequest("clinic_date is required");
    }

    // Check if appointments exist for this date
    const existing = await queryOne<{ count: number }>(
      `SELECT COUNT(*)::INT as count FROM ops.appointments WHERE appointment_date = $1`,
      [clinic_date]
    );

    if (existing && existing.count > 0) {
      return apiConflict(`Appointments already exist for this date (${existing.count} appointments)`);
    }

    // V2: We don't have a separate clinic_days table
    // Clinic days are derived from ops.appointments
    // This endpoint now just returns success with the date info
    // Future: Consider adding ops.clinic_day_metadata table if needed

    return apiSuccess({
      clinic_day_id: null, // No separate table in V2
      clinic_date,
      clinic_type: clinic_type || "regular",
      message: "Clinic day noted. Appointments will be ingested via ClinicHQ upload."
    });
  } catch (error) {
    console.error("Clinic day create error:", error);
    return apiServerError("Failed to create clinic day");
  }
}
