"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchApiWithMeta, ApiError } from "@/lib/api-client";

interface PaginationMeta {
  total: number;
  limit: number;
  offset: number;
}

interface UseListDataOptions<TFilters> {
  /** API endpoint path (e.g., "/api/cats") */
  endpoint: string;
  /** Current filter values */
  filters: TFilters;
  /** Pagination/sorting params from useDataTable */
  apiParams: { limit: number; offset: number; sort?: string };
  /** Maps filter values to URLSearchParams */
  buildParams: (filters: TFilters, apiParams: { limit: number; offset: number; sort?: string }) => URLSearchParams;
  /** Key in the API response that contains the data array (e.g., "cats", "people") */
  dataKey: string;
}

interface UseListDataResult<TItem> {
  items: TItem[];
  total: number;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  meta: PaginationMeta | null;
}

/**
 * Generic hook for fetching paginated list data from an API endpoint.
 *
 * Encapsulates the useState data/loading/error + useCallback fetch + useEffect trigger
 * pattern used across list pages (cats, people, places).
 *
 * @example
 * const { items: cats, total, loading, error } = useListData<Cat>({
 *   endpoint: "/api/cats",
 *   filters,
 *   apiParams,
 *   buildParams: (f, api) => {
 *     const p = new URLSearchParams();
 *     if (f.q) p.set("q", f.q);
 *     if (f.sex) p.set("sex", f.sex);
 *     p.set("limit", String(api.limit));
 *     p.set("offset", String(api.offset));
 *     return p;
 *   },
 *   dataKey: "cats",
 * });
 */
export function useListData<TItem, TFilters = Record<string, string>>(
  options: UseListDataOptions<TFilters>
): UseListDataResult<TItem> {
  const { endpoint, filters, apiParams, buildParams, dataKey } = options;

  const [items, setItems] = useState<TItem[]>([]);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    const params = buildParams(filters, apiParams);

    try {
      const result = await fetchApiWithMeta<Record<string, TItem[]>>(
        `${endpoint}?${params.toString()}`
      );
      setItems((result.data[dataKey] as TItem[]) || []);
      setMeta({
        total: result.meta?.total || 0,
        limit: result.meta?.limit || apiParams.limit,
        offset: result.meta?.offset || 0,
      });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Unknown error"
      );
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, dataKey, JSON.stringify(filters), apiParams.limit, apiParams.offset, apiParams.sort]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    items,
    total: meta?.total || 0,
    loading,
    error,
    refetch: fetchData,
    meta,
  };
}
