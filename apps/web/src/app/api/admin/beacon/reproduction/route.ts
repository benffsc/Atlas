import { NextRequest } from "next/server";
import { queryRows, query } from "@/lib/db";
import { apiSuccess, apiBadRequest, apiServerError } from "@/lib/api-response";

interface ReproductionRecord {
  vitals_id: string;
  cat_id: string;
  cat_name: string;
  place_name: string | null;
  is_pregnant: boolean;
  is_lactating: boolean;
  is_in_heat: boolean;
  recorded_at: string;
  source_system: string;
}

export async function GET() {
  try {
    const sql = `
      SELECT
        cv.vitals_id::TEXT,
        cv.cat_id::TEXT,
        c.display_name AS cat_name,
        p.display_name AS place_name,
        cv.is_pregnant,
        cv.is_lactating,
        cv.is_in_heat,
        cv.recorded_at::TEXT,
        cv.source_system
      FROM ops.cat_vitals cv
      JOIN sot.cats c ON c.cat_id = cv.cat_id
      -- V2: Uses sot.cat_place instead of sot.cat_place_relationships
      LEFT JOIN sot.cat_place cpr ON cpr.cat_id = cv.cat_id
      LEFT JOIN sot.places p ON p.place_id = cpr.place_id
      WHERE cv.is_pregnant = TRUE OR cv.is_lactating = TRUE OR cv.is_in_heat = TRUE
      ORDER BY cv.recorded_at DESC
      LIMIT 500
    `;

    const records = await queryRows<ReproductionRecord>(sql);

    return apiSuccess({ records });
  } catch (error) {
    console.error("Reproduction data fetch error:", error);
    return apiServerError("Failed to fetch reproduction data");
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { vitals_id, is_pregnant, is_lactating, is_in_heat } = body;

    if (!vitals_id) {
      return apiBadRequest("Missing vitals ID");
    }

    const updates: string[] = [];
    const params: (string | boolean)[] = [];
    let paramIndex = 1;

    if (is_pregnant !== undefined) {
      updates.push(`is_pregnant = $${paramIndex++}`);
      params.push(Boolean(is_pregnant));
    }
    if (is_lactating !== undefined) {
      updates.push(`is_lactating = $${paramIndex++}`);
      params.push(Boolean(is_lactating));
    }
    if (is_in_heat !== undefined) {
      updates.push(`is_in_heat = $${paramIndex++}`);
      params.push(Boolean(is_in_heat));
    }

    if (updates.length === 0) {
      return apiBadRequest("No fields to update");
    }

    params.push(vitals_id);

    await query(
      `UPDATE ops.cat_vitals SET ${updates.join(", ")} WHERE vitals_id = $${paramIndex}`,
      params
    );

    return apiSuccess({ success: true });
  } catch (error) {
    console.error("Reproduction update error:", error);
    return apiServerError("Failed to update reproduction data");
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const vitalsId = searchParams.get("id");

    if (!vitalsId) {
      return apiBadRequest("Missing vitals ID");
    }

    // Instead of deleting, we clear the reproduction flags
    // This preserves other vitals data while removing reproduction indicators
    await query(
      `UPDATE ops.cat_vitals
       SET is_pregnant = FALSE, is_lactating = FALSE, is_in_heat = FALSE
       WHERE vitals_id = $1`,
      [vitalsId]
    );

    return apiSuccess({ success: true });
  } catch (error) {
    console.error("Reproduction delete error:", error);
    return apiServerError("Failed to delete reproduction data");
  }
}
