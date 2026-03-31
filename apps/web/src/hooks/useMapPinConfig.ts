/**
 * useMapPinConfig — SWR hook for admin-configurable map pin rendering.
 *
 * Reads map.pin.* and map.colors.pinStyle from /api/admin/config,
 * merges with DEFAULT_PIN_CONFIG fallback. Same SWR pattern as useMapColors().
 */

import useSWR from "swr";
import { fetchApi } from "@/lib/api-client";
import type { MapPinConfig } from "@/components/map/types";
import { DEFAULT_PIN_CONFIG } from "@/components/map/types";

interface ConfigRow {
  key: string;
  value: unknown;
}

interface AllConfigsResponse {
  configs: ConfigRow[];
  categories: string[];
}

const SWR_KEY = "/api/admin/config?category=map";
const fetcher = (url: string) => fetchApi<AllConfigsResponse>(url);

export function useMapPinConfig(): {
  pinConfig: MapPinConfig;
  isLoading: boolean;
} {
  const { data, isLoading } = useSWR<AllConfigsResponse>(SWR_KEY, fetcher, {
    dedupingInterval: 300_000, // 5-min dedup
    revalidateOnFocus: false,
  });

  if (!data || data.configs.length === 0) {
    return { pinConfig: DEFAULT_PIN_CONFIG, isLoading };
  }

  const pinConfig = { ...DEFAULT_PIN_CONFIG };

  for (const row of data.configs) {
    if (row.key === "map.colors.pinStyle" && typeof row.value === "object" && row.value !== null) {
      pinConfig.colors = { ...DEFAULT_PIN_CONFIG.colors, ...(row.value as Record<string, string>) };
    } else if (row.key === "map.pin.statusDots" && typeof row.value === "object" && row.value !== null) {
      pinConfig.statusDots = { ...DEFAULT_PIN_CONFIG.statusDots, ...(row.value as Record<string, string>) };
    } else if (row.key === "map.pin.sizes" && typeof row.value === "object" && row.value !== null) {
      const s = row.value as Record<string, number>;
      pinConfig.sizes = {
        hotspot: s.hotspot ?? DEFAULT_PIN_CONFIG.sizes.hotspot,
        active: s.active ?? DEFAULT_PIN_CONFIG.sizes.active,
        reference: s.reference ?? DEFAULT_PIN_CONFIG.sizes.reference,
      };
    } else if (row.key === "map.pin.labels" && typeof row.value === "object" && row.value !== null) {
      pinConfig.labels = { ...DEFAULT_PIN_CONFIG.labels, ...(row.value as Record<string, string>) };
    }
  }

  return { pinConfig, isLoading: false };
}
