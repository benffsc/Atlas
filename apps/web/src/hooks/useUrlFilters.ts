"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useCallback, useMemo } from "react";

/**
 * Bidirectional sync between URL search params and component filter state.
 * Reads initial values from URL on mount, writes back on change.
 *
 * @param defaults - Default values for each filter key. Keys not present in the
 *   URL fall back to these defaults. When a filter is set back to its default,
 *   the param is removed from the URL to keep it clean.
 */
export function useUrlFilters<T extends Record<string, string>>(defaults: T) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const filters = useMemo(() => {
    const result = { ...defaults };
    for (const key of Object.keys(defaults) as (keyof T & string)[]) {
      const value = searchParams.get(key);
      if (value !== null) {
        (result as Record<string, string>)[key] = value;
      }
    }
    return result;
  }, [searchParams, defaults]);

  const isDefault = useMemo(() => {
    for (const key of Object.keys(defaults) as (keyof T & string)[]) {
      if (searchParams.get(key) !== null && searchParams.get(key) !== defaults[key]) {
        return false;
      }
    }
    return true;
  }, [searchParams, defaults]);

  const setFilter = useCallback(
    (key: keyof T & string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value === defaults[key] || value === "") {
        params.delete(key);
      } else {
        params.set(key, value);
      }
      const qs = params.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [searchParams, router, pathname, defaults],
  );

  const setFilters = useCallback(
    (updates: Partial<T>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === defaults[key as keyof T] || value === "" || value === undefined) {
          params.delete(key);
        } else {
          params.set(key, value as string);
        }
      }
      const qs = params.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [searchParams, router, pathname, defaults],
  );

  const clearFilters = useCallback(() => {
    router.replace(pathname, { scroll: false });
  }, [router, pathname]);

  return { filters, setFilter, setFilters, clearFilters, isDefault } as const;
}
