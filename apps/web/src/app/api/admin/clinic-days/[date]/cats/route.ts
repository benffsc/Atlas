import { NextRequest } from "next/server";
import { queryRows } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { apiSuccess, apiBadRequest, apiUnauthorized, apiServerError } from "@/lib/api-response";

interface RouteParams {
  params: Promise<{ date: string }>;
}

interface ClinicDayCat {
  appointment_id: string;
  cat_id: string | null;
  clinic_day_number: number | null;
  appointment_number: string | null;
  cat_name: string | null;
  cat_sex: string | null;
  cat_breed: string | null;
  cat_color: string | null;
  cat_secondary_color: string | null;
  microchip: string | null;
  needs_microchip: boolean;
  clinichq_animal_id: string | null;
  photo_url: string | null;
  service_type: string | null;
  is_spay: boolean;
  is_neuter: boolean;
  owner_name: string | null;
  // DATA_GAP_053: Original booking name from ClinicHQ (may differ from owner_name)
  booked_as: string | null;
  trapper_name: string | null;
  place_address: string | null;
  // FFS-97: Original booking address from ClinicHQ (where cat came from)
  booking_address: string | null;
  // Weight
  weight_lbs: number | null;
  // FFS-862: Rebooked cat indicator
  rebooked_to_date: string | null;
  // Deceased and health status fields
  is_deceased: boolean;
  deceased_date: string | null;
  death_cause: string | null;
  felv_status: string | null;
  fiv_status: string | null;
}

interface CatGalleryResponse {
  date: string;
  total_cats: number;
  chipped_count: number;
  unchipped_count: number;
  unlinked_count: number;
  rebooked_count: number;
  cats: ClinicDayCat[];
}

