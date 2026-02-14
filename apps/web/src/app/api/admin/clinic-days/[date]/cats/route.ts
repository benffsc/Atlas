import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";
import { getSession } from "@/lib/auth";

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
  trapper_name: string | null;
  place_address: string | null;
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
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { date } = await params;

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "Invalid date format" }, { status: 400 });
    }

    // Get all cats seen on this clinic day (V2 schema)
    const cats = await queryRows<ClinicDayCat>(
      `
      SELECT
        a.appointment_id,
        a.cat_id,
        ROW_NUMBER() OVER (ORDER BY a.appointment_number NULLS LAST, c.name NULLS LAST)::INT AS clinic_day_number,
        a.appointment_number,
        a.service_type,
        a.is_spay,
        a.is_neuter,
        c.name AS cat_name,
        c.sex AS cat_sex,
        c.breed AS cat_breed,
        c.primary_color AS cat_color,
        c.secondary_color AS cat_secondary_color,
        FALSE AS needs_microchip,  -- V2 sot.cats doesn't have needs_microchip column
        ci_mc.id_value AS microchip,
        ci_chq.id_value AS clinichq_animal_id,
        -- Get hero photo first, then most recent cat photo
        (
          SELECT rm.storage_path
          FROM ops.request_media rm
          WHERE rm.cat_id = c.cat_id
            AND rm.is_archived = FALSE
            AND rm.media_type = 'cat_photo'
          ORDER BY rm.is_hero DESC NULLS LAST, rm.uploaded_at DESC
          LIMIT 1
        ) AS photo_url,
        per.display_name AS owner_name,
        pl.formatted_address AS place_address,
        NULL AS trapper_name,  -- V2 ops.appointments doesn't have trapper_person_id
        -- Deceased status from sot.cats
        COALESCE(c.is_deceased, FALSE) AS is_deceased,
        c.deceased_at AS deceased_date,
        -- Death cause from cat_mortality_events (subquery to avoid duplicates)
        (
          SELECT cme.death_cause::TEXT
          FROM sot.cat_mortality_events cme
          WHERE cme.cat_id = c.cat_id
          LIMIT 1
        ) AS death_cause,
        -- FeLV status from cat_test_results
        (
          SELECT
            CASE
              WHEN tr.result_detail ILIKE 'FeLV+%' OR tr.result_detail ILIKE '%FeLV+%' THEN 'positive'
              WHEN tr.result_detail ILIKE 'FeLV-%' OR tr.result_detail ILIKE '%FeLV-%' THEN 'negative'
              WHEN tr.result::TEXT = 'positive' THEN 'positive'
              WHEN tr.result::TEXT = 'negative' THEN 'negative'
              ELSE NULL
            END
          FROM sot.cat_test_results tr
          WHERE tr.cat_id = c.cat_id AND tr.test_type = 'felv_fiv'
          ORDER BY tr.test_date DESC
          LIMIT 1
        ) AS felv_status,
        -- FIV status from cat_test_results
        (
          SELECT
            CASE
              WHEN tr.result_detail ILIKE '%/FIV+' OR tr.result_detail ILIKE '%FIV+%' THEN 'positive'
              WHEN tr.result_detail ILIKE '%/FIV-' OR tr.result_detail ILIKE '%FIV-%' THEN 'negative'
              ELSE NULL
            END
          FROM sot.cat_test_results tr
          WHERE tr.cat_id = c.cat_id AND tr.test_type = 'felv_fiv'
          ORDER BY tr.test_date DESC
          LIMIT 1
        ) AS fiv_status
      FROM ops.appointments a
      LEFT JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
      LEFT JOIN sot.cat_identifiers ci_mc ON ci_mc.cat_id = a.cat_id AND ci_mc.id_type = 'microchip'
      LEFT JOIN sot.cat_identifiers ci_chq ON ci_chq.cat_id = a.cat_id AND ci_chq.id_type = 'clinichq_animal_id'
      LEFT JOIN sot.people per ON per.person_id = a.person_id AND per.merged_into_person_id IS NULL
      LEFT JOIN sot.places pl ON pl.place_id = COALESCE(a.inferred_place_id, a.place_id) AND pl.merged_into_place_id IS NULL
      WHERE a.appointment_date = $1
      ORDER BY a.appointment_number NULLS LAST, c.name NULLS LAST
      `,
      [date]
    );

    // Calculate counts
    const totalCats = cats.length;
    const chippedCount = cats.filter(c => c.microchip !== null).length;
    const unchippedCount = cats.filter(c => c.cat_id !== null && c.microchip === null && c.needs_microchip).length;
    const unlinkedCount = cats.filter(c => c.cat_id === null).length;

    const response: CatGalleryResponse = {
      date,
      total_cats: totalCats,
      chipped_count: chippedCount,
      unchipped_count: unchippedCount,
      unlinked_count: unlinkedCount,
      cats,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Clinic day cats fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch clinic day cats" },
      { status: 500 }
    );
  }
}
