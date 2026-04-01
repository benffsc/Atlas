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

// Hardcoded fallbacks — must stay in sync with MIG_2926 + MIG_2963 + MIG_2964 seed data
const DEFAULTS: Record<string, unknown> = {
  "request.stale_days": 30,
  "request.in_progress_stale_days": 14,
  "pagination.default_limit": 50,
  "pagination.max_limit": 200,
  "map.default_zoom": 10,
  "map.default_center": [38.45, -122.75],
  // Map & geo (MIG_2964 / FFS-685)
  "map.default_bounds": { south: 37.8, north: 39.4, west: -123.6, east: -122.3 },
  "map.autocomplete_bias": { lat: 38.5, lng: -122.8, radius: 50000 },
  "geo.service_counties": ["Sonoma", "Marin", "Napa", "Mendocino", "Lake"],
  "geo.default_county": "Sonoma",
  "geo.service_area_name": "Sonoma County",
  // Org branding (MIG_2963 / FFS-684)
  "org.name_full": "Forgotten Felines of Sonoma County",
  "org.name_short": "FFSC",
  "org.phone": "(707) 576-7999",
  "org.website": "forgottenfelines.com",
  "org.support_email": "admin@forgottenfelinessoco.org",
  "org.email_from": "Forgotten Felines <noreply@forgottenfelines.org>",
  "org.tagline": "Helping community cats since 1990",
  // Terminology (MIG_2973 / FFS-687)
  "terminology.trapper_types": { coordinator: "Coordinator", head_trapper: "Head Trapper", ffsc_trapper: "FFSC Trapper", community_trapper: "Community Trapper" },
  "terminology.program_public": "Find Fix Return (FFR)",
  "terminology.program_staff": "TNR",
  "terminology.action_public": "fix",
  "terminology.action_staff": "alter",
  // Kiosk hub (MIG_3016)
  "kiosk.modules_enabled": ["equipment", "help"],
  "kiosk.session_timeout_public": 120,
  "kiosk.session_timeout_equipment": 300,
  "kiosk.splash_title": "How can we help?",
  "kiosk.splash_subtitle": "Tap an option to get started",
  "kiosk.cats_slideshow_interval": 8,
  "kiosk.success_message": "Thank you! We'll be in touch.",
  "kiosk.help_questions": null,
  "kiosk.staff_selection_required": false,
  // Checkout defaults (MIG_3031 / FFS-1057)
  "kiosk.deposit_presets": [0, 50, 75],
  "kiosk.purpose_due_offsets": { tnr_appointment: 3, kitten_rescue: 14, colony_check: 7, feeding_station: 90, personal_pet: 14, ffr: 3, well_check: 7, rescue_recovery: 14, trap_training: 7, transport: 3 },
  "kiosk.inactivity_countdown": 30,
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
