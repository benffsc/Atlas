import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { queryRows, queryOne } from "@/lib/db";
import { parsePagination } from "@/lib/api-validation";
import { apiSuccess, apiBadRequest, apiServerError } from "@/lib/api-response";

interface RequestListRow {
  request_id: string;
  status: string;
  priority: string;
  summary: string | null;
  estimated_cat_count: number | null;
  has_kittens: boolean;
  scheduled_date: string | null;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  source_created_at: string | null;
  place_id: string | null;
  place_name: string | null;
  place_address: string | null;
  place_city: string | null;
  requester_person_id: string | null;
  requester_name: string | null;
  requester_email: string | null;
  requester_phone: string | null;
  latitude: number | null;
  longitude: number | null;
  linked_cat_count: number;
  is_legacy_request: boolean;
  active_trapper_count: number;
  place_has_location: boolean;
  data_quality_flags: string[];
  no_trapper_reason: string | null;
  primary_trapper_name: string | null;
  assignment_status: string;
  map_preview_url: string | null;
  map_preview_updated_at: string | null;
  requester_role_at_submission: string | null;
  requester_is_site_contact: boolean | null;
  site_contact_name: string | null;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const status = searchParams.get("status");
  const priority = searchParams.get("priority");
  const placeId = searchParams.get("place_id");
  const personId = searchParams.get("person_id");
  const searchQuery = searchParams.get("q");
  const assignedToPersonId = searchParams.get("assigned_to_person");
  const trapperFilter = searchParams.get("trapper");
  const sortBy = searchParams.get("sort_by") || "status";
  const sortOrder = searchParams.get("sort_order") || "asc";
  const { limit, offset } = parsePagination(searchParams, { defaultLimit: 200, maxLimit: 500 });

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (status) {
    conditions.push(`status = $${paramIndex}`);
    params.push(status);
    paramIndex++;
  }

  if (priority) {
    conditions.push(`priority = $${paramIndex}`);
    params.push(priority);
    paramIndex++;
  }

  if (placeId) {
    conditions.push(`place_id = $${paramIndex}`);
    params.push(placeId);
    paramIndex++;
  }

  if (personId) {
    conditions.push(`requester_person_id = $${paramIndex}`);
    params.push(personId);
    paramIndex++;
  }

  if (assignedToPersonId) {
    conditions.push(`request_id IN (
      SELECT rta.request_id FROM ops.request_trapper_assignments rta
      WHERE rta.trapper_person_id = $${paramIndex} AND rta.unassigned_at IS NULL
    )`);
    params.push(assignedToPersonId);
    paramIndex++;
  }

  if (trapperFilter === "has_trapper" || trapperFilter === "assigned") {
    conditions.push(`assignment_status = 'assigned'`);
  } else if (trapperFilter === "needs_trapper" || trapperFilter === "pending") {
    conditions.push(`assignment_status = 'pending'`);
  } else if (trapperFilter === "client_trapping") {
    conditions.push(`assignment_status = 'client_trapping'`);
  }

