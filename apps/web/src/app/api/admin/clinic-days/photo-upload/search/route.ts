import { NextRequest } from "next/server";
import { queryRows } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { apiSuccess, apiBadRequest, apiUnauthorized, apiServerError } from "@/lib/api-response";

interface AppointmentInfo {
  appointment_id: string;
  appointment_date: string;
  clinic_day_number: number | null;
}

interface SearchResult {
  cat_id: string;
  display_name: string | null;
  microchip: string | null;
  clinichq_animal_id: string | null;
  owner_name: string | null;
  // DATA_GAP_053: Original booking name from ClinicHQ (may differ from owner_name)
  booked_as: string | null;
  place_address: string | null;
  sex: string | null;
  primary_color: string | null;
  photo_url: string | null;
  appointment_date: string | null;
  appointment_id: string | null;
  clinic_day_number: number | null;
  is_deceased: boolean;
  deceased_date: string | null;
  death_cause: string | null;
  felv_status: string | null;
  fiv_status: string | null;
  needs_microchip: boolean;
  is_from_clinic_day: boolean;
  // NEW: All recent appointments for this cat (for date selection)
  all_appointments: AppointmentInfo[];
}

/**
 * GET /api/admin/clinic-days/photo-upload/search
 * Search for cats by name, microchip, or owner name
 * Prioritizes cats from the selected clinic day
 */
