import { NextRequest, NextResponse } from "next/server";
import { queryRows } from "@/lib/db";
import { getSession } from "@/lib/auth";

interface SearchResult {
  cat_id: string;
  display_name: string | null;
  microchip: string | null;
  clinichq_animal_id: string | null;
  owner_name: string | null;
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
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get("q");
    const date = searchParams.get("date");

    if (!query || query.trim().length < 2) {
      return NextResponse.json({ cats: [] });
    }

    // Validate date format if provided
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "Invalid date format" }, { status: 400 });
    }

    const searchTerm = `%${query.trim()}%`;

    // Search cats, prioritizing those from the selected clinic day (V2 schema)
    const cats = await queryRows<SearchResult>(
      `
      WITH clinic_day_cats AS (
        SELECT DISTINCT a.cat_id
        FROM ops.appointments a
        WHERE a.appointment_date = $2
          AND a.cat_id IS NOT NULL
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
            SELECT cme.death_cause::TEXT
            FROM sot.cat_mortality_events cme
            WHERE cme.cat_id = c.cat_id
            LIMIT 1
          ) AS death_cause,
          FALSE AS needs_microchip,  -- V2 sot.cats doesn't have needs_microchip
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
          ) AS fiv_status,
          ci_mc.id_value AS microchip,
          ci_chq.id_value AS clinichq_animal_id,
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
          -- Place address via subquery to avoid cartesian product (one row per cat)
          (
            SELECT pl.formatted_address
            FROM sot.cat_place_relationships cpr
            JOIN sot.places pl ON pl.place_id = cpr.place_id
              AND pl.merged_into_place_id IS NULL
            WHERE cpr.cat_id = c.cat_id
            ORDER BY cpr.confidence DESC NULLS LAST, cpr.created_at DESC
            LIMIT 1
          ) AS place_address,
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
          -- Check if from selected clinic day
          (c.cat_id IN (SELECT cat_id FROM clinic_day_cats)) AS is_from_clinic_day,
          -- Get appointment info for selected date
          a_day.appointment_id,
          a_day.appointment_date,
          a_day.appointment_number AS clinic_day_number,
          -- Sorting fields
          CASE WHEN ci_mc.id_value = TRIM(BOTH '%' FROM $1) THEN 0 ELSE 1 END AS microchip_exact_match,
          CASE WHEN c.name ILIKE $1 THEN 0 ELSE 1 END AS name_match
        FROM sot.cats c
        LEFT JOIN sot.cat_identifiers ci_mc ON ci_mc.cat_id = c.cat_id AND ci_mc.id_type = 'microchip'
        LEFT JOIN sot.cat_identifiers ci_chq ON ci_chq.cat_id = c.cat_id AND ci_chq.id_type = 'clinichq_animal_id'
        -- Get appointment for selected date
        LEFT JOIN ops.appointments a_day ON a_day.cat_id = c.cat_id
          AND a_day.appointment_date = $2
        WHERE c.merged_into_cat_id IS NULL
          AND (
            c.name ILIKE $1
            OR ci_mc.id_value ILIKE $1
            OR ci_chq.id_value ILIKE $1
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
        place_address,
        photo_url,
        is_from_clinic_day,
        appointment_id,
        appointment_date,
        clinic_day_number
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

    return NextResponse.json({ cats });
  } catch (error) {
    console.error("Photo upload search error:", error);
    return NextResponse.json(
      { error: "Failed to search cats" },
      { status: 500 }
    );
  }
}
