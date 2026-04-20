import { NextRequest } from "next/server";
import { queryRows } from "@/lib/db";
import { apiSuccess, apiError } from "@/lib/api-response";
import { getSession } from "@/lib/auth";

/**
 * GET /api/admin/clinic-days/[date]/roster
 *
 * Returns the full clinic day roster: master list entries matched to cats,
 * with appointment details. Used for photo upload by CDN lookup.
 *
 * Each entry shows: line_number, owner, cat name, cat_id, microchip,
 * sex, weight, match status, photo count.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ date: string }> }
) {
  const session = await getSession(request);
  if (!session) return apiError("Authentication required", 401);

  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return apiError("Invalid date format", 400);
  }

  const roster = await queryRows<{
    line_number: number;
    entry_id: string;
    parsed_owner_name: string | null;
    parsed_cat_name: string | null;
    raw_client_name: string | null;
    match_confidence: string | null;
    cancellation_reason: string | null;
    appointment_id: string | null;
    cat_id: string | null;
    cat_name: string | null;
    microchip: string | null;
    cat_sex: string | null;
    weight_lbs: number | null;
    clinic_day_number: number | null;
    photo_count: number;
    has_hero: boolean;
  }>(`
    SELECT
      e.line_number,
      e.entry_id::text,
      e.parsed_owner_name,
      e.parsed_cat_name,
      e.raw_client_name,
      e.match_confidence,
      e.cancellation_reason,
      a.appointment_id::text,
      a.cat_id::text,
      c.name AS cat_name,
      c.microchip,
      c.sex AS cat_sex,
      (SELECT cv.weight_lbs FROM ops.cat_vitals cv
       WHERE cv.cat_id = a.cat_id AND cv.weight_lbs IS NOT NULL AND cv.weight_lbs < 50
       ORDER BY cv.recorded_at DESC LIMIT 1
      ) AS weight_lbs,
      a.clinic_day_number,
      COALESCE((SELECT COUNT(*) FROM ops.request_media rm
        WHERE rm.cat_id = a.cat_id AND NOT rm.is_archived), 0)::int AS photo_count,
      COALESCE((SELECT bool_or(rm.is_hero) FROM ops.request_media rm
        WHERE rm.cat_id = a.cat_id AND NOT rm.is_archived), false) AS has_hero
    FROM ops.clinic_day_entries e
    JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
    LEFT JOIN ops.appointments a ON a.appointment_id = e.matched_appointment_id
      AND a.merged_into_appointment_id IS NULL
    LEFT JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
    WHERE cd.clinic_date = $1
    ORDER BY e.line_number
  `, [date]);

  return apiSuccess({
    date,
    entries: roster.length,
    matched: roster.filter(r => r.cat_id).length,
    roster,
  });
}
