/**
 * Geographic config helpers — read from ops.app_config with FFSC defaults.
 *
 * Server components / API routes: use these async helpers.
 * Client components: use useGeoConfig() from @/hooks/useGeoConfig.
 *
 * FFS-685: White-label map & geographic defaults.
 */

import { getServerConfig } from "@/lib/server-config";

// ── Defaults (FFSC / Sonoma County) ─────────────────────────────────
// Keep in sync with MIG_2964 seed data.

const DEFAULTS = {
  "map.default_center": [38.45, -122.75] as [number, number],
  "map.default_zoom": 10,
  "map.default_bounds": { south: 37.8, north: 39.4, west: -123.6, east: -122.3 },
  "map.autocomplete_bias": { lat: 38.5, lng: -122.8, radius: 50000 },
  "geo.service_counties": ["Sonoma", "Marin", "Napa", "Mendocino", "Lake"],
  "geo.default_county": "Sonoma",
  "geo.service_area_name": "Sonoma County",
} as const;

// ── Types ───────────────────────────────────────────────────────────

export interface MapBounds {
  south: number;
  north: number;
  west: number;
  east: number;
}

export interface AutocompleteBias {
  lat: number;
  lng: number;
  radius: number;
}

// ── Convenience getters ─────────────────────────────────────────────

export const getMapCenter = () =>
  getServerConfig<[number, number]>("map.default_center", DEFAULTS["map.default_center"]);

export const getMapZoom = () =>
  getServerConfig<number>("map.default_zoom", DEFAULTS["map.default_zoom"]);

export const getMapBounds = () =>
  getServerConfig<MapBounds>("map.default_bounds", DEFAULTS["map.default_bounds"]);

export const getAutocompleteBias = () =>
  getServerConfig<AutocompleteBias>("map.autocomplete_bias", DEFAULTS["map.autocomplete_bias"]);

export const getServiceCounties = () =>
  getServerConfig<string[]>("geo.service_counties", [...DEFAULTS["geo.service_counties"]]);

export const getDefaultCounty = () =>
  getServerConfig<string>("geo.default_county", DEFAULTS["geo.default_county"]);

export const getServiceAreaName = () =>
  getServerConfig<string>("geo.service_area_name", DEFAULTS["geo.service_area_name"]);
