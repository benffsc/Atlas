import { NextRequest, NextResponse } from "next/server";
import { queryRows, query } from "@/lib/db";
import { requireRole, AuthError } from "@/lib/auth";

/**
 * Data Engine Matching Rules API
 *
 * GET: List all matching rules
 * PATCH: Update a matching rule
 */

interface MatchingRule {
  rule_id: number;
  rule_name: string;
  rule_category: string;
  primary_signal: string;
  secondary_signal: string | null;
  base_confidence: number;
  weight_multiplier: number;
  auto_match_threshold: number;
  review_threshold: number;
  reject_threshold: number;
  conditions: Record<string, unknown>;
  is_active: boolean;
  priority: number;
  applies_to_sources: string[];
  created_at: string;
  updated_at: string;
}

export async function GET(request: NextRequest) {
  try {
    // Require admin role
    await requireRole(request, ["admin"]);

    const rules = await queryRows<MatchingRule>(`
      SELECT
        rule_id,
        rule_name,
        rule_category,
        primary_signal,
        secondary_signal,
        base_confidence::numeric,
        weight_multiplier::numeric,
        auto_match_threshold::numeric,
        review_threshold::numeric,
        reject_threshold::numeric,
        conditions,
        is_active,
        priority,
        applies_to_sources,
        created_at::text,
        updated_at::text
      FROM sot.data_engine_matching_rules
      ORDER BY priority DESC, rule_name ASC
    `);

    return NextResponse.json({ rules });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }
    console.error("Error fetching matching rules:", error);
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
      rule_id,
      is_active,
      base_confidence,
      auto_match_threshold,
      review_threshold,
      priority,
      weight_multiplier,
    } = body;

    if (!rule_id) {
      return NextResponse.json(
        { error: "rule_id is required" },
        { status: 400 }
      );
    }

    // Build update query dynamically
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (is_active !== undefined) {
      updates.push(`is_active = $${paramIndex++}`);
      values.push(is_active);
    }

    if (base_confidence !== undefined) {
      updates.push(`base_confidence = $${paramIndex++}`);
      values.push(base_confidence);
    }

    if (auto_match_threshold !== undefined) {
      updates.push(`auto_match_threshold = $${paramIndex++}`);
      values.push(auto_match_threshold);
    }

    if (review_threshold !== undefined) {
      updates.push(`review_threshold = $${paramIndex++}`);
      values.push(review_threshold);
    }

    if (priority !== undefined) {
      updates.push(`priority = $${paramIndex++}`);
      values.push(priority);
    }

    if (weight_multiplier !== undefined) {
      updates.push(`weight_multiplier = $${paramIndex++}`);
      values.push(weight_multiplier);
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: "No updates provided" },
        { status: 400 }
      );
    }

    updates.push(`updated_at = NOW()`);
    values.push(rule_id);

    const sql = `
      UPDATE sot.data_engine_matching_rules
      SET ${updates.join(", ")}
      WHERE rule_id = $${paramIndex}
      RETURNING rule_id, rule_name, is_active, base_confidence::numeric, updated_at::text
    `;

    const result = await query(sql, values);

    if (!result.rows || result.rows.length === 0) {
      return NextResponse.json({ error: "Rule not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      rule: result.rows[0],
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }
    console.error("Error updating matching rule:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
