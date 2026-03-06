/**
 * Atlas Map Types
 *
 * Shared types for map components and hooks.
 * Extracted from AtlasMap.tsx for modularity.
 */

// Core map data types
export interface Place {
  id: string;
  address: string;
  lat: number;
  lng: number;
  cat_count: number;
  priority: string;
  has_observation: boolean;
  service_zone: string;
  primary_person_name?: string | null;
  person_count?: number;
}

export interface GooglePin {
  id: string;
  name: string;
  lat: number;
  lng: number;
  notes: string;
  entry_type: string;
  signals?: string[];
  cat_count?: number | null;
  ai_meaning?: string | null;
  display_label?: string;
  display_color?: string;
  staff_alert?: boolean;
  ai_confidence?: number | null;
  disease_mentions?: string[] | null;
  safety_concerns?: string[] | null;
}

export interface TnrPriorityPlace {
  id: string;
  address: string;
  lat: number;
  lng: number;
  cat_count: number;
  altered_count: number;
  alteration_rate: number;
  tnr_priority: string;
  has_observation: boolean;
  service_zone: string;
}

export interface Zone {
  zone_id: string;
  zone_code: string;
  anchor_lat: number;
  anchor_lng: number;
  places_count: number;
  total_cats: number;
  observation_status: string;
  boundary?: string;
}

export interface Volunteer {
  id: string;
  name: string;
  lat: number;
  lng: number;
  role: string;
  role_label: string;
  service_zone: string | null;
  is_active: boolean;
}

export interface ClinicClient {
  id: string;
  address: string;
  lat: number;
  lng: number;
  appointment_count: number;
  cat_count: number;
  last_visit: string;
  service_zone: string;
}

export interface HistoricalSource {
  place_id: string;
  address: string;
  lat: number;
  lng: number;
  condition_type: string;
  display_label: string;
  display_color: string;
  severity: string;
  valid_from: string;
  valid_to: string | null;
  peak_cat_count: number | null;
  ecological_impact: string | null;
  description: string | null;
  opacity: number;
}

export interface DataCoverageZone {
  zone_id: string;
  zone_name: string;
  google_maps_entries: number;
  airtable_requests: number;
  clinic_appointments: number;
  intake_submissions: number;
  coverage_level: string;
}

// Consolidated Atlas Pin from v_map_atlas_pins view
export interface AtlasPin {
  id: string;
  address: string;
  display_name: string | null;
  lat: number;
  lng: number;
  service_zone: string | null;
  // For multi-unit clustering
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
  google_summaries: Array<{
    summary: string;
    meaning: string | null;
    date: string | null;
  }>;
  request_count: number;
  active_request_count: number;
  needs_trapper_count: number;
  intake_count: number;
  total_altered: number;
  last_alteration_at: string | null;
  pin_style:
    | "disease"
    | "watch_list"
    | "active"
    | "active_requests"
    | "has_history"
    | "minimal";
  pin_tier: "active" | "reference";
}

export interface MapSummary {
  total_places: number;
  total_cats: number;
  zones_needing_obs: number;
}

// Google Places API types
export interface PlacePrediction {
  place_id: string;
  description: string;
  structured_formatting: {
    main_text: string;
    secondary_text: string;
  };
}

// Search result from Atlas search API
export interface AtlasSearchResult {
  entity_type: string;
  entity_id: string;
  display_name: string;
  subtitle: string | null;
  metadata?: {
    lat?: number;
    lng?: number;
  };
}

// Navigated location for addresses not in Atlas
export interface NavigatedLocation {
  lat: number;
  lng: number;
  address: string;
}

// Annotation type
export interface Annotation {
  annotation_id: string;
  lat: number;
  lng: number;
  label: string;
  note: string | null;
  photo_url: string | null;
  annotation_type: string;
  created_by: string;
  expires_at: string | null;
  created_at: string;
}

// Layer configuration
export interface LayerConfig {
  id: string;
  label: string;
  icon: string;
  color: string;
  description: string;
  defaultEnabled: boolean;
}

// Filter types
export type RiskFilter =
  | "all"
  | "disease"
  | "watch_list"
  | "needs_tnr"
  | "needs_trapper";
export type DataFilter = "all" | "has_atlas" | "has_google" | "has_people";

// Street View state
export interface StreetViewState {
  coords: { lat: number; lng: number; address?: string } | null;
  heading: number;
  pitch: number;
  fullscreen: boolean;
  coneOnly: boolean;
}

