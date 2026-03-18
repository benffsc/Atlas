"use client";

import { useMemo, useCallback } from "react";

interface UseDataTableOptions {
  defaultPageSize?: number;
  defaultSort?: string;
  defaultSortDir?: "asc" | "desc";
}

export function useDataTable(
  filters: Record<string, string>,
  setFilters: (updates: Partial<Record<string, string>>) => void,
  options?: UseDataTableOptions,
) {
  const defaultPageSize = options?.defaultPageSize ?? 25;
  const defaultSort = options?.defaultSort ?? "";
  const defaultSortDir = options?.defaultSortDir ?? "desc";

  const pageIndex = useMemo(() => parseInt(filters.page, 10) || 0, [filters.page]);
  const pageSize = useMemo(
    () => parseInt(filters.pageSize, 10) || defaultPageSize,
    [filters.pageSize, defaultPageSize],
  );
  const sortKey = filters.sort || defaultSort;
  const sortDir = (filters.sortDir as "asc" | "desc") || defaultSortDir;

  const handlePaginationChange = useCallback(
    (page: number, newPageSize: number) => {
      const updates: Partial<Record<string, string>> = { page: String(page) };
      if (newPageSize !== pageSize) {
        updates.pageSize = String(newPageSize);
        updates.page = "0"; // Reset page on page size change
      }
      setFilters(updates);
    },
    [pageSize, setFilters],
  );

  const handleSortChange = useCallback(
    (newSortKey: string, newSortDir: "asc" | "desc") => {
      setFilters({ sort: newSortKey, sortDir: newSortDir, page: "0" });
    },
    [setFilters],
  );

  const apiParams = useMemo(
    () => ({
      limit: pageSize,
      offset: pageIndex * pageSize,
      sort: sortKey,
      sortDir,
    }),
    [pageIndex, pageSize, sortKey, sortDir],
  );

  return {
    pageIndex,
    pageSize,
    sortKey,
    sortDir,
    handlePaginationChange,
    handleSortChange,
    apiParams,
  };
}
