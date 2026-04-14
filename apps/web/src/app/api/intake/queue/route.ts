import { NextRequest } from "next/server";
import { queryRows } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";

interface IntakeSubmission {
  submission_id: string;
  submitted_at: string;
  submitter_name: string;
  email: string;
  phone: string | null;
  cats_address: string;
  cats_city: string | null;
  ownership_status: string;
  cat_count_estimate: number | null;
  fixed_status: string;
  has_kittens: boolean | null;
  has_medical_concerns: boolean | null;
  is_emergency: boolean;
  situation_description: string | null;
  triage_category: string | null;
  triage_score: number | null;
  triage_reasons: unknown;
  // Unified status (new)
  submission_status: string | null;
  appointment_date: string | null;
  priority_override: string | null;
  // Native status (kept for transition)
  native_status: string;
  final_category: string | null;
  created_request_id: string | null;
  age: unknown;
  overdue: boolean;
  is_legacy: boolean;
  legacy_status: string | null;
  legacy_submission_status: string | null;
  legacy_appointment_date: string | null;
  legacy_notes: string | null;
  legacy_source_id: string | null;
  review_notes: string | null;
  matched_person_id: string | null;
  // Source tracking
  intake_source: string | null;
  // Geocoding
  geo_formatted_address: string | null;
  geo_latitude: number | null;
  geo_longitude: number | null;
  geo_confidence: string | null;
  // Contact tracking
  last_contacted_at: string | null;
  last_contact_method: string | null;
  contact_attempt_count: number | null;
  // Test mode
  is_test: boolean;
  // Kitten priority (FFS-559)
  kitten_priority_score: number | null;
  kitten_assessment_outcome: string | null;
  kitten_assessed_at: string | null;
  kitten_redirect_destination: string | null;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category");
  const statusFilter = searchParams.get("status_filter");
  const sourceFilter = searchParams.get("source"); // 'legacy', 'new', or ''
  const mode = searchParams.get("mode"); // 'active', 'scheduled', 'completed', 'all' (+ legacy compat)
  const includeOld = searchParams.get("include_old") === "true";
  const includeTest = searchParams.get("include_test") === "true";
  const includeLegacy = searchParams.get("include_legacy") === "true";
  const searchQuery = searchParams.get("search");
  const limitParam = searchParams.get("limit");

