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

interface PageConfigRow {
  id: string;
  template_key: string;
  label: string;
  page_config: unknown;
  print_settings: unknown;
  active: boolean;
  updated_at: string;
  updated_by: string | null;
}

/**
 * GET /api/admin/forms/layouts
 * List all form page configs. Optional ?template_key= filter.
 */
export async function GET(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized();

  try {
    const templateKey = request.nextUrl.searchParams.get("template_key");

    const configs = templateKey
      ? await queryRows<PageConfigRow>(
          `SELECT id, template_key, label, page_config, print_settings, active, updated_at, updated_by
           FROM ops.form_page_configs
           WHERE template_key = $1
           ORDER BY label`,
          [templateKey]
        )
      : await queryRows<PageConfigRow>(
          `SELECT id, template_key, label, page_config, print_settings, active, updated_at, updated_by
           FROM ops.form_page_configs
           ORDER BY label`
        );

    return apiSuccess({ configs });
  } catch (error) {
    console.error("Failed to fetch page configs:", error);
    return apiServerError("Failed to fetch page configs");
  }
}

/**
 * PUT /api/admin/forms/layouts
 * Update a page config. Admin only.
 * Body: { template_key, page_config?, print_settings?, label?, active? }
 */
export async function PUT(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized();
  if (session.auth_role !== "admin") return apiForbidden("Only admins can edit form layouts");

  try {
    const body = await request.json();
    const { template_key } = body;

    if (!template_key) return apiBadRequest("Missing 'template_key'");

    const existing = await queryOne<{ id: string }>(
      "SELECT id FROM ops.form_page_configs WHERE template_key = $1",
      [template_key]
    );
    if (!existing) return apiNotFound("Page config", template_key);

    const updated = await queryOne<PageConfigRow>(
      `UPDATE ops.form_page_configs SET
        label = COALESCE($2, label),
        page_config = COALESCE($3::jsonb, page_config),
        print_settings = COALESCE($4::jsonb, print_settings),
        active = COALESCE($5, active),
        updated_by = $6,
        updated_at = NOW()
      WHERE template_key = $1
      RETURNING id, template_key, label, page_config, print_settings, active, updated_at, updated_by`,
      [
        template_key,
        body.label ?? null,
        body.page_config ? JSON.stringify(body.page_config) : null,
        body.print_settings ? JSON.stringify(body.print_settings) : null,
        body.active ?? null,
        session.staff_id,
      ]
    );

    return apiSuccess(updated);
  } catch (error) {
    console.error("Failed to update page config:", error);
    return apiServerError("Failed to update page config");
  }
}
