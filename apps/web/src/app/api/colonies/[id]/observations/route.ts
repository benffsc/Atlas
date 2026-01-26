import { NextRequest, NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";

interface Observation {
  observation_id: string;
  observation_date: string;
  total_cats: number | null;
  total_cats_confidence: string | null;
  fixed_cats: number | null;
  fixed_cats_confidence: string | null;
  unfixed_cats: number | null;
  notes: string | null;
  observed_by: string;
  created_at: string;
}

interface ValidationResult {
  has_discrepancy: boolean;
  linked_community_cats: number;
  linked_owned_cats: number;
  message: string | null;
}

// GET /api/colonies/[id]/observations - Get all observations
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: colonyId } = await params;

  try {
    const observations = await queryRows<Observation>(
      `SELECT
        observation_id,
        observation_date,
        total_cats,
        total_cats_confidence,
        fixed_cats,
        fixed_cats_confidence,
        unfixed_cats,
        notes,
        observed_by,
        created_at
      FROM trapper.colony_observations
      WHERE colony_id = $1
      ORDER BY observation_date DESC, created_at DESC`,
      [colonyId]
    );

    return NextResponse.json({ observations });
  } catch (error) {
    console.error("Error fetching observations:", error);
    return NextResponse.json(
      { error: "Failed to fetch observations" },
      { status: 500 }
    );
  }
}

// POST /api/colonies/[id]/observations - Add observation with validation
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: colonyId } = await params;

  try {
    const body = await request.json();
    const {
      observation_date,
      total_cats,
      total_cats_confidence = "medium",
      fixed_cats,
      fixed_cats_confidence = "medium",
      notes,
      observed_by,
      override_discrepancy = false, // Allow override if user acknowledges
    } = body;

    if (!observed_by?.trim()) {
      return NextResponse.json(
        { error: "observed_by is required" },
        { status: 400 }
      );
    }

    // Verify colony exists and get linked cat counts
    const colonyStats = await queryOne<{
      colony_id: string;
      linked_community_cats: number;
      linked_owned_cats: number;
    }>(
      `SELECT colony_id, linked_community_cats, linked_owned_cats
       FROM trapper.v_colony_stats
       WHERE colony_id = $1`,
      [colonyId]
    );

    if (!colonyStats) {
      return NextResponse.json({ error: "Colony not found" }, { status: 404 });
    }

    // Validate observation against linked data
    const validation: ValidationResult = {
      has_discrepancy: false,
      linked_community_cats: colonyStats.linked_community_cats,
      linked_owned_cats: colonyStats.linked_owned_cats,
      message: null,
    };

    if (
      total_cats !== null &&
      total_cats !== undefined &&
      colonyStats.linked_community_cats > 0 &&
      total_cats < colonyStats.linked_community_cats
    ) {
      validation.has_discrepancy = true;
      validation.message =
        `You entered ${total_cats} cats, but we have ${colonyStats.linked_community_cats} ` +
        `community cats linked to this colony` +
        (colonyStats.linked_owned_cats > 0
          ? ` (${colonyStats.linked_owned_cats} additional "Owned" cats excluded)`
          : "") +
        `. The observation count seems low.`;

      // If user hasn't acknowledged, return warning
      if (!override_discrepancy) {
        return NextResponse.json(
          {
            warning: true,
            validation,
            message: validation.message,
          },
          { status: 200 }
        );
      }
    }

    // Calculate unfixed if not provided
    let calculatedUnfixed = null;
    if (total_cats !== null && fixed_cats !== null) {
      calculatedUnfixed = Math.max(0, total_cats - fixed_cats);
    }

    // Insert observation
    const observation = await queryOne<{ observation_id: string }>(
      `INSERT INTO trapper.colony_observations (
        colony_id,
        observation_date,
        total_cats,
        total_cats_confidence,
        fixed_cats,
        fixed_cats_confidence,
        unfixed_cats,
        notes,
        observed_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING observation_id`,
      [
        colonyId,
        observation_date || new Date().toISOString().split("T")[0],
        total_cats ?? null,
        total_cats_confidence,
        fixed_cats ?? null,
        fixed_cats_confidence,
        calculatedUnfixed,
        notes?.trim() || null,
        observed_by.trim(),
      ]
    );

    return NextResponse.json({
      success: true,
      observation_id: observation?.observation_id,
      validation,
    });
  } catch (error) {
    console.error("Error creating observation:", error);
    return NextResponse.json(
      { error: "Failed to create observation" },
      { status: 500 }
    );
  }
}
