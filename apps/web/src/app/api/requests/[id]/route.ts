import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { query, queryOne, queryRows } from "@/lib/db";
import { logFieldEdits } from "@/lib/audit";

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
  cats_trapped: number | null;
  cats_returned: number | null;
  data_source: string;
  source_system: string | null;
  source_record_id: string | null;
  source_created_at: string | null;
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
}

// Validate UUID format
function isValidUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Request ID is required" },
      { status: 400 }
    );
  }

  // Validate UUID format before querying - legacy Airtable IDs (recXXX) are not valid
  if (!isValidUUID(id)) {
    return NextResponse.json(
      { error: "Request not found", details: "Invalid request ID format" },
      { status: 404 }
    );
  }

  try {
    // Query request with all fields including new operational ones
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
        r.has_kittens,
        r.cats_are_friendly,
        r.preferred_contact_method,
        r.assigned_to,
        r.assigned_trapper_type::TEXT,
        r.assigned_at,
        r.assignment_notes,
        r.scheduled_date,
        r.scheduled_time_range,
        r.resolved_at,
        r.resolution_notes,
        r.cats_trapped,
        r.cats_returned,
        r.data_source::TEXT,
        r.source_system,
        r.source_record_id,
        r.source_created_at,
        r.created_by,
        r.created_at,
        r.updated_at,
        -- Enhanced intake fields
        r.permission_status::TEXT,
        r.property_owner_contact,
        r.access_notes,
        r.traps_overnight_safe,
        r.access_without_contact,
        r.property_type::TEXT,
        r.colony_duration::TEXT,
        r.location_description,
        r.eartip_count,
        r.eartip_estimate::TEXT,
        r.count_confidence::TEXT,
        r.kitten_count,
        r.kitten_age_weeks,
        r.kitten_assessment_status,
        r.kitten_assessment_outcome,
        r.kitten_foster_readiness,
        r.kitten_urgency_factors,
        r.kitten_assessment_notes,
        r.not_assessing_reason,
        r.kitten_assessed_by,
        r.kitten_assessed_at,
        r.is_being_fed,
        r.feeder_name,
        r.feeding_schedule,
        r.best_times_seen,
        r.urgency_reasons,
        r.urgency_deadline,
        r.urgency_notes,
        r.best_contact_times,
        -- Hold tracking
        r.hold_reason::TEXT,
        r.hold_reason_notes,
        r.hold_started_at,
        -- Activity tracking
        r.last_activity_at,
        r.last_activity_type,
        -- Redirect/Handoff fields
        r.redirected_to_request_id,
        r.redirected_from_request_id,
        r.redirect_reason,
        r.redirect_at,
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
        p.safety_notes AS place_safety_notes,
        p.safety_concerns AS place_safety_concerns,
        p.service_zone AS place_service_zone,
        sa.locality AS place_city,
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
        (SELECT COALESCE(pi.id_value_raw, pi.id_value_norm) FROM trapper.person_identifiers pi
         WHERE pi.person_id = r.requester_person_id AND pi.id_type = 'email'
         ORDER BY pi.confidence DESC NULLS LAST LIMIT 1) AS requester_email,
        (SELECT COALESCE(pi.id_value_raw, pi.id_value_norm) FROM trapper.person_identifiers pi
         WHERE pi.person_id = r.requester_person_id AND pi.id_type = 'phone'
         ORDER BY pi.confidence DESC NULLS LAST LIMIT 1) AS requester_phone,
        -- Linked cats (from request_cat_links table, following merge chains)
        (SELECT jsonb_agg(jsonb_build_object(
            'cat_id', COALESCE(c.merged_into_cat_id, c.cat_id),
            'cat_name', COALESCE(canonical_cat.display_name, c.display_name),
            'link_purpose', rcl.link_purpose::TEXT,
            'linked_at', rcl.linked_at,
            'microchip', (SELECT ci.id_value FROM trapper.cat_identifiers ci
                          WHERE ci.cat_id = COALESCE(c.merged_into_cat_id, c.cat_id)
                          AND ci.id_type = 'microchip' LIMIT 1),
            'altered_status', COALESCE(canonical_cat.altered_status, c.altered_status)
        ) ORDER BY rcl.linked_at DESC)
         FROM trapper.request_cat_links rcl
         JOIN trapper.sot_cats c ON c.cat_id = rcl.cat_id
         LEFT JOIN trapper.sot_cats canonical_cat ON canonical_cat.cat_id = c.merged_into_cat_id
         WHERE rcl.request_id = r.request_id) AS cats,
        (SELECT COUNT(*) FROM trapper.request_cat_links rcl WHERE rcl.request_id = r.request_id) AS linked_cat_count,
        -- Computed scores (handle if functions don't exist yet)
        COALESCE(trapper.compute_request_readiness(r), 0) AS readiness_score,
        COALESCE(trapper.compute_request_urgency(r), 0) AS urgency_score,
        -- Colony summary (MIG_562)
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
        -- Email batching (MIG_605)
        r.ready_to_email,
        r.email_summary,
        r.email_batch_id,
        -- Classification suggestion (MIG_622)
        r.suggested_classification::TEXT,
        r.classification_confidence,
        r.classification_signals,
        r.classification_disposition,
        r.classification_suggested_at,
        r.classification_reviewed_at,
        r.classification_reviewed_by,
        p.colony_classification::TEXT AS current_place_classification,
        -- SC_004: Assignment status (maintained field)
        r.no_trapper_reason,
        r.assignment_status::TEXT
      FROM trapper.sot_requests r
      LEFT JOIN trapper.places p ON p.place_id = r.place_id
      LEFT JOIN trapper.sot_addresses sa ON sa.address_id = p.sot_address_id
      LEFT JOIN trapper.sot_people per ON per.person_id = r.requester_person_id
      LEFT JOIN trapper.v_place_colony_status pcs ON pcs.place_id = r.place_id
      WHERE r.request_id = $1
    `;

    const requestDetail = await queryOne<RequestDetailRow>(sql, [id]);

    if (!requestDetail) {
      return NextResponse.json(
        { error: "Request not found" },
        { status: 404 }
      );
    }

    // Fetch status history
    const historySql = `
      SELECT old_status, new_status, changed_by, changed_at, reason
      FROM trapper.request_status_history
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
    let currentTrappers: CurrentTrapper[] = [];
    try {
      currentTrappers = await queryRows<CurrentTrapper>(
        `SELECT
          rta.trapper_person_id,
          p.display_name AS trapper_name,
          pr.trapper_type::TEXT,
          pr.trapper_type IN ('coordinator', 'head_trapper', 'ffsc_trapper') AS is_ffsc_trapper,
          rta.is_primary,
          rta.assigned_at
        FROM trapper.request_trapper_assignments rta
        JOIN trapper.sot_people p ON p.person_id = rta.trapper_person_id
        LEFT JOIN trapper.person_roles pr ON pr.person_id = rta.trapper_person_id AND pr.role = 'trapper'
        WHERE rta.request_id = $1
          AND rta.unassigned_at IS NULL
        ORDER BY rta.is_primary DESC, rta.assigned_at`,
        [id]
      );
    } catch {
      // Table might not exist yet
    }

    return NextResponse.json({
      ...requestDetail,
      status_history: statusHistory,
      // Current trappers from the proper assignment system (source of truth)
      current_trappers: currentTrappers,
      // Note: assigned_to field is deprecated, use current_trappers instead
    });
  } catch (error) {
    console.error("Error fetching request detail:", error);
    return NextResponse.json(
      { error: "Failed to fetch request detail" },
      { status: 500 }
    );
  }
}

