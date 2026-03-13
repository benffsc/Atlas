/**
 * useDisplayLabels — SWR hook for admin-configurable display labels.
 *
 * Fetches label overrides from /api/admin/labels, merges with hardcoded
 * label maps from display-labels.ts.
 *
 * Usage:
 *   const { getLabel } = useDisplayLabels('place_kind');
 *   const label = getLabel('single_family'); // 'House'
 *
 *   const { labels } = useAllDisplayLabels(); // for admin page
 */

import useSWR, { type KeyedMutator } from "swr";
import { fetchApi } from "@/lib/api-client";

interface LabelRow {
  registry: string;
  key: string;
  label: string;
  sort_order: number;
  updated_at: string;
}

interface LabelsResponse {
  labels: LabelRow[];
  registries: string[];
}

const SWR_KEY = "/api/admin/labels";
const fetcher = (url: string) => fetchApi<LabelsResponse>(url);

/**
 * Get labels for a specific registry with fallback to a hardcoded map.
 */
export function useDisplayLabels(
  registry: string,
  fallback: Record<string, string> = {}
): {
  getLabel: (key: string) => string;
  labelMap: Record<string, string>;
  isLoading: boolean;
} {
  const { data, isLoading } = useSWR<LabelsResponse>(
    `${SWR_KEY}?registry=${registry}`,
    fetcher,
    { dedupingInterval: 300_000, revalidateOnFocus: false }
  );

  if (!data || data.labels.length === 0) {
    return {
      getLabel: (key: string) =>
        fallback[key] || key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      labelMap: fallback,
      isLoading,
    };
  }

  const labelMap: Record<string, string> = { ...fallback };
  for (const row of data.labels) {
    labelMap[row.key] = row.label;
  }

  return {
    getLabel: (key: string) =>
      labelMap[key] || key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    labelMap,
    isLoading: false,
  };
}

/**
 * Get all labels across all registries. Used by the admin labels page.
 */
export function useAllDisplayLabels(): {
  labels: LabelRow[];
  registries: string[];
  isLoading: boolean;
  mutate: KeyedMutator<LabelsResponse>;
} {
  const { data, isLoading, mutate } = useSWR<LabelsResponse>(SWR_KEY, fetcher, {
    dedupingInterval: 300_000,
    revalidateOnFocus: false,
  });

  return {
    labels: data?.labels ?? [],
    registries: data?.registries ?? [],
    isLoading,
    mutate,
  };
}
