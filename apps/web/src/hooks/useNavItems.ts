/**
 * useNavItems — SWR hook for admin-configurable sidebar navigation.
 *
 * Fetches nav items from /api/admin/nav, grouped into NavSection[].
 * Merges DB items with hardcoded fallback: DB items win (and can hide
 * items via visible=false), but fallback items whose paths aren't in
 * the DB still appear. This prevents new pages from disappearing when
 * a migration hasn't been run yet.
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

/**
 * Merge DB sections with fallback: DB items take priority, but fallback
 * items whose paths don't exist in the DB are appended to their section.
 * This ensures new pages added in code appear even before a DB migration.
 */
function mergeWithFallback(dbSections: NavSection[], fallback: NavSection[]): NavSection[] {
  // Collect all DB paths for quick lookup
  const dbPaths = new Set<string>();
  for (const section of dbSections) {
    for (const item of section.items) {
      dbPaths.add(item.href);
    }
  }

  // Build a map of DB sections by title
  const merged = new Map<string, NavSection>();
  for (const section of dbSections) {
    merged.set(section.title, { ...section, items: [...section.items] });
  }

  // Append fallback items whose paths aren't in DB
  for (const section of fallback) {
    const missingItems = section.items.filter((item) => !dbPaths.has(item.href));
    if (missingItems.length === 0) continue;

    if (merged.has(section.title)) {
      // Section exists in DB — append missing items at the end
      merged.get(section.title)!.items.push(...missingItems);
    } else {
      // Entire section is missing from DB — add it
      merged.set(section.title, { title: section.title, items: [...missingItems] });
    }
  }

  return Array.from(merged.values());
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

  const dbSections = groupIntoSections(data.items);

  return {
    sections: mergeWithFallback(dbSections, fallback),
    isLoading: false,
  };
}
