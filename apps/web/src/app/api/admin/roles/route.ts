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

interface PermissionRow {
  key: string;
  label: string;
  description: string | null;
  category: string;
}

interface RolePermissionRow {
  role: string;
  permission_key: string;
}

/**
 * GET /api/admin/roles
 * Returns the full permission matrix: all permissions + which roles have them.
 */
export async function GET(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized();

  try {
    const permissions = await queryRows<PermissionRow>(
      `SELECT key, label, description, category
       FROM ops.permissions
       ORDER BY category, key`
    );

    const rolePermissions = await queryRows<RolePermissionRow>(
      `SELECT role, permission_key
       FROM ops.role_permissions
       ORDER BY role, permission_key`
    );

    const categories = [...new Set(permissions.map((p) => p.category))].sort();
    const roles = [...new Set(rolePermissions.map((rp) => rp.role))].sort();

    // Build matrix: { [role]: Set<permission_key> }
    const matrix: Record<string, string[]> = {};
    for (const role of roles) {
      matrix[role] = rolePermissions
        .filter((rp) => rp.role === role)
        .map((rp) => rp.permission_key);
    }

    return apiSuccess({ permissions, matrix, categories, roles });
  } catch (error) {
    console.error("Failed to fetch role permissions:", error);
    return apiServerError("Failed to fetch permissions");
  }
}

/**
 * PUT /api/admin/roles
 * Toggle a permission for a role. Admin only.
 * Body: { role: string, permission_key: string, granted: boolean }
 */
export async function PUT(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized();
  if (session.auth_role !== "admin") return apiForbidden("Only admins can edit roles");

  try {
    const body = await request.json();
    const { role, permission_key, granted } = body;

    if (!role || !permission_key || typeof granted !== "boolean") {
      return apiBadRequest("Required: role, permission_key, granted (boolean)");
    }

    // Validate role is a known value
    if (!["admin", "staff", "volunteer"].includes(role)) {
      return apiBadRequest("Invalid role. Must be: admin, staff, or volunteer");
    }

    // Validate permission exists
    const perm = await queryOne<{ key: string }>(
      "SELECT key FROM ops.permissions WHERE key = $1",
      [permission_key]
    );
    if (!perm) return apiBadRequest(`Unknown permission: ${permission_key}`);

    if (granted) {
      await queryOne(
        `INSERT INTO ops.role_permissions (role, permission_key)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [role, permission_key]
      );
    } else {
      await queryOne(
        `DELETE FROM ops.role_permissions
         WHERE role = $1 AND permission_key = $2`,
        [role, permission_key]
      );
    }

    return apiSuccess({ role, permission_key, granted });
  } catch (error) {
    console.error("Failed to update role permission:", error);
    return apiServerError("Failed to update role permission");
  }
}
