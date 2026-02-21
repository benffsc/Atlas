/**
 * Atlas Map Types
 *
 * TypeScript interfaces for map components and data.
 */

import type { Place, Cat, Request, ColonyEstimate } from './entities';

// =============================================================================
// MAP STATE
// =============================================================================

export interface MapState {
  center: LatLng;
  zoom: number;
  bounds?: MapBounds;
  selectedPinId: string | null;
  hoveredPinId: string | null;
  activeLayers: MapLayerId[];
}

export interface LatLng {
  lat: number;
  lng: number;
}

export interface MapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

// =============================================================================
// MAP PINS
// =============================================================================

export interface MapPin {
  id: string;
  type: MapPinType;
  lat: number;
  lng: number;
  title: string;
  subtitle?: string;

  // Entity reference
  entity_id: string;
  entity_type: 'place' | 'request';

  // Display
  icon: MapPinIcon;
  color: MapPinColor;
  size: 'small' | 'medium' | 'large';

  // Clustering
  cluster_id?: string;
  cluster_count?: number;

  // Data (varies by pin type)
  data: MapPinData;
}

export type MapPinType =
  | 'colony'
  | 'request_active'
  | 'request_completed'
  | 'disease_site'
  | 'trapping_site';

export type MapPinIcon =
  | 'paw'
  | 'home'
  | 'warning'
  | 'check'
  | 'trap'
  | 'medical';

export type MapPinColor =
  | 'green'
  | 'yellow'
  | 'red'
  | 'blue'
  | 'purple'
  | 'orange'
  | 'gray';

export interface MapPinData {
  // Colony data
  cat_count?: number;
  tnr_count?: number;
  tnr_coverage_pct?: number;
  last_tnr_date?: string;

  // Request data
  request_status?: string;
  request_priority?: string;
  cats_needing_tnr?: number;

  // Disease data
  felv_status?: string;
  fiv_status?: string;

  // Colony estimate (if available)
  colony_estimate?: {
    low: number;
    high: number;
    confidence: 'high' | 'medium' | 'low';
  };
}

// =============================================================================
// MAP LAYERS
// =============================================================================

export type MapLayerId =
  | 'colonies'
  | 'requests_active'
  | 'requests_completed'
  | 'disease_sites'
  | 'trapping_sites'
  | 'heatmap';

export interface MapLayer {
  id: MapLayerId;
  name: string;
  description: string;
  icon: string;
  visible: boolean;
  opacity: number;
  filters?: MapLayerFilter[];
}

export interface MapLayerFilter {
  field: string;
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'between';
  value: unknown;
}

export const DEFAULT_LAYERS: MapLayer[] = [
  {
    id: 'colonies',
    name: 'Cat Colonies',
    description: 'Known colony locations with population estimates',
    icon: 'paw',
    visible: true,
    opacity: 1,
  },
  {
    id: 'requests_active',
    name: 'Active Requests',
    description: 'TNR requests in progress',
    icon: 'warning',
    visible: true,
    opacity: 1,
  },
  {
    id: 'requests_completed',
    name: 'Completed Requests',
    description: 'Recently completed TNR requests',
    icon: 'check',
    visible: false,
    opacity: 0.5,
  },
  {
    id: 'disease_sites',
    name: 'Disease Sites',
    description: 'Locations with known FeLV/FIV positive cats',
    icon: 'medical',
    visible: false,
    opacity: 1,
  },
  {
    id: 'trapping_sites',
    name: 'Trapping Sites',
    description: 'Active trapping locations',
    icon: 'trap',
    visible: false,
    opacity: 1,
  },
];

// =============================================================================
// MAP DETAIL PANEL
// =============================================================================

export interface MapDetailPanelData {
  type: 'place' | 'request' | 'cluster';
  place?: Place;
  request?: Request;
  colony_estimate?: ColonyEstimate;
  cats?: Cat[];
  cluster?: {
    pin_count: number;
    pins: MapPin[];
  };
}

// =============================================================================
// MAP EVENTS
// =============================================================================

export interface MapClickEvent {
  lat: number;
  lng: number;
  pin?: MapPin;
}

export interface MapMoveEvent {
  center: LatLng;
  zoom: number;
  bounds: MapBounds;
}

export interface MapClusterClickEvent {
  cluster_id: string;
  pins: MapPin[];
  center: LatLng;
}

// =============================================================================
// MAP CONFIG
// =============================================================================

export interface MapConfig {
  defaultCenter: LatLng;
  defaultZoom: number;
  minZoom: number;
  maxZoom: number;
  clusteringEnabled: boolean;
  clusterRadius: number;
  clusterMinPoints: number;
}

export const DEFAULT_MAP_CONFIG: MapConfig = {
  defaultCenter: { lat: 38.4404, lng: -122.7141 }, // Sonoma County
  defaultZoom: 10,
  minZoom: 8,
  maxZoom: 18,
  clusteringEnabled: true,
  clusterRadius: 80,
  clusterMinPoints: 3,
};

// =============================================================================
// COORDINATE UTILITIES
// =============================================================================

/**
 * Tolerance for coordinate matching (approximately 111 meters).
 * Used when matching Google Places to Atlas pins.
 */
export const COORDINATE_TOLERANCE = 0.001;

/**
 * Check if two coordinates are within tolerance.
 */
export function coordinatesMatch(
  a: LatLng | null | undefined,
  b: LatLng | null | undefined,
  tolerance = COORDINATE_TOLERANCE
): boolean {
  if (!a || !b) return false;
  return (
    Math.abs(a.lat - b.lat) < tolerance &&
    Math.abs(a.lng - b.lng) < tolerance
  );
}

/**
 * Calculate distance between two coordinates (in meters).
 * Uses Haversine formula.
 */
export function calculateDistance(a: LatLng, b: LatLng): number {
  const R = 6371000; // Earth radius in meters
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const deltaLat = ((b.lat - a.lat) * Math.PI) / 180;
  const deltaLng = ((b.lng - a.lng) * Math.PI) / 180;

  const x =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));

  return R * c;
}
