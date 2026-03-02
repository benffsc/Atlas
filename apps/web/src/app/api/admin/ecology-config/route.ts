import { NextRequest } from "next/server";
import { queryRows, query } from "@/lib/db";
import { getCurrentUser, getAdminUser } from "@/lib/auth";
import { apiSuccess, apiBadRequest, apiServerError } from "@/lib/api-response";

interface EcologyConfigRow {
  config_id: string;
  config_key: string;
  config_value: number;
  unit: string;
  description: string;
  min_value: number;
  max_value: number;
  updated_at: string;
  updated_by: string | null;
}

export async function GET() {
  try {
    const sql = `
      SELECT
        config_id,
        config_key,
        config_value,
        unit,
        description,
        min_value,
        max_value,
        updated_at,
        updated_by
      FROM ops.ecology_config
      WHERE is_active = TRUE
      ORDER BY config_key
    `;

    const configs = await queryRows<EcologyConfigRow>(sql);

    const response = apiSuccess({ configs });
    // Cache config for 10 minutes - rarely changes
    response.headers.set('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=1200');
    return response;
  } catch (error) {
    console.error("Error fetching ecology config:", error);
    return apiServerError("Failed to fetch ecology config");
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { config_key, config_value, reason } = body;

    if (!config_key || config_value === undefined) {
      return apiBadRequest("config_key and config_value are required");
    }

    // Get user context (admin endpoints default to "admin" if no auth)
    const user = getCurrentUser(request);
    const updatedBy = user.isAuthenticated ? user.displayName : getAdminUser().displayName;

    // Use the update function which handles validation and audit
    const sql = `
      SELECT * FROM ops.update_ecology_config(
        $1,
        $2,
        $3,
        $4
      )
    `;

    const result = await query(sql, [
      config_key,
      config_value,
      updatedBy,
      reason || null,
    ]);

    const row = result.rows[0];

    if (!row.success) {
      return apiBadRequest(row.message);
    }

    return apiSuccess({
      message: row.message,
      old_value: row.old_value,
      new_value: row.new_value,
    });
  } catch (error) {
    console.error("Error updating ecology config:", error);
    return apiServerError("Failed to update ecology config");
  }
}