// Search state
export interface SearchState {
  query: string;
  localResults: Array<{
    type: string;
    item: Place | GooglePin | Volunteer;
    label: string;
  }>;
  atlasResults: AtlasSearchResult[];
  googleSuggestions: PlacePrediction[];
  loading: boolean;
  showResults: boolean;
  navigatedLocation: NavigatedLocation | null;
}

// Layer configurations — atlas sub-layers (exclusive/radio behavior in UI)
export const PRIMARY_LAYER_CONFIGS: LayerConfig[] = [
  {
    id: "atlas_all",
    label: "All Places",
    icon: "📍",
    color: "#3b82f6",
    description: "All atlas places",
    defaultEnabled: true,
  },
  {
    id: "atlas_disease",
    label: "Disease Risk",
    icon: "🦠",
    color: "#ea580c",
    description: "Places with disease risk",
    defaultEnabled: false,
  },
  {
    id: "atlas_watch",
    label: "Watch List",
    icon: "👁",
    color: "#8b5cf6",
    description: "Watch list places",
    defaultEnabled: false,
  },
  {
    id: "atlas_needs_tnr",
    label: "Needs TNR",
    icon: "🎯",
    color: "#dc2626",
    description: "Places needing TNR",
    defaultEnabled: false,
  },
  {
    id: "atlas_needs_trapper",
    label: "Needs Trapper",
    icon: "🪤",
    color: "#f97316",
    description: "Places needing trapper assignment",
    defaultEnabled: false,
  },
  // Disease filter sub-layers (checkbox behavior, only visible when atlas_disease is active)
  {
    id: "dis_felv",
    label: "FeLV",
    icon: "🦠",
    color: "#dc2626",
    description: "FeLV positive places",
    defaultEnabled: false,
  },
  {
    id: "dis_fiv",
    label: "FIV",
    icon: "🦠",
    color: "#ea580c",
    description: "FIV positive places",
    defaultEnabled: false,
  },
  {
    id: "dis_ringworm",
    label: "Ringworm",
    icon: "🦠",
    color: "#ca8a04",
    description: "Ringworm positive places",
    defaultEnabled: false,
  },
  {
    id: "dis_heartworm",
    label: "Heartworm",
    icon: "🦠",
    color: "#7c3aed",
    description: "Heartworm positive places",
    defaultEnabled: false,
  },
  {
    id: "dis_panleuk",
    label: "Panleukopenia",
    icon: "🦠",
    color: "#be185d",
    description: "Panleukopenia positive places",
    defaultEnabled: false,
  },
];

export const LEGACY_LAYER_CONFIGS: LayerConfig[] = [
  {
    id: "places",
    label: "Cat Locations",
    icon: "🐱",
    color: "#3b82f6",
    description: "Places with verified cat activity",
    defaultEnabled: false,
  },
  {
    id: "google_pins",
    label: "All Google Pins",
    icon: "📍",
    color: "#f59e0b",
    description: "Google Maps historical data (AI classified)",
    defaultEnabled: false,
  },
  {
    id: "tnr_priority",
    label: "TNR Priority",
    icon: "🎯",
    color: "#dc2626",
    description: "Targeted TNR priority areas",
    defaultEnabled: false,
  },
  {
    id: "zones",
    label: "Observation Zones",
    icon: "📊",
    color: "#10b981",
    description: "Mark-recapture sampling zones",
    defaultEnabled: false,
  },
  {
    id: "volunteers",
    label: "Volunteers",
    icon: "⭐",
    color: "#FFD700",
    description: "FFSC trappers and volunteers",
    defaultEnabled: false,
  },
  {
    id: "clinic_clients",
    label: "Clinic Clients",
    icon: "🏥",
    color: "#8b5cf6",
    description: "Recent spay/neuter clients",
    defaultEnabled: false,
  },
  {
    id: "historical_sources",
    label: "Historical Sources",
    icon: "📜",
    color: "#9333ea",
    description: "Significant historical sources",
    defaultEnabled: false,
  },
  {
    id: "data_coverage",
    label: "Data Coverage",
    icon: "📊",
    color: "#059669",
    description: "Data density by zone",
    defaultEnabled: false,
  },
];

export const LAYER_CONFIGS: LayerConfig[] = [
  ...PRIMARY_LAYER_CONFIGS,
  ...LEGACY_LAYER_CONFIGS,
];

export const SERVICE_ZONES = [
  "All Zones",
  "Santa Rosa",
  "Petaluma",
  "West County",
  "North County",
  "South County",
  "Sonoma Valley",
  "Other",
];