// Valid status and priority values (including new ones from MIG_182)
const VALID_STATUSES = [
  "new",
  "needs_review",
  "triaged",
  "scheduled",
  "in_progress",
  "active",
  "on_hold",
  "completed",
  "partial",
  "cancelled",
  "redirected",
];
const VALID_PRIORITIES = ["urgent", "high", "normal", "low"];
const VALID_HOLD_REASONS = [
  "weather",
  "callback_pending",
  "access_issue",
  "resource_constraint",
  "client_unavailable",
  "scheduling_conflict",
  "trap_shy",
  "other",
];
const VALID_TRAPPER_TYPES = [
  "coordinator",
  "head_trapper",
  "ffsc_trapper",
  "community_trapper",
  "volunteer",
];
// SC_004: Valid no_trapper_reason values (matches CHECK constraint on sot_requests)
const VALID_NO_TRAPPER_REASONS = [
  "client_trapping",
  "has_community_help",
  "not_needed",
  "pending_assignment",
  "no_capacity",
];

interface UpdateRequestBody {
  status?: string;
  priority?: string;
  summary?: string;
  notes?: string;
  estimated_cat_count?: number;
  has_kittens?: boolean;
  cats_are_friendly?: boolean;
  preferred_contact_method?: string;
  assigned_to?: string;
  assigned_trapper_type?: string;
  assignment_notes?: string;
  scheduled_date?: string;
  scheduled_time_range?: string;
  resolution_notes?: string;
  resolution_reason?: string;
  cats_trapped?: number;
  cats_returned?: number;
  // Hold management
  hold_reason?: string | null;
  hold_reason_notes?: string;
  // Enhanced intake fields
  permission_status?: string;
  access_notes?: string;
  traps_overnight_safe?: boolean;
  access_without_contact?: boolean;
  urgency_reasons?: string[];
  urgency_deadline?: string;
  urgency_notes?: string;
  // Kitten assessment fields
  kitten_count?: number | null;
  kitten_age_weeks?: number | null;
  kitten_assessment_status?: string | null;
  kitten_assessment_outcome?: string | null;
  kitten_foster_readiness?: string | null;
  kitten_urgency_factors?: string[] | null;
  kitten_assessment_notes?: string | null;
  not_assessing_reason?: string | null;
  // Observation data (for completing requests)
  observation_cats_seen?: number | null;
  observation_eartips_seen?: number | null;
  observation_notes?: string | null;
  // Skip trip report check (for completion flow)
  skip_trip_report_check?: boolean;
  // Email batching (MIG_605)
  ready_to_email?: boolean;
  email_summary?: string;
  // SC_004: No trapper reason (syncs assignment_status)
  no_trapper_reason?: string | null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Request ID is required" },
      { status: 400 }
    );
  }

  try {
    const body: UpdateRequestBody = await request.json();

    // Validate status if provided
    if (body.status && !VALID_STATUSES.includes(body.status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` },
        { status: 400 }
      );
    }

    // Check for trip report requirement when completing a request
    // Skip this check if the completion flow is providing observation data directly
    // or if explicitly requested to skip (completion modal handles this)
    if (body.status === "completed" && !body.skip_trip_report_check) {
      // Check if request requires a trip report
      const reportCheck = await queryOne<{
        report_required_before_complete: boolean;
        has_final_report: boolean;
        has_site_observation: boolean;
      }>(
        `SELECT
          COALESCE(r.report_required_before_complete, TRUE) as report_required_before_complete,
          EXISTS (
            SELECT 1 FROM trapper.trapper_trip_reports tr
            WHERE tr.request_id = r.request_id AND tr.is_final_visit = TRUE
          ) as has_final_report,
          EXISTS (
            SELECT 1 FROM trapper.site_observations so
            WHERE so.request_id = r.request_id AND so.is_final_visit = TRUE
          ) as has_site_observation
        FROM trapper.sot_requests r
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
        return NextResponse.json(
          {
            error: "Trip report required before completion",
            requiresReport: true,
            message: "Please submit a final site visit observation or use the completion modal to complete this request.",
          },
          { status: 400 }
        );
      }
    }

    // Validate priority if provided
    if (body.priority && !VALID_PRIORITIES.includes(body.priority)) {
      return NextResponse.json(
        { error: `Invalid priority. Must be one of: ${VALID_PRIORITIES.join(", ")}` },
        { status: 400 }
      );
    }

    // Validate hold_reason if provided
    if (body.hold_reason && !VALID_HOLD_REASONS.includes(body.hold_reason)) {
      return NextResponse.json(
        { error: `Invalid hold_reason. Must be one of: ${VALID_HOLD_REASONS.join(", ")}` },
        { status: 400 }
      );
    }

    // Validate trapper type if provided
    if (body.assigned_trapper_type && !VALID_TRAPPER_TYPES.includes(body.assigned_trapper_type)) {
      return NextResponse.json(
        { error: `Invalid assigned_trapper_type. Must be one of: ${VALID_TRAPPER_TYPES.join(", ")}` },
        { status: 400 }
      );
    }

    // SC_004: Validate no_trapper_reason if provided (non-null)
    if (body.no_trapper_reason !== undefined && body.no_trapper_reason !== null
        && !VALID_NO_TRAPPER_REASONS.includes(body.no_trapper_reason)) {
      return NextResponse.json(
        { error: `Invalid no_trapper_reason. Must be one of: ${VALID_NO_TRAPPER_REASONS.join(", ")}` },
        { status: 400 }
      );
    }

    // Get current request data for audit comparison
    const currentSql = `
      SELECT status::TEXT, priority::TEXT, summary, notes, estimated_cat_count,
             has_kittens, cats_are_friendly, assigned_to, assigned_trapper_type::TEXT,
             scheduled_date::TEXT, scheduled_time_range, hold_reason::TEXT, hold_reason_notes,
             cats_trapped, cats_returned, resolution_notes, permission_status::TEXT,
             access_notes, traps_overnight_safe, access_without_contact,
             kitten_count, kitten_age_weeks, kitten_assessment_status
      FROM trapper.sot_requests WHERE request_id = $1
    `;
    const current = await queryOne<{
      status: string | null;
      priority: string | null;
      summary: string | null;
      notes: string | null;
      estimated_cat_count: number | null;
      has_kittens: boolean | null;
      cats_are_friendly: boolean | null;
      assigned_to: string | null;
      assigned_trapper_type: string | null;
      scheduled_date: string | null;
      scheduled_time_range: string | null;
      hold_reason: string | null;
      hold_reason_notes: string | null;
      cats_trapped: number | null;
      cats_returned: number | null;
      resolution_notes: string | null;
      permission_status: string | null;
      access_notes: string | null;
      traps_overnight_safe: boolean | null;
      access_without_contact: boolean | null;
      kitten_count: number | null;
      kitten_age_weeks: number | null;
      kitten_assessment_status: string | null;
    }>(currentSql, [id]);

    if (!current) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }

    // Track changes for audit logging
    const auditChanges: Array<{ field: string; oldValue: unknown; newValue: unknown }> = [];

    // Build dynamic update query
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (body.status !== undefined && body.status !== current.status) {
      auditChanges.push({ field: "status", oldValue: current.status, newValue: body.status });
      updates.push(`status = $${paramIndex}::trapper.request_status`);
      values.push(body.status);
      paramIndex++;

      // If moving to on_hold, set hold_started_at
      if (body.status === "on_hold") {
        updates.push(`hold_started_at = COALESCE(hold_started_at, NOW())`);
      }
      // If moving out of on_hold, clear hold fields
      if (body.status !== "on_hold") {
        updates.push(`hold_started_at = NULL`);
        updates.push(`hold_reason = NULL`);
        updates.push(`hold_reason_notes = NULL`);
      }
    }

    if (body.priority !== undefined && body.priority !== current.priority) {
      auditChanges.push({ field: "priority", oldValue: current.priority, newValue: body.priority });
      updates.push(`priority = $${paramIndex}::trapper.request_priority`);
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

    if (body.cats_are_friendly !== undefined) {
      updates.push(`cats_are_friendly = $${paramIndex}`);
      values.push(body.cats_are_friendly);
      paramIndex++;
    }

    if (body.preferred_contact_method !== undefined) {
      updates.push(`preferred_contact_method = $${paramIndex}`);
      values.push(body.preferred_contact_method || null);
      paramIndex++;
    }

    // DEPRECATED: Use POST /api/requests/[id]/trappers instead
    // This field is kept for backward compatibility with legacy data
    // New code should use the request_trapper_assignments table
    if (body.assigned_to !== undefined && body.assigned_to !== current.assigned_to) {
      auditChanges.push({ field: "assigned_to", oldValue: current.assigned_to, newValue: body.assigned_to || null });
      updates.push(`assigned_to = $${paramIndex}`);
      values.push(body.assigned_to || null);
      paramIndex++;
      // Set assigned_at when assigning
      if (body.assigned_to) {
        updates.push(`assigned_at = COALESCE(assigned_at, NOW())`);
      } else {
        updates.push(`assigned_at = NULL`);
      }
    }

    if (body.assigned_trapper_type !== undefined && body.assigned_trapper_type !== current.assigned_trapper_type) {
      auditChanges.push({ field: "assigned_trapper_type", oldValue: current.assigned_trapper_type, newValue: body.assigned_trapper_type || null });
      updates.push(`assigned_trapper_type = $${paramIndex}::trapper.trapper_type`);
      values.push(body.assigned_trapper_type || null);
      paramIndex++;
    }

    if (body.assignment_notes !== undefined) {
      updates.push(`assignment_notes = $${paramIndex}`);
      values.push(body.assignment_notes || null);
      paramIndex++;
    }

    if (body.scheduled_date !== undefined && body.scheduled_date !== current.scheduled_date) {
      auditChanges.push({ field: "scheduled_date", oldValue: current.scheduled_date, newValue: body.scheduled_date || null });
      updates.push(`scheduled_date = $${paramIndex}`);
      values.push(body.scheduled_date || null);
      paramIndex++;
    }

    if (body.scheduled_time_range !== undefined && body.scheduled_time_range !== current.scheduled_time_range) {
      auditChanges.push({ field: "scheduled_time_range", oldValue: current.scheduled_time_range, newValue: body.scheduled_time_range || null });
      updates.push(`scheduled_time_range = $${paramIndex}`);
      values.push(body.scheduled_time_range || null);
      paramIndex++;
    }

    if (body.resolution_notes !== undefined) {
      updates.push(`resolution_notes = $${paramIndex}`);
      values.push(body.resolution_notes || null);
      paramIndex++;
    }

    if (body.resolution_reason !== undefined) {
      updates.push(`resolution_reason = $${paramIndex}`);
      values.push(body.resolution_reason || null);
      paramIndex++;
    }

    if (body.cats_trapped !== undefined && body.cats_trapped !== current.cats_trapped) {
      auditChanges.push({ field: "cats_trapped", oldValue: current.cats_trapped, newValue: body.cats_trapped });
      updates.push(`cats_trapped = $${paramIndex}`);
      values.push(body.cats_trapped);
      paramIndex++;
    }

    if (body.cats_returned !== undefined && body.cats_returned !== current.cats_returned) {
      auditChanges.push({ field: "cats_returned", oldValue: current.cats_returned, newValue: body.cats_returned });
      updates.push(`cats_returned = $${paramIndex}`);
      values.push(body.cats_returned);
      paramIndex++;
    }

    // Hold management
    if (body.hold_reason !== undefined && body.hold_reason !== current.hold_reason) {
      auditChanges.push({ field: "hold_reason", oldValue: current.hold_reason, newValue: body.hold_reason });
      if (body.hold_reason === null) {
        updates.push(`hold_reason = NULL`);
      } else {
        updates.push(`hold_reason = $${paramIndex}::trapper.hold_reason`);
        values.push(body.hold_reason);
        paramIndex++;
      }
    }

    if (body.hold_reason_notes !== undefined) {
      updates.push(`hold_reason_notes = $${paramIndex}`);
      values.push(body.hold_reason_notes || null);
      paramIndex++;
    }

    // Enhanced intake fields that might be updated
    if (body.permission_status !== undefined) {
      updates.push(`permission_status = $${paramIndex}::trapper.permission_status`);
      values.push(body.permission_status);
      paramIndex++;
    }

    if (body.access_notes !== undefined) {
      updates.push(`access_notes = $${paramIndex}`);
      values.push(body.access_notes || null);
      paramIndex++;
    }

    if (body.traps_overnight_safe !== undefined) {
      updates.push(`traps_overnight_safe = $${paramIndex}`);
      values.push(body.traps_overnight_safe);
      paramIndex++;
    }

    if (body.access_without_contact !== undefined) {
      updates.push(`access_without_contact = $${paramIndex}`);
      values.push(body.access_without_contact);
      paramIndex++;
    }

    if (body.urgency_reasons !== undefined) {
      updates.push(`urgency_reasons = $${paramIndex}`);
      values.push(body.urgency_reasons);
      paramIndex++;
    }

    if (body.urgency_deadline !== undefined) {
      updates.push(`urgency_deadline = $${paramIndex}`);
      values.push(body.urgency_deadline || null);
      paramIndex++;
    }

    if (body.urgency_notes !== undefined) {
      updates.push(`urgency_notes = $${paramIndex}`);
      values.push(body.urgency_notes || null);
      paramIndex++;
    }

    // Kitten assessment fields
    if (body.kitten_count !== undefined) {
      updates.push(`kitten_count = $${paramIndex}`);
      values.push(body.kitten_count);
      paramIndex++;
    }

    if (body.kitten_age_weeks !== undefined) {
      updates.push(`kitten_age_weeks = $${paramIndex}`);
      values.push(body.kitten_age_weeks);
      paramIndex++;
    }

    if (body.kitten_assessment_status !== undefined) {
      updates.push(`kitten_assessment_status = $${paramIndex}`);
      values.push(body.kitten_assessment_status);
      paramIndex++;
    }

    if (body.kitten_assessment_outcome !== undefined) {
      updates.push(`kitten_assessment_outcome = $${paramIndex}`);
      values.push(body.kitten_assessment_outcome);
      paramIndex++;
    }

    if (body.kitten_foster_readiness !== undefined) {
      updates.push(`kitten_foster_readiness = $${paramIndex}`);
      values.push(body.kitten_foster_readiness);
      paramIndex++;
    }

    if (body.kitten_urgency_factors !== undefined) {
      updates.push(`kitten_urgency_factors = $${paramIndex}`);
      values.push(body.kitten_urgency_factors);
      paramIndex++;
    }

    if (body.kitten_assessment_notes !== undefined) {
      updates.push(`kitten_assessment_notes = $${paramIndex}`);
      values.push(body.kitten_assessment_notes);
      paramIndex++;
    }

    // MIG_610: not_assessing_reason
    if (body.not_assessing_reason !== undefined) {
      updates.push(`not_assessing_reason = $${paramIndex}`);
      values.push(body.not_assessing_reason);
      paramIndex++;
    }

    // Email batching (MIG_605)
    if (body.ready_to_email !== undefined) {
      updates.push(`ready_to_email = $${paramIndex}`);
      values.push(body.ready_to_email);
      paramIndex++;
    }

    if (body.email_summary !== undefined) {
      updates.push(`email_summary = $${paramIndex}`);
      values.push(body.email_summary || null);
      paramIndex++;
    }

    // SC_004: no_trapper_reason with assignment_status sync
    if (body.no_trapper_reason !== undefined) {
      if (body.no_trapper_reason === null) {
        // Clearing reason — assignment_status reverts based on active trappers
        updates.push(`no_trapper_reason = NULL`);
        // Check if request has active trappers to determine assignment_status
        updates.push(`assignment_status = CASE
          WHEN (SELECT COUNT(*) FROM trapper.request_trapper_assignments
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

    // Handle status changes that trigger resolved_at
    if (body.status === "completed" || body.status === "cancelled" || body.status === "partial") {
      updates.push(`resolved_at = COALESCE(resolved_at, NOW())`);
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    // Add updated_at
    updates.push(`updated_at = NOW()`);

    // Log changes to centralized entity_edits table
    if (auditChanges.length > 0) {
      await logFieldEdits("request", id, auditChanges, {
        editedBy: "web_user",
        editSource: "web_ui",
      });
    }

    // Add request_id to values
    values.push(id);

    const sql = `
      UPDATE trapper.sot_requests
      SET ${updates.join(", ")}
      WHERE request_id = $${paramIndex}
      RETURNING request_id, status, priority, updated_at
    `;

    const result = await queryOne<{
      request_id: string;
      status: string;
      priority: string;
      updated_at: string;
    }>(sql, values);

    if (!result) {
      return NextResponse.json(
        { error: "Request not found" },
        { status: 404 }
      );
    }

    // If request was completed/partial with observation data, record observation with feedback loop (MIG_563)
    let observationCreated = false;
    let chapmanEstimate: number | null = null;
    if (
      (body.status === "completed" || body.status === "partial") &&
      body.observation_cats_seen !== undefined &&
      body.observation_cats_seen !== null &&
      body.observation_cats_seen > 0
    ) {
      try {
        // Use the new record_completion_observation function which:
        // 1. Creates the observation record
        // 2. Computes Chapman estimate if mark-resight data available
        // 3. Verifies prior estimates against this observation
        // 4. Updates source accuracy statistics
        const obsResult = await queryOne<{ record_completion_observation: string | null }>(
          `SELECT trapper.record_completion_observation($1, $2, $3, $4) AS record_completion_observation`,
          [
            id,
            body.observation_cats_seen,
            body.observation_eartips_seen || 0,
            body.observation_notes || null,
          ]
        );

        if (obsResult?.record_completion_observation) {
          observationCreated = true;

          // Get the Chapman estimate if one was computed
          const estimateResult = await queryOne<{ total_cats: number | null }>(
            `SELECT total_cats FROM trapper.place_colony_estimates WHERE estimate_id = $1`,
            [obsResult.record_completion_observation]
          );
          chapmanEstimate = estimateResult?.total_cats || null;
        }
      } catch (obsErr) {
        // Fall back to simple insert if function doesn't exist yet
        console.error("[completion] record_completion_observation failed, using fallback:", obsErr);

        const placeResult = await queryOne<{ place_id: string | null }>(
          `SELECT place_id FROM trapper.sot_requests WHERE request_id = $1`,
          [id]
        );

        if (placeResult?.place_id) {
          await query(
            `INSERT INTO trapper.place_colony_estimates (
              place_id,
              total_cats_observed,
              eartip_count_observed,
              observation_date,
              notes,
              source_type,
              source_system,
              source_record_id,
              is_firsthand,
              created_by
            ) VALUES (
              $1, $2, $3, CURRENT_DATE, $4,
              'trapper_site_visit',
              'atlas_ui',
              $5,
              TRUE,
              'request_completion'
            )
            ON CONFLICT DO NOTHING`,
            [
              placeResult.place_id,
              body.observation_cats_seen,
              body.observation_eartips_seen || 0,
              body.observation_notes || `Observation logged during request completion`,
              id,
            ]
          );
          observationCreated = true;
        }
      }
    }

    // Revalidate cached pages that show request data
    revalidatePath("/"); // Dashboard
    revalidatePath("/requests"); // Requests list
    revalidatePath(`/requests/${id}`); // Request detail

    return NextResponse.json({
      success: true,
      request: result,
      observation_created: observationCreated,
      chapman_estimate: chapmanEstimate,
    });
  } catch (error) {
    console.error("Error updating request:", error);
    return NextResponse.json(
      { error: "Failed to update request" },
      { status: 500 }
    );
  }
}