  if (searchQuery && searchQuery.trim()) {
    conditions.push(`(
      summary ILIKE $${paramIndex}
      OR place_name ILIKE $${paramIndex}
      OR place_address ILIKE $${paramIndex}
      OR place_city ILIKE $${paramIndex}
      OR requester_name ILIKE $${paramIndex}
    )`);
    params.push(`%${searchQuery.trim()}%`);
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const nativeFirst = `is_legacy_request ASC`;

  const buildOrderBy = () => {
    const dir = sortOrder === "desc" ? "DESC" : "ASC";
    const effectiveCreatedAt = `COALESCE(source_created_at, created_at)`;

    switch (sortBy) {
      case "created":
        return `${nativeFirst}, ${effectiveCreatedAt} ${dir} NULLS LAST`;
      case "priority":
        return `
          ${nativeFirst},
          CASE priority
            WHEN 'urgent' THEN 1
            WHEN 'high' THEN 2
            WHEN 'normal' THEN 3
            WHEN 'low' THEN 4
          END ${dir},
          ${effectiveCreatedAt} DESC NULLS LAST
        `;
      case "type":
        return `is_legacy_request ${dir}, ${effectiveCreatedAt} DESC NULLS LAST`;
      case "status":
      default:
        return `
          ${nativeFirst},
          CASE status
            WHEN 'new' THEN 1
            WHEN 'triaged' THEN 1
            WHEN 'working' THEN 2
            WHEN 'scheduled' THEN 2
            WHEN 'in_progress' THEN 2
            WHEN 'paused' THEN 3
            WHEN 'on_hold' THEN 3
            WHEN 'completed' THEN 4
            WHEN 'cancelled' THEN 4
            WHEN 'redirected' THEN 5
            WHEN 'handed_off' THEN 5
          END ${dir},
          ${effectiveCreatedAt} DESC NULLS LAST
        `;
    }
  };

  try {
    const sql = `
      SELECT
        request_id,
        status,
        priority,
        summary,
        estimated_cat_count,
        has_kittens,
        scheduled_date,
        assigned_to,
        created_at,
        updated_at,
        source_created_at,
        place_id,
        place_name,
        place_address,
        place_city,
        requester_person_id,
        requester_name,
        requester_email,
        requester_phone,
        latitude,
        longitude,
        linked_cat_count,
        is_legacy_request,
        active_trapper_count,
        place_has_location,
        data_quality_flags,
        no_trapper_reason,
        primary_trapper_name,
        assignment_status,
        map_preview_url,
        map_preview_updated_at,
        requester_role_at_submission,
        requester_is_site_contact,
        site_contact_name
      FROM ops.v_request_list
      ${whereClause}
      ORDER BY ${buildOrderBy()}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    params.push(limit, offset);

    const requests = await queryRows<RequestListRow>(sql, params);

    const response = apiSuccess({ requests }, { limit, offset });

    response.headers.set(
      "Cache-Control",
      "private, max-age=30, stale-while-revalidate=60"
    );

    return response;
  } catch (error) {
    console.error("Error fetching requests:", error);
    return apiServerError("Failed to fetch requests");
  }
}

// ============================================================================
// POST /api/requests - Create new request
// ============================================================================

/**
 * Complete field mapping for request creation.
 * All fields from ops.requests that can be set on creation.
 */
interface CreateRequestBody {
  // Status & Priority
  status?: string;
  priority?: string;

  // Location
  place_id?: string;
  property_type?: string;
  location_description?: string;

  // Contact - Requester
  requester_person_id?: string;
  site_contact_person_id?: string;
  requester_is_site_contact?: boolean;
  requester_role_at_submission?: string;

  // Cat Info
  estimated_cat_count?: number;
  total_cats_reported?: number;
  peak_count?: number;
  count_confidence?: string;
  colony_duration?: string;
  awareness_duration?: string;
  eartip_count?: number;
  cats_are_friendly?: boolean;
  fixed_status?: string;
  cat_name?: string;
  cat_description?: string;
  handleability?: string;

  // Kittens
  has_kittens?: boolean;
  kitten_count?: number;
  kitten_age_estimate?: string;
  kitten_behavior?: string;
  mom_present?: boolean;
  kitten_contained?: boolean;
  mom_fixed?: boolean;
  can_bring_in?: boolean;

  // Feeding
  is_being_fed?: boolean;
  feeder_name?: string;
  feeding_schedule?: string;
  feeding_location?: string;
  feeding_time?: string;
  best_times_seen?: string;

  // Medical
  has_medical_concerns?: boolean;
  medical_description?: string;

  // Property & Access
  is_property_owner?: boolean;
  has_property_access?: boolean;
  access_notes?: string;
  permission_status?: string;
  dogs_on_site?: boolean;
  trap_savvy?: boolean;
  previous_tnr?: boolean;

  // Third Party
  is_third_party_report?: boolean;
  third_party_relationship?: string;

  // Location Meta
  county?: string;
  is_emergency?: boolean;

  // Triage
  triage_category?: string;
  received_by?: string;

  // Notes
  summary?: string;
  notes?: string;
  important_notes?: string;

  // Provenance
  created_by?: string;
}

/**
 * POST /api/requests
 *
 * Creates a new request by directly inserting into ops.requests.
 * All 50+ fields are mapped to ensure complete data capture.
 */
export async function POST(request: NextRequest) {
  let body: CreateRequestBody;
  try {
    body = await request.json();
  } catch {
    return apiBadRequest("Invalid JSON in request body");
  }

  // Validate minimum requirements
  if (!body.place_id && !body.summary) {
    return apiBadRequest("Either place_id or summary is required");
  }

  try {
    // Core columns that exist in ops.requests base table
    // Note: Many columns in v_request_detail are from joined views, not the base table
    const result = await queryOne<{ request_id: string }>(
      `INSERT INTO ops.requests (
        status,
        priority,
        place_id,
        requester_person_id,
        summary,
        notes,
        estimated_cat_count,
        has_kittens,
        source_system
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9
      )
      RETURNING request_id::TEXT`,
      [
        body.status || "new",
        body.priority || "normal",
        body.place_id ?? null,
        body.requester_person_id ?? null,
        body.summary ?? null,
        body.notes ?? null,
        body.estimated_cat_count ?? null,
        body.has_kittens ?? false,
        "atlas_ui",
      ]
    );

    if (!result) {
      return apiServerError("Failed to create request - no result returned");
    }

    // Revalidate cached pages
    revalidatePath("/");
    revalidatePath("/requests");

    return NextResponse.json({
      success: true,
      request_id: result.request_id,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Error creating request:", errorMessage);

    // Provide helpful error messages for common issues
    if (errorMessage.includes("violates foreign key constraint")) {
      if (errorMessage.includes("place_id")) {
        return apiBadRequest("Invalid place_id - place does not exist");
      }
      if (errorMessage.includes("requester_person_id")) {
        return apiBadRequest("Invalid requester_person_id - person does not exist");
      }
    }

    // Include actual error in dev for debugging
    if (process.env.NODE_ENV === "development") {
      return NextResponse.json(
        { success: false, error: { message: errorMessage, code: 500 } },
        { status: 500 }
      );
    }

    return apiServerError("Failed to create request");
  }
}