/**
 * GET /api/admin/clinic-days/[date]/cats
 * Get all cats seen on a clinic day with photos and microchip status
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    // Require auth
    const session = await getSession(request);
    if (!session) {
      return apiUnauthorized();
    }

    const { date } = await params;

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return apiBadRequest("Invalid date format");
    }

    // Get all cats seen on this clinic day (V2 schema)
    // Try with medical data first (ops.cat_test_results from MIG_2060)
    // Falls back to basic query if medical tables don't exist yet
    let cats: ClinicDayCat[];
    try {
      cats = await queryRows<ClinicDayCat>(
        `
        SELECT
          a.appointment_id,
          a.cat_id,
          -- Only show clinic_day_number if explicitly assigned (no auto-generation)
          a.clinic_day_number,
          a.appointment_number,
          a.service_type,
          a.is_spay,
          a.is_neuter,
          c.name AS cat_name,
          c.sex AS cat_sex,
          c.breed AS cat_breed,
          c.primary_color AS cat_color,
          c.secondary_color AS cat_secondary_color,
          -- needs_microchip: TRUE if cat had spay/neuter but no microchip
          -- Cats that get altered should typically be microchipped
          CASE WHEN (a.is_spay OR a.is_neuter) AND COALESCE(
            (SELECT ci.id_value FROM sot.cat_identifiers ci WHERE ci.cat_id = a.cat_id AND ci.id_type = 'microchip' LIMIT 1),
            c.microchip
          ) IS NULL THEN TRUE ELSE FALSE END AS needs_microchip,
          -- Use COALESCE to fall back to denormalized columns if cat_identifiers is empty
          -- MIG_2602: Use LIMIT 1 subqueries instead of JOIN to prevent duplicate rows
          COALESCE(
            (SELECT ci.id_value FROM sot.cat_identifiers ci WHERE ci.cat_id = a.cat_id AND ci.id_type = 'microchip' LIMIT 1),
            c.microchip
          ) AS microchip,
          COALESCE(
            (SELECT ci.id_value FROM sot.cat_identifiers ci WHERE ci.cat_id = a.cat_id AND ci.id_type = 'clinichq_animal_id' LIMIT 1),
            c.clinichq_animal_id
          ) AS clinichq_animal_id,
          -- Get photo for this cat with priority: 1) hero (main photo), 2) most recent
          (
            SELECT rm.storage_path
            FROM ops.request_media rm
            WHERE rm.cat_id = c.cat_id
              AND rm.is_archived = FALSE
            ORDER BY rm.is_hero DESC NULLS LAST, rm.uploaded_at DESC
            LIMIT 1
          ) AS photo_url,
          per.display_name AS owner_name,
          -- DATA_GAP_053: Original booking name from clinic_accounts (may differ from resolved owner_name)
          ca.display_name AS booked_as,
          pl.formatted_address AS place_address,
          -- FFS-97: Original booking address from ClinicHQ
          a.owner_address AS booking_address,
          NULL AS trapper_name,
          a.cat_weight_lbs AS weight_lbs,
          NULL::TEXT AS rebooked_to_date,
          COALESCE(c.is_deceased, FALSE) AS is_deceased,
          c.deceased_at AS deceased_date,
          (
            SELECT cme.cause::TEXT
            FROM sot.cat_mortality_events cme
            WHERE cme.cat_id = c.cat_id AND cme.deleted_at IS NULL
            LIMIT 1
          ) AS death_cause,
          -- FeLV/FIV status from ops.cat_test_results (MIG_2117 V2 schema)
          -- V2: Uses test_type = 'felv' or 'fiv' with result column (not felv_status/fiv_status)
          (
            SELECT tr.result
            FROM ops.cat_test_results tr
            WHERE tr.cat_id = c.cat_id
              AND tr.test_type IN ('felv', 'felv_fiv_combo')
              AND tr.result IS NOT NULL
            ORDER BY tr.test_date DESC
            LIMIT 1
          ) AS felv_status,
          (
            SELECT tr.result
            FROM ops.cat_test_results tr
            WHERE tr.cat_id = c.cat_id
              AND tr.test_type IN ('fiv', 'felv_fiv_combo')
              AND tr.result IS NOT NULL
            ORDER BY tr.test_date DESC
            LIMIT 1
          ) AS fiv_status
        FROM ops.appointments a
        LEFT JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
        LEFT JOIN sot.people per ON per.person_id = a.person_id AND per.merged_into_person_id IS NULL
        LEFT JOIN ops.clinic_accounts ca ON ca.account_id = a.owner_account_id AND ca.merged_into_account_id IS NULL
        LEFT JOIN sot.places pl ON pl.place_id = COALESCE(a.inferred_place_id, a.place_id) AND pl.merged_into_place_id IS NULL
        WHERE a.appointment_date = $1
        ORDER BY a.clinic_day_number NULLS LAST, a.appointment_number NULLS LAST, c.name NULLS LAST
        `,
        [date]
      );
    } catch (medicalError) {
      // Fallback: ops.cat_test_results doesn't exist yet (MIG_2060 not applied)
      console.warn("ops.cat_test_results not available, using fallback query:", medicalError);
      cats = await queryRows<ClinicDayCat>(
        `
        SELECT
          a.appointment_id,
          a.cat_id,
          -- Only show clinic_day_number if explicitly assigned (no auto-generation)
          a.clinic_day_number,
          a.appointment_number,
          a.service_type,
          a.is_spay,
          a.is_neuter,
          c.name AS cat_name,
          c.sex AS cat_sex,
          c.breed AS cat_breed,
          c.primary_color AS cat_color,
          c.secondary_color AS cat_secondary_color,
          -- needs_microchip: TRUE if cat had spay/neuter but no microchip
          -- Cats that get altered should typically be microchipped
          CASE WHEN (a.is_spay OR a.is_neuter) AND COALESCE(
            (SELECT ci.id_value FROM sot.cat_identifiers ci WHERE ci.cat_id = a.cat_id AND ci.id_type = 'microchip' LIMIT 1),
            c.microchip
          ) IS NULL THEN TRUE ELSE FALSE END AS needs_microchip,
          -- Use COALESCE to fall back to denormalized columns if cat_identifiers is empty
          -- MIG_2602: Use LIMIT 1 subqueries instead of JOIN to prevent duplicate rows
          COALESCE(
            (SELECT ci.id_value FROM sot.cat_identifiers ci WHERE ci.cat_id = a.cat_id AND ci.id_type = 'microchip' LIMIT 1),
            c.microchip
          ) AS microchip,
          COALESCE(
            (SELECT ci.id_value FROM sot.cat_identifiers ci WHERE ci.cat_id = a.cat_id AND ci.id_type = 'clinichq_animal_id' LIMIT 1),
            c.clinichq_animal_id
          ) AS clinichq_animal_id,
          -- Get photo for this cat with priority: 1) hero (main photo), 2) most recent
          (
            SELECT rm.storage_path
            FROM ops.request_media rm
            WHERE rm.cat_id = c.cat_id
              AND rm.is_archived = FALSE
            ORDER BY rm.is_hero DESC NULLS LAST, rm.uploaded_at DESC
            LIMIT 1
          ) AS photo_url,
          per.display_name AS owner_name,
          -- DATA_GAP_053: Original booking name from clinic_accounts (may differ from resolved owner_name)
          ca.display_name AS booked_as,
          pl.formatted_address AS place_address,
          -- FFS-97: Original booking address from ClinicHQ
          a.owner_address AS booking_address,
          NULL AS trapper_name,
          a.cat_weight_lbs AS weight_lbs,
          NULL::TEXT AS rebooked_to_date,
          COALESCE(c.is_deceased, FALSE) AS is_deceased,
          c.deceased_at AS deceased_date,
          (
            SELECT cme.cause::TEXT
            FROM sot.cat_mortality_events cme
            WHERE cme.cat_id = c.cat_id AND cme.deleted_at IS NULL
            LIMIT 1
          ) AS death_cause,
          NULL AS felv_status,
          NULL AS fiv_status
        FROM ops.appointments a
        LEFT JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
        LEFT JOIN sot.people per ON per.person_id = a.person_id AND per.merged_into_person_id IS NULL
        LEFT JOIN ops.clinic_accounts ca ON ca.account_id = a.owner_account_id AND ca.merged_into_account_id IS NULL
        LEFT JOIN sot.places pl ON pl.place_id = COALESCE(a.inferred_place_id, a.place_id) AND pl.merged_into_place_id IS NULL
        WHERE a.appointment_date = $1
        ORDER BY a.clinic_day_number NULLS LAST, a.appointment_number NULLS LAST, c.name NULLS LAST
        `,
        [date]
      );
    }

    // FFS-862: Fetch rebooked cats that were originally scheduled for this date
    // but got rebooked to a later date (invisible in appointment_info for this date)
    try {
      const rebooked = await queryRows<ClinicDayCat>(
        `
        SELECT
          rb.appointment_id,
          rb.cat_id,
          rb.clinic_day_number,
          rb.animal_number AS appointment_number,
          rb.service_type,
          COALESCE(rb.is_spay, FALSE) AS is_spay,
          COALESCE(rb.is_neuter, FALSE) AS is_neuter,
          c.name AS cat_name,
          c.sex AS cat_sex,
          c.breed AS cat_breed,
          c.primary_color AS cat_color,
          c.secondary_color AS cat_secondary_color,
          CASE WHEN (rb.is_spay OR rb.is_neuter) AND COALESCE(
            (SELECT ci.id_value FROM sot.cat_identifiers ci WHERE ci.cat_id = rb.cat_id AND ci.id_type = 'microchip' LIMIT 1),
            c.microchip
          ) IS NULL THEN TRUE ELSE FALSE END AS needs_microchip,
          COALESCE(
            (SELECT ci.id_value FROM sot.cat_identifiers ci WHERE ci.cat_id = rb.cat_id AND ci.id_type = 'microchip' LIMIT 1),
            c.microchip
          ) AS microchip,
          COALESCE(
            (SELECT ci.id_value FROM sot.cat_identifiers ci WHERE ci.cat_id = rb.cat_id AND ci.id_type = 'clinichq_animal_id' LIMIT 1),
            c.clinichq_animal_id
          ) AS clinichq_animal_id,
          (
            SELECT rm.storage_path
            FROM ops.request_media rm
            WHERE rm.cat_id = c.cat_id AND rm.is_archived = FALSE
            ORDER BY rm.is_hero DESC NULLS LAST, rm.uploaded_at DESC
            LIMIT 1
          ) AS photo_url,
          per.display_name AS owner_name,
          ca.display_name AS booked_as,
          pl.formatted_address AS place_address,
          rb.owner_address AS booking_address,
          NULL AS trapper_name,
          rb.cat_weight_lbs AS weight_lbs,
          TO_CHAR(rb.rebooked_to_date, 'YYYY-MM-DD') AS rebooked_to_date,
          COALESCE(c.is_deceased, FALSE) AS is_deceased,
          c.deceased_at AS deceased_date,
          NULL AS death_cause,
          NULL AS felv_status,
          NULL AS fiv_status
        FROM ops.v_rebooked_cats rb
        LEFT JOIN sot.cats c ON c.cat_id = rb.cat_id AND c.merged_into_cat_id IS NULL
        LEFT JOIN sot.people per ON per.person_id = rb.person_id AND per.merged_into_person_id IS NULL
        LEFT JOIN ops.clinic_accounts ca ON ca.account_id = rb.owner_account_id AND ca.merged_into_account_id IS NULL
        LEFT JOIN sot.places pl ON pl.place_id = COALESCE(rb.inferred_place_id, rb.place_id) AND pl.merged_into_place_id IS NULL
        WHERE rb.original_date = $1
          AND rb.cat_id IS NOT NULL
        `,
        [date]
      );
      cats.push(...rebooked);
    } catch (rebookError) {
      // v_rebooked_cats view may not exist yet (MIG_2989 not applied)
      console.warn("ops.v_rebooked_cats not available:", rebookError);
    }

    // Calculate counts
    const totalCats = cats.length;
    const chippedCount = cats.filter(c => c.microchip !== null).length;
    const unchippedCount = cats.filter(c => c.cat_id !== null && c.microchip === null && c.needs_microchip).length;
    const unlinkedCount = cats.filter(c => c.cat_id === null).length;
    const rebookedCount = cats.filter(c => c.rebooked_to_date !== null).length;

    const response: CatGalleryResponse = {
      date,
      total_cats: totalCats,
      chipped_count: chippedCount,
      unchipped_count: unchippedCount,
      unlinked_count: unlinkedCount,
      rebooked_count: rebookedCount,
      cats,
    };

    return apiSuccess(response);
  } catch (error) {
    console.error("Clinic day cats fetch error:", error);
    return apiServerError("Failed to fetch clinic day cats");
  }
}
