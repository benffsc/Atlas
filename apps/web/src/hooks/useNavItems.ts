/**
 * useNavItems — SWR hook for admin-configurable sidebar navigation.
 *
 * Fetches nav items from /api/admin/nav, grouped into NavSection[].
 * Falls back to hardcoded items if the fetch fails or is loading.
 *
 * Usage:
 *   const { sections, isLoading } = useNavItems('admin', FALLBACK_SECTIONS);
 */

import useSWR from "swr";
import { fetchApi } from "@/lib/api-client";
import type { NavSection } from "@/components/SidebarLayout";

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

interface NavResponse {
  items: NavItemRow[];
}

const fetcher = (url: string) => fetchApi<NavResponse>(url);

/**
 * Convert flat nav item rows into grouped NavSection[] for SidebarLayout.
 */
function groupIntoSections(items: NavItemRow[]): NavSection[] {
  const sectionMap = new Map<string, { title: string; items: NavItemRow[] }>();

  for (const item of items) {
    if (!item.visible) continue;
    if (!sectionMap.has(item.section)) {
      sectionMap.set(item.section, { title: item.section, items: [] });
    }
    sectionMap.get(item.section)!.items.push(item);
  }

  return Array.from(sectionMap.values()).map((section) => ({
    title: section.title,
    items: section.items
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((item) => ({
        label: item.label,
        href: item.path,
        icon: item.icon,
      })),
  }));
}

export function useNavItems(
  sidebar: "main" | "admin" | "beacon",
  fallback: NavSection[]
): {
  sections: NavSection[];
  isLoading: boolean;
} {
  const { data, isLoading } = useSWR<NavResponse>(
    `/api/admin/nav?sidebar=${sidebar}`,
    fetcher,
    {
      dedupingInterval: 300_000,
      revalidateOnFocus: false,
      fallbackData: undefined,
    }
  );

  if (!data || data.items.length === 0) {
    return { sections: fallback, isLoading };
  }

  return {
    sections: groupIntoSections(data.items),
    isLoading: false,
  };
}
