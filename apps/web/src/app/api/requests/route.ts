import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";

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
  linked_cat_count: number;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const status = searchParams.get("status");
  const priority = searchParams.get("priority");
  const placeId = searchParams.get("place_id");
  const personId = searchParams.get("person_id");
  const sortBy = searchParams.get("sort_by") || "status"; // status, created, priority
  const sortOrder = searchParams.get("sort_order") || "asc"; // asc, desc
  const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 200);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (status) {
    conditions.push(`status = $${paramIndex}::trapper.request_status`);
    params.push(status);
    paramIndex++;
  }

  if (priority) {
    conditions.push(`priority = $${paramIndex}::trapper.request_priority`);
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

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Build ORDER BY clause based on sort parameters
  const buildOrderBy = () => {
    const dir = sortOrder === "desc" ? "DESC" : "ASC";
    const dirInverse = sortOrder === "desc" ? "ASC" : "DESC";

    switch (sortBy) {
      case "created":
        // Sort by original Airtable creation date (source_created_at)
        return `source_created_at ${dir} NULLS LAST, created_at ${dir}`;
      case "priority":
        return `
          CASE priority
            WHEN 'urgent' THEN 1
            WHEN 'high' THEN 2
            WHEN 'normal' THEN 3
            WHEN 'low' THEN 4
          END ${dir},
          source_created_at DESC NULLS LAST
        `;
      case "status":
      default:
        // Default: status order, then by creation date
        return `
          CASE status
            WHEN 'new' THEN 1
            WHEN 'triaged' THEN 2
            WHEN 'scheduled' THEN 3
            WHEN 'in_progress' THEN 4
            WHEN 'on_hold' THEN 5
            WHEN 'completed' THEN 6
            WHEN 'cancelled' THEN 7
          END ${dir},
          source_created_at ${dirInverse} NULLS LAST
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
        linked_cat_count
      FROM trapper.v_request_list
      ${whereClause}
      ORDER BY ${buildOrderBy()}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    params.push(limit, offset);

    const requests = await queryRows<RequestListRow>(sql, params);

    return NextResponse.json({
      requests,
      limit,
      offset,
    });
  } catch (error) {
    console.error("Error fetching requests:", error);
    return NextResponse.json(
      { error: "Failed to fetch requests" },
      { status: 500 }
    );
  }
}

// Valid status and priority values
const VALID_STATUSES = ["new", "triaged", "scheduled", "in_progress", "completed", "cancelled", "on_hold"];
const VALID_PRIORITIES = ["urgent", "high", "normal", "low"];
const VALID_PERMISSION_STATUSES = ["yes", "no", "pending", "not_needed", "unknown"];
const VALID_COLONY_DURATIONS = ["under_1_month", "1_to_6_months", "6_to_24_months", "over_2_years", "unknown"];
const VALID_COUNT_CONFIDENCES = ["exact", "good_estimate", "rough_guess", "unknown"];
const VALID_EARTIP_ESTIMATES = ["none", "few", "some", "most", "all", "unknown"];
const VALID_PROPERTY_TYPES = ["private_home", "apartment_complex", "mobile_home_park", "business", "farm_ranch", "public_park", "industrial", "other"];

interface CreateRequestBody {
  // Location
  place_id?: string;
  raw_address?: string;
  property_type?: string;
  location_description?: string;
  // Contact
  requester_person_id?: string;
  raw_requester_name?: string;
  raw_requester_phone?: string;
  raw_requester_email?: string;
  property_owner_contact?: string;
  best_contact_times?: string;
  // Permission & Access
  permission_status?: string;
  access_notes?: string;
  traps_overnight_safe?: boolean | null;
  access_without_contact?: boolean | null;
  // About the Cats
  estimated_cat_count?: number;
  count_confidence?: string;
  colony_duration?: string;
  eartip_count?: number;
  eartip_estimate?: string;
  cats_are_friendly?: boolean | null;
  // Kittens
  has_kittens?: boolean;
  kitten_count?: number;
  kitten_age_weeks?: number;
  // Feeding
  is_being_fed?: boolean | null;
  feeder_name?: string;
  feeding_schedule?: string;
  best_times_seen?: string;
  // Urgency
  urgency_reasons?: string[];
  urgency_deadline?: string;
  urgency_notes?: string;
  priority?: string;
  // Additional
  summary?: string;
  notes?: string;
  created_by?: string;
  // Legacy fields
  preferred_contact_method?: string;
}

interface RawIntakeResult {
  raw_id: string;
}

interface PromotionResult {
  promoted_request_id: string | null;
  intake_status: string;
  validation_errors: object | null;
  validation_warnings: object | null;
}

/**
 * POST /api/requests
 *
 * Creates a new request following the Raw → Normalize → SoT pipeline:
 * 1. Write to raw_intake_request (append-only)
 * 2. Validate and promote to sot_requests
 * 3. Return promotion status
 *
 * This ensures SoT integrity per the Atlas Concept Pack:
 * - No direct writes to SoT tables
 * - All data goes through validation
 * - Audit trail maintained
 */
export async function POST(request: NextRequest) {
  try {
    const body: CreateRequestBody = await request.json();

    // Basic client-side validation (real validation happens in normalizer)
    if (!body.place_id && !body.raw_address && !body.summary) {
      return NextResponse.json(
        { error: "Either place, address, or summary is required" },
        { status: 400 }
      );
    }

    // Step 1: Write to raw_intake_request (append-only)
    const rawResult = await queryOne<RawIntakeResult>(
      `INSERT INTO trapper.raw_intake_request (
        -- Source tracking
        created_by,
        source_system,
        -- Location
        place_id,
        raw_address,
        raw_property_type,
        raw_location_description,
        -- Contact
        requester_person_id,
        raw_requester_name,
        raw_requester_phone,
        raw_requester_email,
        raw_property_owner_contact,
        raw_best_contact_times,
        -- Permission & Access
        raw_permission_status,
        raw_access_notes,
        raw_traps_overnight_safe,
        raw_access_without_contact,
        -- About the Cats
        raw_estimated_cat_count,
        raw_count_confidence,
        raw_colony_duration,
        raw_eartip_count,
        raw_eartip_estimate,
        raw_cats_are_friendly,
        -- Kittens
        raw_has_kittens,
        raw_kitten_count,
        raw_kitten_age_weeks,
        -- Feeding
        raw_is_being_fed,
        raw_feeder_name,
        raw_feeding_schedule,
        raw_best_times_seen,
        -- Urgency
        raw_urgency_reasons,
        raw_urgency_deadline,
        raw_urgency_notes,
        raw_priority,
        -- Additional
        raw_summary,
        raw_notes
      ) VALUES (
        $1, 'atlas_ui',
        $2, $3, $4, $5,
        $6, $7, $8, $9, $10, $11,
        $12, $13, $14, $15,
        $16, $17, $18, $19, $20, $21,
        $22, $23, $24,
        $25, $26, $27, $28,
        $29, $30, $31, $32,
        $33, $34
      )
      RETURNING raw_id`,
      [
        body.created_by || "app_user",
        body.place_id || null,
        body.raw_address || null,
        body.property_type || null,
        body.location_description || null,
        body.requester_person_id || null,
        body.raw_requester_name || null,
        body.raw_requester_phone || null,
        body.raw_requester_email || null,
        body.property_owner_contact || null,
        body.best_contact_times || null,
        body.permission_status || null,
        body.access_notes || null,
        body.traps_overnight_safe ?? null,
        body.access_without_contact ?? null,
        body.estimated_cat_count || null,
        body.count_confidence || null,
        body.colony_duration || null,
        body.eartip_count || null,
        body.eartip_estimate || null,
        body.cats_are_friendly ?? null,
        body.has_kittens || false,
        body.kitten_count || null,
        body.kitten_age_weeks || null,
        body.is_being_fed ?? null,
        body.feeder_name || null,
        body.feeding_schedule || null,
        body.best_times_seen || null,
        body.urgency_reasons || null,
        body.urgency_deadline || null,
        body.urgency_notes || null,
        body.priority || null,
        body.summary || null,
        body.notes || null,
      ]
    );

    if (!rawResult) {
      return NextResponse.json(
        { error: "Failed to save request intake" },
        { status: 500 }
      );
    }

    // Step 2: Validate and promote to SoT
    const promotionResult = await queryOne<PromotionResult>(
      `SELECT
        promoted_request_id::TEXT,
        intake_status::TEXT,
        validation_errors,
        validation_warnings
       FROM (
         SELECT trapper.promote_intake_request($1, $2) AS promoted_request_id
       ) promotion
       CROSS JOIN trapper.raw_intake_request r
       WHERE r.raw_id = $1`,
      [rawResult.raw_id, body.created_by || "app_user"]
    );

    // Step 3: Return result with promotion status
    if (promotionResult?.promoted_request_id) {
      // Successfully promoted to SoT
      return NextResponse.json({
        success: true,
        request_id: promotionResult.promoted_request_id,
        raw_id: rawResult.raw_id,
        status: "promoted",
      });
    } else {
      // Check if it needs review or was rejected
      const statusResult = await queryOne<{
        intake_status: string;
        validation_errors: object | null;
        validation_warnings: object | null;
        review_reason: string | null;
      }>(
        `SELECT intake_status::TEXT, validation_errors, validation_warnings, review_reason
         FROM trapper.raw_intake_request WHERE raw_id = $1`,
        [rawResult.raw_id]
      );

      if (statusResult?.intake_status === "needs_review") {
        return NextResponse.json({
          success: true,
          raw_id: rawResult.raw_id,
          status: "needs_review",
          review_reason: statusResult.review_reason,
          message: "Request saved but needs human review before activation",
        });
      } else if (statusResult?.intake_status === "rejected") {
        return NextResponse.json({
          success: false,
          raw_id: rawResult.raw_id,
          status: "rejected",
          errors: statusResult.validation_errors,
          message: "Request failed validation",
        }, { status: 400 });
      } else {
        // Pending - normalizer didn't run (maybe table doesn't exist yet)
        return NextResponse.json({
          success: true,
          raw_id: rawResult.raw_id,
          status: "pending",
          message: "Request saved, awaiting processing",
        });
      }
    }
  } catch (error) {
    console.error("Error creating request:", error);

    // If raw_intake_request table doesn't exist yet, fall back to direct write
    // This maintains backwards compatibility during migration
    if (error instanceof Error && error.message.includes("raw_intake_request")) {
      console.warn("raw_intake_request table not found, falling back to direct write");
      return handleLegacyDirectWrite(request);
    }

    return NextResponse.json(
      { error: "Failed to create request" },
      { status: 500 }
    );
  }
}

// Legacy fallback for backwards compatibility during migration
async function handleLegacyDirectWrite(request: NextRequest) {
  try {
    const body: CreateRequestBody = await request.json();

    const result = await queryOne<{ request_id: string }>(
      `INSERT INTO trapper.sot_requests (
        place_id, property_type, location_description,
        requester_person_id, property_owner_contact, best_contact_times,
        permission_status, access_notes, traps_overnight_safe, access_without_contact,
        estimated_cat_count, count_confidence, colony_duration, eartip_count, eartip_estimate, cats_are_friendly,
        has_kittens, kitten_count, kitten_age_weeks,
        is_being_fed, feeder_name, feeding_schedule, best_times_seen,
        urgency_reasons, urgency_deadline, urgency_notes, priority,
        summary, notes, data_source, source_system, created_by
      ) VALUES (
        $1, $2::trapper.property_type, $3, $4, $5, $6,
        COALESCE($7, 'unknown')::trapper.permission_status, $8, $9, $10,
        $11, COALESCE($12, 'unknown')::trapper.count_confidence,
        COALESCE($13, 'unknown')::trapper.colony_duration, $14,
        COALESCE($15, 'unknown')::trapper.eartip_estimate, $16,
        $17, $18, $19, $20, $21, $22, $23, $24, $25, $26,
        COALESCE($27, 'normal')::trapper.request_priority, $28, $29,
        'app', 'atlas_ui', $30
      )
      RETURNING request_id`,
      [
        body.place_id || null, body.property_type || null, body.location_description || null,
        body.requester_person_id || null, body.property_owner_contact || null, body.best_contact_times || null,
        body.permission_status || null, body.access_notes || null, body.traps_overnight_safe ?? null, body.access_without_contact ?? null,
        body.estimated_cat_count || null, body.count_confidence || null, body.colony_duration || null,
        body.eartip_count || null, body.eartip_estimate || null, body.cats_are_friendly ?? null,
        body.has_kittens || false, body.kitten_count || null, body.kitten_age_weeks || null,
        body.is_being_fed ?? null, body.feeder_name || null, body.feeding_schedule || null, body.best_times_seen || null,
        body.urgency_reasons || null, body.urgency_deadline || null, body.urgency_notes || null,
        body.priority || null, body.summary || null, body.notes || null,
        body.created_by || "app_user",
      ]
    );

    if (!result) {
      return NextResponse.json({ error: "Failed to create request" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      request_id: result.request_id,
      status: "promoted",
      legacy: true,
    });
  } catch (error) {
    console.error("Legacy write failed:", error);
    return NextResponse.json({ error: "Failed to create request" }, { status: 500 });
  }
}
