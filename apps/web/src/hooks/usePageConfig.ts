/**
 * usePageConfig — SWR hook for print form page configurations.
 *
 * Fetches page layout config from /api/admin/forms/layouts for a given template.
 * Used by the admin layout builder and (future) config-driven print renderer.
 *
 * Usage:
 *   const { config, isLoading } = usePageConfig('tnr_call_sheet');
 *   // config.page_config.pages[0].sections → section layout
 */

import useSWR, { type KeyedMutator } from "swr";
import { fetchApi } from "@/lib/api-client";

export interface PageSection {
  key: string;
  label: string;
  type: string;
  visible: boolean;
  layout?: string;
  fields: (string | PageField)[];
}

export interface PageField {
  key: string;
  width?: string;
  label?: string;
  type?: string;
}

export interface PageDef {
  number: number;
  label: string;
  condition?: string;
  sections: PageSection[];
}

export interface PageConfig {
  pages: PageDef[];
}

export interface PrintSettings {
  orientation: string;
  paperSize: string;
  margins: { top: string; right: string; bottom: string; left: string };
}

export interface PageConfigRow {
  id: string;
  template_key: string;
  label: string;
  page_config: PageConfig;
  print_settings: PrintSettings;
  active: boolean;
  updated_at: string;
  updated_by: string | null;
}

interface LayoutsResponse {
  configs: PageConfigRow[];
}

const fetcher = (url: string) => fetchApi<LayoutsResponse>(url);

/**
 * Fetch page config for a specific template.
 */
export function usePageConfig(templateKey: string): {
  config: PageConfigRow | null;
  isLoading: boolean;
  mutate: KeyedMutator<LayoutsResponse>;
} {
  const { data, isLoading, mutate } = useSWR<LayoutsResponse>(
    `/api/admin/forms/layouts?template_key=${templateKey}`,
    fetcher,
    { dedupingInterval: 300_000, revalidateOnFocus: false }
  );

  return {
    config: data?.configs?.[0] ?? null,
    isLoading,
    mutate,
  };
}

/**
 * Fetch all page configs. Used by the admin layout list page.
 */
export function useAllPageConfigs(): {
  configs: PageConfigRow[];
  isLoading: boolean;
  mutate: KeyedMutator<LayoutsResponse>;
} {
  const { data, isLoading, mutate } = useSWR<LayoutsResponse>(
    "/api/admin/forms/layouts",
    fetcher,
    { dedupingInterval: 300_000, revalidateOnFocus: false }
  );

  return {
    configs: data?.configs ?? [],
    isLoading,
    mutate,
  };
}
