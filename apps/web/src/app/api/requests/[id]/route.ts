import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";

interface RequestDetailRow {
  request_id: string;
  status: string;
  priority: string;
  summary: string | null;
  notes: string | null;
  legacy_notes: string | null;
  estimated_cat_count: number | null;
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
        -- Place info
        r.place_id,
        p.display_name AS place_name,
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
        -- Requester info
        r.requester_person_id,
        per.display_name AS requester_name,
        -- Linked cats
        (SELECT jsonb_agg(jsonb_build_object(
            'cat_id', rc.cat_id,
            'cat_name', c.display_name,
            'relationship', rc.relationship
        ))
         FROM trapper.request_cats rc
         JOIN trapper.sot_cats c ON c.cat_id = rc.cat_id
         WHERE rc.request_id = r.request_id) AS cats,
        (SELECT COUNT(*) FROM trapper.request_cats rc WHERE rc.request_id = r.request_id) AS linked_cat_count,
        -- Computed scores (handle if functions don't exist yet)
        COALESCE(trapper.compute_request_readiness(r), 0) AS readiness_score,
        COALESCE(trapper.compute_request_urgency(r), 0) AS urgency_score
      FROM trapper.sot_requests r
      LEFT JOIN trapper.places p ON p.place_id = r.place_id
      LEFT JOIN trapper.sot_addresses sa ON sa.address_id = p.sot_address_id
      LEFT JOIN trapper.sot_people per ON per.person_id = r.requester_person_id
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
      const { queryRows } = await import("@/lib/db");
      statusHistory = await queryRows(historySql, [id]);
    } catch {
      // Table might not exist yet
    }

    return NextResponse.json({
      ...requestDetail,
      status_history: statusHistory,
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

    // Build dynamic update query
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (body.status !== undefined) {
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

    if (body.priority !== undefined) {
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

    if (body.assigned_to !== undefined) {
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

    if (body.assigned_trapper_type !== undefined) {
      updates.push(`assigned_trapper_type = $${paramIndex}::trapper.trapper_type`);
      values.push(body.assigned_trapper_type || null);
      paramIndex++;
    }

    if (body.assignment_notes !== undefined) {
      updates.push(`assignment_notes = $${paramIndex}`);
      values.push(body.assignment_notes || null);
      paramIndex++;
    }

    if (body.scheduled_date !== undefined) {
      updates.push(`scheduled_date = $${paramIndex}`);
      values.push(body.scheduled_date || null);
      paramIndex++;
    }

    if (body.scheduled_time_range !== undefined) {
      updates.push(`scheduled_time_range = $${paramIndex}`);
      values.push(body.scheduled_time_range || null);
      paramIndex++;
    }

    if (body.resolution_notes !== undefined) {
      updates.push(`resolution_notes = $${paramIndex}`);
      values.push(body.resolution_notes || null);
      paramIndex++;
    }

    if (body.cats_trapped !== undefined) {
      updates.push(`cats_trapped = $${paramIndex}`);
      values.push(body.cats_trapped);
      paramIndex++;
    }

    if (body.cats_returned !== undefined) {
      updates.push(`cats_returned = $${paramIndex}`);
      values.push(body.cats_returned);
      paramIndex++;
    }

    // Hold management
    if (body.hold_reason !== undefined) {
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

    return NextResponse.json({
      success: true,
      request: result,
    });
  } catch (error) {
    console.error("Error updating request:", error);
    return NextResponse.json(
      { error: "Failed to update request" },
      { status: 500 }
    );
  }
}
