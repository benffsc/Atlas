import { NextRequest, NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";

/**
 * Cat Birth API Endpoint
 *
 * GET - Get birth event for a cat
 * POST - Register birth event using register_birth_event()
 * DELETE - Remove birth event
 *
 * Used by:
 * - Cat detail page birth information section
 * - Beacon birth rate calculations
 */

const VALID_DATE_PRECISIONS = [
  "exact",
  "week",
  "month",
  "season",
  "year",
  "estimated",
] as const;

const VALID_SEASONS = ["spring", "summer", "fall", "winter"] as const;

interface BirthEvent {
  birth_event_id: string;
  litter_id: string;
  cat_id: string;
  mother_cat_id: string | null;
  mother_name: string | null;
  birth_date: string | null;
  birth_date_precision: string;
  birth_year: number | null;
  birth_month: number | null;
  birth_season: string | null;
  place_id: string | null;
  place_name: string | null;
  kitten_count_in_litter: number | null;
  survived_to_weaning: boolean | null;
  litter_survived_count: number | null;
  source_system: string;
  notes: string | null;
  created_at: string;
}

interface Sibling {
  cat_id: string;
  display_name: string;
  sex: string | null;
  microchip: string | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: "Cat ID is required" }, { status: 400 });
  }

  try {
    // Get birth event
    const birthSql = `
      SELECT
        be.birth_event_id,
        be.litter_id,
        be.cat_id,
        be.mother_cat_id,
        mc.display_name AS mother_name,
        be.birth_date::TEXT,
        be.birth_date_precision::TEXT,
        be.birth_year,
        be.birth_month,
        be.birth_season,
        be.place_id,
        p.display_name AS place_name,
        be.kitten_count_in_litter,
        be.survived_to_weaning,
        be.litter_survived_count,
        be.source_system,
        be.notes,
        be.created_at::TEXT
      FROM sot.cat_birth_events be
      LEFT JOIN sot.cats mc ON mc.cat_id = be.mother_cat_id
      LEFT JOIN sot.places p ON p.place_id = be.place_id
      WHERE be.cat_id = $1
    `;
    const birthEvent = await queryOne<BirthEvent>(birthSql, [id]);

    // Get siblings if part of a litter
    let siblings: Sibling[] = [];
    if (birthEvent?.litter_id) {
      const siblingsSql = `
        SELECT
          c.cat_id,
          c.display_name,
          c.sex,
          c.microchip
        FROM sot.cat_birth_events be
        JOIN sot.cats c ON c.cat_id = be.cat_id
        WHERE be.litter_id = $1 AND be.cat_id != $2
        LIMIT 10
      `;
      siblings = await queryRows<Sibling>(siblingsSql, [birthEvent.litter_id, id]);
    }

    return NextResponse.json({
      birth_event: birthEvent ?? null,
      siblings,
    });
  } catch (error) {
    console.error("Error fetching birth info:", error);
    return NextResponse.json(
      { error: "Failed to fetch birth information" },
      { status: 500 }
    );
  }
}

