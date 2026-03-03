import { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { queryRows, queryOne } from "@/lib/db";
import { parsePagination } from "@/lib/api-validation";
import { apiSuccess, apiBadRequest, apiServerError } from "@/lib/api-response";

// Valid enum values from ops.requests CHECK constraints
const VALID_STATUS = ['new', 'triaged', 'scheduled', 'in_progress', 'on_hold', 'completed', 'cancelled'] as const;
const VALID_PRIORITY = ['low', 'normal', 'high', 'urgent'] as const;

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
  is_archived: boolean;
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
  const includeArchived = searchParams.get("include_archived") === "true";
  const sortBy = searchParams.get("sort_by") || "status";
  const sortOrder = searchParams.get("sort_order") || "asc";
  const { limit, offset } = parsePagination(searchParams, { defaultLimit: 200, maxLimit: 500 });

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  // By default, exclude archived requests unless explicitly requested
  if (!includeArchived) {
    conditions.push("(r.is_archived IS NOT TRUE)");
  }

  if (status) {
    conditions.push(`vrl.status = $${paramIndex}`);
    params.push(status);
    paramIndex++;
  }

  if (priority) {
    conditions.push(`vrl.priority = $${paramIndex}`);
    params.push(priority);
    paramIndex++;
  }

  if (placeId) {
    conditions.push(`vrl.place_id = $${paramIndex}`);
    params.push(placeId);
    paramIndex++;
  }

  if (personId) {
    conditions.push(`vrl.requester_person_id = $${paramIndex}`);
    params.push(personId);
    paramIndex++;
  }

  if (assignedToPersonId) {
    conditions.push(`vrl.request_id IN (
      SELECT rta.request_id FROM ops.request_trapper_assignments rta
      WHERE rta.trapper_person_id = $${paramIndex} AND rta.unassigned_at IS NULL
    )`);
    params.push(assignedToPersonId);
    paramIndex++;
  }

  if (trapperFilter === "has_trapper" || trapperFilter === "assigned") {
    conditions.push(`vrl.assignment_status = 'assigned'`);
  } else if (trapperFilter === "needs_trapper" || trapperFilter === "pending") {
    conditions.push(`vrl.assignment_status = 'pending'`);
  } else if (trapperFilter === "client_trapping") {
    conditions.push(`vrl.assignment_status = 'client_trapping'`);
  }

  if (searchQuery && searchQuery.trim()) {
    conditions.push(`(
      vrl.summary ILIKE $${paramIndex}
      OR vrl.place_name ILIKE $${paramIndex}
      OR vrl.place_address ILIKE $${paramIndex}
      OR vrl.place_city ILIKE $${paramIndex}
      OR vrl.requester_name ILIKE $${paramIndex}
    )`);
    params.push(`%${searchQuery.trim()}%`);
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const nativeFirst = `vrl.is_legacy_request ASC`;

  const buildOrderBy = () => {
    const dir = sortOrder === "desc" ? "DESC" : "ASC";
    const effectiveCreatedAt = `COALESCE(vrl.source_created_at, vrl.created_at)`;

    switch (sortBy) {
      case "created":
        return `${nativeFirst}, ${effectiveCreatedAt} ${dir} NULLS LAST`;
      case "priority":
        return `
          ${nativeFirst},
          CASE vrl.priority
            WHEN 'urgent' THEN 1
            WHEN 'high' THEN 2
            WHEN 'normal' THEN 3
            WHEN 'low' THEN 4
          END ${dir},
          ${effectiveCreatedAt} DESC NULLS LAST
        `;
      case "type":
        return `vrl.is_legacy_request ${dir}, ${effectiveCreatedAt} DESC NULLS LAST`;
      case "status":
      default:
        return `
          ${nativeFirst},
          CASE vrl.status
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
        vrl.request_id,
        vrl.status,
        vrl.priority,
        vrl.summary,
        vrl.estimated_cat_count,
        vrl.has_kittens,
        vrl.scheduled_date,
        vrl.assigned_to,
        vrl.created_at,
        vrl.updated_at,
        vrl.source_created_at,
        vrl.place_id,
        vrl.place_name,
        vrl.place_address,
        vrl.place_city,
        vrl.requester_person_id,
        vrl.requester_name,
        vrl.requester_email,
        vrl.requester_phone,
        vrl.latitude,
        vrl.longitude,
        vrl.linked_cat_count,
        vrl.is_legacy_request,
        vrl.active_trapper_count,
        vrl.place_has_location,
        vrl.data_quality_flags,
        vrl.no_trapper_reason,
        vrl.primary_trapper_name,
        vrl.assignment_status,
        vrl.map_preview_url,
        vrl.map_preview_updated_at,
        vrl.requester_role_at_submission,
        vrl.requester_is_site_contact,
        vrl.site_contact_name,
        COALESCE(r.is_archived, FALSE) AS is_archived
      FROM ops.v_request_list vrl
      JOIN ops.requests r ON r.request_id = vrl.request_id
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

  // Validate enum values to return 400 instead of 500 on CHECK constraint violation
  if (body.status && !VALID_STATUS.includes(body.status as typeof VALID_STATUS[number])) {
    return apiBadRequest(`Invalid status. Must be one of: ${VALID_STATUS.join(', ')}`);
  }

  if (body.priority && !VALID_PRIORITY.includes(body.priority as typeof VALID_PRIORITY[number])) {
    return apiBadRequest(`Invalid priority. Must be one of: ${VALID_PRIORITY.join(', ')}`);
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

    return apiSuccess({
      request_id: result.request_id,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Error creating request:", errorMessage);

    // Provide helpful error messages for common constraint violations
    if (errorMessage.includes("violates foreign key constraint")) {
      if (errorMessage.includes("place_id")) {
        return apiBadRequest("Invalid place_id - place does not exist");
      }
      if (errorMessage.includes("requester_person_id")) {
        return apiBadRequest("Invalid requester_person_id - person does not exist");
      }
      return apiBadRequest("Invalid reference - referenced entity does not exist");
    }

    // CHECK constraint violations (enum values)
    if (errorMessage.includes("violates check constraint")) {
      return apiBadRequest("Invalid field value - check status/priority/handleability values");
    }

    // NOT NULL constraint violations
    if (errorMessage.includes("violates not-null constraint")) {
      return apiBadRequest("Missing required field");
    }

    return apiServerError("Failed to create request");
  }
}
