import { NextRequest } from "next/server";
import { queryOne, queryRows } from "@/lib/db";
import { apiBadRequest, apiNotFound, apiSuccess, apiServerError } from "@/lib/api-response";

interface SetOverrideBody {
  count: number;
  altered?: number;
  note?: string;
  changed_by?: string;
}

interface ClearOverrideBody {
  reason?: string;
  changed_by?: string;
}

// POST /api/places/[id]/colony-override - Set manual override
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return apiBadRequest("Place ID is required");
  }

  try {
    const body: SetOverrideBody = await request.json();

    if (typeof body.count !== "number" || body.count < 0) {
      return apiBadRequest("count must be a non-negative number");
    }

    // Use the set_colony_override function
    const result = await queryOne<{
      success: boolean;
      message: string;
      previous_count: number | null;
      previous_altered: number | null;
    }>(
      `SELECT * FROM ops.set_colony_override($1, $2, $3, $4, $5)`,
      [
        id,
        body.count,
        body.altered ?? null,
        body.note ?? null,
        body.changed_by ?? "web_app",
      ]
    );

    if (!result || !result.success) {
      return apiBadRequest(result?.message || "Failed to set override");
    }

    return apiSuccess({
      success: true,
      message: "Colony override set successfully",
      previous_count: result.previous_count,
      previous_altered: result.previous_altered,
    });
  } catch (error) {
    console.error("Error setting colony override:", error);
    return apiServerError("Failed to set colony override");
  }
}

// DELETE /api/places/[id]/colony-override - Clear manual override
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return apiBadRequest("Place ID is required");
  }

  try {
    let body: ClearOverrideBody = {};
    try {
      body = await request.json();
    } catch {
      // Body is optional for DELETE
    }

    const result = await queryOne<{ clear_colony_override: boolean }>(
      `SELECT ops.clear_colony_override($1, $2, $3)`,
      [id, body.reason ?? null, body.changed_by ?? "web_app"]
    );

    if (!result?.clear_colony_override) {
      return apiNotFound("Place or override", id);
    }

    return apiSuccess({
      success: true,
      message: "Colony override cleared",
    });
  } catch (error) {
    console.error("Error clearing colony override:", error);
    return apiServerError("Failed to clear colony override");
  }
}

// GET /api/places/[id]/colony-override - Get override history
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return apiBadRequest("Place ID is required");
  }

  try {
    // Get current override from place
    const currentSql = `
      SELECT
        colony_override_count,
        colony_override_altered,
        colony_override_note,
        colony_override_at,
        colony_override_by
      FROM sot.places
      WHERE place_id = $1
    `;

    const current = await queryOne<{
      colony_override_count: number | null;
      colony_override_altered: number | null;
      colony_override_note: string | null;
      colony_override_at: string | null;
      colony_override_by: string | null;
    }>(currentSql, [id]);

    // Get history
    const historySql = `
      SELECT
        history_id,
        override_count,
        override_altered,
        override_note,
        previous_count,
        previous_altered,
        changed_by,
        change_reason,
        changed_at,
        a_known_at_time,
        n_max_at_time
      FROM sot.colony_override_history
      WHERE place_id = $1
      ORDER BY changed_at DESC
      LIMIT 20
    `;

    const history = await queryRows(historySql, [id]);

    return apiSuccess({
      current: current && current.colony_override_count !== null ? {
        count: current.colony_override_count,
        altered: current.colony_override_altered,
        note: current.colony_override_note,
        set_at: current.colony_override_at,
        set_by: current.colony_override_by,
      } : null,
      history: history || [],
    });
  } catch (error) {
    console.error("Error fetching colony override:", error);
    return apiServerError("Failed to fetch colony override");
  }
}
