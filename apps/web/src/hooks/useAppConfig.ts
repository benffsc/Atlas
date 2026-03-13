/**
 * useAppConfig — SWR-based hook for runtime app configuration.
 *
 * Fetches all configs once from /api/admin/config, caches for 5 minutes,
 * and falls back to hardcoded DEFAULTS when loading or on error.
 *
 * Usage:
 *   const { value } = useAppConfig<number>('request.stale_days');
 *   const { value: center } = useAppConfig<[number, number]>('map.default_center');
 */

import useSWR, { type KeyedMutator } from "swr";
import { fetchApi } from "@/lib/api-client";

// Hardcoded fallbacks — must stay in sync with MIG_2926 seed data
const DEFAULTS: Record<string, unknown> = {
  "request.stale_days": 30,
  "request.in_progress_stale_days": 14,
  "pagination.default_limit": 50,
  "pagination.max_limit": 200,
  "map.default_zoom": 10,
  "map.default_center": [38.45, -122.75],
};

interface ConfigRow {
  key: string;
  value: unknown;
  description: string | null;
  category: string;
  updated_by: string | null;
  updated_at: string;
}

interface AllConfigsResponse {
  configs: ConfigRow[];
  categories: string[];
}

const SWR_KEY = "/api/admin/config";

const fetcher = (url: string) => fetchApi<AllConfigsResponse>(url);

/**
 * Read a single config value. Falls back to DEFAULTS[key] while loading or on error.
 */
export function useAppConfig<T = unknown>(key: string): {
  value: T;
  isLoading: boolean;
  error: Error | undefined;
} {
  const { data, error, isLoading } = useSWR<AllConfigsResponse>(SWR_KEY, fetcher, {
    dedupingInterval: 300_000, // 5 min
    revalidateOnFocus: false,
  });

  if (!data || error) {
    return {
      value: (DEFAULTS[key] ?? null) as T,
      isLoading,
      error,
    };
  }

  const row = data.configs.find((c) => c.key === key);
  return {
    value: (row ? row.value : DEFAULTS[key] ?? null) as T,
    isLoading: false,
    error: undefined,
  };
}

/**
 * Read all configs + mutate function. Used by the admin config page.
 */
export function useAllConfigs(): {
  configs: ConfigRow[];
  categories: string[];
  isLoading: boolean;
  error: Error | undefined;
  mutate: KeyedMutator<AllConfigsResponse>;
} {
  const { data, error, isLoading, mutate } = useSWR<AllConfigsResponse>(
    SWR_KEY,
    fetcher,
    {
      dedupingInterval: 300_000,
      revalidateOnFocus: false,
    }
  );

  return {
    configs: data?.configs ?? [],
    categories: data?.categories ?? [],
    isLoading,
    error,
    mutate,
  };
}
