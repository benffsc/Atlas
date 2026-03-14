import { NextRequest } from "next/server";
import { queryRows, queryOne } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";

interface FosterRow {
  person_id: string;
  display_name: string;
  role_status: string;
  email: string | null;
  phone: string | null;
  started_at: string | null;
  cats_fostered: number;
  vh_groups: string | null;
  has_agreement: boolean;
}

interface FosterAggregates {
  total_fosters: number;
  active_fosters: number;
  inactive_fosters: number;
  total_cats_fostered: number;
}

/**
 * GET /api/fosters
 * Returns foster roster with aggregates and pagination.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const status = searchParams.get("status"); // active, inactive
  const search = searchParams.get("search");
  const sortBy = searchParams.get("sort") || "display_name";
  const limit = parseInt(searchParams.get("limit") || "50", 10);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

  try {
    const conditions: string[] = ["pr.role = 'foster'"];
    const params: (string | number)[] = [limit, offset];

    if (status === "active") {
      conditions.push("pr.role_status = 'active'");
    } else if (status === "inactive") {
      conditions.push("pr.role_status = 'inactive'");
    }

    if (search && search.trim().length > 0) {
      params.push(search.trim());
      conditions.push(`(
        LOWER(p.display_name) LIKE LOWER('%' || $${params.length} || '%')
        OR LOWER(COALESCE(sot.get_email(p.person_id), '')) LIKE LOWER('%' || $${params.length} || '%')
      )`);
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    // Validate sort column
    const validSortColumns = ["display_name", "cats_fostered", "started_at", "role_status"];
    const orderColumn = validSortColumns.includes(sortBy) ? sortBy : "display_name";
    const orderDir = orderColumn === "display_name" ? "ASC" : "DESC NULLS LAST";

    const fosters = await queryRows<FosterRow>(
      `SELECT
        p.person_id,
        p.display_name,
        pr.role_status,
        sot.get_email(p.person_id) AS email,
        sot.get_phone(p.person_id) AS phone,
        pr.started_at::TEXT,
        COALESCE(fc.cats_fostered, 0)::INT AS cats_fostered,
        vg.groups AS vh_groups,
        COALESCE(fa.has_agreement, FALSE) AS has_agreement
      FROM sot.people p
      JOIN sot.person_roles pr ON pr.person_id = p.person_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::INT AS cats_fostered
        FROM sot.person_cat pc
        WHERE pc.person_id = p.person_id AND pc.relationship_type = 'foster'
      ) fc ON TRUE
      LEFT JOIN LATERAL (
        SELECT STRING_AGG(vug.name, ', ' ORDER BY vug.name) AS groups
        FROM source.volunteerhub_volunteers vv
        JOIN source.volunteerhub_group_memberships vgm ON vgm.volunteerhub_id = vv.volunteerhub_id
        JOIN source.volunteerhub_user_groups vug ON vug.user_group_uid = vgm.user_group_uid
        WHERE vv.matched_person_id = p.person_id
          AND vgm.left_at IS NULL
          AND LOWER(vug.name) LIKE '%foster%'
      ) vg ON TRUE
      LEFT JOIN LATERAL (
        SELECT TRUE AS has_agreement
        FROM ops.foster_agreements ag
        WHERE ag.person_id = p.person_id
        LIMIT 1
      ) fa ON TRUE
      ${whereClause}
      ORDER BY
        CASE WHEN pr.role_status = 'active' THEN 0 ELSE 1 END,
        ${orderColumn === "cats_fostered" ? "fc.cats_fostered" : orderColumn === "started_at" ? "pr.started_at" : `p.${orderColumn}`} ${orderDir}
      LIMIT $1 OFFSET $2`,
      params
    );

    // Aggregates
    const aggregates = await queryOne<FosterAggregates>(
      `SELECT
        COUNT(*)::INT AS total_fosters,
        COUNT(*) FILTER (WHERE pr.role_status = 'active')::INT AS active_fosters,
        COUNT(*) FILTER (WHERE pr.role_status = 'inactive')::INT AS inactive_fosters,
        COALESCE(SUM(fc.cnt), 0)::INT AS total_cats_fostered
      FROM sot.person_roles pr
      JOIN sot.people p ON p.person_id = pr.person_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::INT AS cnt
        FROM sot.person_cat pc
        WHERE pc.person_id = pr.person_id AND pc.relationship_type = 'foster'
      ) fc ON TRUE
      WHERE pr.role = 'foster'`
    );

    return apiSuccess(
      {
        fosters,
        aggregates: aggregates || {
          total_fosters: 0,
          active_fosters: 0,
          inactive_fosters: 0,
          total_cats_fostered: 0,
        },
      },
      { limit, offset, hasMore: fosters.length === limit }
    );
  } catch (error) {
    console.error("Error fetching fosters:", error);
    return apiServerError("Failed to fetch fosters");
  }
}
