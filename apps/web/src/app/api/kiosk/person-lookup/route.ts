import { NextRequest } from "next/server";
import { apiSuccess, apiBadRequest, apiServerError } from "@/lib/api-response";
import { queryOne } from "@/lib/db";

/**
 * GET /api/kiosk/person-lookup?phone=7075551234&email=user@email.com
 *
 * Kiosk person lookup by phone or email.
 * Returns person info + context for the welcome-back screen.
 *
 * At least one of phone or email is required.
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const rawPhone = searchParams.get("phone")?.trim() || null;
    const rawEmail = searchParams.get("email")?.trim().toLowerCase() || null;

    // Normalize phone: strip non-digits, remove leading 1 if 11 digits
    let normalizedPhone: string | null = null;
    if (rawPhone) {
      const digits = rawPhone.replace(/\D/g, "");
      if (digits.length === 11 && digits.startsWith("1")) {
        normalizedPhone = digits.slice(1);
      } else if (digits.length > 0) {
        normalizedPhone = digits;
      }
    }

    // Validate: at least one identifier required
    if (!normalizedPhone && !rawEmail) {
      return apiBadRequest("At least one of phone or email is required");
    }

    // Find person by phone first, then email
    // Filter: confidence >= 0.5 (MANDATORY), merged_into_person_id IS NULL (merge-aware)
    const personRow = await queryOne<{
      person_id: string;
      first_name: string | null;
      last_name: string | null;
    }>(
      `SELECT p.id AS person_id, p.first_name, p.last_name
       FROM sot.person_identifiers pi
       JOIN sot.people p ON p.id = pi.person_id
       WHERE pi.confidence >= 0.5
         AND p.merged_into_person_id IS NULL
         AND (
           (pi.id_type = 'phone' AND pi.id_value_norm = $1)
           OR
           (pi.id_type = 'email' AND pi.id_value_norm = $2)
         )
       ORDER BY
         CASE WHEN pi.id_type = 'phone' AND pi.id_value_norm = $1 THEN 0 ELSE 1 END,
         pi.confidence DESC
       LIMIT 1`,
      [normalizedPhone, rawEmail]
    );

    // No person found
    if (!personRow) {
      return apiSuccess({
        found: false,
        person_id: null,
        display_name: null,
        first_name: null,
        context: null,
      });
    }

    const { person_id, first_name, last_name } = personRow;
    const displayName = [first_name, last_name].filter(Boolean).join(" ") || null;

    // Gather all context in a single query for speed
    const contextRow = await queryOne<{
      open_request_count: string;
      completed_request_count: string;
      trapper_type: string | null;
      last_visit_date: string | null;
      has_previous_pet_spay: boolean;
    }>(
      `SELECT
         (SELECT COUNT(*)
          FROM ops.requests
          WHERE person_id = $1
            AND status NOT IN ('completed', 'cancelled', 'closed')
            AND merged_into_request_id IS NULL
         ) AS open_request_count,

         (SELECT COUNT(*)
          FROM ops.requests
          WHERE person_id = $1
            AND status = 'completed'
            AND merged_into_request_id IS NULL
         ) AS completed_request_count,

         (SELECT trapper_type
          FROM sot.trapper_profiles
          WHERE person_id = $1
          LIMIT 1
         ) AS trapper_type,

         (SELECT MAX(source_created_at)
          FROM ops.appointments
          WHERE person_id = $1
         )::text AS last_visit_date,

         (SELECT EXISTS(
           SELECT 1
           FROM ops.intake_submissions
           WHERE (email = $2 OR phone = $3)
             AND call_type = 'pet_spay_neuter'
         )) AS has_previous_pet_spay`,
      [person_id, rawEmail, normalizedPhone]
    );

    return apiSuccess({
      found: true,
      person_id,
      display_name: displayName,
      first_name,
      context: {
        open_request_count: parseInt(contextRow?.open_request_count ?? "0", 10),
        completed_request_count: parseInt(contextRow?.completed_request_count ?? "0", 10),
        trapper_type: contextRow?.trapper_type ?? null,
        last_visit_date: contextRow?.last_visit_date ?? null,
        has_previous_pet_spay: contextRow?.has_previous_pet_spay ?? false,
      },
    });
  } catch (error) {
    console.error("Kiosk person lookup error:", error);
    return apiServerError("Failed to look up person");
  }
}
