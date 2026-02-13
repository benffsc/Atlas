import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne, execute } from "@/lib/db";

interface SourceConfidence {
  source_type: string;
  base_confidence: number;
  is_firsthand_boost: number;
  supersession_tier: number;
  description: string | null;
}

interface CountPrecision {
  precision_type: string;
  default_number_confidence: number;
  description: string | null;
  examples: string[];
}

/**
 * GET /api/admin/colony-estimation
 * Returns all colony estimation configuration
 */
export async function GET() {
  try {
    // Get source confidence settings
    const sourceConfidence = await queryRows<SourceConfidence>(`
      SELECT
        source_type,
        base_confidence,
        COALESCE(is_firsthand_boost, 0.05) as is_firsthand_boost,
        COALESCE(supersession_tier, 1) as supersession_tier,
        description
      FROM sot.colony_source_confidence
      ORDER BY supersession_tier DESC, base_confidence DESC
    `);

    // Get count precision factors
    const countPrecision = await queryRows<CountPrecision>(`
      SELECT
        precision_type,
        default_number_confidence,
        description,
        examples
      FROM trapper.count_precision_factors
      ORDER BY default_number_confidence DESC
    `);

    // Get supersession statistics
    const supersessionStats = await queryOne<{
      total_estimates: number;
      active_estimates: number;
      superseded_estimates: number;
      excluded_estimates: number;
    }>(`
      SELECT
        COUNT(*) as total_estimates,
        COUNT(*) FILTER (WHERE (is_superseded IS NULL OR is_superseded = FALSE) AND (is_excluded IS NULL OR is_excluded = FALSE)) as active_estimates,
        COUNT(*) FILTER (WHERE is_superseded = TRUE) as superseded_estimates,
        COUNT(*) FILTER (WHERE is_excluded = TRUE) as excluded_estimates
      FROM sot.place_colony_estimates
      WHERE total_cats IS NOT NULL
    `);

    return NextResponse.json({
      source_confidence: sourceConfidence,
      count_precision: countPrecision,
      stats: supersessionStats || {
        total_estimates: 0,
        active_estimates: 0,
        superseded_estimates: 0,
        excluded_estimates: 0,
      },
    });
  } catch (error) {
    console.error("Error fetching colony estimation config:", error);
    return NextResponse.json(
      { error: "Failed to fetch configuration" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/colony-estimation
 * Update source confidence or count precision settings
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, ...data } = body;

    if (type === "source_confidence") {
      const { source_type, base_confidence, is_firsthand_boost, supersession_tier, description } = data;

      if (!source_type) {
        return NextResponse.json({ error: "source_type required" }, { status: 400 });
      }

      await execute(
        `INSERT INTO sot.colony_source_confidence
          (source_type, base_confidence, is_firsthand_boost, supersession_tier, description)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (source_type) DO UPDATE SET
           base_confidence = COALESCE($2, colony_source_confidence.base_confidence),
           is_firsthand_boost = COALESCE($3, colony_source_confidence.is_firsthand_boost),
           supersession_tier = COALESCE($4, colony_source_confidence.supersession_tier),
           description = COALESCE($5, colony_source_confidence.description)`,
        [source_type, base_confidence, is_firsthand_boost, supersession_tier, description]
      );

      return NextResponse.json({ success: true, source_type });
    }

    if (type === "count_precision") {
      const { precision_type, default_number_confidence, description, examples } = data;

      if (!precision_type) {
        return NextResponse.json({ error: "precision_type required" }, { status: 400 });
      }

      await execute(
        `INSERT INTO trapper.count_precision_factors
          (precision_type, default_number_confidence, description, examples)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (precision_type) DO UPDATE SET
           default_number_confidence = COALESCE($2, count_precision_factors.default_number_confidence),
           description = COALESCE($3, count_precision_factors.description),
           examples = COALESCE($4, count_precision_factors.examples)`,
        [precision_type, default_number_confidence, description, examples]
      );

      return NextResponse.json({ success: true, precision_type });
    }

    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  } catch (error) {
    console.error("Error updating colony estimation config:", error);
    return NextResponse.json(
      { error: "Failed to update configuration" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/colony-estimation
 * Delete a source type or precision type
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type");
    const key = searchParams.get("key");

    if (!type || !key) {
      return NextResponse.json({ error: "type and key required" }, { status: 400 });
    }

    if (type === "source_confidence") {
      // Don't allow deleting core source types
      const coreTypes = ["verified_cats", "trapper_report", "trapping_request", "intake_form"];
      if (coreTypes.includes(key)) {
        return NextResponse.json({ error: "Cannot delete core source type" }, { status: 400 });
      }

      await execute(
        `DELETE FROM sot.colony_source_confidence WHERE source_type = $1`,
        [key]
      );
    } else if (type === "count_precision") {
      // Don't allow deleting core precision types
      const coreTypes = ["exact", "approximate", "range", "lower_bound"];
      if (coreTypes.includes(key)) {
        return NextResponse.json({ error: "Cannot delete core precision type" }, { status: 400 });
      }

      await execute(
        `DELETE FROM trapper.count_precision_factors WHERE precision_type = $1`,
        [key]
      );
    } else {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting colony estimation config:", error);
    return NextResponse.json(
      { error: "Failed to delete configuration" },
      { status: 500 }
    );
  }
}
