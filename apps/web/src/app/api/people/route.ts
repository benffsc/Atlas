import { NextRequest } from "next/server";
import { queryRows, query, queryOne } from "@/lib/db";
import { parsePagination, parseBody } from "@/lib/api-validation";
import { apiSuccess, apiServerError, apiUnprocessable } from "@/lib/api-response";
import { CreatePersonSchema } from "@/lib/schemas";
import { shouldBePerson } from "@/lib/guards";

interface PersonListRow {
  person_id: string;
  display_name: string;
  account_type: string | null;
  is_canonical: boolean;
  surface_quality: string | null;
  quality_reason: string | null;
  has_email: boolean;
  has_phone: boolean;
  cat_count: number;
  place_count: number;
  cat_names: string | null;
  primary_place: string | null;
  created_at: string;
  source_quality: string;
  last_appointment_date: string | null;
  // Status fields (FFS-434)
  primary_role: string | null;
  trapper_type: string | null;
  do_not_contact: boolean;
  entity_type: string | null;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const q = searchParams.get("q") || null;
  const { limit, offset } = parsePagination(searchParams);
  const deepSearch = searchParams.get("deep_search") === "true";

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  // Search query
  if (q) {
    conditions.push(`display_name ILIKE $${paramIndex}`);
    params.push(`%${q}%`);
    paramIndex++;
  }

  // Default: only high-quality canonical people
  // Deep Search: show everything including low quality and non-person accounts
  if (!deepSearch) {
    conditions.push(`account_type = 'person'`);
    conditions.push(`surface_quality != 'Low'`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  try {
    // Order by surface quality (High first), then name
    const sql = `
      SELECT
        person_id,
        display_name,
        account_type,
        is_canonical,
        surface_quality,
        quality_reason,
        has_email,
        has_phone,
        cat_count,
        place_count,
        cat_names,
        primary_place,
        created_at,
        source_quality,
        (SELECT MAX(a.appointment_date)::TEXT FROM ops.appointments a WHERE a.person_id = v.person_id) AS last_appointment_date,
        -- Status fields (FFS-434)
        primary_role,
        trapper_type,
        COALESCE((SELECT p.do_not_contact FROM sot.people p WHERE p.person_id = v.person_id), false) AS do_not_contact,
        entity_type
      FROM sot.v_person_list_v3 v
      ${whereClause}
      ORDER BY
        CASE surface_quality WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END,
        display_name ASC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    const countSql = `
      SELECT COUNT(*) as total
      FROM sot.v_person_list_v3 v
      ${whereClause}
    `;

    params.push(limit, offset);

    const [dataResult, countResult] = await Promise.all([
      queryRows<PersonListRow>(sql, params),
      query(countSql, params.slice(0, -2)),
    ]);

    const total = parseInt(countResult.rows[0]?.total || "0", 10);
    return apiSuccess({ people: dataResult }, { total, limit, offset });
  } catch (error) {
    console.error("Error fetching people:", error);
    return apiServerError("Failed to fetch people");
  }
}

// =============================================================================
// POST /api/people — Create a new person via data_engine_resolve_identity
// =============================================================================

interface ResolutionResult {
  decision_type: string;
  person_id: string | null;
  display_name: string | null;
  confidence: number;
  reason: string;
  match_details: Record<string, unknown>;
  decision_id: string;
}

export async function POST(request: NextRequest) {
  const parsed = await parseBody(request, CreatePersonSchema);
  if ("error" in parsed) return parsed.error;

  const { first_name, last_name, email, phone, entity_type } = parsed.data;

  // Client-side gate (server SQL gate is authoritative, but this gives fast feedback)
  const gate = shouldBePerson(first_name, last_name || null, email || null, phone || null);
  if (!gate.valid) {
    return apiUnprocessable(gate.reason);
  }

  try {
    // Call data_engine_resolve_identity directly for full decision info
    const result = await queryOne<ResolutionResult>(
      `SELECT * FROM sot.data_engine_resolve_identity($1, $2, $3, $4, $5, $6)`,
      [email || null, phone || null, first_name, last_name || null, null, "atlas_ui"]
    );

    if (!result || !result.person_id) {
      // Rejection from SQL gate
      return apiUnprocessable(result?.reason || "Person creation rejected by data engine");
    }

    // If entity_type provided, update the person record
    if (entity_type) {
      await query(
        `UPDATE sot.people SET entity_type = $1, updated_at = NOW() WHERE person_id = $2`,
        [entity_type, result.person_id]
      );
    }

    // Fetch the final person record for response
    const person = await queryOne<{
      person_id: string;
      display_name: string;
      first_name: string | null;
      last_name: string | null;
      entity_type: string | null;
      is_verified: boolean;
    }>(
      `SELECT person_id, display_name, first_name, last_name, entity_type, is_verified
       FROM sot.people WHERE person_id = $1`,
      [result.person_id]
    );

    return apiSuccess({
      person,
      resolution: {
        decision_type: result.decision_type,
        is_new: result.decision_type === "new_entity",
        is_match: result.decision_type === "auto_match" || result.decision_type === "review_pending",
        confidence: result.confidence,
        reason: result.reason,
      },
    });
  } catch (error) {
    console.error("Error creating person:", error);
    return apiServerError("Failed to create person");
  }
}
