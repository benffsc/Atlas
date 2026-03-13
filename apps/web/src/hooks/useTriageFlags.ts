/**
 * useTriageFlags — SWR hook for admin-configurable triage flags.
 *
 * Fetches flag definitions from /api/admin/triage-flags, caches for 5 minutes.
 * Falls back to hardcoded FLAG_CONFIG when loading or on error.
 *
 * Usage:
 *   const { flagConfig } = useTriageFlags();
 *   const style = flagConfig['stale_30d']; // { label, bg, color }
 */

import useSWR from "swr";
import { fetchApi } from "@/lib/api-client";

interface TriageFlagRow {
  id: string;
  key: string;
  label: string;
  color: string;
  text_color: string;
  active: boolean;
}

interface FlagsResponse {
  flags: TriageFlagRow[];
}

// Hardcoded fallback matching MIG_2929 seed data
const DEFAULT_FLAG_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  no_trapper: { label: "Needs trapper", bg: "#fef3c7", color: "#92400e" },
  client_trapping: { label: "Client trapping", bg: "#dcfce7", color: "#166534" },
  no_geometry: { label: "No map pin", bg: "#dbeafe", color: "#1e40af" },
  stale_30d: { label: "Stale 30d", bg: "#fee2e2", color: "#991b1b" },
  no_requester: { label: "No requester", bg: "#e0e7ff", color: "#3730a3" },
};

const fetcher = (url: string) => fetchApi<FlagsResponse>(url);

export function useTriageFlags(): {
  flagConfig: Record<string, { label: string; bg: string; color: string }>;
  isLoading: boolean;
} {
  const { data, isLoading } = useSWR<FlagsResponse>(
    "/api/admin/triage-flags?entity_type=request",
    fetcher,
    { dedupingInterval: 300_000, revalidateOnFocus: false }
  );

  if (!data || data.flags.length === 0) {
    return { flagConfig: DEFAULT_FLAG_CONFIG, isLoading };
  }

  const config: Record<string, { label: string; bg: string; color: string }> = {};
  for (const flag of data.flags) {
    if (flag.active) {
      config[flag.key] = { label: flag.label, bg: flag.color, color: flag.text_color };
    }
  }

  return { flagConfig: config, isLoading: false };
}