  try {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    // Search by name, email, phone, or address
    if (searchQuery && searchQuery.trim()) {
      conditions.push(`(
        submitter_name ILIKE $${paramIndex}
        OR email ILIKE $${paramIndex}
        OR phone ILIKE $${paramIndex}
        OR cats_address ILIKE $${paramIndex}
        OR geo_formatted_address ILIKE $${paramIndex}
      )`);
      params.push(`%${searchQuery.trim()}%`);
      paramIndex++;
    }

    // Filter by category
    if (category) {
      conditions.push(`triage_category = $${paramIndex}`);
      params.push(category);
      paramIndex++;
    }

    // Mode-based filtering using unified submission_status
    // New tab system (FFS-111): active, scheduled, completed, all
    // Legacy tab names still supported for backward compatibility
    if (mode === "active" || mode === "attention") {
      // "Active" tab: New and in-progress items
      conditions.push(`submission_status IN ('new', 'in_progress')`);
    } else if (mode === "scheduled") {
      // "Scheduled" tab: Appointments booked
      conditions.push(`submission_status = 'scheduled'`);
    } else if (mode === "completed" || mode === "complete") {
      // "Completed" tab: Done + archived items
      conditions.push(`submission_status IN ('complete', 'archived')`);
    } else if (mode === "recent") {
      // Legacy "Recent" tab - maps to active behavior
      conditions.push(`(
        is_legacy = FALSE
        OR submitted_at >= '2025-10-01'
        OR submission_status IN ('new', 'in_progress', 'scheduled')
      )`);
    } else if (mode === "all") {
      // "All Submissions" tab: Everything except archived
      // View already filters out archived
    } else if (mode === "legacy") {
      // Legacy filter (backward compat)
      conditions.push(`is_legacy = TRUE`);
    } else if (mode === "test") {
      // Test filter (backward compat)
      conditions.push(`is_test = TRUE`);
    } else {
      // Default: Show actionable items (new + in_progress + scheduled)
      if (statusFilter === "active") {
        conditions.push(`submission_status IN ('new', 'in_progress', 'scheduled')`);
      } else if (statusFilter && statusFilter !== "") {
        conditions.push(`submission_status = $${paramIndex}`);
        params.push(statusFilter);
        paramIndex++;
      }

      // Filter by source (legacy vs new form)
      if (sourceFilter === "legacy") {
        conditions.push(`is_legacy = TRUE`);
      } else if (sourceFilter === "new") {
        conditions.push(`is_legacy = FALSE`);
      }

      // When viewing all (no status filter), still hide old legacy unless requested
      if (!statusFilter && !includeOld) {
        conditions.push(`(is_legacy = FALSE OR submitted_at >= '2025-10-01' OR submission_status IN ('new', 'in_progress', 'scheduled'))`);
      }
    }

    // Exclude test submissions unless explicitly included or viewing test mode
    if (mode !== "test" && !includeTest) {
      conditions.push(`COALESCE(is_test, FALSE) = FALSE`);
    }

    // Exclude legacy submissions unless filter chip is on (FFS-111)
    // Only applies to tabs that don't already filter by legacy status
    if (!includeLegacy && mode !== "legacy" && mode !== "all") {
      conditions.push(`is_legacy = FALSE`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const sql = `
      SELECT
        submission_id,
        submitted_at,
        submitter_name,
        email,
        phone,
        cats_address,
        cats_city,
        ownership_status,
        cat_count_estimate,
        fixed_status,
        has_kittens,
        has_medical_concerns,
        is_emergency,
        situation_description,
        triage_category,
        triage_score,
        triage_reasons,
        submission_status,
        appointment_date,
        priority_override,
        native_status,
        final_category,
        created_request_id,
        age::text as age,
        overdue,
        is_legacy,
        legacy_status,
        legacy_submission_status,
        legacy_appointment_date,
        legacy_notes,
        legacy_source_id,
        review_notes,
        matched_person_id,
        place_id,
        intake_source,
        geo_formatted_address,
        geo_latitude,
        geo_longitude,
        geo_confidence,
        last_contacted_at,
        last_contact_method,
        contact_attempt_count,
        is_test,
        kitten_priority_score,
        kitten_assessment_outcome,
        kitten_assessed_at,
        kitten_redirect_destination,
        -- FFS-1192 — kiosk self-service appointment tags (from custom_fields)
        intake_assigned_to,
        intake_followup_needed,
        trapping_assistance_requested,
        -- FFS-1187 — service area + out-of-area email state
        service_area_status,
        service_area_status_source,
        service_area_status_set_at,
        out_of_service_area_approved_at,
        out_of_service_area_approved_by,
        out_of_service_area_email_sent_at,
        out_of_service_area_email_id
      FROM ops.v_intake_triage_queue
      ${whereClause}
      ORDER BY
        is_emergency DESC,
        CASE submission_status
          WHEN 'new' THEN 1
          WHEN 'in_progress' THEN 2
          WHEN 'scheduled' THEN 3
          ELSE 4
        END,
        submitted_at DESC
      LIMIT ${mode === "legacy" ? 2000 : (limitParam ? Math.min(parseInt(limitParam, 10), 2000) : 500)}
    `;

    const submissions = await queryRows<IntakeSubmission>(sql, params);

    return apiSuccess({ submissions });
  } catch (err) {
    console.error("Error fetching queue:", err);
    return apiServerError("Failed to fetch submissions");
  }
}
