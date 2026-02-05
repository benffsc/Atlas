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

    // Search cats, prioritizing those from the selected clinic day
    // Also search staged_records for microchip matches on the clinic day
    const cats = await queryRows<SearchResult>(
      `
      WITH clinic_day_cats AS (
        SELECT DISTINCT a.cat_id
        FROM trapper.sot_appointments a
        WHERE a.appointment_date = $2
          AND a.cat_id IS NOT NULL
      ),
      -- Also find cats by searching staged appointment records for microchip
      staged_microchip_matches AS (
        SELECT DISTINCT a.cat_id
        FROM trapper.sot_appointments a
        JOIN trapper.staged_records sr ON sr.source_row_id = a.source_record_id
          AND sr.source_system = 'clinichq'
          AND sr.source_table = 'appointment_info'
        WHERE a.appointment_date = $2
          AND a.cat_id IS NOT NULL
          AND (sr.payload->>'Microchip') ILIKE $1
      )
      SELECT
        c.cat_id,
        c.display_name,
        c.sex,
        c.primary_color,
        COALESCE(c.is_deceased, FALSE) AS is_deceased,
        c.deceased_date,
        -- Death cause from cat_mortality_events (subquery to avoid duplicates)
        (
          SELECT cme.death_cause::TEXT
          FROM trapper.cat_mortality_events cme
          WHERE cme.cat_id = c.cat_id
          LIMIT 1
        ) AS death_cause,
        COALESCE(c.needs_microchip, FALSE) AS needs_microchip,
        -- FeLV status from cat_test_results (felv_fiv_status is NOT on sot_cats)
        (
          SELECT
            CASE
              WHEN tr.result_detail ILIKE 'FeLV+%' OR tr.result_detail ILIKE '%FeLV+%' THEN 'positive'
              WHEN tr.result_detail ILIKE 'FeLV-%' OR tr.result_detail ILIKE '%FeLV-%' THEN 'negative'
              WHEN tr.result::TEXT = 'positive' THEN 'positive'
              WHEN tr.result::TEXT = 'negative' THEN 'negative'
              ELSE NULL
            END
          FROM trapper.cat_test_results tr
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
          FROM trapper.cat_test_results tr
          WHERE tr.cat_id = c.cat_id AND tr.test_type = 'felv_fiv'
          ORDER BY tr.test_date DESC
          LIMIT 1
        ) AS fiv_status,
        ci_mc.id_value AS microchip,
        ci_chq.id_value AS clinichq_animal_id,
        per.display_name AS owner_name,
        pl.formatted_address AS place_address,
        -- Get hero photo first, then most recent cat photo
        (
          SELECT rm.storage_path
          FROM trapper.request_media rm
          WHERE (rm.linked_cat_id = c.cat_id OR rm.direct_cat_id = c.cat_id)
            AND rm.is_archived = FALSE
            AND rm.media_type = 'cat_photo'
          ORDER BY rm.is_hero DESC NULLS LAST, rm.uploaded_at DESC
          LIMIT 1
        ) AS photo_url,
        -- Check if from selected clinic day
        (c.cat_id IN (SELECT cat_id FROM clinic_day_cats)) AS is_from_clinic_day,
        -- Get appointment info for selected date
        a_day.appointment_date,
        a_day.clinic_day_number
      FROM trapper.sot_cats c
      LEFT JOIN trapper.cat_identifiers ci_mc ON ci_mc.cat_id = c.cat_id AND ci_mc.id_type = 'microchip'
      LEFT JOIN trapper.cat_identifiers ci_chq ON ci_chq.cat_id = c.cat_id AND ci_chq.id_type = 'clinichq_animal_id'
      -- Get owner via person-cat relationships
      LEFT JOIN trapper.person_cat_relationships pcr ON pcr.cat_id = c.cat_id
        AND pcr.relationship_type IN ('owner', 'caretaker')
      LEFT JOIN trapper.sot_people per ON per.person_id = pcr.person_id
        AND per.merged_into_person_id IS NULL
      -- Get place via cat-place relationships
      LEFT JOIN trapper.cat_place_relationships cpr ON cpr.cat_id = c.cat_id
      LEFT JOIN trapper.places pl ON pl.place_id = cpr.place_id
        AND pl.merged_into_place_id IS NULL
      -- Get appointment for selected date
      LEFT JOIN trapper.sot_appointments a_day ON a_day.cat_id = c.cat_id
        AND a_day.appointment_date = $2
      WHERE c.merged_into_cat_id IS NULL
        AND (
          c.display_name ILIKE $1
          OR ci_mc.id_value ILIKE $1
          OR ci_chq.id_value ILIKE $1
          OR per.display_name ILIKE $1
          -- Also match cats found via staged record microchip search
          OR c.cat_id IN (SELECT cat_id FROM staged_microchip_matches)
        )
      ORDER BY
        -- Cats from selected clinic day first
        (c.cat_id IN (SELECT cat_id FROM clinic_day_cats)) DESC,
        -- Then by name match quality
        CASE WHEN c.display_name ILIKE $1 THEN 0 ELSE 1 END,
        c.display_name NULLS LAST
      LIMIT 20
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
