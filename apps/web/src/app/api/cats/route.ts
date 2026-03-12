import { NextRequest } from "next/server";
import { queryRows, query } from "@/lib/db";
import { parsePagination } from "@/lib/api-validation";
import { apiSuccess, apiServerError } from "@/lib/api-response";

interface HealthFlag {
  category: string;
  key: string;
  label: string;
  color?: string | null;
}

interface CatListRow {
  cat_id: string;
  display_name: string;
  sex: string | null;
  altered_status: string | null;
  breed: string | null;
  microchip: string | null;
  quality_tier: string;
  quality_reason: string;
  has_microchip: boolean;
  owner_count: number;
  owner_names: string | null;
  primary_place_id: string | null;
  primary_place_label: string | null;
  place_kind: string | null;
  has_place: boolean;
  created_at: string;
  last_appointment_date: string | null;
  appointment_count: number;
  source_system: string | null;
  photo_url: string | null;
  // Health fields
  is_deceased: boolean;
  weight_lbs: number | null;
  age_group: string | null;
  health_flags: HealthFlag[];
  // Lifecycle status
  current_status: string | null;
}

// Valid sort options
const SORT_OPTIONS = {
  quality: "quality_tier ASC, display_name ASC",
  name: "display_name ASC",
  recent_appointment: "last_visit_date DESC NULLS LAST, display_name ASC",
  created: "created_at DESC",
} as const;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const q = searchParams.get("q") || null;
  const { limit, offset } = parsePagination(searchParams);
  const hasPlace = searchParams.get("has_place");
  const sex = searchParams.get("sex");
  const alteredStatus = searchParams.get("altered_status");
  const sort = searchParams.get("sort") as keyof typeof SORT_OPTIONS | null;
  // New filters for origin and partner org
  const hasOrigin = searchParams.get("has_origin"); // true/false - has inferred_place_id
  const partnerOrg = searchParams.get("partner_org"); // SCAS, FFSC, etc.
  // Health filters (FFS-440)
  const disease = searchParams.get("disease"); // felv, fiv, etc.
  const condition = searchParams.get("condition"); // uri, fleas, pregnant, etc.
  const isDeceased = searchParams.get("is_deceased"); // true/false

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  // Search query (name or microchip)
  if (q) {
    conditions.push(`(
      display_name ILIKE $${paramIndex}
      OR microchip ILIKE $${paramIndex}
    )`);
    params.push(`%${q}%`);
    paramIndex++;
  }

  // Filter: has_place
  if (hasPlace === "true") {
    conditions.push("has_place = true");
  } else if (hasPlace === "false") {
    conditions.push("has_place = false");
  }

  // Filter: sex
  if (sex) {
    conditions.push(`sex ILIKE $${paramIndex}`);
    params.push(sex);
    paramIndex++;
  }

  // Filter: altered_status
  if (alteredStatus) {
    conditions.push(`altered_status ILIKE $${paramIndex}`);
    params.push(alteredStatus);
    paramIndex++;
  }

  // Filter: has_origin (has inferred_place_id from appointments)
  if (hasOrigin === "true") {
    conditions.push(`EXISTS (
      SELECT 1 FROM ops.appointments a
      WHERE a.cat_id = v_cat_list.cat_id
        AND a.inferred_place_id IS NOT NULL
    )`);
  } else if (hasOrigin === "false") {
    conditions.push(`NOT EXISTS (
      SELECT 1 FROM ops.appointments a
      WHERE a.cat_id = v_cat_list.cat_id
        AND a.inferred_place_id IS NOT NULL
    )`);
  }

  // Filter: partner_org (SCAS, FFSC, etc.)
  if (partnerOrg) {
    conditions.push(`EXISTS (
      SELECT 1 FROM ops.appointments a
      JOIN ops.partner_organizations po ON po.org_id = a.partner_org_id
      WHERE a.cat_id = v_cat_list.cat_id
        AND po.org_name_short ILIKE $${paramIndex}
    )`);
    params.push(partnerOrg);
    paramIndex++;
  }

  // Health filters (FFS-440)
  if (disease) {
    conditions.push(`EXISTS (
      SELECT 1 FROM ops.cat_test_results ctr
      WHERE ctr.cat_id = v_cat_list.cat_id
        AND ctr.test_type = $${paramIndex}
        AND ctr.result = 'positive'
    )`);
    params.push(disease);
    paramIndex++;
  }

  if (condition) {
    if (condition === "pregnant") {
      conditions.push(`EXISTS (
        SELECT 1 FROM ops.cat_vitals cv
        WHERE cv.cat_id = v_cat_list.cat_id AND cv.is_pregnant = true
      )`);
    } else if (condition === "lactating") {
      conditions.push(`EXISTS (
        SELECT 1 FROM ops.cat_vitals cv
        WHERE cv.cat_id = v_cat_list.cat_id AND cv.is_lactating = true
      )`);
    } else {
      conditions.push(`EXISTS (
        SELECT 1 FROM ops.cat_conditions cc
        WHERE cc.cat_id = v_cat_list.cat_id
          AND cc.condition_type = $${paramIndex}
          AND cc.resolved_at IS NULL
      )`);
      params.push(condition);
      paramIndex++;
    }
  }

  if (isDeceased === "true") {
    conditions.push(`EXISTS (SELECT 1 FROM sot.cats c WHERE c.cat_id = v_cat_list.cat_id AND c.is_deceased = true)`);
  } else if (isDeceased === "false") {
    conditions.push(`NOT EXISTS (SELECT 1 FROM sot.cats c WHERE c.cat_id = v_cat_list.cat_id AND c.is_deceased = true)`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Determine sort order
  const orderBy = sort && SORT_OPTIONS[sort] ? SORT_OPTIONS[sort] : SORT_OPTIONS.quality;

  try {
    // Get data with sort order
    const sql = `
      SELECT
        cat_id,
        display_name,
        sex,
        altered_status,
        breed,
        microchip,
        quality_tier,
        quality_reason,
        has_microchip,
        owner_count,
        owner_names,
        primary_place_id,
        primary_place_label,
        place_kind,
        has_place,
        created_at,
        last_visit_date::TEXT AS last_appointment_date,
        visit_count AS appointment_count,
        source_system,
        (SELECT c.photo_url FROM sot.cats c WHERE c.cat_id = v_cat_list.cat_id) AS photo_url,
        -- Health fields
        COALESCE((SELECT c.is_deceased FROM sot.cats c WHERE c.cat_id = v_cat_list.cat_id), false) AS is_deceased,
        (SELECT c.weight_lbs FROM sot.cats c WHERE c.cat_id = v_cat_list.cat_id) AS weight_lbs,
        (SELECT c.age_group FROM sot.cats c WHERE c.cat_id = v_cat_list.cat_id) AS age_group,
        -- health_flags: JSONB array aggregating disease + reproductive + conditions
        COALESCE((
          SELECT jsonb_agg(flag)
          FROM (
            -- Positive disease test results
            SELECT DISTINCT ON (dt.disease_key)
              jsonb_build_object(
                'category', 'disease',
                'key', dt.disease_key,
                'label', dt.short_code || '+',
                'color', dt.badge_color
              ) AS flag
            FROM ops.cat_test_results ctr
            JOIN ops.disease_types dt ON dt.disease_key = ctr.test_type
            WHERE ctr.cat_id = v_cat_list.cat_id
              AND ctr.result = 'positive'

            UNION ALL

            -- Reproductive flags from latest vitals
            SELECT jsonb_build_object(
              'category', 'reproductive',
              'key', 'pregnant',
              'label', 'Pregnant',
              'color', null
            ) AS flag
            WHERE EXISTS (
              SELECT 1 FROM ops.cat_vitals cv
              WHERE cv.cat_id = v_cat_list.cat_id AND cv.is_pregnant = true
              ORDER BY cv.recorded_at DESC LIMIT 1
            )

            UNION ALL

            SELECT jsonb_build_object(
              'category', 'reproductive',
              'key', 'lactating',
              'label', 'Lactating',
              'color', null
            ) AS flag
            WHERE EXISTS (
              SELECT 1 FROM ops.cat_vitals cv
              WHERE cv.cat_id = v_cat_list.cat_id AND cv.is_lactating = true
              ORDER BY cv.recorded_at DESC LIMIT 1
            )

            UNION ALL

            -- Active (unresolved) clinical conditions
            SELECT DISTINCT ON (cc.condition_type)
              jsonb_build_object(
                'category', 'condition',
                'key', cc.condition_type,
                'label', INITCAP(REPLACE(cc.condition_type, '_', ' ')),
                'color', null
              ) AS flag
            FROM ops.cat_conditions cc
            WHERE cc.cat_id = v_cat_list.cat_id
              AND cc.resolved_at IS NULL
          ) flags
        ), '[]'::jsonb) AS health_flags,
        (SELECT vcs.current_status FROM sot.v_cat_current_status vcs WHERE vcs.cat_id = v_cat_list.cat_id) AS current_status
      FROM sot.v_cat_list
      ${whereClause}
      ORDER BY ${orderBy}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    const countSql = `
      SELECT COUNT(*) as total
      FROM sot.v_cat_list
      ${whereClause}
    `;

    params.push(limit, offset);

    const [dataResult, countResult] = await Promise.all([
      queryRows<CatListRow>(sql, params),
      query(countSql, params.slice(0, -2)),
    ]);

    // Enrich health_flags with age_group and weight (from separate columns)
    for (const cat of dataResult) {
      const flags: HealthFlag[] = Array.isArray(cat.health_flags) ? cat.health_flags : [];
      if (cat.age_group === "kitten" || cat.age_group === "senior") {
        flags.push({
          category: "age",
          key: cat.age_group,
          label: cat.age_group === "kitten" ? "Kitten" : "Senior",
        });
      }
      if (cat.weight_lbs != null && cat.weight_lbs > 0) {
        flags.push({
          category: "weight",
          key: "weight",
          label: `${Number(cat.weight_lbs).toFixed(1)} lbs`,
        });
      }
      cat.health_flags = flags;
    }

    const total = parseInt(countResult.rows[0]?.total || "0", 10);
    return apiSuccess({ cats: dataResult }, { total, limit, offset });
  } catch (error) {
    console.error("Error fetching cats:", error);
    return apiServerError("Failed to fetch cats");
  }
}
