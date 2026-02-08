import { NextRequest, NextResponse } from "next/server";
import { queryRows, query } from "@/lib/db";
import { requireRole, AuthError } from "@/lib/auth";

/**
 * Fellegi-Sunter Parameters API
 *
 * GET: List all F-S parameters (M/U probabilities and computed weights)
 * PATCH: Update M/U values for a field
 */

interface FSParameter {
  param_id: number;
  field_name: string;
  m_probability: number;
  u_probability: number;
  agreement_weight: number;
  disagreement_weight: number;
  field_type: string;
  comparison_function: string | null;
  description: string | null;
  last_calibrated_at: string | null;
  calibration_sample_size: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export async function GET(request: NextRequest) {
  try {
    // Require admin role
    await requireRole(request, ["admin"]);

    const parameters = await queryRows<FSParameter>(`
      SELECT
        param_id,
        field_name,
        m_probability::numeric,
        u_probability::numeric,
        agreement_weight::numeric,
        disagreement_weight::numeric,
        field_type,
        comparison_function,
        description,
        last_calibrated_at::text,
        calibration_sample_size,
        is_active,
        created_at::text,
        updated_at::text
      FROM trapper.fellegi_sunter_parameters
      ORDER BY agreement_weight DESC
    `);

    return NextResponse.json({ parameters });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }
    console.error("Error fetching F-S parameters:", error);
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
      field_name,
      m_probability,
      u_probability,
      is_active,
      description,
    } = body;

    if (!field_name) {
      return NextResponse.json(
        { error: "field_name is required" },
        { status: 400 }
      );
    }

    // Validate probability ranges
    if (m_probability !== undefined) {
      if (m_probability <= 0 || m_probability >= 1) {
        return NextResponse.json(
          { error: "m_probability must be between 0 and 1 (exclusive)" },
          { status: 400 }
        );
      }
    }

    if (u_probability !== undefined) {
      if (u_probability <= 0 || u_probability >= 1) {
        return NextResponse.json(
          { error: "u_probability must be between 0 and 1 (exclusive)" },
          { status: 400 }
        );
      }
    }

    // Build update query dynamically
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (m_probability !== undefined) {
      updates.push(`m_probability = $${paramIndex++}`);
      values.push(m_probability);
    }

    if (u_probability !== undefined) {
      updates.push(`u_probability = $${paramIndex++}`);
      values.push(u_probability);
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
    values.push(field_name);

    const sql = `
      UPDATE trapper.fellegi_sunter_parameters
      SET ${updates.join(", ")}
      WHERE field_name = $${paramIndex}
      RETURNING
        param_id,
        field_name,
        m_probability::numeric,
        u_probability::numeric,
        agreement_weight::numeric,
        disagreement_weight::numeric,
        is_active,
        updated_at::text
    `;

    const result = await query(sql, values);

    if (!result.rows || result.rows.length === 0) {
      return NextResponse.json(
        { error: "Parameter not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      parameter: result.rows[0],
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }
    console.error("Error updating F-S parameter:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
