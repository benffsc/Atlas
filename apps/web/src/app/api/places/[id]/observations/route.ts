import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne, query } from "@/lib/db";

/**
 * POST /api/places/[id]/observations
 *
 * Quick site observation logging for trappers.
 * Minimal friction - only requires cats_seen and eartips_seen.
 * Enables Chapman estimator for population estimation.
 *
 * Stores in: place_colony_estimates with source_type = 'trapper_site_visit'
 */

interface ObservationBody {
  cats_seen: number;          // Total cats observed
  eartips_seen: number;       // How many had ear tips
  time_of_day?: "morning" | "afternoon" | "evening" | "night";
  at_feeding_station?: boolean;
  notes?: string;
  observer_name?: string;     // If not logged in, can provide name
}

interface Observation {
  estimate_id: string;
  total_cats_observed: number;
  eartip_count_observed: number;
  observation_time_of_day: string | null;
  is_at_feeding_station: boolean | null;
  observation_date: string;
  notes: string | null;
  reporter_name: string | null;
  created_at: string;
}

// GET - List recent observations for this place
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Place ID is required" },
      { status: 400 }
    );
  }

  try {
    const sql = `
      SELECT
        e.estimate_id,
        e.total_cats_observed,
        e.eartip_count_observed,
        e.observation_time_of_day,
        e.is_at_feeding_station,
        e.observation_date::TEXT,
        e.notes,
        COALESCE(p.display_name, e.created_by) AS reporter_name,
        e.created_at::TEXT
      FROM sot.place_colony_estimates e
      LEFT JOIN sot.people p ON p.person_id = e.reported_by_person_id
      WHERE e.place_id = $1
        AND e.source_type = 'trapper_site_visit'
        AND e.total_cats_observed IS NOT NULL
      ORDER BY e.observation_date DESC, e.created_at DESC
      LIMIT 20
    `;

    const observations = await queryRows<Observation>(sql, [id]);

    return NextResponse.json({
      place_id: id,
      observations,
      count: observations.length,
    });
  } catch (error) {
    console.error("Error fetching observations:", error);
    return NextResponse.json(
      { error: "Failed to fetch observations" },
      { status: 500 }
    );
  }
}

// POST - Log a new site observation
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Place ID is required" },
      { status: 400 }
    );
  }

  try {
    const body: ObservationBody = await request.json();

    // Validate required fields
    if (body.cats_seen === undefined || body.cats_seen === null) {
      return NextResponse.json(
        { error: "cats_seen is required" },
        { status: 400 }
      );
    }

    if (body.eartips_seen === undefined || body.eartips_seen === null) {
      return NextResponse.json(
        { error: "eartips_seen is required" },
        { status: 400 }
      );
    }

    // Basic validation
    if (body.cats_seen < 0 || body.eartips_seen < 0) {
      return NextResponse.json(
        { error: "Counts cannot be negative" },
        { status: 400 }
      );
    }

    if (body.eartips_seen > body.cats_seen) {
      return NextResponse.json(
        { error: "Ear-tipped cats cannot exceed total cats seen" },
        { status: 400 }
      );
    }

    // Validate time_of_day if provided
    const validTimes = ["morning", "afternoon", "evening", "night"];
    if (body.time_of_day && !validTimes.includes(body.time_of_day)) {
      return NextResponse.json(
        { error: `time_of_day must be one of: ${validTimes.join(", ")}` },
        { status: 400 }
      );
    }

    // Verify place exists
    const placeCheck = await queryOne<{ place_id: string }>(
      `SELECT place_id FROM sot.places WHERE place_id = $1`,
      [id]
    );

    if (!placeCheck) {
      return NextResponse.json(
        { error: "Place not found" },
        { status: 404 }
      );
    }

    // Insert the observation
    const sql = `
      INSERT INTO sot.place_colony_estimates (
        place_id,
        total_cats_observed,
        eartip_count_observed,
        observation_time_of_day,
        is_at_feeding_station,
        observation_date,
        notes,
        source_type,
        source_system,
        is_firsthand,
        created_by
      ) VALUES (
        $1, $2, $3, $4, $5, CURRENT_DATE, $6,
        'trapper_site_visit',
        'atlas_ui',
        TRUE,
        $7
      )
      RETURNING
        estimate_id,
        total_cats_observed,
        eartip_count_observed,
        observation_date::TEXT,
        created_at::TEXT
    `;

    const result = await queryOne<{
      estimate_id: string;
      total_cats_observed: number;
      eartip_count_observed: number;
      observation_date: string;
      created_at: string;
    }>(sql, [
      id,
      body.cats_seen,
      body.eartips_seen,
      body.time_of_day || null,
      body.at_feeding_station ?? null,
      body.notes || null,
      body.observer_name || "web_user",
    ]);

    if (!result) {
      return NextResponse.json(
        { error: "Failed to create observation" },
        { status: 500 }
      );
    }

    // Calculate what this observation means for Chapman estimation
    // N̂ = (M+1)(C+1)/(R+1) - 1
    // M = altered cats at this place (from clinic data)
    // C = cats seen (total_cats_observed)
    // R = ear-tipped seen (eartip_count_observed)

    let chapmanEstimate = null;
    if (body.eartips_seen > 0) {
      // Get M (altered count) from verified clinic data
      const alteredSql = `
        SELECT COUNT(DISTINCT cpr.cat_id)::INT as altered_count
        FROM sot.cat_place_relationships cpr
        JOIN sot.cats c ON c.cat_id = cpr.cat_id
        WHERE cpr.place_id = $1
          AND c.altered_status IN ('spayed', 'neutered')
      `;
      const alteredResult = await queryOne<{ altered_count: number }>(alteredSql, [id]);
      const M = alteredResult?.altered_count || 0;
      const C = body.cats_seen;
      const R = body.eartips_seen;

      if (M > 0 && R > 0) {
        chapmanEstimate = Math.round(((M + 1) * (C + 1)) / (R + 1) - 1);
      }
    }

    return NextResponse.json({
      success: true,
      observation: result,
      chapman_estimate: chapmanEstimate,
      message: chapmanEstimate
        ? `Observation logged. Chapman population estimate: ~${chapmanEstimate} cats`
        : "Observation logged successfully",
    });
  } catch (error) {
    console.error("Error creating observation:", error);
    return NextResponse.json(
      { error: "Failed to create observation" },
      { status: 500 }
    );
  }
}
