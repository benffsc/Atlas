import { NextRequest, NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";
import { getSession } from "@/lib/auth";

interface SiteObservation {
  observation_id: string;
  place_id: string | null;
  request_id: string | null;
  observer_person_id: string | null;
  observer_staff_id: string | null;
  observer_type: string | null;
  observer_name: string | null;
  observation_date: string;
  observation_time: string | null;
  time_of_day: string | null;
  cats_seen_total: number | null;
  cats_seen_is_estimate: boolean;
  eartipped_seen: number | null;
  eartipped_is_estimate: boolean;
  cats_trapped: number;
  cats_returned: number;
  female_seen: number | null;
  male_seen: number | null;
  unknown_sex_seen: number | null;
  sex_counts_are_estimates: boolean;
  is_at_feeding_station: boolean | null;
  weather_conditions: string | null;
  confidence: string;
  notes: string | null;
  created_at: string;
  // Trip report fields (unified)
  arrival_time: string | null;
  departure_time: string | null;
  traps_set: number;
  traps_retrieved: number;
  issues_encountered: string[];
  issue_details: string | null;
  is_final_visit: boolean;
  equipment_used: string[] | null;
  // Joined fields
  place_name?: string;
  place_address?: string;
}

/**
 * GET /api/observations
 * List observations with optional filters
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const placeId = searchParams.get("place_id");
    const requestId = searchParams.get("request_id");
    const observerType = searchParams.get("observer_type");
    const startDate = searchParams.get("start_date");
    const endDate = searchParams.get("end_date");
    const limit = parseInt(searchParams.get("limit") || "50");
    const offset = parseInt(searchParams.get("offset") || "0");

    // Build WHERE clause
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (placeId) {
      conditions.push(`o.place_id = $${paramIndex++}`);
      params.push(placeId);
    }
    if (requestId) {
      conditions.push(`o.request_id = $${paramIndex++}`);
      params.push(requestId);
    }
    if (observerType) {
      conditions.push(`o.observer_type = $${paramIndex++}`);
      params.push(observerType);
    }
    if (startDate) {
      conditions.push(`o.observation_date >= $${paramIndex++}`);
      params.push(startDate);
    }
    if (endDate) {
      conditions.push(`o.observation_date <= $${paramIndex++}`);
      params.push(endDate);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const observations = await queryRows<SiteObservation>(
      `
      SELECT
        o.observation_id,
        o.place_id,
        o.request_id,
        o.observer_person_id,
        o.observer_staff_id,
        o.observer_type,
        COALESCE(o.observer_name, per.display_name, s.display_name) as observer_name,
        o.observation_date,
        o.observation_time,
        o.time_of_day,
        o.cats_seen_total,
        o.cats_seen_is_estimate,
        o.eartipped_seen,
        o.eartipped_is_estimate,
        o.cats_trapped,
        o.cats_returned,
        o.female_seen,
        o.male_seen,
        o.unknown_sex_seen,
        o.sex_counts_are_estimates,
        o.is_at_feeding_station,
        o.weather_conditions,
        o.confidence,
        o.notes,
        o.arrival_time,
        o.departure_time,
        o.traps_set,
        o.traps_retrieved,
        o.issues_encountered,
        o.issue_details,
        o.is_final_visit,
        o.equipment_used,
        o.created_at,
        p.display_name as place_name,
        p.formatted_address as place_address
      FROM ops.site_observations o
      LEFT JOIN sot.places p ON p.place_id = o.place_id
      LEFT JOIN sot.people per ON per.person_id = o.observer_person_id
      LEFT JOIN ops.staff s ON s.staff_id = o.observer_staff_id
      ${whereClause}
      ORDER BY o.observation_date DESC, o.created_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex}
      `,
      [...params, limit, offset]
    );

    return NextResponse.json({
      observations,
      pagination: {
        limit,
        offset,
        hasMore: observations.length === limit,
      },
    });
  } catch (error) {
    console.error("Observations list error:", error);
    return NextResponse.json(
      { error: "Failed to fetch observations" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/observations
 * Submit a new observation (unified - supports both quick and full trip report modes)
 */
export async function POST(request: NextRequest) {
  try {
    // Get authenticated user (staff or person)
    const session = await getSession(request);

    const body = await request.json();
    const {
      place_id,
      request_id,
      observer_type,
      observer_name: providedObserverName,
      observation_date,
      observation_time,
      time_of_day,
      cats_seen_total,
      cats_seen_is_estimate,
      eartipped_seen,
      eartipped_is_estimate,
      cats_trapped,
      cats_returned,
      female_seen,
      male_seen,
      unknown_sex_seen,
      sex_counts_are_estimates,
      is_at_feeding_station,
      weather_conditions,
      confidence,
      notes,
      // Trip report fields (unified)
      arrival_time,
      departure_time,
      traps_set,
      traps_retrieved,
      issues_encountered,
      issue_details,
      is_final_visit,
      equipment_used,
    } = body;

    // Must have at least place_id or request_id
    if (!place_id && !request_id) {
      return NextResponse.json(
        { error: "Either place_id or request_id is required" },
        { status: 400 }
      );
    }

    // If no place_id but have request_id, get place from request
    let effectivePlaceId = place_id;
    if (!place_id && request_id) {
      const req = await queryOne<{ place_id: string }>(
        `SELECT place_id FROM ops.requests WHERE request_id = $1`,
        [request_id]
      );
      if (req?.place_id) {
        effectivePlaceId = req.place_id;
      }
    }

    // Determine observer type and IDs
    let effectiveObserverType = observer_type || "admin_entry";
    let observerStaffId = null;
    let observerPersonId = null;
    let observerName = providedObserverName || null;

    if (session) {
      observerStaffId = session.staff_id;
      // Auto-fill observer name from session if not provided
      if (!observerName) {
        observerName = session.display_name || null;
      }
      if (!observer_type) {
        effectiveObserverType = session.staff_id ? "trapper_field" : "admin_entry";
      }
    }

    // Validate observer_type
    const validObserverTypes = [
      "trapper_field",
      "staff_phone_call",
      "client_report",
      "requester_update",
      "admin_entry",
    ];
    if (!validObserverTypes.includes(effectiveObserverType)) {
      return NextResponse.json(
        { error: `Invalid observer_type. Must be one of: ${validObserverTypes.join(", ")}` },
        { status: 400 }
      );
    }

    // Validate confidence if provided
    if (confidence && !["high", "medium", "low"].includes(confidence)) {
      return NextResponse.json(
        { error: "Invalid confidence. Must be: high, medium, or low" },
        { status: 400 }
      );
    }

    // Insert observation (includes unified trip report fields)
    const observation = await queryOne<{ observation_id: string; created_at: string }>(
      `
      INSERT INTO ops.site_observations (
        place_id,
        request_id,
        observer_person_id,
        observer_staff_id,
        observer_type,
        observer_name,
        observation_date,
        observation_time,
        time_of_day,
        cats_seen_total,
        cats_seen_is_estimate,
        eartipped_seen,
        eartipped_is_estimate,
        cats_trapped,
        cats_returned,
        female_seen,
        male_seen,
        unknown_sex_seen,
        sex_counts_are_estimates,
        is_at_feeding_station,
        weather_conditions,
        confidence,
        notes,
        arrival_time,
        departure_time,
        traps_set,
        traps_retrieved,
        issues_encountered,
        issue_details,
        is_final_visit,
        equipment_used,
        source_system
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, 'atlas_ui')
      RETURNING observation_id, created_at
      `,
      [
        effectivePlaceId || null,
        request_id || null,
        observerPersonId,
        observerStaffId,
        effectiveObserverType,
        observerName,
        observation_date || new Date().toISOString().split("T")[0],
        observation_time || null,
        time_of_day || null,
        cats_seen_total ?? null,
        cats_seen_is_estimate ?? true,
        eartipped_seen ?? null,
        eartipped_is_estimate ?? true,
        cats_trapped ?? 0,
        cats_returned ?? 0,
        female_seen ?? null,
        male_seen ?? null,
        unknown_sex_seen ?? null,
        sex_counts_are_estimates ?? true,
        is_at_feeding_station ?? null,
        weather_conditions || null,
        confidence || "medium",
        notes || null,
        arrival_time || null,
        departure_time || null,
        traps_set ?? 0,
        traps_retrieved ?? 0,
        issues_encountered || [],
        issue_details || null,
        is_final_visit ?? false,
        equipment_used || null,
      ]
    );

    if (!observation) {
      return NextResponse.json(
        { error: "Failed to create observation" },
        { status: 500 }
      );
    }

    // Calculate Chapman estimate if we have cats observed and a place
    let chapmanEstimate = null;
    if (effectivePlaceId && cats_seen_total !== null && cats_seen_total !== undefined) {
      try {
        const chapmanResult = await queryOne<{
          estimated_population: number;
          confidence_interval_low: number;
          confidence_interval_high: number;
          verified_altered: number;
          observation_count: number;
          recapture_count: number;
        }>(
          `SELECT * FROM trapper.calculate_chapman_estimate($1, $2, $3)`,
          [effectivePlaceId, cats_seen_total, eartipped_seen ?? 0]
        );

        if (chapmanResult) {
          chapmanEstimate = {
            estimated_population: Math.round(Number(chapmanResult.estimated_population)),
            confidence_interval: {
              low: Math.round(Number(chapmanResult.confidence_interval_low)),
              high: Math.round(Number(chapmanResult.confidence_interval_high)),
            },
            verified_altered: chapmanResult.verified_altered,
            recapture_count: chapmanResult.recapture_count,
          };
        }
      } catch (err) {
        // Chapman calculation is optional - log but don't fail
        console.warn("Chapman estimate calculation failed:", err);
      }
    }

    // Get latest colony estimate for this place
    let latestEstimate = null;
    if (effectivePlaceId) {
      const estimate = await queryOne<{
        total_cats: number;
        source_type: string;
        observation_date: string;
      }>(
        `SELECT total_cats, source_type, observation_date
         FROM sot.place_colony_estimates
         WHERE place_id = $1
         ORDER BY observation_date DESC, created_at DESC
         LIMIT 1`,
        [effectivePlaceId]
      );
      if (estimate) {
        latestEstimate = {
          total_cats: estimate.total_cats,
          source_type: estimate.source_type,
          observation_date: estimate.observation_date,
        };
      }
    }

    return NextResponse.json({
      success: true,
      observation_id: observation.observation_id,
      message: "Observation recorded successfully",
      chapman_estimate: chapmanEstimate,
      latest_estimate: latestEstimate,
    });
  } catch (error) {
    console.error("Observation create error:", error);
    return NextResponse.json(
      { error: "Failed to create observation" },
      { status: 500 }
    );
  }
}
