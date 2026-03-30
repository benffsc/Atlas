import { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { queryRows, queryOne } from "@/lib/db";
import { parsePagination } from "@/lib/api-validation";
import { apiSuccess, apiBadRequest, apiServerError } from "@/lib/api-response";
import { REQUEST_STATUS, REQUEST_PRIORITY } from "@/lib/enums";
import { createRequestSchema, type CreateRequestBody } from "@/lib/types/request-contracts";

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
  const includeTestData = searchParams.get("include_test_data") === "true";
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

  // By default, exclude E2E test requests unless explicitly requested
  if (!includeTestData) {
    conditions.push(`(
      r.source_system != 'e2e_test'
      AND (r.internal_notes IS NULL OR r.internal_notes NOT LIKE '%E2E_TEST_MARKER%')
      AND (r.notes IS NULL OR r.notes NOT LIKE '%E2E_TEST_MARKER%')
      AND (r.summary IS NULL OR r.summary NOT LIKE 'E2E Test -%')
    )`);
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
        COALESCE(r.is_archived, FALSE) AS is_archived,
        r.resolution_outcome
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
 * POST /api/requests
 *
 * Creates a new request by directly inserting into ops.requests.
 * All form fields are mapped to DB columns (MIG_2817 added missing ones).
 * Field name mismatches are mapped: feeding_schedule→feeding_frequency,
 * eartip_count→eartip_count_observed, initial_status→status.
 *
 * Type contract: CreateRequestBody from @/lib/types/request-contracts.ts (FFS-148)
 */
export async function POST(request: NextRequest) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return apiBadRequest("Invalid JSON in request body");
  }

  // FFS-148: Validate against shared contract schema
  const parsed = createRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    const fieldErrors = parsed.error.issues.map(
      (i) => `${i.path.join(".")}: ${i.message}`
    );
    return apiBadRequest("Validation failed", { fields: fieldErrors });
  }
  const body: CreateRequestBody = parsed.data;

  // Validate minimum requirements
  if (!body.place_id && !body.summary) {
    return apiBadRequest("Either place_id or summary is required");
  }

  // Map form field names to database column names
  const status = body.initial_status || body.status || "new";
  const eartipCount = body.eartip_count ?? null;
  const feedingFrequency = body.feeding_frequency ?? body.feeding_schedule ?? null;

  // Validate enum values to return 400 instead of 500 on CHECK constraint violation
  if (status && !REQUEST_STATUS.includes(status as (typeof REQUEST_STATUS)[number])) {
    return apiBadRequest(`Invalid status. Must be one of: ${REQUEST_STATUS.join(', ')}`);
  }

  if (body.priority && !REQUEST_PRIORITY.includes(body.priority as (typeof REQUEST_PRIORITY)[number])) {
    return apiBadRequest(`Invalid priority. Must be one of: ${REQUEST_PRIORITY.join(', ')}`);
  }

  try {
    const result = await queryOne<{ request_id: string }>(
      `INSERT INTO ops.requests (
        status, priority, place_id, requester_person_id,
        site_contact_person_id, requester_is_site_contact, requester_role_at_submission,
        summary, notes, internal_notes, source_system,
        -- Request purpose (MIG_2817)
        request_purpose, request_purposes,
        -- Cat info
        estimated_cat_count, total_cats_reported, peak_count, count_confidence,
        colony_duration, awareness_duration, eartip_count_observed, eartip_estimate,
        cats_are_friendly, cat_name, cat_description, handleability, fixed_status,
        wellness_cat_count,
        -- Kittens
        has_kittens, kitten_count, kitten_age_estimate, kitten_age_weeks,
        kitten_mixed_ages_description, kitten_behavior, kitten_notes,
        mom_present, kitten_contained, mom_fixed, can_bring_in,
        -- Feeding
        is_being_fed, feeder_name, feeding_frequency, feeding_location, feeding_time,
        best_times_seen,
        -- Medical
        has_medical_concerns, medical_description,
        -- Property & Access (MIG_2817 additions)
        property_type, location_description, is_property_owner, has_property_access,
        access_notes, permission_status, traps_overnight_safe, access_without_contact,
        property_owner_name, property_owner_phone, authorization_pending, best_contact_times,
        dogs_on_site, trap_savvy, previous_tnr,
        -- Third party & location meta
        is_third_party_report, third_party_relationship, county, is_emergency,
        -- Urgency (MIG_2817)
        urgency_reasons, urgency_deadline, urgency_notes,
        -- Triage
        triage_category, received_by,
        -- Entry metadata (MIG_2817)
        entry_mode, completion_data,
        -- Trapping logistics (FFS-151)
        best_trapping_time, ownership_status, important_notes,
        -- Raw requester contact (FFS-146)
        raw_requester_name, raw_requester_phone, raw_requester_email,
        -- Person slots parity (FFS-443b)
        property_owner_person_id, raw_property_owner_email,
        raw_site_contact_name, raw_site_contact_phone, raw_site_contact_email
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
        $12, $13,
        $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27,
        $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38,
        $39, $40, $41, $42, $43, $44,
        $45, $46,
        $47, $48, $49, $50, $51, $52, $53, $54, $55, $56, $57, $58,
        $59, $60, $61,
        $62, $63, $64, $65,
        $66, $67, $68,
        $69, $70,
        $71, $72,
        $73, $74, $75,
        $76, $77, $78,
        $79, $80,
        $81, $82, $83
      )
      RETURNING request_id::TEXT`,
      [
        // Core: $1-$11
        status, body.priority || "normal", body.place_id ?? null, body.requester_person_id ?? null,
        body.site_contact_person_id ?? null, body.requester_is_site_contact ?? null, body.requester_role_at_submission ?? null,
        body.summary ?? null, body.notes ?? null, body.internal_notes ?? null, "atlas_ui",
        // Request purpose: $12-$13
        body.request_purpose ?? null, body.request_purposes ?? null,
        // Cat info: $14-$27
        body.estimated_cat_count ?? null, body.total_cats_reported ?? null, body.peak_count ?? null, body.count_confidence ?? null,
        body.colony_duration ?? null, body.awareness_duration ?? null, eartipCount, body.eartip_estimate ?? null,
        body.cats_are_friendly ?? null, body.cat_name ?? null, body.cat_description ?? null, body.handleability ?? null, body.fixed_status ?? null,
        body.wellness_cat_count ?? null,
        // Kittens: $28-$38
        body.has_kittens ?? false, body.kitten_count ?? null, body.kitten_age_estimate ?? null, body.kitten_age_weeks ?? null,
        body.kitten_mixed_ages_description ?? null, body.kitten_behavior ?? null, body.kitten_notes ?? null,
        body.mom_present ?? null, body.kitten_contained ?? null, body.mom_fixed ?? null, body.can_bring_in ?? null,
        // Feeding: $39-$44
        body.is_being_fed ?? null, body.feeder_name ?? null, feedingFrequency, body.feeding_location ?? null, body.feeding_time ?? null,
        body.best_times_seen ?? null,
        // Medical: $45-$46
        body.has_medical_concerns ?? null, body.medical_description ?? null,
        // Property & Access: $47-$61
        body.property_type ?? null, body.location_description ?? null, body.is_property_owner ?? null, body.has_property_access ?? null,
        body.access_notes ?? null, body.permission_status ?? null, body.traps_overnight_safe ?? null, body.access_without_contact ?? null,
        body.property_owner_name ?? null, body.property_owner_phone ?? null, body.authorization_pending ?? null, body.best_contact_times ?? null,
        body.dogs_on_site ?? null, body.trap_savvy ?? null, body.previous_tnr ?? null,
        // Third party & location meta: $62-$65
        body.is_third_party_report ?? false, body.third_party_relationship ?? null, body.county ?? null,
        // FFS-466: Derive is_emergency from urgency_reasons if not explicitly set
        body.is_emergency ?? (body.urgency_reasons?.includes("emergency") ? true : false),
        // Urgency: $66-$68
        body.urgency_reasons ?? null, body.urgency_deadline ?? null, body.urgency_notes ?? null,
        // Triage: $69-$70
        body.triage_category ?? null, body.received_by ?? null,
        // Entry metadata: $71-$72
        body.entry_mode ?? null, body.completion_data ? JSON.stringify(body.completion_data) : null,
        // Trapping logistics (FFS-151): $73-$75
        body.best_trapping_time ?? null, body.ownership_status ?? null, body.important_notes ?? null,
        // Raw requester contact (FFS-146): $76-$78
        body.raw_requester_name ?? null, body.raw_requester_phone ?? null, body.raw_requester_email ?? null,
        // Person slots parity (FFS-443b): $79-$83
        body.property_owner_person_id ?? null, body.raw_property_owner_email ?? null,
        body.raw_site_contact_name ?? null, body.raw_site_contact_phone ?? null, body.raw_site_contact_email ?? null,
      ]
    );

    if (!result) {
      return apiServerError("Failed to create request - no result returned");
    }

    // FFS-146: Auto-resolve requester person from raw contact info
    // Non-blocking: if resolution fails, request is still created with raw fields preserved
    if (!body.requester_person_id && (body.raw_requester_email || body.raw_requester_phone)) {
      try {
        // Parse raw name into first/last (best-effort)
        const nameParts = (body.raw_requester_name || "").trim().split(/\s+/);
        const firstName = nameParts[0] || null;
        const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : null;

        const resolved = await queryOne<{ person_id: string }>(
          `SELECT sot.find_or_create_person(
            $1, $2, $3, $4, NULL, 'atlas_ui'
          )::TEXT AS person_id`,
          [
            body.raw_requester_email ?? null,
            body.raw_requester_phone ?? null,
            firstName,
            lastName,
          ]
        );

        if (resolved?.person_id) {
          await queryOne(
            `UPDATE ops.requests SET requester_person_id = $1 WHERE request_id = $2`,
            [resolved.person_id, result.request_id]
          );
        }
      } catch (resolveError) {
        console.warn("[POST /api/requests] Auto-resolve requester failed (non-blocking):", resolveError);
      }
    }

    // FFS-498: Link pre-resolved property owner to place
    if (body.property_owner_person_id && body.place_id) {
      try {
        await queryOne(
          `SELECT sot.link_person_to_place(
            p_person_id := $1::UUID,
            p_place_id := $2::UUID,
            p_relationship_type := 'property_owner',
            p_evidence_type := 'manual',
            p_source_system := 'atlas_ui',
            p_confidence := 0.9
          )`,
          [body.property_owner_person_id, body.place_id]
        );
      } catch (linkError) {
        console.warn("[POST /api/requests] Link property owner to place failed (non-blocking):", linkError);
      }
    }

    // FFS-443b: Auto-resolve property owner person from raw contact info
    // Requires name + (phone OR email) per INV-5
    if (!body.property_owner_person_id && body.property_owner_name && (body.property_owner_phone || body.raw_property_owner_email)) {
      try {
        const nameParts = body.property_owner_name.trim().split(/\s+/);
        const firstName = nameParts[0] || null;
        const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : null;

        const resolved = await queryOne<{ person_id: string }>(
          `SELECT sot.find_or_create_person(
            $1, $2, $3, $4, NULL, 'atlas_ui'
          )::TEXT AS person_id`,
          [body.raw_property_owner_email ?? null, body.property_owner_phone ?? null, firstName, lastName]
        );

        if (resolved?.person_id) {
          // Store property_owner_person_id on the request
          await queryOne(
            `UPDATE ops.requests SET property_owner_person_id = $1 WHERE request_id = $2`,
            [resolved.person_id, result.request_id]
          );

          // FFS-498: Link property owner to place via centralized function
          if (body.place_id) {
            await queryOne(
              `SELECT sot.link_person_to_place(
                p_person_id := $1::UUID,
                p_place_id := $2::UUID,
                p_relationship_type := 'property_owner',
                p_evidence_type := 'manual',
                p_source_system := 'atlas_ui',
                p_confidence := 0.9
              )`,
              [resolved.person_id, body.place_id]
            );
          }
        }
      } catch (resolveError) {
        console.warn("[POST /api/requests] Auto-resolve property owner failed (non-blocking):", resolveError);
      }
    }

    // FFS-498: Link pre-resolved site contact to place
    if (body.site_contact_person_id && body.place_id) {
      try {
        await queryOne(
          `SELECT sot.link_person_to_place(
            p_person_id := $1::UUID,
            p_place_id := $2::UUID,
            p_relationship_type := 'site_contact',
            p_evidence_type := 'manual',
            p_source_system := 'atlas_ui',
            p_confidence := 0.9
          )`,
          [body.site_contact_person_id, body.place_id]
        );
      } catch (linkError) {
        console.warn("[POST /api/requests] Link site contact to place failed (non-blocking):", linkError);
      }
    }

    // FFS-443b: Auto-resolve site contact person from raw contact info
    // Requires phone OR email per INV-5
    if (!body.site_contact_person_id && (body.raw_site_contact_phone || body.raw_site_contact_email)) {
      try {
        const nameParts = (body.raw_site_contact_name || "").trim().split(/\s+/);
        const firstName = nameParts[0] || null;
        const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : null;

        const resolved = await queryOne<{ person_id: string }>(
          `SELECT sot.find_or_create_person(
            $1, $2, $3, $4, NULL, 'atlas_ui'
          )::TEXT AS person_id`,
          [body.raw_site_contact_email ?? null, body.raw_site_contact_phone ?? null, firstName, lastName]
        );

        if (resolved?.person_id) {
          await queryOne(
            `UPDATE ops.requests SET site_contact_person_id = $1 WHERE request_id = $2`,
            [resolved.person_id, result.request_id]
          );

          // FFS-498: Link site contact to place via centralized function
          if (body.place_id) {
            await queryOne(
              `SELECT sot.link_person_to_place(
                p_person_id := $1::UUID,
                p_place_id := $2::UUID,
                p_relationship_type := 'site_contact',
                p_evidence_type := 'manual',
                p_source_system := 'atlas_ui',
                p_confidence := 0.9
              )`,
              [resolved.person_id, body.place_id]
            );
          }
        }
      } catch (resolveError) {
        console.warn("[POST /api/requests] Auto-resolve site contact failed (non-blocking):", resolveError);
      }
    }

    // FFS-296: Link requestor to place + enrich place data
    if (result?.request_id) {
      try {
        await queryOne(`SELECT ops.enrich_person_from_request($1::UUID)`, [result.request_id]);
      } catch (e) {
        console.warn("[POST /api/requests] enrich_person_from_request failed:", e);
      }
      try {
        await queryOne(`SELECT ops.enrich_place_from_request($1::UUID)`, [result.request_id]);
      } catch (e) {
        console.warn("[POST /api/requests] enrich_place_from_request failed:", e);
      }
    }

    // Revalidate cached pages
    revalidatePath("/");
    revalidatePath("/requests");

    // Return in the format the new request form expects
    return apiSuccess({
      success: true,
      status: "promoted" as const,
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
