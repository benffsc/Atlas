/**
 * useMapData - SWR-based hook for map data fetching
 *
 * Provides client-side caching with stale-while-revalidate pattern:
 * - Instant display of cached data
 * - Background revalidation for freshness
 * - Deduplication of concurrent requests
 * - Automatic retry on error
 *
 * Usage:
 *   const { data, error, isLoading, mutate } = useMapData({
 *     layers: ['atlas_pins'],
 *     zone: 'Santa Rosa',
 *     bounds: { south: 38.3, west: -123, north: 38.6, east: -122.5 },
 *   });
 *
 *   // Force refresh after data change
 *   mutate();
 */

import useSWR, { SWRConfiguration } from 'swr';

export interface MapDataBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface UseMapDataOptions {
  /** Layers to fetch (e.g., ['atlas_pins', 'zones']) */
  layers: string[];
  /** Filter by service zone */
  zone?: string;
  /** Risk filter for atlas_pins layer */
  riskFilter?: string;
  /** Data filter for atlas_pins layer */
  dataFilter?: string;
  /** Disease filter keys for atlas_pins layer */
  diseaseFilter?: string[];
  /** Viewport bounds for efficient loading */
  bounds?: MapDataBounds;
  /** Set to false to disable fetching */
  enabled?: boolean;
  /** Additional SWR configuration */
  swrOptions?: SWRConfiguration;
}

export interface AtlasPin {
  id: string;
  address: string;
  display_name: string | null;
  lat: number;
  lng: number;
  service_zone: string | null;
  parent_place_id: string | null;
  place_kind: string | null;
  unit_identifier: string | null;
  cat_count: number;
  people: Array<{ name: string; roles: string[]; is_staff: boolean }>;
  person_count: number;
  disease_risk: boolean;
  disease_risk_notes: string | null;
  disease_badges: Array<{
    disease_key: string;
    short_code: string;
    color: string;
    status: string;
    last_positive: string | null;
    positive_cats: number;
  }>;
  disease_count: number;
  watch_list: boolean;
  google_entry_count: number;
  google_summaries: Array<{ summary: string; meaning: string | null; date: string | null }>;
  request_count: number;
  active_request_count: number;
  needs_trapper_count: number;
  intake_count: number;
  total_altered: number;
  last_alteration_at: string | null;
  pin_style: "disease" | "watch_list" | "active" | "active_requests" | "has_history" | "minimal";
  pin_tier: "active" | "reference";
}

export interface MapDataResponse {
  atlas_pins?: AtlasPin[];
  places?: Array<{
    id: string;
    address: string;
    lat: number;
    lng: number;
    cat_count: number;
    priority: string;
    has_observation: boolean;
    service_zone: string;
    primary_person_name: string | null;
    person_count: number;
  }>;
  google_pins?: Array<{
    id: string;
    name: string;
    lat: number;
    lng: number;
    notes: string;
    entry_type: string;
    cat_count: number | null;
    ai_meaning: string | null;
    display_label: string;
    display_color: string;
    staff_alert: boolean;
    ai_confidence: number | null;
    classification_description: string | null;
  }>;
  zones?: Array<{
    id: string;
    name: string;
    geojson: unknown;
    center_lat: number;
    center_lng: number;
    status: string;
    priority: number;
  }>;
  summary?: {
    total_places: number;
    total_cats: number;
    zones_needing_obs: number;
  };
  // Additional legacy layer types...
  tnr_priority?: unknown[];
  volunteers?: unknown[];
  clinic_clients?: unknown[];
  historical_sources?: unknown[];
  data_coverage?: unknown[];
  annotations?: unknown[];
}

const fetcher = async (url: string): Promise<MapDataResponse> => {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch map data: ${res.status}`);
  }
  return res.json();
};

/**
 * Build the cache key (URL) from options
 */
function buildMapDataKey(options: UseMapDataOptions): string | null {
  if (options.enabled === false) return null;
  if (options.layers.length === 0) return null;

  const params = new URLSearchParams();
  params.set("layers", options.layers.join(","));

  if (options.zone && options.zone !== "All Zones") {
    params.set("zone", options.zone);
  }
  if (options.riskFilter && options.riskFilter !== "all") {
    params.set("risk_filter", options.riskFilter);
  }
  if (options.dataFilter && options.dataFilter !== "all") {
    params.set("data_filter", options.dataFilter);
  }
  if (options.diseaseFilter?.length) {
    params.set("disease_filter", options.diseaseFilter.join(","));
  }
  if (options.bounds) {
    params.set(
      "bounds",
      `${options.bounds.south},${options.bounds.west},${options.bounds.north},${options.bounds.east}`
    );
  }

  return `/api/beacon/map-data?${params}`;
}

/**
 * SWR-based hook for fetching map data with caching
 */
export function useMapData(options: UseMapDataOptions) {
  const key = buildMapDataKey(options);

  const defaultSwrOptions: SWRConfiguration = {
    // Don't refetch when user returns to tab (map already visible)
    revalidateOnFocus: false,
    // Do refetch when connection is restored
    revalidateOnReconnect: true,
    // Deduplicate requests within 1 minute
    dedupingInterval: 60000,
    // Keep showing previous data while loading new data
    keepPreviousData: true,
    // Retry failed requests
    errorRetryCount: 3,
    // Don't automatically refetch on interval (map handles its own refresh)
    refreshInterval: 0,
  };

  return useSWR<MapDataResponse>(
    key,
    fetcher,
    { ...defaultSwrOptions, ...options.swrOptions }
  );
}

/**
 * Global map data invalidation
 *
 * Call this after mutations that affect map data (place edits, merges, etc.)
 * to force all useMapData hooks to refetch.
 */
export function invalidateMapData() {
  // Broadcast custom event that components can listen to
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('atlas:map-data-invalidate', {
      detail: { timestamp: Date.now() }
    }));
  }
}
