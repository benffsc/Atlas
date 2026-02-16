import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";

interface DiseaseType {
  disease_key: string;
  display_label: string;
  short_code: string;
  color: string;
  severity_order: number;
  decay_window_months: number | null;
  is_contagious: boolean;
  description: string | null;
  is_active: boolean;
  created_at: string;
  active_place_count: number;
  historical_place_count: number;
  total_place_count: number;
}

// Get all disease types with place counts
export async function GET() {
  try {
    const diseaseTypes = await queryRows<DiseaseType>(
      `
      SELECT
        dt.disease_key,
        dt.display_label,
        dt.short_code,
        dt.badge_color as color,
        dt.severity_order,
        dt.decay_window_months,
        dt.is_contagious,
        dt.description,
        dt.is_active,
        dt.created_at,
        COALESCE(stats.active_count, 0) as active_place_count,
        COALESCE(stats.historical_count, 0) as historical_place_count,
        COALESCE(stats.total_count, 0) as total_place_count
      FROM ops.disease_types dt
      LEFT JOIN (
        SELECT
          disease_type_key,
          COUNT(*) FILTER (WHERE status IN ('confirmed_active', 'perpetual')) as active_count,
          COUNT(*) FILTER (WHERE status = 'historical') as historical_count,
          COUNT(*) as total_count
        FROM ops.place_disease_status
        WHERE status NOT IN ('false_flag', 'cleared')
        GROUP BY disease_type_key
      ) stats ON stats.disease_type_key = dt.disease_key
      ORDER BY dt.severity_order
      `
    );

    return NextResponse.json({ disease_types: diseaseTypes });
  } catch (error) {
    console.error("Error fetching disease types:", error);
    return NextResponse.json(
      { error: "Failed to fetch disease types" },
      { status: 500 }
    );
  }
}

// Create a new disease type
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      disease_key,
      display_label,
      short_code,
      color,
      decay_window_months,
      is_contagious,
      description,
    } = body;

    // Validate disease_key: alphanumeric/underscore, lowercase, 2-30 chars
    if (
      !disease_key ||
      typeof disease_key !== "string" ||
      !/^[a-z0-9_]{2,30}$/.test(disease_key)
    ) {
      return NextResponse.json(
        {
          error:
            "disease_key must be lowercase alphanumeric/underscore, 2-30 characters",
        },
        { status: 400 }
      );
    }

    // Validate display_label is non-empty
    if (!display_label || typeof display_label !== "string" || !display_label.trim()) {
      return NextResponse.json(
        { error: "display_label is required and must be non-empty" },
        { status: 400 }
      );
    }

    // Validate short_code is exactly 1 uppercase letter
    if (
      !short_code ||
      typeof short_code !== "string" ||
      !/^[A-Z]$/.test(short_code)
    ) {
      return NextResponse.json(
        { error: "short_code must be exactly 1 uppercase letter" },
        { status: 400 }
      );
    }

    // Validate color is valid hex
    if (
      !color ||
      typeof color !== "string" ||
      !/^#[0-9a-fA-F]{6}$/.test(color)
    ) {
      return NextResponse.json(
        { error: "color must be a valid hex color (e.g. #FF0000)" },
        { status: 400 }
      );
    }

    const result = await queryOne(
      `
      INSERT INTO ops.disease_types (
        disease_key, display_label, short_code, color,
        decay_window_months, is_contagious, description
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
      `,
      [
        disease_key,
        display_label.trim(),
        short_code,
        color,
        decay_window_months ?? null,
        is_contagious ?? false,
        description || null,
      ]
    );

    return NextResponse.json({ success: true, disease_type: result });
  } catch (error) {
    console.error("Error creating disease type:", error);
    if (
      error instanceof Error &&
      error.message.includes("duplicate key")
    ) {
      return NextResponse.json(
        { error: "A disease type with this key or short code already exists" },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: "Failed to create disease type" },
      { status: 500 }
    );
  }
}

// Update an existing disease type
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { disease_key } = body;

    if (!disease_key || typeof disease_key !== "string") {
      return NextResponse.json(
        { error: "disease_key is required to identify the record to update" },
        { status: 400 }
      );
    }

    // Only allow updating these fields
    const allowedFields: Record<string, string> = {
      display_label: "display_label",
      decay_window_months: "decay_window_months",
      color: "color",
      is_contagious: "is_contagious",
      description: "description",
      is_active: "is_active",
      severity_order: "severity_order",
    };

    const setClauses: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    for (const [field, column] of Object.entries(allowedFields)) {
      if (field in body && field !== "disease_key") {
        // Validate color if provided
        if (field === "color" && body[field] !== undefined) {
          if (typeof body[field] !== "string" || !/^#[0-9a-fA-F]{6}$/.test(body[field])) {
            return NextResponse.json(
              { error: "color must be a valid hex color (e.g. #FF0000)" },
              { status: 400 }
            );
          }
        }

        // Validate display_label if provided
        if (field === "display_label" && body[field] !== undefined) {
          if (typeof body[field] !== "string" || !body[field].trim()) {
            return NextResponse.json(
              { error: "display_label must be non-empty" },
              { status: 400 }
            );
          }
        }

        setClauses.push(`${column} = $${paramIndex}`);
        params.push(body[field]);
        paramIndex++;
      }
    }

    if (setClauses.length === 0) {
      return NextResponse.json(
        { error: "No valid fields provided to update" },
        { status: 400 }
      );
    }

    params.push(disease_key);

    const result = await queryOne(
      `
      UPDATE ops.disease_types
      SET ${setClauses.join(", ")}
      WHERE disease_key = $${paramIndex}
      RETURNING *
      `,
      params
    );

    if (!result) {
      return NextResponse.json(
        { error: `Disease type '${disease_key}' not found` },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, disease_type: result });
  } catch (error) {
    console.error("Error updating disease type:", error);
    return NextResponse.json(
      { error: "Failed to update disease type" },
      { status: 500 }
    );
  }
}
