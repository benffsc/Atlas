import { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { query, queryOne, queryRows } from "@/lib/db";
import { logFieldEdits } from "@/lib/audit";
import { requireValidUUID, parseBody } from "@/lib/api-validation";
import { apiSuccess, apiError, apiBadRequest, apiNotFound, apiServerError } from "@/lib/api-response";
import { UpdateRequestSchema } from "@/lib/schemas";

interface CurrentTrapper {
  trapper_person_id: string;
  trapper_name: string;
  trapper_type: string | null;
  is_ffsc_trapper: boolean;
  is_primary: boolean;
  assigned_at: string;
}

interface RequestDetailRow {
  request_id: string;
  status: string;
  priority: string;
  summary: string | null;
  notes: string | null;
  legacy_notes: string | null;
  estimated_cat_count: number | null;
  // MIG_534 cat count semantic fields
  total_cats_reported: number | null;
  cat_count_semantic: string | null;
  has_kittens: boolean;
  cats_are_friendly: boolean | null;
  preferred_contact_method: string | null;
  assigned_to: string | null;
  assigned_trapper_type: string | null;
  assigned_at: string | null;
  assignment_notes: string | null;
  scheduled_date: string | null;
  scheduled_time_range: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
  resolution_reason: string | null;
  cats_trapped: number | null;
  cats_returned: number | null;
  data_source: string;
  source_system: string | null;
  source_record_id: string | null;
  source_created_at: string | null;
  // Archive fields (MIG_2580)
  is_archived: boolean;
  archived_at: string | null;
  archived_by: string | null;
  archive_reason: string | null;
  archive_notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // Enhanced intake fields (MIG_181)
  permission_status: string | null;
  property_owner_contact: string | null;
  access_notes: string | null;
  traps_overnight_safe: boolean | null;
  access_without_contact: boolean | null;
  property_type: string | null;
  colony_duration: string | null;
  location_description: string | null;
  eartip_count: number | null;
  eartip_estimate: string | null;
  count_confidence: string | null;
  kitten_count: number | null;
  kitten_age_weeks: number | null;
  kitten_assessment_status: string | null;
  kitten_assessment_outcome: string | null;
  kitten_foster_readiness: string | null;
  kitten_urgency_factors: string[] | null;
  kitten_assessment_notes: string | null;
  not_assessing_reason: string | null;
  kitten_assessed_by: string | null;
  kitten_assessed_at: string | null;
  is_being_fed: boolean | null;
  feeder_name: string | null;
  feeding_schedule: string | null;
  best_times_seen: string | null;
  urgency_reasons: string[] | null;
  urgency_deadline: string | null;
  urgency_notes: string | null;
  best_contact_times: string | null;
  // Hold tracking (MIG_182)
  hold_reason: string | null;
  hold_reason_notes: string | null;
  hold_started_at: string | null;
  // Activity tracking (MIG_182)
  last_activity_at: string | null;
  last_activity_type: string | null;
  // Redirect/Handoff fields
  redirected_to_request_id: string | null;
  redirected_from_request_id: string | null;
  redirect_reason: string | null;
  redirect_at: string | null;
  transfer_type: string | null;
  // Place info
  place_id: string | null;
  place_name: string | null;
  place_address: string | null;
  place_kind: string | null;
  place_city: string | null;
  place_postal_code: string | null;
  place_coordinates: { lat: number; lng: number } | null;
  place_safety_notes: string | null;
  place_safety_concerns: string[] | null;
  place_service_zone: string | null;
  // Requester info
  requester_person_id: string | null;
  requester_name: string | null;
  requester_email: string | null;
  requester_phone: string | null;
  requester_role_at_submission: string | null;
  requester_is_site_contact: boolean | null;
  // Site contact info (MIG_2522)
  site_contact_person_id: string | null;
  site_contact_name: string | null;
  site_contact_email: string | null;
  site_contact_phone: string | null;
  // Verified counts (computed from ClinicHQ linkage)
  linked_cat_count: number | null;
  verified_altered_count: number | null;
  verified_intact_count: number | null;
  unverified_count: number | null;
  verification_completeness: string | null;
  cats: object[] | null;
  // Computed scores
  readiness_score: number | null;
  urgency_score: number | null;
  // Colony summary (MIG_562)
  colony_size_estimate: number | null;
  colony_verified_altered: number | null;
  colony_work_remaining: number | null;
  colony_alteration_rate: number | null;
  colony_estimation_method: string | null;
  colony_has_override: boolean | null;
  colony_override_note: string | null;
  colony_verified_exceeds_reported: boolean | null;
  // Email batching (MIG_605)
  ready_to_email: boolean;
  email_summary: string | null;
  email_batch_id: string | null;
  // Classification suggestion (MIG_622)
  suggested_classification: string | null;
  classification_confidence: number | null;
  classification_signals: Record<string, unknown> | null;
  classification_disposition: string | null;
  classification_suggested_at: string | null;
  classification_reviewed_at: string | null;
  classification_reviewed_by: string | null;
  current_place_classification: string | null;
  // SC_004: Assignment status (maintained field)
  no_trapper_reason: string | null;
  assignment_status: string;
  // Call sheet trapping logistics (MIG_2495)
  dogs_on_site: string | null;
  trap_savvy: string | null;
  previous_tnr: string | null;
  handleability: string | null;
  fixed_status: string | null;
  ownership_status: string | null;
  has_medical_concerns: boolean;
  medical_description: string | null;
  important_notes: string[] | null;
  // MIG_2817: Additional restored columns
  request_purpose: string | null;
  request_purposes: string[] | null;
  property_owner_name: string | null;
  property_owner_phone: string | null;
  authorization_pending: boolean | null;
  kitten_mixed_ages_description: string | null;
  kitten_notes: string | null;
  wellness_cat_count: number | null;
  entry_mode: string | null;
  completion_data: Record<string, unknown> | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    requireValidUUID(id, "request");
    // Query request with V2 schema columns
    // V2: Uses only columns that exist in ops.requests after MIG cleanup
    // Columns that don't exist return NULL for frontend compatibility
    const sql = `
      SELECT
        r.request_id,
        r.status::TEXT,
        r.priority::TEXT,
        r.summary,
        r.notes,
        r.estimated_cat_count,
        r.total_cats_reported,
        r.cat_count_semantic::TEXT,
        COALESCE(r.has_kittens, FALSE) AS has_kittens,
        -- V1 columns now return NULL (dropped in V2) — except MIG_2817 restored columns
        r.cats_are_friendly,
        NULL::TEXT AS preferred_contact_method,
        NULL::TEXT AS assigned_to,
        NULL::TEXT AS assigned_trapper_type,
        NULL::TIMESTAMPTZ AS assigned_at,
        NULL::TEXT AS assignment_notes,
        NULL::TEXT AS scheduled_date,
        NULL::TEXT AS scheduled_time_range,
        r.resolved_at,
        r.resolution AS resolution_notes,
        r.resolution_outcome,
        r.resolution_reason,
        NULL::INT AS cats_trapped,
        NULL::INT AS cats_returned,
        r.source_system AS data_source,
        r.source_system,
        r.source_record_id,
        r.source_created_at,
        -- Archive fields (MIG_2580)
        COALESCE(r.is_archived, FALSE) AS is_archived,
        r.archived_at,
        r.archived_by,
        r.archive_reason,
        r.archive_notes,
        NULL::TEXT AS created_by,
        r.created_at,
        r.updated_at,
        -- V2 intake fields (MIG_2531/2532 + MIG_2817 restorations)
        r.permission_status,
        r.property_owner_name AS property_owner_contact,
        r.property_owner_name,
        r.access_notes,
        r.traps_overnight_safe,
        r.access_without_contact,
        r.property_type,
        r.colony_duration,
        r.location_description,
        r.eartip_count_observed AS eartip_count,
        r.eartip_estimate,
        r.count_confidence,
        r.kitten_count,
        r.kitten_age_weeks,
        NULL::TEXT AS kitten_assessment_status,
        NULL::TEXT AS kitten_assessment_outcome,
        NULL::TEXT AS kitten_foster_readiness,
        NULL::TEXT[] AS kitten_urgency_factors,
        NULL::TEXT AS kitten_assessment_notes,
        NULL::TEXT AS not_assessing_reason,
        NULL::TEXT AS kitten_assessed_by,
        NULL::TIMESTAMPTZ AS kitten_assessed_at,
        r.is_being_fed,
        r.feeder_name,
        r.feeding_frequency AS feeding_schedule,
        r.best_times_seen,
        r.urgency_reasons,
        r.urgency_deadline,
        r.urgency_notes,
        r.best_contact_times,
        -- Hold tracking
        r.hold_reason::TEXT,
        NULL::TEXT AS hold_reason_notes,
        NULL::TIMESTAMPTZ AS hold_started_at,
        -- Activity tracking
        r.last_activity_at,
        NULL::TEXT AS last_activity_type,
        -- Redirect/Handoff fields (V2: not tracked separately)
        NULL::UUID AS redirected_to_request_id,
        NULL::UUID AS redirected_from_request_id,
        NULL::TEXT AS redirect_reason,
        NULL::TIMESTAMPTZ AS redirect_at,
        r.transfer_type,
        -- Place info (use address if place name matches requester name)
        r.place_id,
        CASE
          WHEN p.display_name IS NOT NULL AND per.display_name IS NOT NULL
            AND LOWER(TRIM(p.display_name)) = LOWER(TRIM(per.display_name))
          THEN COALESCE(SPLIT_PART(p.formatted_address, ',', 1), p.formatted_address)
          ELSE COALESCE(p.display_name, SPLIT_PART(p.formatted_address, ',', 1))
        END AS place_name,
        p.formatted_address AS place_address,
        p.place_kind::TEXT,
        NULL::TEXT AS place_safety_notes,
        NULL::TEXT[] AS place_safety_concerns,
        p.service_zone AS place_service_zone,
        sa.city AS place_city,
        sa.postal_code AS place_postal_code,
        CASE WHEN p.location IS NOT NULL THEN
            jsonb_build_object(
                'lat', ST_Y(p.location::geometry),
                'lng', ST_X(p.location::geometry)
            )
        ELSE NULL END AS place_coordinates,
        -- Requester info (include contact details)
        r.requester_person_id,
        per.display_name AS requester_name,
        (SELECT COALESCE(pi.id_value_raw, pi.id_value_norm) FROM sot.person_identifiers pi
         WHERE pi.person_id = r.requester_person_id AND pi.id_type = 'email'
           AND pi.confidence >= 0.5
         ORDER BY pi.confidence DESC NULLS LAST LIMIT 1) AS requester_email,
        (SELECT COALESCE(pi.id_value_raw, pi.id_value_norm) FROM sot.person_identifiers pi
         WHERE pi.person_id = r.requester_person_id AND pi.id_type = 'phone'
           AND pi.confidence >= 0.5
         ORDER BY pi.confidence DESC NULLS LAST LIMIT 1) AS requester_phone,
        r.requester_role_at_submission,
        r.requester_is_site_contact,
        -- Site contact info (MIG_2522 - may be same as requester or different)
        r.site_contact_person_id,
        sc.display_name AS site_contact_name,
        (SELECT COALESCE(pi.id_value_raw, pi.id_value_norm) FROM sot.person_identifiers pi
         WHERE pi.person_id = r.site_contact_person_id AND pi.id_type = 'email'
           AND pi.confidence >= 0.5
         ORDER BY pi.confidence DESC NULLS LAST LIMIT 1) AS site_contact_email,
        (SELECT COALESCE(pi.id_value_raw, pi.id_value_norm) FROM sot.person_identifiers pi
         WHERE pi.person_id = r.site_contact_person_id AND pi.id_type = 'phone'
           AND pi.confidence >= 0.5
         ORDER BY pi.confidence DESC NULLS LAST LIMIT 1) AS site_contact_phone,
        -- Linked cats (V2: uses request_cats table)
        (SELECT jsonb_agg(jsonb_build_object(
            'cat_id', COALESCE(c.merged_into_cat_id, c.cat_id),
            'cat_name', COALESCE(canonical_cat.name, c.name),
            'link_purpose', rc.link_type::TEXT,
            'linked_at', rc.created_at,
            'microchip', c.microchip,
            'altered_status', COALESCE(canonical_cat.altered_status, c.altered_status),
            'last_visit_date', (SELECT MAX(a.appointment_date) FROM ops.appointments a
                                WHERE a.cat_id = COALESCE(c.merged_into_cat_id, c.cat_id))
        ) ORDER BY rc.created_at DESC)
         FROM ops.request_cats rc
         JOIN sot.cats c ON c.cat_id = rc.cat_id
         LEFT JOIN sot.cats canonical_cat ON canonical_cat.cat_id = c.merged_into_cat_id
         WHERE rc.request_id = r.request_id) AS cats,
        (SELECT COUNT(*) FROM ops.request_cats rc WHERE rc.request_id = r.request_id) AS linked_cat_count,
        -- Computed scores (V2: functions may not exist, use defaults)
        0 AS readiness_score,
        0 AS urgency_score,
        -- Colony summary
        pcs.colony_size_estimate,
        pcs.verified_altered_count AS colony_verified_altered,
        pcs.estimated_work_remaining AS colony_work_remaining,
        pcs.alteration_rate_pct AS colony_alteration_rate,
        pcs.estimation_method AS colony_estimation_method,
        pcs.has_override AS colony_has_override,
        pcs.colony_override_note,
        -- Flag when verified > reported (needs reconciliation)
        CASE WHEN pcs.verified_altered_count > COALESCE(r.total_cats_reported, 0)
             AND r.total_cats_reported IS NOT NULL
        THEN TRUE ELSE FALSE END AS colony_verified_exceeds_reported,
        -- Email batching (V2: not present)
        FALSE AS ready_to_email,
        NULL::TEXT AS email_summary,
        NULL::UUID AS email_batch_id,
        -- Classification suggestion (V2: not present)
        NULL::TEXT AS suggested_classification,
        NULL::NUMERIC AS classification_confidence,
        NULL::JSONB AS classification_signals,
        NULL::TEXT AS classification_disposition,
        NULL::TIMESTAMPTZ AS classification_suggested_at,
        NULL::TIMESTAMPTZ AS classification_reviewed_at,
        NULL::TEXT AS classification_reviewed_by,
        NULL::TEXT AS current_place_classification,
        -- SC_004: Assignment status (maintained field)
        r.no_trapper_reason,
        r.assignment_status::TEXT,
        -- Call sheet trapping logistics (V2 columns)
        r.dogs_on_site,
        r.trap_savvy,
        r.previous_tnr,
        r.handleability,
        r.fixed_status,
        NULL::TEXT AS ownership_status,
        COALESCE(r.has_medical_concerns, FALSE) AS has_medical_concerns,
        r.medical_description,
        NULL::TEXT[] AS important_notes,
        -- V2 Beacon-critical fields (MIG_2532)
        r.peak_count,
        r.awareness_duration,
        r.county,
        r.is_property_owner,
        r.has_property_access,
        r.feeding_location,
        r.feeding_time,
        r.is_emergency,
        r.cat_name,
        r.cat_description,
        r.kitten_behavior,
        r.kitten_contained,
        r.mom_present,
        r.mom_fixed,
        r.can_bring_in,
        r.kitten_age_estimate,
        r.is_third_party_report,
        r.third_party_relationship,
        r.triage_category,
        r.received_by,
        -- MIG_2817: Additional columns restored from intake form
        r.request_purpose,
        r.request_purposes,
        r.property_owner_phone,
        r.authorization_pending,
        r.kitten_mixed_ages_description,
        r.kitten_notes,
        r.wellness_cat_count,
        r.entry_mode,
        r.completion_data
      FROM ops.requests r
      LEFT JOIN sot.places p ON p.place_id = r.place_id
      LEFT JOIN sot.addresses sa ON sa.address_id = p.sot_address_id
      LEFT JOIN sot.people per ON per.person_id = r.requester_person_id
      LEFT JOIN sot.people sc ON sc.person_id = r.site_contact_person_id
      LEFT JOIN sot.v_place_colony_status pcs ON pcs.place_id = r.place_id
      WHERE r.request_id = $1
    `;

    const requestDetail = await queryOne<RequestDetailRow>(sql, [id]);

    if (!requestDetail) {
      return apiNotFound("Request", id);
    }

    // Fetch status history
    const historySql = `
      SELECT old_status, new_status, changed_by, changed_at, reason
      FROM ops.request_status_history
      WHERE request_id = $1
      ORDER BY changed_at DESC
      LIMIT 20
    `;

    let statusHistory: object[] = [];
    try {
      statusHistory = await queryRows(historySql, [id]);
    } catch {
      // Table might not exist yet
    }

    // Fetch current trappers from the proper assignment table
    // This is the source of truth (assigned_to field is deprecated)
    // V2: Uses status='active' instead of unassigned_at IS NULL
    // V2: Uses assignment_type='primary' instead of is_primary boolean
    let currentTrappers: CurrentTrapper[] = [];
    try {
      currentTrappers = await queryRows<CurrentTrapper>(
        `SELECT
          rta.trapper_person_id,
          p.display_name AS trapper_name,
          pr.trapper_type::TEXT,
          pr.trapper_type IN ('coordinator', 'head_trapper', 'ffsc_trapper') AS is_ffsc_trapper,
          COALESCE(rta.assignment_type = 'primary', false) AS is_primary,
          rta.assigned_at::TEXT
        FROM ops.request_trapper_assignments rta
        JOIN sot.people p ON p.person_id = rta.trapper_person_id
        LEFT JOIN sot.person_roles pr ON pr.person_id = rta.trapper_person_id AND pr.role = 'trapper'
        WHERE rta.request_id = $1
          AND rta.status = 'active'
        ORDER BY (rta.assignment_type = 'primary') DESC, rta.assigned_at`,
        [id]
      );
    } catch (err) {
      console.error("Error fetching trappers:", err);
      // Table might not exist yet or query error
    }

    return apiSuccess({
      ...requestDetail,
      status_history: statusHistory,
      // Current trappers from the proper assignment system (source of truth)
      current_trappers: currentTrappers,
      // Note: assigned_to field is deprecated, use current_trappers instead
    });
  } catch (error) {
    // Handle validation errors from requireValidUUID
    if (error instanceof Error && error.name === "ApiError") {
      return apiError(error.message, (error as { status?: number }).status || 400);
    }
    console.error("Error fetching request detail:", error);
    return apiServerError("Failed to fetch request detail");
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    requireValidUUID(id, "request");

    // Validate request body with Zod schema (validates enums, allows passthrough for extra fields)
    const parsed = await parseBody(request, UpdateRequestSchema);
    if ("error" in parsed) return parsed.error;
    const body = parsed.data;

    // Check for trip report requirement when completing a request
    // FFS-155: Only enforce for 'successful' outcome. Other outcomes skip the check.
    // Skip if the completion flow is providing observation data directly
    // or if explicitly requested to skip (close case modal handles this)
    const outcomeRequiresTripReport = !body.resolution_outcome || body.resolution_outcome === "successful";
    if (body.status === "completed" && !body.skip_trip_report_check && outcomeRequiresTripReport) {
      // Check if request requires a trip report
      const reportCheck = await queryOne<{
        report_required_before_complete: boolean;
        has_final_report: boolean;
        has_site_observation: boolean;
      }>(
        `SELECT
          COALESCE(r.report_required_before_complete, TRUE) as report_required_before_complete,
          EXISTS (
            SELECT 1 FROM ops.trapper_trip_reports tr
            WHERE tr.request_id = r.request_id AND tr.is_final_visit = TRUE
          ) as has_final_report,
          EXISTS (
            SELECT 1 FROM ops.site_observations so
            WHERE so.request_id = r.request_id AND so.is_final_visit = TRUE
          ) as has_site_observation
        FROM ops.requests r
        WHERE r.request_id = $1`,
        [id]
      );

      // Only block if no final report AND no final site observation AND not providing observation data now
      const hasObservationData = body.observation_cats_seen !== undefined && body.observation_cats_seen !== null;
      if (
        reportCheck?.report_required_before_complete &&
        !reportCheck?.has_final_report &&
        !reportCheck?.has_site_observation &&
        !hasObservationData
      ) {
        return apiBadRequest("Trip report required before completion. Please submit a final site visit observation or use the Close Case modal to complete this request.");
      }
    }

    // Get current request data for audit comparison (V2 columns only)
    const currentSql = `
      SELECT status::TEXT, priority::TEXT, summary, notes, estimated_cat_count,
             has_kittens, hold_reason::TEXT, resolution, access_notes,
             kitten_count, no_trapper_reason
      FROM ops.requests WHERE request_id = $1
    `;
    const current = await queryOne<{
      status: string | null;
      priority: string | null;
      summary: string | null;
      notes: string | null;
      estimated_cat_count: number | null;
      has_kittens: boolean | null;
      hold_reason: string | null;
      resolution: string | null;
      access_notes: string | null;
      kitten_count: number | null;
      no_trapper_reason: string | null;
    }>(currentSql, [id]);

    if (!current) {
      return apiNotFound("Request", id);
    }

    // Track changes for audit logging
    const auditChanges: Array<{ field: string; oldValue: unknown; newValue: unknown }> = [];

    // Build dynamic update query
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (body.status !== undefined && body.status !== current.status) {
      auditChanges.push({ field: "status", oldValue: current.status, newValue: body.status });
      updates.push(`status = $${paramIndex}`);
      values.push(body.status);
      paramIndex++;

      // If moving out of paused/on_hold, clear hold_reason
      // (hold_started_at and hold_reason_notes are V1 columns, not in V2)
      if (body.status !== "paused" && body.status !== "on_hold") {
        updates.push(`hold_reason = NULL`);
      }
    }

    if (body.priority !== undefined && body.priority !== current.priority) {
      auditChanges.push({ field: "priority", oldValue: current.priority, newValue: body.priority });
      updates.push(`priority = $${paramIndex}`);
      values.push(body.priority);
      paramIndex++;
    }

    if (body.summary !== undefined) {
      updates.push(`summary = $${paramIndex}`);
      values.push(body.summary || null);
      paramIndex++;
    }

    if (body.notes !== undefined) {
      updates.push(`notes = $${paramIndex}`);
      values.push(body.notes || null);
      paramIndex++;
    }

    if (body.estimated_cat_count !== undefined) {
      updates.push(`estimated_cat_count = $${paramIndex}`);
      values.push(body.estimated_cat_count);
      paramIndex++;
    }

    if (body.has_kittens !== undefined) {
      updates.push(`has_kittens = $${paramIndex}`);
      values.push(body.has_kittens);
      paramIndex++;
    }

    // Resolution notes (FFS-155) — body sends `resolution_notes`, DB column is `resolution`
    if (body.resolution_notes !== undefined) {
      if (body.resolution_notes === null) {
        updates.push(`resolution = NULL`);
      } else {
        updates.push(`resolution = $${paramIndex}`);
        values.push(body.resolution_notes);
        paramIndex++;
      }
    }

    // Resolution reason (FFS-155)
    if (body.resolution_reason !== undefined) {
      if (body.resolution_reason === null) {
        updates.push(`resolution_reason = NULL`);
      } else {
        updates.push(`resolution_reason = $${paramIndex}`);
        values.push(body.resolution_reason);
        paramIndex++;
      }
    }

    // V1 columns that are silently ignored (no DB column or deprecated):
    // - cats_are_friendly, preferred_contact_method, assigned_to, assigned_trapper_type
    // - assignment_notes, scheduled_date, scheduled_time_range
    // - cats_trapped, cats_returned
    // - permission_status, traps_overnight_safe, access_without_contact
    // - urgency_reasons, urgency_deadline, urgency_notes, kitten_age_weeks
    // - kitten_assessment_status, kitten_assessment_outcome
    // Use POST /api/requests/[id]/trappers for trapper assignment

    // Hold management (hold_reason + hold_reason_notes exist in V2 via MIG_2495)
    if (body.hold_reason !== undefined && body.hold_reason !== current.hold_reason) {
      auditChanges.push({ field: "hold_reason", oldValue: current.hold_reason, newValue: body.hold_reason });
      if (body.hold_reason === null) {
        updates.push(`hold_reason = NULL`);
      } else {
        updates.push(`hold_reason = $${paramIndex}`);
        values.push(body.hold_reason);
        paramIndex++;
      }
    }

    // Hold reason notes (MIG_2495 column, used by HoldRequestModal)
    if (body.hold_reason_notes !== undefined) {
      if (body.hold_reason_notes === null) {
        updates.push(`hold_reason_notes = NULL`);
      } else {
        updates.push(`hold_reason_notes = $${paramIndex}`);
        values.push(body.hold_reason_notes);
        paramIndex++;
      }
    }

    // Resolution outcome (FFS-155)
    if (body.resolution_outcome !== undefined) {
      if (body.resolution_outcome === null) {
        updates.push(`resolution_outcome = NULL`);
      } else {
        updates.push(`resolution_outcome = $${paramIndex}`);
        values.push(body.resolution_outcome);
        paramIndex++;
      }
    }

    // V2 columns that exist
    if (body.access_notes !== undefined) {
      updates.push(`access_notes = $${paramIndex}`);
      values.push(body.access_notes || null);
      paramIndex++;
    }

    // Kitten count (V2 column)
    if (body.kitten_count !== undefined) {
      updates.push(`kitten_count = $${paramIndex}`);
      values.push(body.kitten_count);
      paramIndex++;
    }

    // V1 kitten assessment columns dropped (kitten_foster_readiness, kitten_urgency_factors,
    // kitten_assessment_notes, not_assessing_reason, ready_to_email, email_summary)
    // These were never populated in V2 schema

    // SC_004: no_trapper_reason with assignment_status sync
    if (body.no_trapper_reason !== undefined) {
      if (body.no_trapper_reason === null) {
        // Clearing reason — assignment_status reverts based on active trappers
        updates.push(`no_trapper_reason = NULL`);
        // Check if request has active trappers to determine assignment_status
        updates.push(`assignment_status = CASE
          WHEN (SELECT COUNT(*) FROM ops.request_trapper_assignments
                WHERE request_id = $${paramIndex} AND unassigned_at IS NULL) > 0
          THEN 'assigned' ELSE 'pending' END`);
        values.push(id);
        paramIndex++;
      } else {
        updates.push(`no_trapper_reason = $${paramIndex}`);
        values.push(body.no_trapper_reason);
        paramIndex++;
        // Sync assignment_status: client_trapping gets its own status,
        // others stay pending (unless active trappers exist, in which case 'assigned')
        if (body.no_trapper_reason === "client_trapping") {
          updates.push(`assignment_status = 'client_trapping'`);
        }
        // Other reasons (not_needed, has_community_help, etc.) keep pending/assigned as-is
      }
      auditChanges.push({
        field: "no_trapper_reason",
        oldValue: null, // We don't fetch old value here; audit captures the change
        newValue: body.no_trapper_reason,
      });
    }

    // ==========================================================================
    // MIG_2531/2532: New fields for Beacon-critical data and intake unification
    // ==========================================================================

    // Beacon-critical fields
    if (body.peak_count !== undefined) {
      updates.push(`peak_count = $${paramIndex}`);
      values.push(body.peak_count);
      paramIndex++;
    }

    if (body.awareness_duration !== undefined) {
      updates.push(`awareness_duration = $${paramIndex}`);
      values.push(body.awareness_duration);
      paramIndex++;
    }

    if (body.county !== undefined) {
      updates.push(`county = $${paramIndex}`);
      values.push(body.county);
      paramIndex++;
    }

    // Property/Access
    if (body.is_property_owner !== undefined) {
      updates.push(`is_property_owner = $${paramIndex}`);
      values.push(body.is_property_owner);
      paramIndex++;
    }

    if (body.has_property_access !== undefined) {
      updates.push(`has_property_access = $${paramIndex}`);
      values.push(body.has_property_access);
      paramIndex++;
    }

    if (body.property_type !== undefined) {
      updates.push(`property_type = $${paramIndex}`);
      values.push(body.property_type);
      paramIndex++;
    }

    if (body.colony_duration !== undefined) {
      updates.push(`colony_duration = $${paramIndex}`);
      values.push(body.colony_duration);
      paramIndex++;
    }

    // Feeding
    if (body.is_being_fed !== undefined) {
      updates.push(`is_being_fed = $${paramIndex}`);
      values.push(body.is_being_fed);
      paramIndex++;
    }

    if (body.feeder_name !== undefined) {
      updates.push(`feeder_name = $${paramIndex}`);
      values.push(body.feeder_name);
      paramIndex++;
    }

    if (body.feeding_frequency !== undefined) {
      updates.push(`feeding_frequency = $${paramIndex}`);
      values.push(body.feeding_frequency);
      paramIndex++;
    }

    if (body.feeding_location !== undefined) {
      updates.push(`feeding_location = $${paramIndex}`);
      values.push(body.feeding_location);
      paramIndex++;
    }

    if (body.feeding_time !== undefined) {
      updates.push(`feeding_time = $${paramIndex}`);
      values.push(body.feeding_time);
      paramIndex++;
    }

    // Medical/Emergency
    if (body.is_emergency !== undefined) {
      updates.push(`is_emergency = $${paramIndex}`);
      values.push(body.is_emergency);
      paramIndex++;
    }

    if (body.has_medical_concerns !== undefined) {
      updates.push(`has_medical_concerns = $${paramIndex}`);
      values.push(body.has_medical_concerns);
      paramIndex++;
    }

    if (body.medical_description !== undefined) {
      updates.push(`medical_description = $${paramIndex}`);
      values.push(body.medical_description);
      paramIndex++;
    }

    // Cat description
    if (body.cat_name !== undefined) {
      updates.push(`cat_name = $${paramIndex}`);
      values.push(body.cat_name);
      paramIndex++;
    }

    if (body.cat_description !== undefined) {
      updates.push(`cat_description = $${paramIndex}`);
      values.push(body.cat_description);
      paramIndex++;
    }

    // Enhanced kitten tracking
    if (body.kitten_behavior !== undefined) {
      updates.push(`kitten_behavior = $${paramIndex}`);
      values.push(body.kitten_behavior);
      paramIndex++;
    }

    if (body.kitten_contained !== undefined) {
      updates.push(`kitten_contained = $${paramIndex}`);
      values.push(body.kitten_contained);
      paramIndex++;
    }

    if (body.mom_present !== undefined) {
      updates.push(`mom_present = $${paramIndex}`);
      values.push(body.mom_present);
      paramIndex++;
    }

    if (body.mom_fixed !== undefined) {
      updates.push(`mom_fixed = $${paramIndex}`);
      values.push(body.mom_fixed);
      paramIndex++;
    }

    if (body.can_bring_in !== undefined) {
      updates.push(`can_bring_in = $${paramIndex}`);
      values.push(body.can_bring_in);
      paramIndex++;
    }

    if (body.kitten_age_estimate !== undefined) {
      updates.push(`kitten_age_estimate = $${paramIndex}`);
      values.push(body.kitten_age_estimate);
      paramIndex++;
    }

    // Third-party reporter (MIG_2522)
    if (body.is_third_party_report !== undefined) {
      updates.push(`is_third_party_report = $${paramIndex}`);
      values.push(body.is_third_party_report);
      paramIndex++;
    }

    if (body.third_party_relationship !== undefined) {
      updates.push(`third_party_relationship = $${paramIndex}`);
      values.push(body.third_party_relationship);
      paramIndex++;
    }

    // Trapping logistics
    if (body.best_trapping_time !== undefined) {
      updates.push(`best_trapping_time = $${paramIndex}`);
      values.push(body.best_trapping_time);
      paramIndex++;
    }

    if (body.dogs_on_site !== undefined) {
      updates.push(`dogs_on_site = $${paramIndex}`);
      values.push(body.dogs_on_site);
      paramIndex++;
    }

    if (body.trap_savvy !== undefined) {
      updates.push(`trap_savvy = $${paramIndex}`);
      values.push(body.trap_savvy);
      paramIndex++;
    }

    if (body.previous_tnr !== undefined) {
      updates.push(`previous_tnr = $${paramIndex}`);
      values.push(body.previous_tnr);
      paramIndex++;
    }

    // Triage
    if (body.triage_category !== undefined) {
      updates.push(`triage_category = $${paramIndex}`);
      values.push(body.triage_category);
      paramIndex++;
    }

    if (body.received_by !== undefined) {
      updates.push(`received_by = $${paramIndex}`);
      values.push(body.received_by);
      paramIndex++;
    }

    // Handle status changes that trigger resolved_at
    if (body.status === "completed" || body.status === "cancelled" || body.status === "partial") {
      updates.push(`resolved_at = COALESCE(resolved_at, NOW())`);
    }

    // Clear resolution_outcome when reopening (FFS-155: Jira pattern — cleared on reopen)
    if (body.status && body.status !== "completed" && body.status !== "cancelled" && body.status !== "partial") {
      // Only clear if the request was previously resolved
      if (current.status === "completed" || current.status === "cancelled" || current.status === "partial") {
        updates.push(`resolution_outcome = NULL`);
        updates.push(`resolved_at = NULL`);
      }
    }

    if (updates.length === 0) {
      return apiBadRequest("No valid fields to update");
    }

    // Add updated_at
    updates.push(`updated_at = NOW()`);

    // Log changes to centralized entity_edits table
    if (auditChanges.length > 0) {
      try {
        await logFieldEdits("request", id, auditChanges, {
          editedBy: "web_user",
          editSource: "web_ui",
        });
      } catch (auditErr) {
        console.error("[PATCH request] logFieldEdits failed:", auditErr);
      }
    }

    // Add request_id to values
    values.push(id);

    const sql = `
      UPDATE ops.requests
      SET ${updates.join(", ")}
      WHERE request_id = $${paramIndex}
      RETURNING request_id, status::TEXT, priority::TEXT, updated_at
    `;

    const result = await queryOne<{
      request_id: string;
      status: string;
      priority: string;
      updated_at: string;
    }>(sql, values);

    if (!result) {
      return apiNotFound("Request", id);
    }

    // If request was completed/partial with observation data, record colony estimate (FFS-155)
    // Uses V2 table sot.place_colony_estimates (MIG_2029 schema)
    let observationCreated = false;
    if (
      (body.status === "completed" || body.status === "partial") &&
      body.observation_cats_seen !== undefined &&
      body.observation_cats_seen !== null &&
      body.observation_cats_seen > 0
    ) {
      try {
        const placeResult = await queryOne<{ place_id: string | null }>(
          `SELECT place_id FROM ops.requests WHERE request_id = $1`,
          [id]
        );

        if (placeResult?.place_id) {
          await query(
            `INSERT INTO sot.place_colony_estimates (
              place_id,
              total_count_observed,
              eartip_count_observed,
              observed_date,
              observer_notes,
              estimate_method,
              source_system
            ) VALUES (
              $1, $2, $3, CURRENT_DATE, $4,
              'direct_count',
              'atlas_ui'
            )`,
            [
              placeResult.place_id,
              body.observation_cats_seen,
              body.observation_eartips_seen || 0,
              body.observation_notes || `Colony count at request completion`,
            ]
          );
          observationCreated = true;
        }
      } catch (obsErr) {
        // Don't fail the request closure if observation insert fails
        console.error("[completion] Colony estimate insert failed:", obsErr);
      }
    }

    // Revalidate cached pages that show request data
    revalidatePath("/"); // Dashboard
    revalidatePath("/requests"); // Requests list
    revalidatePath(`/requests/${id}`); // Request detail

    return apiSuccess({
      request: result,
      observation_created: observationCreated,
    });
  } catch (error) {
    // Handle validation errors from requireValidUUID
    if (error instanceof Error && error.name === "ApiError") {
      return apiError(error.message, (error as { status?: number }).status || 400);
    }
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("Error updating request:", errMsg, error);
    // Keep error detail for debugging but don't expose raw SQL to users
    return apiServerError("Failed to update request");
  }
}
