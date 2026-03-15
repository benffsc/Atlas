import { queryRows, queryOne } from "@/lib/db";
import { apiSuccess, apiBadRequest, apiNotFound, apiServerError } from "@/lib/api-response";
import { requireValidUUID } from "@/lib/api-validation";
import { NextRequest } from "next/server";

interface EquipmentRow {
  equipment_id: string;
  equipment_type: string;
  equipment_name: string | null;
  serial_number: string | null;
  condition: string | null;
  notes: string | null;
  is_available: boolean;
  source_system: string;
  created_at: string;
  active_checkout_person: string | null;
  active_checkout_date: string | null;
  total_checkouts: number;
}

interface EquipmentStats {
  total: number;
  available: number;
  checked_out: number;
  by_type: Array<{ equipment_type: string; count: number }>;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const typeFilter = searchParams.get("type");
    const availableFilter = searchParams.get("available");

    let whereClause = "WHERE 1=1";
    const params: unknown[] = [];
    let paramIdx = 1;

    if (typeFilter) {
      whereClause += ` AND e.equipment_type = $${paramIdx}`;
      params.push(typeFilter);
      paramIdx++;
    }
    if (availableFilter === "true") {
      whereClause += " AND e.is_available = TRUE";
    } else if (availableFilter === "false") {
      whereClause += " AND e.is_available = FALSE";
    }

    const equipment = await queryRows<EquipmentRow>(
      `
      SELECT
        e.equipment_id,
        e.equipment_type,
        e.equipment_name,
        e.serial_number,
        e.condition,
        e.notes,
        e.is_available,
        e.source_system,
        e.created_at,
        p.display_name AS active_checkout_person,
        ac.checked_out_at::text AS active_checkout_date,
        COALESCE(tc.total_checkouts, 0)::int AS total_checkouts
      FROM ops.equipment e
      LEFT JOIN LATERAL (
        SELECT ec.person_id, ec.checked_out_at
        FROM ops.equipment_checkouts ec
        WHERE ec.equipment_id = e.equipment_id AND ec.returned_at IS NULL
        ORDER BY ec.checked_out_at DESC
        LIMIT 1
      ) ac ON TRUE
      LEFT JOIN sot.people p ON p.person_id = ac.person_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS total_checkouts
        FROM ops.equipment_checkouts ec2
        WHERE ec2.equipment_id = e.equipment_id
      ) tc ON TRUE
      ${whereClause}
      ORDER BY e.equipment_type, e.equipment_name, e.created_at
      `,
      params
    );

    const stats = await queryOne<EquipmentStats>(
      `
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE is_available)::int AS available,
        COUNT(*) FILTER (WHERE NOT is_available)::int AS checked_out,
        (
          SELECT jsonb_agg(jsonb_build_object('equipment_type', sub.equipment_type, 'count', sub.cnt))
          FROM (
            SELECT equipment_type, COUNT(*)::int AS cnt
            FROM ops.equipment
            GROUP BY equipment_type
            ORDER BY cnt DESC
          ) sub
        ) AS by_type
      FROM ops.equipment
      `
    );

    const types = await queryRows<{ equipment_type: string }>(
      `SELECT DISTINCT equipment_type FROM ops.equipment ORDER BY equipment_type`
    );

    return apiSuccess({
      equipment,
      stats: {
        total: stats?.total || 0,
        available: stats?.available || 0,
        checked_out: stats?.checked_out || 0,
        by_type: stats?.by_type || [],
      },
      equipment_types: types.map(t => t.equipment_type),
    });
  } catch (error) {
    console.error("Equipment list error:", error);
    return apiServerError("Failed to fetch equipment");
  }
}

/**
 * POST /api/admin/equipment
 * Actions: checkout, return
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, equipment_id, person_id, notes } = body;

    if (!action || !equipment_id) {
      return apiBadRequest("action and equipment_id are required");
    }

    requireValidUUID(equipment_id, "equipment");

    if (action === "checkout") {
      if (!person_id) {
        return apiBadRequest("person_id is required for checkout");
      }
      requireValidUUID(person_id, "person");

      // Verify equipment exists and is available
      const equip = await queryOne<{ is_available: boolean }>(
        `SELECT is_available FROM ops.equipment WHERE equipment_id = $1`,
        [equipment_id]
      );
      if (!equip) return apiNotFound("equipment", equipment_id);
      if (!equip.is_available) return apiBadRequest("Equipment is already checked out");

      // Create checkout record and mark unavailable
      const checkout = await queryOne<{ checkout_id: string }>(
        `INSERT INTO ops.equipment_checkouts (equipment_id, person_id, checked_out_at, notes, source_system)
         VALUES ($1, $2, NOW(), $3, 'atlas_ui')
         RETURNING checkout_id`,
        [equipment_id, person_id, notes || null]
      );

      await queryOne(
        `UPDATE ops.equipment SET is_available = FALSE WHERE equipment_id = $1`,
        [equipment_id]
      );

      return apiSuccess({ checkout_id: checkout?.checkout_id, action: "checked_out" });

    } else if (action === "return") {
      // Find active checkout
      const activeCheckout = await queryOne<{ checkout_id: string }>(
        `SELECT checkout_id FROM ops.equipment_checkouts
         WHERE equipment_id = $1 AND returned_at IS NULL
         ORDER BY checked_out_at DESC LIMIT 1`,
        [equipment_id]
      );

      if (!activeCheckout) return apiBadRequest("No active checkout found for this equipment");

      // Mark returned and equipment available
      await queryOne(
        `UPDATE ops.equipment_checkouts SET returned_at = NOW() WHERE checkout_id = $1`,
        [activeCheckout.checkout_id]
      );

      await queryOne(
        `UPDATE ops.equipment SET is_available = TRUE WHERE equipment_id = $1`,
        [equipment_id]
      );

      return apiSuccess({ checkout_id: activeCheckout.checkout_id, action: "returned" });

    } else {
      return apiBadRequest(`Unknown action: ${action}. Expected 'checkout' or 'return'`);
    }
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") {
      return apiBadRequest(error.message);
    }
    console.error("Equipment action error:", error);
    return apiServerError("Failed to process equipment action");
  }
}
