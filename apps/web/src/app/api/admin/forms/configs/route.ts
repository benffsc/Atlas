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

interface FormConfigRow {
  key: string;
  value: {
    id: string;
    label: string;
    sections: Array<{
      component: string;
      label?: string;
      props?: Record<string, unknown>;
    }>;
  };
  category: string;
  updated_at: string;
}

const VALID_COMPONENTS = [
  "person", "place", "catDetails", "kittens", "propertyAccess", "urgencyNotes",
];

/**
 * GET /api/admin/forms/configs
 * Returns all form_config.* entries from app_config.
 */
export async function GET(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized();

  try {
    const rows = await queryRows<FormConfigRow>(
      `SELECT key, value, category, updated_at
       FROM ops.app_config
       WHERE key LIKE 'form_config.%'
       ORDER BY key`
    );

    const configs = rows.map((r) => ({
      config_id: r.value.id,
      key: r.key,
      label: r.value.label,
      sections: r.value.sections,
      updated_at: r.updated_at,
    }));

    return apiSuccess({ configs });
  } catch (error) {
    console.error("Failed to fetch form configs:", error);
    return apiServerError("Failed to fetch form configs");
  }
}

/**
 * PUT /api/admin/forms/configs
 * Update a form config. Admin only.
 * Body: { config_id, label?, sections? }
 */
export async function PUT(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized();
  if (session.auth_role !== "admin") return apiForbidden("Only admins can edit form configs");

  try {
    const body = await request.json();
    const { config_id, label, sections } = body;

    if (!config_id) return apiBadRequest("config_id is required");

    const dbKey = `form_config.${config_id}`;

    // Verify exists
    const existing = await queryOne<{ value: unknown }>(
      `SELECT value FROM ops.app_config WHERE key = $1`,
      [dbKey]
    );
    if (!existing) return apiNotFound("Form config", config_id);

    // Validate sections if provided
    if (sections) {
      if (!Array.isArray(sections)) return apiBadRequest("sections must be an array");
      for (const s of sections) {
        if (!s.component || !VALID_COMPONENTS.includes(s.component)) {
          return apiBadRequest(`Invalid section component: ${s.component}. Valid: ${VALID_COMPONENTS.join(", ")}`);
        }
      }
    }

    // Build updated value
    const currentValue = existing.value as Record<string, unknown>;
    const updatedValue = {
      ...currentValue,
      ...(label !== undefined ? { label } : {}),
      ...(sections !== undefined ? { sections } : {}),
    };

    const updated = await queryOne<FormConfigRow>(
      `UPDATE ops.app_config SET value = $2::jsonb, updated_at = NOW()
       WHERE key = $1
       RETURNING key, value, category, updated_at`,
      [dbKey, JSON.stringify(updatedValue)]
    );

    return apiSuccess({
      config_id: (updated?.value as Record<string, unknown>)?.id,
      key: updated?.key,
      label: (updated?.value as Record<string, unknown>)?.label,
      sections: (updated?.value as Record<string, unknown>)?.sections,
      updated_at: updated?.updated_at,
    });
  } catch (error) {
    console.error("Failed to update form config:", error);
    return apiServerError("Failed to update form config");
  }
}
