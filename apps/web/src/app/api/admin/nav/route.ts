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

interface NavItemRow {
  id: string;
  sidebar: string;
  section: string;
  label: string;
  path: string;
  icon: string;
  sort_order: number;
  visible: boolean;
  required_role: string | null;
}

/**
 * GET /api/admin/nav?sidebar=admin
 * List nav items, optionally filtered by sidebar.
 */
export async function GET(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized();

  try {
    const sidebar = request.nextUrl.searchParams.get("sidebar");

    const items = sidebar
      ? await queryRows<NavItemRow>(
          `SELECT id, sidebar, section, label, path, icon, sort_order, visible, required_role
           FROM ops.nav_items
           WHERE sidebar = $1
           ORDER BY sort_order`,
          [sidebar]
        )
      : await queryRows<NavItemRow>(
          `SELECT id, sidebar, section, label, path, icon, sort_order, visible, required_role
           FROM ops.nav_items
           ORDER BY sidebar, sort_order`
        );

    // Filter by role for non-admin users
    const filtered = items.filter(
      (item) =>
        !item.required_role || session.auth_role === "admin" || session.auth_role === item.required_role
    );

    return apiSuccess({ items: filtered });
  } catch (error) {
    console.error("Failed to fetch nav items:", error);
    return apiServerError("Failed to fetch navigation");
  }
}

/**
 * PUT /api/admin/nav
 * Update a nav item. Admin only.
 * Body: { id, label?, path?, icon?, sort_order?, visible?, required_role?, section? }
 */
export async function PUT(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized();
  if (session.auth_role !== "admin") return apiForbidden("Only admins can edit navigation");

  try {
    const body = await request.json();
    const { id } = body;

    if (!id) return apiBadRequest("Missing 'id'");

    const existing = await queryOne<{ id: string }>(
      "SELECT id FROM ops.nav_items WHERE id = $1",
      [id]
    );
    if (!existing) return apiNotFound("Nav item", id);

    const updated = await queryOne<NavItemRow>(
      `UPDATE ops.nav_items SET
        label = COALESCE($2, label),
        path = COALESCE($3, path),
        icon = COALESCE($4, icon),
        sort_order = COALESCE($5, sort_order),
        visible = COALESCE($6, visible),
        required_role = CASE WHEN $7::text = '__null__' THEN NULL WHEN $7::text IS NOT NULL THEN $7::text ELSE required_role END,
        section = COALESCE($8, section),
        updated_at = NOW()
      WHERE id = $1
      RETURNING id, sidebar, section, label, path, icon, sort_order, visible, required_role`,
      [
        id,
        body.label ?? null,
        body.path ?? null,
        body.icon ?? null,
        body.sort_order ?? null,
        body.visible ?? null,
        body.required_role === null ? "__null__" : body.required_role ?? null,
        body.section ?? null,
      ]
    );

    return apiSuccess(updated);
  } catch (error) {
    console.error("Failed to update nav item:", error);
    return apiServerError("Failed to update navigation item");
  }
}

/**
 * POST /api/admin/nav
 * Create a new nav item. Admin only.
 */
export async function POST(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized();
  if (session.auth_role !== "admin") return apiForbidden("Only admins can create navigation items");

  try {
    const body = await request.json();
    const { sidebar, section, label, path, icon, sort_order, required_role } = body;

    if (!sidebar || !section || !label || !path) {
      return apiBadRequest("Missing required fields: sidebar, section, label, path");
    }

    const created = await queryOne<NavItemRow>(
      `INSERT INTO ops.nav_items (sidebar, section, label, path, icon, sort_order, required_role)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, sidebar, section, label, path, icon, sort_order, visible, required_role`,
      [sidebar, section, label, path, icon || "", sort_order ?? 0, required_role ?? null]
    );

    return apiSuccess(created);
  } catch (error) {
    console.error("Failed to create nav item:", error);
    return apiServerError("Failed to create navigation item");
  }
}

/**
 * DELETE /api/admin/nav?id=UUID
 * Delete a nav item. Admin only.
 */
export async function DELETE(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized();
  if (session.auth_role !== "admin") return apiForbidden("Only admins can delete navigation items");

  try {
    const id = request.nextUrl.searchParams.get("id");
    if (!id) return apiBadRequest("Missing 'id' query parameter");

    const deleted = await queryOne<{ id: string }>(
      "DELETE FROM ops.nav_items WHERE id = $1 RETURNING id",
      [id]
    );

    if (!deleted) return apiNotFound("Nav item", id);
    return apiSuccess({ deleted: id });
  } catch (error) {
    console.error("Failed to delete nav item:", error);
    return apiServerError("Failed to delete navigation item");
  }
}
