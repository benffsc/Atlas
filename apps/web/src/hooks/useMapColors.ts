/**
 * useMapColors — SWR hook for admin-configurable map colors.
 *
 * Reads map.colors.* keys from /api/admin/config, merges with hardcoded
 * MAP_COLORS fallback. Returns the same shape as MAP_COLORS from map-colors.ts.
 *
 * Usage:
 *   const { colors } = useMapColors();
 *   const priorityColor = colors.priority.critical; // '#dc2626'
 */

import useSWR from "swr";
import { fetchApi } from "@/lib/api-client";
import { MAP_COLORS } from "@/lib/map-colors";

interface ConfigRow {
  key: string;
  value: unknown;
}

interface AllConfigsResponse {
  configs: ConfigRow[];
  categories: string[];
}

type MapColorsType = typeof MAP_COLORS;

const SWR_KEY = "/api/admin/config?category=map";
const fetcher = (url: string) => fetchApi<AllConfigsResponse>(url);

export function useMapColors(): {
  colors: MapColorsType;
  isLoading: boolean;
} {
  const { data, isLoading } = useSWR<AllConfigsResponse>(SWR_KEY, fetcher, {
    dedupingInterval: 300_000,
    revalidateOnFocus: false,
  });

  if (!data || data.configs.length === 0) {
    return { colors: MAP_COLORS, isLoading };
  }

  // Merge DB values on top of hardcoded defaults
  // Only flat string-valued groups are admin-configurable (not personRole which has {bg,text} objects).
  const merged = { ...MAP_COLORS } as unknown as Record<string, Record<string, string>>;

  for (const row of data.configs) {
    // Keys are like "map.colors.priority"
    const match = row.key.match(/^map\.colors\.(\w+)$/);
    if (match && typeof row.value === "object" && row.value !== null) {
      const category = match[1];
      if (category in MAP_COLORS && category !== "personRole") {
        merged[category] = {
          ...(MAP_COLORS[category as keyof MapColorsType] as Record<string, string>),
          ...(row.value as Record<string, string>),
        };
      }
    }
  }

  return { colors: merged as unknown as MapColorsType, isLoading: false };
}
