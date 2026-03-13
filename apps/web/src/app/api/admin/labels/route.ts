import { NextRequest } from "next/server";
import { queryRows, queryOne } from "@/lib/db";
import { getSession } from "@/lib/auth";
import {
  apiSuccess,
  apiBadRequest,
  apiUnauthorized,
  apiForbidden,
  apiServerError,
} from "@/lib/api-response";

interface LabelRow {
  registry: string;
  key: string;
  label: string;
  sort_order: number;
  updated_at: string;
}

/**
 * GET /api/admin/labels?registry=place_kind
 * List display labels, optionally filtered by registry.
 */
export async function GET(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized();

  try {
    const registry = request.nextUrl.searchParams.get("registry");

    const labels = registry
      ? await queryRows<LabelRow>(
          `SELECT registry, key, label, sort_order, updated_at
           FROM ops.display_labels
           WHERE registry = $1
           ORDER BY sort_order, key`,
          [registry]
        )
      : await queryRows<LabelRow>(
          `SELECT registry, key, label, sort_order, updated_at
           FROM ops.display_labels
           ORDER BY registry, sort_order, key`
        );

    const registries = [
      ...new Set(labels.map((l) => l.registry)),
    ].sort();

    return apiSuccess({ labels, registries });
  } catch (error) {
    console.error("Failed to fetch display labels:", error);
    return apiServerError("Failed to fetch display labels");
  }
}

/**
 * PUT /api/admin/labels
 * Update a single display label. Admin only.
 * Body: { registry, key, label }
 */
export async function PUT(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized();
  if (session.auth_role !== "admin") return apiForbidden("Only admins can edit labels");

  try {
    const body = await request.json();
    const { registry, key, label } = body;

    if (!registry || !key || !label) {
      return apiBadRequest("Required: registry, key, label");
    }

    const updated = await queryOne<LabelRow>(
      `UPDATE ops.display_labels
       SET label = $3, updated_at = NOW()
       WHERE registry = $1 AND key = $2
       RETURNING registry, key, label, sort_order, updated_at`,
      [registry, key, label]
    );

    if (!updated) {
      return apiBadRequest(`Label not found: ${registry}.${key}`);
    }

    return apiSuccess(updated);
  } catch (error) {
    console.error("Failed to update display label:", error);
    return apiServerError("Failed to update display label");
  }
}

/**
 * POST /api/admin/labels
 * Add a new display label. Admin only.
 * Body: { registry, key, label, sort_order? }
 */
export async function POST(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized();
  if (session.auth_role !== "admin") return apiForbidden("Only admins can add labels");

  try {
    const body = await request.json();
    const { registry, key, label } = body;

    if (!registry || !key || !label) {
      return apiBadRequest("Required: registry, key, label");
    }

    const created = await queryOne<LabelRow>(
      `INSERT INTO ops.display_labels (registry, key, label, sort_order)
       VALUES ($1, $2, $3, $4)
       RETURNING registry, key, label, sort_order, updated_at`,
      [registry, key, label, body.sort_order ?? 0]
    );

    return apiSuccess(created);
  } catch (error) {
    if (error instanceof Error && error.message.includes("duplicate")) {
      return apiBadRequest("Label already exists for this registry and key");
    }
    console.error("Failed to create display label:", error);
    return apiServerError("Failed to create display label");
  }
}

/**
 * DELETE /api/admin/labels?registry=X&key=Y
 * Delete a display label. Admin only.
 */
export async function DELETE(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized();
  if (session.auth_role !== "admin") return apiForbidden("Only admins can delete labels");

  try {
    const registry = request.nextUrl.searchParams.get("registry");
    const key = request.nextUrl.searchParams.get("key");
    if (!registry || !key) return apiBadRequest("Missing 'registry' and 'key' query params");

    const deleted = await queryOne<{ registry: string; key: string }>(
      "DELETE FROM ops.display_labels WHERE registry = $1 AND key = $2 RETURNING registry, key",
      [registry, key]
    );

    if (!deleted) return apiBadRequest(`Label not found: ${registry}.${key}`);
    return apiSuccess({ deleted: `${registry}.${key}` });
  } catch (error) {
    console.error("Failed to delete display label:", error);
    return apiServerError("Failed to delete display label");
  }
}