export async function GET(request: NextRequest) {
  try {
    // Require auth
    const session = await getSession(request);
    if (!session) {
      return apiUnauthorized();
    }

    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get("q");
    const date = searchParams.get("date");

    if (!query || query.trim().length < 2) {
      return apiSuccess({ cats: [] });
    }

    // Validate date format if provided
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return apiBadRequest("Invalid date format");
    }

    const searchTerm = `%${query.trim()}%`;

    // Search cats, prioritizing those from the selected clinic day (V2 schema)
    // Try with ops.cat_test_results (MIG_2060), fall back if not available
    let cats: SearchResult[];
    try {
      cats = await queryRows<SearchResult>(
      `
      WITH clinic_day_cats AS (
        SELECT DISTINCT a.cat_id
        FROM ops.appointments a
        WHERE a.appointment_date = $2
          AND a.cat_id IS NOT NULL
      ),
      -- Get only the first appointment per cat for the selected date (avoid duplicates)
      first_appointment AS (
        SELECT DISTINCT ON (a.cat_id)
          a.cat_id,
          a.appointment_id,
          a.appointment_date,
          a.clinic_day_number,
          -- DATA_GAP_053: Include owner_account_id for booked_as lookup
          a.owner_account_id
        FROM ops.appointments a
        WHERE a.appointment_date = $2
        ORDER BY a.cat_id, a.appointment_number NULLS LAST, a.created_at
      ),
      -- Deduplicated cat results with proper sorting
      cat_results AS (
        SELECT
          c.cat_id,
          c.name AS display_name,
          c.sex,
          c.primary_color,
          COALESCE(c.is_deceased, FALSE) AS is_deceased,
          c.deceased_at AS deceased_date,
          -- Death cause from cat_mortality_events (subquery to avoid duplicates)
          (
            SELECT cme.cause::TEXT
            FROM sot.cat_mortality_events cme
            WHERE cme.cat_id = c.cat_id AND cme.deleted_at IS NULL
            LIMIT 1
          ) AS death_cause,
          FALSE AS needs_microchip,
          -- FeLV/FIV from ops.cat_test_results (MIG_2060) - NULL if table doesn't exist
          (
            SELECT tr.felv_status
            FROM ops.cat_test_results tr
            WHERE tr.cat_id = c.cat_id AND tr.test_type = 'felv_fiv' AND tr.felv_status IS NOT NULL
            ORDER BY tr.test_date DESC LIMIT 1
          ) AS felv_status,
          (
            SELECT tr.fiv_status
            FROM ops.cat_test_results tr
            WHERE tr.cat_id = c.cat_id AND tr.test_type = 'felv_fiv' AND tr.fiv_status IS NOT NULL
            ORDER BY tr.test_date DESC LIMIT 1
          ) AS fiv_status,
          -- MIG_2602 FIX: Use subqueries to avoid cartesian product from multiple identifiers
          -- (a cat with 2 microchips + 2 clinichq_ids would create 4 rows with LEFT JOIN)
          COALESCE(
            (SELECT ci.id_value FROM sot.cat_identifiers ci WHERE ci.cat_id = c.cat_id AND ci.id_type = 'microchip' LIMIT 1),
            c.microchip
          ) AS microchip,
          COALESCE(
            (SELECT ci.id_value FROM sot.cat_identifiers ci WHERE ci.cat_id = c.cat_id AND ci.id_type = 'clinichq_animal_id' LIMIT 1),
            c.clinichq_animal_id
          ) AS clinichq_animal_id,
          -- Owner name via subquery to avoid cartesian product (one row per cat)
          -- V2: Uses sot.person_cat (not sot.person_cat_relationships)
          (
            SELECT per.display_name
            FROM sot.person_cat pc
            JOIN sot.people per ON per.person_id = pc.person_id
              AND per.merged_into_person_id IS NULL
            WHERE pc.cat_id = c.cat_id
              AND pc.relationship_type IN ('owner', 'caretaker')
            ORDER BY pc.confidence DESC NULLS LAST, pc.created_at DESC
            LIMIT 1
          ) AS owner_name,
          -- DATA_GAP_053: Original booking name from clinic_accounts (may differ from owner_name)
          (
            SELECT ca.display_name
            FROM ops.clinic_accounts ca
            WHERE ca.account_id = fa.owner_account_id
              AND ca.merged_into_account_id IS NULL
            LIMIT 1
          ) AS booked_as,
          -- Place address via subquery to avoid cartesian product (one row per cat)
          -- V2: Uses sot.cat_place (not sot.cat_place_relationships)
          (
            SELECT pl.formatted_address
            FROM sot.cat_place cp
            JOIN sot.places pl ON pl.place_id = cp.place_id
              AND pl.merged_into_place_id IS NULL
            WHERE cp.cat_id = c.cat_id
            ORDER BY cp.confidence DESC NULLS LAST, cp.created_at DESC
            LIMIT 1
          ) AS place_address,
          -- Get photo with priority: 1) hero (main photo), 2) most recent
          (
            SELECT rm.storage_path
            FROM ops.request_media rm
            WHERE rm.cat_id = c.cat_id
              AND rm.is_archived = FALSE
            ORDER BY rm.is_hero DESC NULLS LAST, rm.uploaded_at DESC
            LIMIT 1
          ) AS photo_url,
          -- Check if from selected clinic day
          (c.cat_id IN (SELECT cat_id FROM clinic_day_cats)) AS is_from_clinic_day,
          -- Get appointment info for selected date (using deduplicated first_appointment)
          fa.appointment_id,
          fa.appointment_date,
          -- Only show clinic_day_number if explicitly assigned (no auto-generation)
          fa.clinic_day_number,
          -- ALL recent appointments for this cat (last 90 days)
          (
            SELECT COALESCE(JSONB_AGG(
              JSONB_BUILD_OBJECT(
                'appointment_id', a.appointment_id,
                'appointment_date', a.appointment_date::TEXT,
                'clinic_day_number', a.clinic_day_number
              ) ORDER BY a.appointment_date DESC
            ), '[]'::JSONB)
            FROM ops.appointments a
            WHERE a.cat_id = c.cat_id
              AND a.appointment_date >= CURRENT_DATE - INTERVAL '90 days'
          ) AS all_appointments,
          -- Sorting fields: check both cat_identifiers AND sot.cats.microchip
          CASE WHEN COALESCE(
            (SELECT ci.id_value FROM sot.cat_identifiers ci WHERE ci.cat_id = c.cat_id AND ci.id_type = 'microchip' LIMIT 1),
            c.microchip
          ) = TRIM(BOTH '%' FROM $1) THEN 0 ELSE 1 END AS microchip_exact_match,
          CASE WHEN c.name ILIKE $1 THEN 0 ELSE 1 END AS name_match
        FROM sot.cats c
        -- MIG_2602 FIX: Removed LEFT JOINs to cat_identifiers (now uses subqueries above)
        -- Get FIRST appointment for selected date (avoids duplicates if cat has multiple appointments)
        LEFT JOIN first_appointment fa ON fa.cat_id = c.cat_id
        WHERE c.merged_into_cat_id IS NULL
          AND (
            c.name ILIKE $1
            -- MIG_2602 FIX: Use EXISTS to avoid cartesian product
            OR EXISTS (SELECT 1 FROM sot.cat_identifiers ci WHERE ci.cat_id = c.cat_id AND ci.id_type = 'microchip' AND ci.id_value ILIKE $1)
            OR EXISTS (SELECT 1 FROM sot.cat_identifiers ci WHERE ci.cat_id = c.cat_id AND ci.id_type = 'clinichq_animal_id' AND ci.id_value ILIKE $1)
            -- Also search microchip directly on sot.cats table
            OR c.microchip ILIKE $1
            -- Search by clinic day number (e.g., "#5" or just "5")
            OR (fa.clinic_day_number IS NOT NULL AND fa.clinic_day_number::TEXT = REGEXP_REPLACE(TRIM(BOTH '%' FROM $1), '^#', ''))
            -- Search owner names via EXISTS to avoid join duplicates
            -- V2: Uses sot.person_cat (not sot.person_cat_relationships)
            OR EXISTS (
              SELECT 1 FROM sot.person_cat pc
              JOIN sot.people per ON per.person_id = pc.person_id
              WHERE pc.cat_id = c.cat_id
                AND pc.relationship_type IN ('owner', 'caretaker')
                AND per.merged_into_person_id IS NULL
                AND per.display_name ILIKE $1
            )
          )
      )
      SELECT
        cat_id,
        display_name,
        sex,
        primary_color,
        is_deceased,
        deceased_date,
        death_cause,
        needs_microchip,
        felv_status,
        fiv_status,
        microchip,
        clinichq_animal_id,
        owner_name,
        booked_as,
        place_address,
        photo_url,
        is_from_clinic_day,
        appointment_id,
        appointment_date,
        clinic_day_number,
        all_appointments
      FROM cat_results
      ORDER BY
        -- Cats from selected clinic day first
        is_from_clinic_day DESC,
        -- Exact microchip match takes priority
        microchip_exact_match,
        -- Then by name match quality
        name_match,
        display_name NULLS LAST
      LIMIT 50
      `,
        [searchTerm, date || "1900-01-01"]
      );
    } catch (medicalError) {
      // Fallback: ops.cat_test_results doesn't exist yet (MIG_2060 not applied)
      console.warn("ops.cat_test_results not available in search, using fallback");
      cats = await queryRows<SearchResult>(
        `
        WITH clinic_day_cats AS (
          SELECT DISTINCT a.cat_id
          FROM ops.appointments a
          WHERE a.appointment_date = $2
            AND a.cat_id IS NOT NULL
        ),
        -- Get only the first appointment per cat for the selected date (avoid duplicates)
        first_appointment AS (
          SELECT DISTINCT ON (a.cat_id)
            a.cat_id,
            a.appointment_id,
            a.appointment_date,
            a.clinic_day_number,
            a.appointment_number,
            -- DATA_GAP_053: Include owner_account_id for booked_as lookup
            a.owner_account_id
          FROM ops.appointments a
          WHERE a.appointment_date = $2
          ORDER BY a.cat_id, a.appointment_number NULLS LAST, a.created_at
        ),
        cat_results AS (
          SELECT
            c.cat_id,
            c.name AS display_name,
            c.sex,
            c.primary_color,
            COALESCE(c.is_deceased, FALSE) AS is_deceased,
            c.deceased_at AS deceased_date,
            (
              SELECT cme.cause::TEXT
              FROM sot.cat_mortality_events cme
              WHERE cme.cat_id = c.cat_id
              LIMIT 1
            ) AS death_cause,
            FALSE AS needs_microchip,
            NULL AS felv_status,
            NULL AS fiv_status,
            -- MIG_2602 FIX: Use subqueries to avoid cartesian product from multiple identifiers
            COALESCE(
              (SELECT ci.id_value FROM sot.cat_identifiers ci WHERE ci.cat_id = c.cat_id AND ci.id_type = 'microchip' LIMIT 1),
              c.microchip
            ) AS microchip,
            COALESCE(
              (SELECT ci.id_value FROM sot.cat_identifiers ci WHERE ci.cat_id = c.cat_id AND ci.id_type = 'clinichq_animal_id' LIMIT 1),
              c.clinichq_animal_id
            ) AS clinichq_animal_id,
            (
              SELECT per.display_name
              FROM sot.person_cat pc
              JOIN sot.people per ON per.person_id = pc.person_id AND per.merged_into_person_id IS NULL
              WHERE pc.cat_id = c.cat_id AND pc.relationship_type IN ('owner', 'caretaker')
              ORDER BY pc.confidence DESC NULLS LAST, pc.created_at DESC
              LIMIT 1
            ) AS owner_name,
            -- DATA_GAP_053: Original booking name from clinic_accounts (may differ from owner_name)
            (
              SELECT ca.display_name
              FROM ops.clinic_accounts ca
              WHERE ca.account_id = fa.owner_account_id
                AND ca.merged_into_account_id IS NULL
              LIMIT 1
            ) AS booked_as,
            (
              SELECT pl.formatted_address
              FROM sot.cat_place cp
              JOIN sot.places pl ON pl.place_id = cp.place_id AND pl.merged_into_place_id IS NULL
              WHERE cp.cat_id = c.cat_id
              ORDER BY cp.confidence DESC NULLS LAST, cp.created_at DESC
              LIMIT 1
            ) AS place_address,
            NULL AS photo_url,
            (c.cat_id IN (SELECT cat_id FROM clinic_day_cats)) AS is_from_clinic_day,
            fa.appointment_id,
            fa.appointment_date,
            -- Use stored clinic_day_number, fallback to row number based on appointment_number
            COALESCE(fa.clinic_day_number,
              ROW_NUMBER() OVER (PARTITION BY fa.appointment_date ORDER BY fa.appointment_number NULLS LAST, c.name NULLS LAST)::INT
            ) AS clinic_day_number,
            -- ALL recent appointments for this cat (last 90 days)
            (
              SELECT COALESCE(JSONB_AGG(
                JSONB_BUILD_OBJECT(
                  'appointment_id', a.appointment_id,
                  'appointment_date', a.appointment_date::TEXT,
                  'clinic_day_number', a.clinic_day_number
                ) ORDER BY a.appointment_date DESC
              ), '[]'::JSONB)
              FROM ops.appointments a
              WHERE a.cat_id = c.cat_id
                AND a.appointment_date >= CURRENT_DATE - INTERVAL '90 days'
            ) AS all_appointments,
            -- Sorting fields: check both cat_identifiers AND sot.cats.microchip
            CASE WHEN COALESCE(
              (SELECT ci.id_value FROM sot.cat_identifiers ci WHERE ci.cat_id = c.cat_id AND ci.id_type = 'microchip' LIMIT 1),
              c.microchip
            ) = TRIM(BOTH '%' FROM $1) THEN 0 ELSE 1 END AS microchip_exact_match,
            CASE WHEN c.name ILIKE $1 THEN 0 ELSE 1 END AS name_match
          FROM sot.cats c
          -- MIG_2602 FIX: Removed LEFT JOINs to cat_identifiers (now uses subqueries above)
          -- Get FIRST appointment for selected date (avoids duplicates if cat has multiple appointments)
          LEFT JOIN first_appointment fa ON fa.cat_id = c.cat_id
          WHERE c.merged_into_cat_id IS NULL
            AND (
              c.name ILIKE $1
              -- MIG_2602 FIX: Use EXISTS to avoid cartesian product
              OR EXISTS (SELECT 1 FROM sot.cat_identifiers ci WHERE ci.cat_id = c.cat_id AND ci.id_type = 'microchip' AND ci.id_value ILIKE $1)
              OR EXISTS (SELECT 1 FROM sot.cat_identifiers ci WHERE ci.cat_id = c.cat_id AND ci.id_type = 'clinichq_animal_id' AND ci.id_value ILIKE $1)
              -- Also search microchip directly on sot.cats table
              OR c.microchip ILIKE $1
              OR EXISTS (
                SELECT 1 FROM sot.person_cat pc
                JOIN sot.people per ON per.person_id = pc.person_id
                WHERE pc.cat_id = c.cat_id
                  AND pc.relationship_type IN ('owner', 'caretaker')
                  AND per.merged_into_person_id IS NULL
                  AND per.display_name ILIKE $1
              )
            )
        )
        SELECT
          cat_id, display_name, sex, primary_color, is_deceased, deceased_date,
          death_cause, needs_microchip, felv_status, fiv_status, microchip,
          clinichq_animal_id, owner_name, booked_as, place_address, photo_url,
          is_from_clinic_day, appointment_id, appointment_date, clinic_day_number,
          all_appointments
        FROM cat_results
        ORDER BY is_from_clinic_day DESC, microchip_exact_match, name_match, display_name NULLS LAST
        LIMIT 50
        `,
        [searchTerm, date || "1900-01-01"]
      );
    }

    return apiSuccess({ cats });
  } catch (error) {
    console.error("Photo upload search error:", error);
    return apiServerError("Failed to search cats");
  }
}
