import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const ACTION_TO_STATUS: Record<string, string> = {
  confirm: "confirmed_active",
  dismiss: "false_flag",
  set_perpetual: "perpetual",
  clear: "cleared",
  set_historical: "historical",
  suspect: "suspected",
};

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Place ID is required" },
      { status: 400 }
    );
  }

  try {
    const statusesSql = `
      SELECT
        pds.status_id,
        pds.disease_type_key as disease_key,
        dt.display_label,
        dt.short_code,
        dt.color,
        dt.severity_order,
        dt.decay_window_months as default_decay_months,
        dt.is_contagious,
        pds.status,
        pds.evidence_source,
        pds.first_positive_date,
        pds.last_positive_date,
        COALESCE(pds.decay_window_override, dt.decay_window_months) as effective_decay_months,
        pds.positive_cat_count,
        pds.total_tested_count,
        pds.notes,
        pds.set_by,
        pds.set_at,
        pds.updated_at
      FROM ops.place_disease_status pds
      JOIN ops.disease_types dt ON dt.disease_key = pds.disease_type_key
      WHERE pds.place_id = $1
      ORDER BY dt.severity_order
    `;

    const diseaseTypesSql = `
      SELECT disease_key, display_label, short_code, badge_color as color, decay_window_months, is_contagious
      FROM ops.disease_types
      WHERE is_active = TRUE
      ORDER BY severity_order
    `;

    const [statuses, diseaseTypes] = await Promise.all([
      queryRows(statusesSql, [id]),
      queryRows(diseaseTypesSql),
    ]);

    return NextResponse.json({ statuses, disease_types: diseaseTypes });
  } catch (error) {
    console.error("Error fetching place disease statuses:", error);
    return NextResponse.json(
      { error: "Failed to fetch disease statuses" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Place ID is required" },
      { status: 400 }
    );
  }

  try {
    const body = await request.json();
    const { disease_key, action, notes, staff_id } = body as {
      disease_key?: string;
      action?: string;
      notes?: string;
      staff_id?: string;
    };

    if (!disease_key || !action) {
      return NextResponse.json(
        { error: "disease_key and action are required" },
        { status: 400 }
      );
    }

    const mappedStatus = ACTION_TO_STATUS[action];
    if (!mappedStatus) {
      return NextResponse.json(
        {
          error: `Invalid action. Must be one of: ${Object.keys(ACTION_TO_STATUS).join(", ")}`,
        },
        { status: 400 }
      );
    }

    const result = await queryOne<{ set_place_disease_override: string }>(
      `SELECT ops.set_place_disease_override($1, $2, $3, $4, $5)`,
      [id, disease_key, mappedStatus, notes || null, staff_id || "staff"]
    );

    return NextResponse.json({
      success: true,
      status_id: result?.set_place_disease_override ?? null,
    });
  } catch (error) {
    console.error("Error setting disease status override:", error);
    return NextResponse.json(
      { error: "Failed to set disease status override" },
      { status: 500 }
    );
  }
}
