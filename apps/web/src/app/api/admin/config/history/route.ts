import { NextRequest } from "next/server";
import { queryRows, queryOne } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { parsePagination } from "@/lib/api-validation";
import { apiSuccess, apiUnauthorized, apiServerError } from "@/lib/api-response";

interface ConfigHistoryRow {
  history_id: number;
  config_key: string;
  old_value: unknown;
  new_value: unknown;
  changed_by: string | null;
  changed_by_name: string | null;
  changed_at: string;
  change_source: string | null;
}

/**
 * GET /api/admin/config/history
 * Returns config change history. Optional ?key= filter for specific config key.
 * Pagination via ?limit= and ?offset=.
 */
export async function GET(request: NextRequest) {
  const session = await getSession(request);
  if (!session) {
    return apiUnauthorized();
  }

  try {
    const { limit, offset } = parsePagination(request.nextUrl.searchParams);
    const key = request.nextUrl.searchParams.get("key");

    const conditions: string[] = [];
    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (key) {
      conditions.push(`h.config_key = $${paramIndex}`);
      params.push(key);
      paramIndex++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await queryOne<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM ops.app_config_history h ${where}`,
      params
    );
    const total = countResult?.total ?? 0;

    const history = await queryRows<ConfigHistoryRow>(
      `SELECT
        h.history_id,
        h.config_key,
        h.old_value,
        h.new_value,
        h.changed_by,
        s.display_name AS changed_by_name,
        h.changed_at::text,
        h.change_source
      FROM ops.app_config_history h
      LEFT JOIN ops.staff s ON s.staff_id::text = h.changed_by
      ${where}
      ORDER BY h.changed_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    return apiSuccess({ history }, { total, limit, offset });
  } catch (error) {
    console.error("Failed to fetch config history:", error);
    return apiServerError("Failed to fetch configuration history");
  }
}
