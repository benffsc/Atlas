import { NextRequest } from "next/server";
import { queryRows, queryOne } from "@/lib/db";
import { getSession } from "@/lib/auth";
import {
  apiSuccess,
  apiBadRequest,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiServerError,
} from "@/lib/api-response";

interface ConfigRow {
  key: string;
  value: unknown;
  description: string | null;
  category: string;
  updated_by: string | null;
  updated_at: string;
}

/**
 * GET /api/admin/config
 * List all config entries, optionally filtered by ?category=
 */
export async function GET(request: NextRequest) {
  const session = await getSession(request);
  if (!session) {
    return apiUnauthorized();
  }

  try {
    const category = request.nextUrl.searchParams.get("category");

    const configs = category
      ? await queryRows<ConfigRow>(
          `SELECT key, value, description, category, updated_by, updated_at
           FROM ops.app_config
           WHERE category = $1
           ORDER BY category, key`,
          [category]
        )
      : await queryRows<ConfigRow>(
          `SELECT key, value, description, category, updated_by, updated_at
           FROM ops.app_config
           ORDER BY category, key`
        );

    const categories = [
      ...new Set(configs.map((c) => c.category)),
    ].sort();

    return apiSuccess({ configs, categories });
  } catch (error) {
    console.error("Failed to fetch app config:", error);
    return apiServerError("Failed to fetch configuration");
  }
}

/**
 * PUT /api/admin/config
 * Update a single config key. Admin only. Cannot create new keys.
 * Body: { key: string, value: any }
 */
export async function PUT(request: NextRequest) {
  const session = await getSession(request);
  if (!session) {
    return apiUnauthorized();
  }
  if (session.auth_role !== "admin") {
    return apiForbidden("Only admins can update configuration");
  }

  try {
    const body = await request.json();
    const { key, value } = body;

    if (!key || typeof key !== "string") {
      return apiBadRequest("Missing or invalid 'key'");
    }
    if (value === undefined) {
      return apiBadRequest("Missing 'value'");
    }

    // Verify key exists — no creating new keys from the API
    const existing = await queryOne<{ key: string }>(
      "SELECT key FROM ops.app_config WHERE key = $1",
      [key]
    );
    if (!existing) {
      return apiNotFound("Config key", key);
    }

    const updated = await queryOne<{ key: string; value: unknown; updated_at: string }>(
      `UPDATE ops.app_config
       SET value = $2::jsonb,
           updated_by = $3,
           updated_at = NOW()
       WHERE key = $1
       RETURNING key, value, updated_at`,
      [key, JSON.stringify(value), session.staff_id]
    );

    return apiSuccess(updated);
  } catch (error) {
    console.error("Failed to update app config:", error);
    return apiServerError("Failed to update configuration");
  }
}
