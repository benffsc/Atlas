import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne, query } from "@/lib/db";

interface AutomationRule {
  rule_id: string;
  name: string;
  description: string | null;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  action_type: string;
  action_config: Record<string, unknown>;
  is_active: boolean;
  execution_count: number;
  last_executed_at: string | null;
  created_at: string;
  updated_at: string;
}

// GET /api/admin/automations - List all automation rules
export async function GET() {
  try {
    const rules = await queryRows<AutomationRule>(`
      SELECT
        rule_id,
        name,
        description,
        trigger_type,
        trigger_config,
        action_type,
        action_config,
        is_active,
        COALESCE(execution_count, 0)::INT AS execution_count,
        last_executed_at::TEXT,
        created_at::TEXT,
        updated_at::TEXT
      FROM ops.automation_rules
      ORDER BY is_active DESC, name
    `);

    // Get available email templates for dropdown
    const templates = await queryRows<{ template_key: string; name: string }>(`
      SELECT template_key, name FROM ops.email_templates WHERE is_active = TRUE ORDER BY name
    `);

    return NextResponse.json({ rules, templates });
  } catch (error) {
    console.error("Error fetching automations:", error);
    return NextResponse.json(
      { error: "Failed to fetch automations" },
      { status: 500 }
    );
  }
}

// POST /api/admin/automations - Create new rule
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      name,
      description,
      trigger_type,
      trigger_config,
      action_type,
      action_config,
    } = body;

    if (!name || !trigger_type || !action_type) {
      return NextResponse.json(
        { error: "name, trigger_type, and action_type are required" },
        { status: 400 }
      );
    }

    const result = await queryOne<{ rule_id: string }>(`
      INSERT INTO ops.automation_rules (
        name, description, trigger_type, trigger_config, action_type, action_config
      ) VALUES ($1, $2, $3, $4::JSONB, $5, $6::JSONB)
      RETURNING rule_id
    `, [
      name,
      description || null,
      trigger_type,
      JSON.stringify(trigger_config || {}),
      action_type,
      JSON.stringify(action_config || {}),
    ]);

    return NextResponse.json({
      success: true,
      rule_id: result?.rule_id,
    });
  } catch (error) {
    console.error("Error creating automation:", error);
    return NextResponse.json(
      { error: "Failed to create automation" },
      { status: 500 }
    );
  }
}

// PATCH /api/admin/automations - Update rule
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { rule_id, ...updates } = body;

    if (!rule_id) {
      return NextResponse.json(
        { error: "rule_id is required" },
        { status: 400 }
      );
    }

    const allowedFields = [
      "name",
      "description",
      "trigger_type",
      "trigger_config",
      "action_type",
      "action_config",
      "is_active",
    ];

    const setClause: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        if (key === "trigger_config" || key === "action_config") {
          setClause.push(`${key} = $${paramIndex++}::JSONB`);
          values.push(JSON.stringify(value));
        } else {
          setClause.push(`${key} = $${paramIndex++}`);
          values.push(value);
        }
      }
    }

    if (setClause.length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    setClause.push(`updated_at = NOW()`);
    values.push(rule_id);

    await query(
      `UPDATE ops.automation_rules
       SET ${setClause.join(", ")}
       WHERE rule_id = $${paramIndex}`,
      values
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating automation:", error);
    return NextResponse.json(
      { error: "Failed to update automation" },
      { status: 500 }
    );
  }
}

// DELETE /api/admin/automations
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const ruleId = searchParams.get("rule_id");

  if (!ruleId) {
    return NextResponse.json(
      { error: "rule_id is required" },
      { status: 400 }
    );
  }

  try {
    await query(
      `DELETE FROM ops.automation_rules WHERE rule_id = $1`,
      [ruleId]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting automation:", error);
    return NextResponse.json(
      { error: "Failed to delete automation" },
      { status: 500 }
    );
  }
}
