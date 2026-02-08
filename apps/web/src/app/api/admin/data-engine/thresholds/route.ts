import { NextRequest, NextResponse } from "next/server";
import { queryRows, query } from "@/lib/db";
import { requireRole, AuthError } from "@/lib/auth";

/**
 * Fellegi-Sunter Thresholds API
 *
 * GET: List all threshold configurations
 * PATCH: Update thresholds for a source system
 */

interface FSThreshold {
  threshold_id: number;
  source_system: string;
  upper_threshold: number;
  lower_threshold: number;
  upper_probability: number;
  lower_probability: number;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export async function GET(request: NextRequest) {
  try {
    // Require admin role
    await requireRole(request, ["admin"]);

    const thresholds = await queryRows<FSThreshold>(`
      SELECT
        threshold_id,
        source_system,
        upper_threshold::numeric,
        lower_threshold::numeric,
        upper_probability::numeric,
        lower_probability::numeric,
        description,
        is_active,
        created_at::text,
        updated_at::text
      FROM trapper.fellegi_sunter_thresholds
      ORDER BY source_system
    `);

    return NextResponse.json({ thresholds });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }
    console.error("Error fetching F-S thresholds:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    // Require admin role
    await requireRole(request, ["admin"]);

    const body = await request.json();
    const {
      source_system,
      upper_threshold,
      lower_threshold,
      is_active,
      description,
    } = body;

    if (!source_system) {
      return NextResponse.json(
        { error: "source_system is required" },
        { status: 400 }
      );
    }

    // Validate threshold logic
    if (upper_threshold !== undefined && lower_threshold !== undefined) {
      if (upper_threshold <= lower_threshold) {
        return NextResponse.json(
          { error: "upper_threshold must be greater than lower_threshold" },
          { status: 400 }
        );
      }
    }

    // Build update query dynamically
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (upper_threshold !== undefined) {
      updates.push(`upper_threshold = $${paramIndex++}`);
      values.push(upper_threshold);
    }

    if (lower_threshold !== undefined) {
      updates.push(`lower_threshold = $${paramIndex++}`);
      values.push(lower_threshold);
    }

    if (is_active !== undefined) {
      updates.push(`is_active = $${paramIndex++}`);
      values.push(is_active);
    }

    if (description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(description);
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: "No updates provided" },
        { status: 400 }
      );
    }

    updates.push(`updated_at = NOW()`);
    values.push(source_system);

    const sql = `
      UPDATE trapper.fellegi_sunter_thresholds
      SET ${updates.join(", ")}
      WHERE source_system = $${paramIndex}
      RETURNING
        threshold_id,
        source_system,
        upper_threshold::numeric,
        lower_threshold::numeric,
        upper_probability::numeric,
        lower_probability::numeric,
        is_active,
        updated_at::text
    `;

    const result = await query(sql, values);

    if (!result.rows || result.rows.length === 0) {
      return NextResponse.json(
        { error: "Threshold configuration not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      threshold: result.rows[0],
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }
    console.error("Error updating F-S threshold:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    // Require admin role
    await requireRole(request, ["admin"]);

    const body = await request.json();
    const {
      source_system,
      upper_threshold,
      lower_threshold,
      description,
    } = body;

    if (!source_system) {
      return NextResponse.json(
        { error: "source_system is required" },
        { status: 400 }
      );
    }

    if (upper_threshold === undefined || lower_threshold === undefined) {
      return NextResponse.json(
        { error: "upper_threshold and lower_threshold are required" },
        { status: 400 }
      );
    }

    if (upper_threshold <= lower_threshold) {
      return NextResponse.json(
        { error: "upper_threshold must be greater than lower_threshold" },
        { status: 400 }
      );
    }

    const result = await query(
      `
      INSERT INTO trapper.fellegi_sunter_thresholds
      (source_system, upper_threshold, lower_threshold, description)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (source_system) DO UPDATE SET
        upper_threshold = EXCLUDED.upper_threshold,
        lower_threshold = EXCLUDED.lower_threshold,
        description = EXCLUDED.description,
        updated_at = NOW()
      RETURNING
        threshold_id,
        source_system,
        upper_threshold::numeric,
        lower_threshold::numeric,
        upper_probability::numeric,
        lower_probability::numeric,
        is_active,
        created_at::text,
        updated_at::text
    `,
      [source_system, upper_threshold, lower_threshold, description]
    );

    return NextResponse.json({
      success: true,
      threshold: result.rows[0],
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }
    console.error("Error creating F-S threshold:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
