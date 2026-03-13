/**
 * useDesignTokens — SWR hook for admin-configurable theme colors.
 *
 * Reads theme.* keys from /api/admin/config, merges with hardcoded defaults
 * from design-tokens.ts.
 *
 * Usage:
 *   const { brand, entityColors, requestStatusColors } = useDesignTokens();
 *   // brand.primary → '#3b82f6'
 *   // entityColors.cat → '#3b82f6'
 */

import useSWR from "swr";
import { fetchApi } from "@/lib/api-client";
import { COLORS, ENTITY_COLORS, REQUEST_STATUS_COLORS } from "@/lib/design-tokens";

interface ConfigRow {
  key: string;
  value: unknown;
}

interface AllConfigsResponse {
  configs: ConfigRow[];
  categories: string[];
}

interface BrandColors {
  primary: string;
  primaryDark: string;
  primaryLight: string;
  primaryHover: string;
}

interface StatusColors {
  success: string;
  successDark: string;
  successLight: string;
  warning: string;
  warningDark: string;
  warningLight: string;
  error: string;
  errorDark: string;
  errorLight: string;
  info: string;
  infoDark: string;
  infoLight: string;
}

type EntityColors = typeof ENTITY_COLORS;
type RequestStatusColors = typeof REQUEST_STATUS_COLORS;

const DEFAULT_BRAND: BrandColors = {
  primary: COLORS.primary,
  primaryDark: COLORS.primaryDark,
  primaryLight: COLORS.primaryLight,
  primaryHover: COLORS.primaryHover,
};

const DEFAULT_STATUS: StatusColors = {
  success: COLORS.success,
  successDark: COLORS.successDark,
  successLight: COLORS.successLight,
  warning: COLORS.warning,
  warningDark: COLORS.warningDark,
  warningLight: COLORS.warningLight,
  error: COLORS.error,
  errorDark: COLORS.errorDark,
  errorLight: COLORS.errorLight,
  info: COLORS.info,
  infoDark: COLORS.infoDark,
  infoLight: COLORS.infoLight,
};

const SWR_KEY = "/api/admin/config?category=theme";
const fetcher = (url: string) => fetchApi<AllConfigsResponse>(url);

export function useDesignTokens(): {
  brand: BrandColors;
  status: StatusColors;
  entityColors: EntityColors;
  requestStatusColors: RequestStatusColors;
  isLoading: boolean;
} {
  const { data, isLoading } = useSWR<AllConfigsResponse>(SWR_KEY, fetcher, {
    dedupingInterval: 300_000,
    revalidateOnFocus: false,
  });

  if (!data || data.configs.length === 0) {
    return {
      brand: DEFAULT_BRAND,
      status: DEFAULT_STATUS,
      entityColors: ENTITY_COLORS,
      requestStatusColors: REQUEST_STATUS_COLORS,
      isLoading,
    };
  }

  const configMap: Record<string, unknown> = {};
  for (const row of data.configs) {
    configMap[row.key] = row.value;
  }

  const brand: BrandColors = {
    ...DEFAULT_BRAND,
    ...((configMap["theme.brand"] as Partial<BrandColors>) ?? {}),
  };

  const status: StatusColors = {
    ...DEFAULT_STATUS,
    ...((configMap["theme.status"] as Partial<StatusColors>) ?? {}),
  };

  const entityColors = {
    ...ENTITY_COLORS,
    ...((configMap["theme.entity_colors"] as Partial<EntityColors>) ?? {}),
  } as EntityColors;

  const requestStatusColors = {
    ...REQUEST_STATUS_COLORS,
    ...((configMap["theme.request_status"] as Partial<RequestStatusColors>) ?? {}),
  } as RequestStatusColors;

  return { brand, status, entityColors, requestStatusColors, isLoading: false };
}
