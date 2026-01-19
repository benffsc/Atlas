import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne, query } from "@/lib/db";
import { getSession } from "@/lib/auth";

/**
 * GET /api/admin/data-improvements
 * List data improvements with filtering
 */
export async function GET(request: NextRequest) {
  try {
    // Require admin auth
    const session = await getSession(request);
    if (!session || session.auth_role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "pending";
    const category = searchParams.get("category");
    const priority = searchParams.get("priority");
    const limit = parseInt(searchParams.get("limit") || "100");
    const offset = parseInt(searchParams.get("offset") || "0");

    // Build WHERE clause
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (status && status !== "all") {
      conditions.push(`di.status = $${paramIndex++}`);
      params.push(status);
    }
    if (category) {
      conditions.push(`di.category = $${paramIndex++}`);
      params.push(category);
    }
    if (priority) {
      conditions.push(`di.priority = $${paramIndex++}`);
      params.push(priority);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Get improvements with entity details
    const improvements = await queryRows(
      `
      SELECT
        di.improvement_id,
        di.title,
        di.description,
        di.entity_type,
        di.entity_id,
        di.category,
        di.priority,
        di.suggested_fix,
        di.fix_sql,
        di.source,
        di.source_reference_id,
        di.status,
        di.assigned_to,
        a.display_name as assigned_name,
        di.resolved_by,
        rb.display_name as resolver_name,
        di.resolved_at,
        di.resolution_notes,
        di.created_at,
        di.updated_at,
        -- Entity details
        CASE
          WHEN di.entity_type = 'place' THEN (SELECT label FROM trapper.places WHERE place_id = di.entity_id)
          WHEN di.entity_type = 'cat' THEN (SELECT name FROM trapper.sot_cats WHERE cat_id = di.entity_id)
          WHEN di.entity_type = 'person' THEN (SELECT display_name FROM trapper.sot_people WHERE person_id = di.entity_id)
          WHEN di.entity_type = 'request' THEN (SELECT short_address FROM trapper.sot_requests WHERE request_id = di.entity_id)
          ELSE NULL
        END as entity_name
      FROM trapper.data_improvements di
      LEFT JOIN trapper.staff a ON a.staff_id = di.assigned_to
      LEFT JOIN trapper.staff rb ON rb.staff_id = di.resolved_by
      ${whereClause}
      ORDER BY
        CASE di.priority
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'normal' THEN 3
          WHEN 'low' THEN 4
        END,
        di.created_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex}
      `,
      [...params, limit, offset]
    );

    // Get counts by status
    const counts = await queryOne(
      `
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'confirmed') as confirmed,
        COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress,
        COUNT(*) FILTER (WHERE status = 'resolved') as resolved,
        COUNT(*) FILTER (WHERE status = 'rejected') as rejected,
        COUNT(*) FILTER (WHERE status = 'wont_fix') as wont_fix,
        COUNT(*) as total
      FROM trapper.data_improvements
      `
    );

    return NextResponse.json({
      improvements,
      counts,
      pagination: {
        limit,
        offset,
        hasMore: improvements.length === limit,
      },
    });
  } catch (error) {
    console.error("Data improvements list error:", error);
    return NextResponse.json(
      { error: "Failed to fetch improvements" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/data-improvements
 * Create a new data improvement manually
 */
export async function POST(request: NextRequest) {
  try {
    // Require admin auth
    const session = await getSession(request);
    if (!session || session.auth_role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const body = await request.json();
    const {
      title,
      description,
      entity_type,
      entity_id,
      category,
      priority,
      suggested_fix,
      fix_sql,
    } = body;

    // Validate required fields
    if (!title || !description || !category) {
      return NextResponse.json(
        { error: "Missing required fields: title, description, category" },
        { status: 400 }
      );
    }

    // Validate category
    const validCategories = [
      "data_correction",
      "duplicate_entity",
      "missing_data",
      "stale_data",
      "schema_issue",
      "business_rule",
      "other",
    ];
    if (!validCategories.includes(category)) {
      return NextResponse.json(
        { error: `Invalid category. Must be one of: ${validCategories.join(", ")}` },
        { status: 400 }
      );
    }

    const improvement = await queryOne<{ improvement_id: string; created_at: string }>(
      `
      INSERT INTO trapper.data_improvements (
        title,
        description,
        entity_type,
        entity_id,
        category,
        priority,
        suggested_fix,
        fix_sql,
        source
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'admin_report')
      RETURNING improvement_id, created_at
      `,
      [
        title,
        description,
        entity_type || null,
        entity_id || null,
        category,
        priority || "normal",
        suggested_fix ? JSON.stringify(suggested_fix) : null,
        fix_sql || null,
      ]
    );

    if (!improvement) {
      return NextResponse.json(
        { error: "Failed to create improvement" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      improvement_id: improvement.improvement_id,
    });
  } catch (error) {
    console.error("Data improvement create error:", error);
    return NextResponse.json(
      { error: "Failed to create improvement" },
      { status: 500 }
    );
  }
}