interface RegisterBirthBody {
  mother_cat_id?: string;
  birth_date?: string;
  birth_date_precision?: string;
  birth_year?: number;
  birth_month?: number;
  birth_season?: string;
  place_id?: string;
  kitten_count_in_litter?: number;
  survived_to_weaning?: boolean;
  litter_survived_count?: number;
  litter_id?: string; // To link to existing litter
  notes?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: "Cat ID is required" }, { status: 400 });
  }

  try {
    const body: RegisterBirthBody = await request.json();

    // Validate date precision if provided
    if (body.birth_date_precision && !VALID_DATE_PRECISIONS.includes(body.birth_date_precision as typeof VALID_DATE_PRECISIONS[number])) {
      return NextResponse.json(
        { error: `Invalid birth_date_precision. Must be one of: ${VALID_DATE_PRECISIONS.join(", ")}` },
        { status: 400 }
      );
    }

    // Validate season if provided
    if (body.birth_season && !VALID_SEASONS.includes(body.birth_season as typeof VALID_SEASONS[number])) {
      return NextResponse.json(
        { error: `Invalid birth_season. Must be one of: ${VALID_SEASONS.join(", ")}` },
        { status: 400 }
      );
    }

    // Validate month if provided
    if (body.birth_month !== undefined && (body.birth_month < 1 || body.birth_month > 12)) {
      return NextResponse.json(
        { error: "birth_month must be between 1 and 12" },
        { status: 400 }
      );
    }

    // Validate kitten count if provided
    if (body.kitten_count_in_litter !== undefined && body.kitten_count_in_litter < 1) {
      return NextResponse.json(
        { error: "kitten_count_in_litter must be at least 1" },
        { status: 400 }
      );
    }

    // Check if cat already has birth event
    const existing = await queryOne<{ birth_event_id: string }>(
      "SELECT birth_event_id FROM sot.cat_birth_events WHERE cat_id = $1",
      [id]
    );

    if (existing) {
      // Update existing record
      const updateSql = `
        UPDATE sot.cat_birth_events
        SET
          mother_cat_id = COALESCE($2::UUID, mother_cat_id),
          birth_date = COALESCE($3::DATE, birth_date),
          birth_date_precision = COALESCE($4, birth_date_precision),
          birth_year = COALESCE($5, birth_year),
          birth_month = COALESCE($6, birth_month),
          birth_season = COALESCE($7, birth_season),
          place_id = COALESCE($8::UUID, place_id),
          kitten_count_in_litter = COALESCE($9, kitten_count_in_litter),
          survived_to_weaning = COALESCE($10, survived_to_weaning),
          litter_survived_count = COALESCE($11, litter_survived_count),
          litter_id = COALESCE($12::UUID, litter_id),
          notes = COALESCE($13, notes),
          updated_at = NOW()
        WHERE cat_id = $1
        RETURNING birth_event_id
      `;

      const result = await queryOne<{ birth_event_id: string }>(updateSql, [
        id,
        body.mother_cat_id || null,
        body.birth_date || null,
        body.birth_date_precision || null,
        body.birth_year ?? null,
        body.birth_month ?? null,
        body.birth_season || null,
        body.place_id || null,
        body.kitten_count_in_litter ?? null,
        body.survived_to_weaning ?? null,
        body.litter_survived_count ?? null,
        body.litter_id || null,
        body.notes || null,
      ]);

      return NextResponse.json({
        success: true,
        message: "Birth event updated",
        birth_event_id: result?.birth_event_id,
        is_update: true,
      });
    }

    // Create new birth event
    const insertSql = `
      INSERT INTO sot.cat_birth_events (
        cat_id,
        mother_cat_id,
        birth_date,
        birth_date_precision,
        birth_year,
        birth_month,
        birth_season,
        place_id,
        kitten_count_in_litter,
        survived_to_weaning,
        litter_survived_count,
        litter_id,
        notes,
        source_system
      ) VALUES (
        $1,
        $2::UUID,
        $3::DATE,
        COALESCE($4, 'estimated'),
        $5,
        $6,
        $7,
        $8::UUID,
        $9,
        $10,
        $11,
        COALESCE($12::UUID, gen_random_uuid()),
        $13,
        'atlas_ui'
      )
      RETURNING birth_event_id, litter_id
    `;

    const result = await queryOne<{ birth_event_id: string; litter_id: string }>(insertSql, [
      id,
      body.mother_cat_id || null,
      body.birth_date || null,
      body.birth_date_precision || null,
      body.birth_year ?? null,
      body.birth_month ?? null,
      body.birth_season || null,
      body.place_id || null,
      body.kitten_count_in_litter ?? null,
      body.survived_to_weaning ?? null,
      body.litter_survived_count ?? null,
      body.litter_id || null,
      body.notes || null,
    ]);

    if (!result) {
      return NextResponse.json(
        { error: "Failed to create birth event" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Birth event recorded",
      birth_event_id: result.birth_event_id,
      litter_id: result.litter_id,
      is_update: false,
    });
  } catch (error) {
    console.error("Error recording birth:", error);
    return NextResponse.json(
      { error: "Failed to record birth event" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: "Cat ID is required" }, { status: 400 });
  }

  try {
    const deleteSql = `
      DELETE FROM sot.cat_birth_events
      WHERE cat_id = $1
      RETURNING birth_event_id
    `;

    const result = await queryOne<{ birth_event_id: string }>(deleteSql, [id]);

    if (!result) {
      return NextResponse.json(
        { error: "No birth event found for this cat" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Birth event removed",
    });
  } catch (error) {
    console.error("Error removing birth record:", error);
    return NextResponse.json(
      { error: "Failed to remove birth record" },
      { status: 500 }
    );
  }
}
