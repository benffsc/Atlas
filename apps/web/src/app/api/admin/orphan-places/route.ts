import { NextRequest } from "next/server";
import { queryRows, queryOne } from "@/lib/db";
import { apiSuccess, apiBadRequest, apiServerError } from "@/lib/api-response";

interface OrphanPlace {
  place_id: string;
  display_name: string | null;
  formatted_address: string | null;
  place_kind: string | null;
  locality: string | null;
  source_system: string | null;
  created_at: string;
  is_address_backed: boolean;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 200);
  const offset = parseInt(searchParams.get("offset") || "0");

  try {
    const [orphans, stats, bySource, byKind] = await Promise.all([
      queryRows<OrphanPlace>(
        `SELECT * FROM ops.v_orphan_places LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
      queryOne<{ total: number }>(
        `SELECT COUNT(*)::int AS total FROM ops.v_orphan_places`
      ),
      queryRows<{ source_system: string | null; count: number }>(
        `SELECT source_system, COUNT(*)::int AS count
         FROM ops.v_orphan_places
         GROUP BY source_system
         ORDER BY count DESC`
      ),
      queryRows<{ place_kind: string | null; count: number }>(
        `SELECT place_kind, COUNT(*)::int AS count
         FROM ops.v_orphan_places
         GROUP BY place_kind
         ORDER BY count DESC`
      ),
    ]);

    return apiSuccess({
      orphans,
      total: stats?.total || 0,
      by_source: Object.fromEntries(bySource.map(r => [r.source_system || "(none)", r.count])),
      by_kind: Object.fromEntries(byKind.map(r => [r.place_kind || "(none)", r.count])),
    });
  } catch (error) {
    console.error("Error fetching orphan places:", error);
    return apiServerError("Failed to fetch orphan places");
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const placeIds: string[] = body.place_ids;

    if (!placeIds || !Array.isArray(placeIds) || placeIds.length === 0) {
      return apiBadRequest("place_ids array is required");
    }

    if (placeIds.length > 100) {
      return apiBadRequest("Maximum 100 places per batch");
    }

    // Safety: only delete places that are still orphans (re-check via the view)
    const result = await queryOne<{ deleted: number }>(`
      WITH to_delete AS (
        SELECT o.place_id
        FROM ops.v_orphan_places o
        WHERE o.place_id = ANY($1::uuid[])
      ),
      deleted AS (
        DELETE FROM sot.places
        WHERE place_id IN (SELECT place_id FROM to_delete)
        RETURNING place_id
      )
      SELECT COUNT(*)::int AS deleted FROM deleted
    `, [placeIds]);

    return apiSuccess({
      deleted: result?.deleted || 0,
      requested: placeIds.length,
    });
  } catch (error) {
    console.error("Error deleting orphan places:", error);
    return apiServerError("Failed to delete orphan places");
  }
}
