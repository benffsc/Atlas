/**
 * usePermission — check if the current user has a specific permission.
 *
 * Fetches the full role-permission matrix once via SWR (5min cache),
 * then checks locally. Falls back to legacy role-based logic if
 * the fetch fails or is loading.
 *
 * Usage:
 *   const canEditConfig = usePermission('admin.config');
 *   const canWriteRequests = usePermission('requests.write');
 */

import useSWR from "swr";
import { fetchApi } from "@/lib/api-client";
import { useCurrentUser } from "@/hooks/useCurrentUser";

interface PermissionRow {
  key: string;
  label: string;
  description: string | null;
  category: string;
}

interface RolesResponse {
  permissions: PermissionRow[];
  matrix: Record<string, string[]>;
  categories: string[];
  roles: string[];
}

const SWR_KEY = "/api/admin/roles";
const fetcher = (url: string) => fetchApi<RolesResponse>(url);

/**
 * Legacy fallback: admin gets everything, staff gets non-admin,
 * volunteer gets read-only. Matches current inline check behavior.
 */
function legacyCheck(role: string | undefined, permissionKey: string): boolean {
  if (!role) return false;
  if (role === "admin") return true;
  if (role === "staff") return !permissionKey.startsWith("admin.");
  // volunteer — read-only
  return permissionKey.endsWith(".read");
}

/**
 * Check a single permission for the current user.
 */
export function usePermission(permissionKey: string): boolean {
  const { user } = useCurrentUser();
  const { data } = useSWR<RolesResponse>(SWR_KEY, fetcher, {
    dedupingInterval: 300_000,
    revalidateOnFocus: false,
  });

  const role = user?.auth_role;

  // If matrix not loaded, fall back to legacy
  if (!data || !role) {
    return legacyCheck(role, permissionKey);
  }

  const rolePerms = data.matrix[role];
  if (!rolePerms) return false;
  return rolePerms.includes(permissionKey);
}

/**
 * Return all permissions for the current user's role (for UI rendering).
 */
export function usePermissions(): {
  permissions: PermissionRow[];
  matrix: Record<string, string[]>;
  roles: string[];
  categories: string[];
  isLoading: boolean;
  mutate: () => void;
} {
  const { data, isLoading, mutate } = useSWR<RolesResponse>(SWR_KEY, fetcher, {
    dedupingInterval: 300_000,
    revalidateOnFocus: false,
  });

  return {
    permissions: data?.permissions ?? [],
    matrix: data?.matrix ?? {},
    roles: data?.roles ?? ["admin", "staff", "volunteer"],
    categories: data?.categories ?? [],
    isLoading,
    mutate,
  };
}
