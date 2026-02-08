"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import "@/styles/atlas-map.css";
import {
  createPinMarker,
  createCircleMarker,
  createStarMarker,
  createClinicMarker,
  createUserLocationMarker,
  createAtlasPinMarker,
  createReferencePinMarker,
  createAnnotationMarker,
  generateLegendPinSvg,
} from "@/lib/map-markers";
import { MAP_COLORS, getPriorityColor } from "@/lib/map-colors";
import {
  buildPlacePopup,
  buildGooglePinPopup,
  buildTNRPriorityPopup,
  buildVolunteerPopup,
  buildClinicClientPopup,
  buildZonePopup,
  escapeHtml,
} from "@/components/map/MapPopup";
import { PlaceDetailDrawer } from "@/components/map/PlaceDetailDrawer";
import { AnnotationDetailDrawer } from "@/components/map/AnnotationDetailDrawer";
import { PersonDetailDrawer } from "@/components/map/PersonDetailDrawer";
import { CatDetailDrawer } from "@/components/map/CatDetailDrawer";
import { PlacementPanel } from "@/components/map/PlacementPanel";

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < breakpoint);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [breakpoint]);
  return isMobile;
}

// Types for map data
interface Place {
  id: string;
  address: string;
  lat: number;
  lng: number;
  cat_count: number;
  priority: string;
  has_observation: boolean;
  service_zone: string;
  primary_person_name?: string;
  person_count?: number;
}

interface GooglePin {
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

interface TnrPriorityPlace {
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

interface Zone {
  zone_id: string;
  zone_code: string;
  anchor_lat: number;
  anchor_lng: number;
  places_count: number;
  total_cats: number;
  observation_status: string;
  boundary?: string;
}

interface Volunteer {
  id: string;
  name: string;
  lat: number;
  lng: number;
  role: string;
  role_label: string;
  service_zone: string | null;
  is_active: boolean;
}

interface ClinicClient {
  id: string;
  address: string;
  lat: number;
  lng: number;
  appointment_count: number;
  cat_count: number;
  last_visit: string;
  service_zone: string;
}

// Google Places API types
interface PlacePrediction {
  place_id: string;
  description: string;
  structured_formatting: {
    main_text: string;
    secondary_text: string;
  };
}

// Search result from Atlas search API
interface AtlasSearchResult {
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
interface NavigatedLocation {
  lat: number;
  lng: number;
  address: string;
}

interface HistoricalSource {
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

interface DataCoverageZone {
  zone_id: string;
  zone_name: string;
  google_maps_entries: number;
  airtable_requests: number;
  clinic_appointments: number;
  intake_submissions: number;
  coverage_level: string;
}

// NEW: Consolidated Atlas Pin from v_map_atlas_pins view
interface AtlasPin {
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
  disease_badges: Array<{ disease_key: string; short_code: string; color: string; status: string; last_positive: string | null; positive_cats: number }>;
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

interface MapSummary {
  total_places: number;
  total_cats: number;
  zones_needing_obs: number;
}

// Layer configuration
interface LayerConfig {
  id: string;
  label: string;
  icon: string;
  color: string;
  description: string;
  defaultEnabled: boolean;
}

// Primary layers (shown by default)
const PRIMARY_LAYER_CONFIGS: LayerConfig[] = [
  { id: "atlas_pins", label: "Atlas Data", icon: "📍", color: "#3b82f6", description: "Places, people, cats, and history", defaultEnabled: true },
];

// Legacy layers (hidden by default, advanced users only)
const LEGACY_LAYER_CONFIGS: LayerConfig[] = [
  { id: "places", label: "Cat Locations", icon: "🐱", color: "#3b82f6", description: "Places with verified cat activity", defaultEnabled: false },
  { id: "google_pins", label: "All Google Pins", icon: "📍", color: "#f59e0b", description: "Google Maps historical data (AI classified)", defaultEnabled: false },
  { id: "tnr_priority", label: "TNR Priority", icon: "🎯", color: "#dc2626", description: "Targeted TNR priority areas", defaultEnabled: false },
  { id: "zones", label: "Observation Zones", icon: "📊", color: "#10b981", description: "Mark-recapture sampling zones", defaultEnabled: false },
  { id: "volunteers", label: "Volunteers", icon: "⭐", color: "#FFD700", description: "FFSC trappers and volunteers", defaultEnabled: false },
  { id: "clinic_clients", label: "Clinic Clients", icon: "🏥", color: "#8b5cf6", description: "Recent spay/neuter clients", defaultEnabled: false },
  { id: "historical_sources", label: "Historical Sources", icon: "📜", color: "#9333ea", description: "Significant historical sources", defaultEnabled: false },
  { id: "data_coverage", label: "Data Coverage", icon: "📊", color: "#059669", description: "Data density by zone", defaultEnabled: false },
];

// Combined for state initialization
const LAYER_CONFIGS: LayerConfig[] = [...PRIMARY_LAYER_CONFIGS, ...LEGACY_LAYER_CONFIGS];

// Map branding
const MAP_TITLE = "Atlas Map";

const SERVICE_ZONES = [
  "All Zones",
  "Santa Rosa",
  "Petaluma",
  "West County",
  "North County",
  "South County",
  "Sonoma Valley",
  "Other",
];

// Colors now imported from map-colors.ts

export default function AtlasMap() {
  const isMobile = useIsMobile();
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const layersRef = useRef<Record<string, L.LayerGroup>>({});
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const labelsLayerRef = useRef<L.TileLayer | null>(null);

  // State
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showLayerPanel, setShowLayerPanel] = useState(false);
  const [showLegend, setShowLegend] = useState(!isMobile);
  const [isSatellite, setIsSatellite] = useState(false);
  const [selectedZone, setSelectedZone] = useState("All Zones");
  const [enabledLayers, setEnabledLayers] = useState<Record<string, boolean>>(
    Object.fromEntries(LAYER_CONFIGS.map(l => [l.id, l.defaultEnabled]))
  );

  // Data - NEW simplified layers
  const [atlasPins, setAtlasPins] = useState<AtlasPin[]>([]);

  // Data - Legacy layers
  const [places, setPlaces] = useState<Place[]>([]);
  const [googlePins, setGooglePins] = useState<GooglePin[]>([]);
  const [tnrPriority, setTnrPriority] = useState<TnrPriorityPlace[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [volunteers, setVolunteers] = useState<Volunteer[]>([]);
  const [clinicClients, setClinicClients] = useState<ClinicClient[]>([]);
  const [historicalSources, setHistoricalSources] = useState<HistoricalSource[]>([]);
  const [dataCoverage, setDataCoverage] = useState<DataCoverageZone[]>([]);
  const [summary, setSummary] = useState<MapSummary | null>(null);

  // Filters for atlas_pins layer
  const [riskFilter, setRiskFilter] = useState<"all" | "disease" | "watch_list" | "needs_tnr" | "needs_trapper">("all");
  const [dataFilter, setDataFilter] = useState<"all" | "has_atlas" | "has_google" | "has_people">("all");
  const [diseaseFilter, setDiseaseFilter] = useState<string[]>([]);

  // Show legacy layers toggle
  const [showLegacyLayers, setShowLegacyLayers] = useState(false);

  // Search suggestions
  const [searchResults, setSearchResults] = useState<Array<{ type: string; item: Place | GooglePin | Volunteer; label: string }>>([]);
  const [atlasSearchResults, setAtlasSearchResults] = useState<AtlasSearchResult[]>([]);
  const [googleSuggestions, setGoogleSuggestions] = useState<PlacePrediction[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [navigatedLocation, setNavigatedLocation] = useState<NavigatedLocation | null>(null);
  const navigatedMarkerRef = useRef<L.Marker | null>(null);
  const atlasPinsRef = useRef<AtlasPin[]>([]);
  const leafletCjsRef = useRef<any>(null);

  // Keep atlasPinsRef in sync without triggering effects
  useEffect(() => {
    atlasPinsRef.current = atlasPins;
  }, [atlasPins]);

  // Drawer state for place details
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const selectedPlaceIdRef = useRef<string | null>(null);
  const [drawerFromAddPoint, setDrawerFromAddPoint] = useState(false);
  useEffect(() => { selectedPlaceIdRef.current = selectedPlaceId; }, [selectedPlaceId]);

  // Add Point mode state
  const [addPointMode, setAddPointMode] = useState<'place' | 'annotation' | null>(null);
  const [pendingClick, setPendingClick] = useState<{ lat: number; lng: number } | null>(null);
  const [showAddPointMenu, setShowAddPointMenu] = useState(false);

  // Annotations state
  interface Annotation {
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
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const annotationLayerRef = useRef<L.LayerGroup | null>(null);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);

  // Person and Cat drawer state
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [selectedCatId, setSelectedCatId] = useState<string | null>(null);

  // Street View state
  const [streetViewCoords, setStreetViewCoords] = useState<{ lat: number; lng: number; address?: string } | null>(null);
  const [streetViewHeading, setStreetViewHeading] = useState(0);
  const [streetViewPitch, setStreetViewPitch] = useState(0);
  const streetViewMarkerRef = useRef<L.Marker | null>(null);
  const streetViewIframeRef = useRef<HTMLIFrameElement>(null);
  const streetViewConePosRef = useRef<{ lat: number; lng: number } | null>(null);
  const [streetViewFullscreen, setStreetViewFullscreen] = useState(false);
  // Cone-only mode: show cone marker on map without the bottom panel (used by drawer street view)
  const [streetViewConeOnly, setStreetViewConeOnly] = useState(false);
  const streetViewConeOnlyRef = useRef(false);
  const miniMapRef = useRef<any>(null);
  const miniMapContainerRef = useRef<HTMLDivElement>(null);

  // Listen for postMessage from interactive Street View iframe
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (!event.data?.type) return;
      if (event.data.type === "streetview-pov") {
        setStreetViewHeading(event.data.heading);
        setStreetViewPitch(event.data.pitch);
      } else if (event.data.type === "streetview-position") {
        // User "walked" — move the cone marker directly without changing the iframe URL
        streetViewConePosRef.current = { lat: event.data.lat, lng: event.data.lng };
        if (streetViewMarkerRef.current) {
          streetViewMarkerRef.current.setLatLng([event.data.lat, event.data.lng]);
        }
        // Update mini map center if it exists
        if (miniMapRef.current) {
          miniMapRef.current.setView([event.data.lat, event.data.lng], 16, { animate: true });
          // Move mini map cone marker
          const layers = miniMapRef.current._miniMapConeMarker;
          if (layers) {
            layers.setLatLng([event.data.lat, event.data.lng]);
          }
        }
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // Listen for atlas:navigate-place events from person/cat drawers
  useEffect(() => {
    const handler = (e: Event) => {
      const placeId = (e as CustomEvent).detail?.placeId;
      if (placeId) {
        setSelectedPersonId(null);
        setSelectedCatId(null);
        setSelectedPlaceId(placeId);
      }
    };
    window.addEventListener("atlas:navigate-place", handler);
    return () => window.removeEventListener("atlas:navigate-place", handler);
  }, []);

  // Mini map for Street View fullscreen mode
  useEffect(() => {
    if (!streetViewFullscreen || !miniMapContainerRef.current || !streetViewCoords) {
      // Destroy mini map when exiting fullscreen
      if (miniMapRef.current) {
        miniMapRef.current.remove();
        miniMapRef.current = null;
      }
      return;
    }

    // Create lightweight Leaflet map in the mini map container
    const miniMap = L.map(miniMapContainerRef.current, {
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      touchZoom: false,
    });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 19,
    }).addTo(miniMap);

    // Center on street view position
    const conePos = streetViewConePosRef.current || streetViewCoords;
    miniMap.setView([conePos.lat, conePos.lng], 16);

    // Add cone marker (blue dot)
    const coneMarker = L.circleMarker([conePos.lat, conePos.lng], {
      radius: 6,
      fillColor: "#3b82f6",
      fillOpacity: 1,
      color: "white",
      weight: 2,
    }).addTo(miniMap);
    (miniMap as any)._miniMapConeMarker = coneMarker;

    // Add nearby atlas pins within ~300m
    const MINI_RADIUS = 0.003;
    for (const p of atlasPinsRef.current) {
      if (!p.lat || !p.lng) continue;
      const dLat = Math.abs(p.lat - conePos.lat);
      const dLng = Math.abs(p.lng - conePos.lng);
      if (dLat < MINI_RADIUS && dLng < MINI_RADIUS) {
        const dotColor = p.pin_style === "disease" ? "#ea580c"
          : p.pin_style === "watch_list" ? "#8b5cf6"
          : p.pin_style === "active" ? "#22c55e"
          : p.pin_style === "active_requests" ? "#14b8a6"
          : p.pin_style === "has_history" ? "#6366f1"
          : "#94a3b8";
        L.circleMarker([p.lat, p.lng], {
          radius: 4,
          fillColor: dotColor,
          fillOpacity: 0.8,
          color: "white",
          weight: 1,
        }).addTo(miniMap);
      }
    }

    miniMapRef.current = miniMap;

    // Invalidate size after render
    setTimeout(() => miniMap.invalidateSize(), 100);

    return () => {
      miniMap.remove();
      miniMapRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streetViewFullscreen, streetViewCoords]);

  // Escape key exits Street View fullscreen
  useEffect(() => {
    if (!streetViewFullscreen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setStreetViewFullscreen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [streetViewFullscreen]);

  // Invalidate map size when fullscreen toggles
  useEffect(() => {
    if (mapRef.current) {
      setTimeout(() => mapRef.current?.invalidateSize(), 350);
    }
  }, [streetViewFullscreen]);

  // Keep cone-only ref in sync with state
  useEffect(() => { streetViewConeOnlyRef.current = streetViewConeOnly; }, [streetViewConeOnly]);

  // Auto-collapse legend when any drawer is open to reduce clutter
  const legendWasOpenRef = useRef<boolean | null>(null);
  useEffect(() => {
    const anyDrawerOpen = !!(selectedPlaceId || selectedCatId || selectedPersonId || selectedAnnotationId);
    if (anyDrawerOpen && legendWasOpenRef.current === null) {
      legendWasOpenRef.current = showLegend;
      setShowLegend(false);
    } else if (!anyDrawerOpen && legendWasOpenRef.current !== null) {
      setShowLegend(legendWasOpenRef.current);
      legendWasOpenRef.current = null;
    }
  }, [selectedPlaceId, selectedCatId, selectedPersonId, selectedAnnotationId]);

  // Expose setSelectedPlaceId and street view globally for popup buttons + drawer
  useEffect(() => {
    (window as unknown as { atlasMapExpandPlace: (id: string) => void }).atlasMapExpandPlace = (id: string) => {
      setSelectedPlaceId(id);
    };
    // Open full bottom panel + cone
    (window as unknown as { atlasMapOpenStreetView: (lat: number, lng: number, address?: string) => void }).atlasMapOpenStreetView = (lat: number, lng: number, address?: string) => {
      setStreetViewCoords({ lat, lng, address });
      setStreetViewConeOnly(false);
    };
    // Show cone marker only (no bottom panel) — used by drawer street view
    (window as unknown as { atlasMapShowStreetViewCone: (lat: number, lng: number) => void }).atlasMapShowStreetViewCone = (lat: number, lng: number) => {
      setStreetViewCoords({ lat, lng });
      setStreetViewConeOnly(true);
    };
    // Hide cone-only mode (doesn't close the full panel if open)
    (window as unknown as { atlasMapHideStreetViewCone: () => void }).atlasMapHideStreetViewCone = () => {
      if (streetViewConeOnlyRef.current) {
        setStreetViewCoords(null);
        setStreetViewConeOnly(false);
      }
    };
    // Open street view directly in fullscreen mode (used by drawer Expand button)
    (window as unknown as { atlasMapExpandStreetViewFullscreen: (lat: number, lng: number, address?: string) => void }).atlasMapExpandStreetViewFullscreen = (lat: number, lng: number, address?: string) => {
      setStreetViewCoords({ lat, lng, address });
      setStreetViewConeOnly(false);
      setStreetViewFullscreen(true);
    };
    return () => {
      delete (window as unknown as { atlasMapExpandPlace?: (id: string) => void }).atlasMapExpandPlace;
      delete (window as unknown as { atlasMapOpenStreetView?: (lat: number, lng: number, address?: string) => void }).atlasMapOpenStreetView;
      delete (window as unknown as { atlasMapShowStreetViewCone?: (lat: number, lng: number) => void }).atlasMapShowStreetViewCone;
      delete (window as unknown as { atlasMapHideStreetViewCone?: () => void }).atlasMapHideStreetViewCone;
      delete (window as unknown as { atlasMapExpandStreetViewFullscreen?: (lat: number, lng: number, address?: string) => void }).atlasMapExpandStreetViewFullscreen;
    };
  }, []);

  // Emit map context events for Tippy integration
  useEffect(() => {
    const emitMapContext = () => {
      if (!mapRef.current) return;

      const center = mapRef.current.getCenter();
      const bounds = mapRef.current.getBounds();
      const zoom = mapRef.current.getZoom();

      // Find selected place data if any
      const selectedPlace = selectedPlaceId
        ? atlasPins.find(p => p.id === selectedPlaceId) ||
          places.find(p => p.id === selectedPlaceId)
        : null;

      window.dispatchEvent(new CustomEvent('tippy-map-context', {
        detail: {
          center: { lat: center.lat, lng: center.lng },
          zoom,
          bounds: {
            north: bounds.getNorth(),
            south: bounds.getSouth(),
            east: bounds.getEast(),
            west: bounds.getWest(),
          },
          selectedPlace: selectedPlace ? {
            place_id: selectedPlace.id,
            address: selectedPlace.address,
          } : null,
          navigatedLocation: navigatedLocation,
          drawerOpen: !!selectedPlaceId,
          visiblePinCount: atlasPins.length,
          lastSearchQuery: searchQuery || null,
        }
      }));
    };

    // Emit on map move end
    if (mapRef.current) {
      mapRef.current.on('moveend', emitMapContext);
      mapRef.current.on('zoomend', emitMapContext);
    }

    // Emit initially and when selection changes
    emitMapContext();

    return () => {
      if (mapRef.current) {
        mapRef.current.off('moveend', emitMapContext);
        mapRef.current.off('zoomend', emitMapContext);
      }
    };
  }, [selectedPlaceId, atlasPins, places, navigatedLocation]);

  // Fetch map data
  const fetchMapData = useCallback(async () => {
    const layers = Object.entries(enabledLayers)
      .filter(([, enabled]) => enabled)
      .map(([id]) => id);

    if (layers.length === 0) {
      // Clear new layers
      setAtlasPins([]);
      // Clear legacy layers
      setPlaces([]);
      setGooglePins([]);
      setTnrPriority([]);
      setZones([]);
      setVolunteers([]);
      setClinicClients([]);
      setHistoricalSources([]);
      setDataCoverage([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ layers: layers.join(",") });
      if (selectedZone !== "All Zones") {
        params.set("zone", selectedZone);
      }
      // Add filter params for atlas_pins layer
      if (layers.includes("atlas_pins")) {
        params.set("risk_filter", riskFilter);
        params.set("data_filter", dataFilter);
        if (diseaseFilter.length > 0) {
          params.set("disease_filter", diseaseFilter.join(","));
        }
      }

      // Add viewport bounds for efficient loading (only load visible pins)
      if (mapRef.current) {
        const bounds = mapRef.current.getBounds();
        params.set("bounds", `${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()}`);
      }

      const response = await fetch(`/api/beacon/map-data?${params}`);
      if (!response.ok) throw new Error("Failed to fetch map data");

      const data = await response.json();
      // New layers
      setAtlasPins(data.atlas_pins || []);
      // Legacy layers
      setPlaces(data.places || []);
      setGooglePins(data.google_pins || []);
      setTnrPriority(data.tnr_priority || []);
      setZones(data.zones || []);
      setVolunteers(data.volunteers || []);
      setClinicClients(data.clinic_clients || []);
      setHistoricalSources(data.historical_sources || []);
      setDataCoverage(data.data_coverage || []);
      setSummary(data.summary || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [enabledLayers, selectedZone, riskFilter, dataFilter, diseaseFilter]);

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    // leaflet.markercluster mutates the CJS exports object from require("leaflet"),
    // which is a different object than our ES namespace (import * as L). We need the
    // mutable CJS reference so the plugin's .markerClusterGroup() is accessible.
    const LeafletCjs = require("leaflet");
    require("leaflet.markercluster");
    leafletCjsRef.current = LeafletCjs;

    const map = L.map(mapContainerRef.current, {
      zoomControl: false,
      // Use Canvas instead of SVG for 2-3x faster marker rendering
      preferCanvas: true,
      // Smooth trackpad/scroll zoom
      scrollWheelZoom: true,
      wheelDebounceTime: 80,
      wheelPxPerZoomLevel: 120,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      // Smooth panning
      inertia: true,
      inertiaDeceleration: 2000,
      inertiaMaxSpeed: 1500,
      bounceAtZoomLimits: false,
    }).setView([38.45, -122.75], 10);

    // Add default street tile layer (CartoDB Voyager)
    const streetTiles = L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      maxZoom: 19,
    }).addTo(map);
    tileLayerRef.current = streetTiles;

    // Custom zoom control position
    L.control.zoom({ position: "bottomright" }).addTo(map);

    mapRef.current = map;

    // Handle URL parameters for deep linking (e.g., /map?lat=38.5&lng=-122.7&zoom=16 or /map?search=address)
    const searchParams = new URLSearchParams(window.location.search);
    const urlLat = searchParams.get('lat');
    const urlLng = searchParams.get('lng');
    const urlZoom = searchParams.get('zoom');
    const urlSearch = searchParams.get('search');

    const urlHighlight = searchParams.get('highlight');

    if (urlLat && urlLng) {
      const lat = parseFloat(urlLat);
      const lng = parseFloat(urlLng);
      const zoom = urlZoom ? parseInt(urlZoom, 10) : 16;

      if (!isNaN(lat) && !isNaN(lng)) {
        map.setView([lat, lng], zoom);
        // Set navigated location to show a marker at this point
        setNavigatedLocation({ lat, lng, address: urlHighlight || 'Selected location' });
      }
    } else if (urlSearch) {
      // Pre-populate search query from URL and trigger search
      setSearchQuery(urlSearch);
      setShowSearchResults(true);
    }

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Toggle satellite / street tile layer
  useEffect(() => {
    if (!mapRef.current || !tileLayerRef.current) return;

    // Remove existing layers
    mapRef.current.removeLayer(tileLayerRef.current);
    if (labelsLayerRef.current) {
      mapRef.current.removeLayer(labelsLayerRef.current);
      labelsLayerRef.current = null;
    }

    if (isSatellite) {
      // Satellite imagery base layer
      const satelliteTiles = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
        attribution: "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics",
        maxZoom: 19,
      });
      satelliteTiles.addTo(mapRef.current);
      satelliteTiles.setZIndex(0);
      tileLayerRef.current = satelliteTiles;

      // Add labels overlay on top of satellite
      const labelsTiles = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        maxZoom: 19,
        pane: "overlayPane", // Ensure labels are above satellite but below markers
      });
      labelsTiles.addTo(mapRef.current);
      labelsTiles.setZIndex(1);
      labelsLayerRef.current = labelsTiles;
    } else {
      // Street view (includes labels)
      const streetTiles = L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        maxZoom: 19,
      });
      streetTiles.addTo(mapRef.current);
      streetTiles.setZIndex(0);
      tileLayerRef.current = streetTiles;
    }
  }, [isSatellite]);

  // Fetch data on mount and when filters change (debounced to avoid rapid re-fetches)
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchMapData();
    }, 150);
    return () => clearTimeout(timer);
  }, [fetchMapData]);

  // Refetch data when viewport changes (pan/zoom) - debounced to avoid excessive requests
  useEffect(() => {
    if (!mapRef.current) return;

    let timer: NodeJS.Timeout;
    const handleMoveEnd = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        fetchMapData();
      }, 300); // 300ms debounce for viewport changes
    };

    mapRef.current.on('moveend', handleMoveEnd);
    return () => {
      clearTimeout(timer);
      mapRef.current?.off('moveend', handleMoveEnd);
    };
  }, [fetchMapData]);

  // Update places layer
  useEffect(() => {
    if (!mapRef.current) return;
    if (layersRef.current.places) {
      mapRef.current.removeLayer(layersRef.current.places);
    }
    if (!enabledLayers.places || places.length === 0) return;

    const layer = L.layerGroup();
    places.forEach((place) => {
      if (!place.lat || !place.lng) return;
      const color = getPriorityColor(place.priority);
      const size = place.priority === "high" ? 16 : place.priority === "medium" ? 14 : 12;

      const marker = L.marker([place.lat, place.lng], {
        icon: createCircleMarker(color, { size }),
      });

      marker.bindPopup(buildPlacePopup({
        id: place.id,
        address: place.address,
        lat: place.lat,
        lng: place.lng,
        cat_count: place.cat_count,
        priority: place.priority,
        service_zone: place.service_zone,
        has_observation: place.has_observation,
        primary_person_name: place.primary_person_name,
        person_count: place.person_count,
      }));
      layer.addLayer(marker);
    });

    layer.addTo(mapRef.current);
    layersRef.current.places = layer;
  }, [places, enabledLayers.places]);

  // Update Google pins layer
  useEffect(() => {
    if (!mapRef.current) return;
    if (layersRef.current.google_pins) {
      mapRef.current.removeLayer(layersRef.current.google_pins);
    }
    if (!enabledLayers.google_pins || googlePins.length === 0) return;

    const layer = L.layerGroup();
    googlePins.forEach((pin) => {
      if (!pin.lat || !pin.lng) return;

      const color = pin.display_color || MAP_COLORS.layers.google_pins;
      const isAlert = pin.staff_alert || false;
      const size = isAlert ? 36 : 28;

      const marker = L.marker([pin.lat, pin.lng], {
        icon: createPinMarker(color, { size, isAlert }),
      });

      marker.bindPopup(buildGooglePinPopup({
        id: pin.id,
        name: pin.name,
        notes: pin.notes,
        cat_count: pin.cat_count ?? undefined,
        display_label: pin.display_label,
        display_color: pin.display_color,
        ai_meaning: pin.ai_meaning ?? undefined,
        ai_confidence: pin.ai_confidence ?? undefined,
        staff_alert: isAlert ? pin.display_label : undefined,
        disease_mentions: pin.disease_mentions ?? undefined,
        safety_concerns: pin.safety_concerns ?? undefined,
      }));
      layer.addLayer(marker);
    });

    layer.addTo(mapRef.current);
    layersRef.current.google_pins = layer;
  }, [googlePins, enabledLayers.google_pins]);

  // Update TNR Priority layer
  useEffect(() => {
    if (!mapRef.current) return;
    if (layersRef.current.tnr_priority) {
      mapRef.current.removeLayer(layersRef.current.tnr_priority);
    }
    if (!enabledLayers.tnr_priority || tnrPriority.length === 0) return;

    const layer = L.layerGroup();
    tnrPriority.forEach((place) => {
      if (!place.lat || !place.lng) return;

      const color = MAP_COLORS.priority[place.tnr_priority as keyof typeof MAP_COLORS.priority] || MAP_COLORS.priority.unknown;
      const size = place.tnr_priority === "critical" ? 36 : place.tnr_priority === "high" ? 32 : 28;

      const marker = L.marker([place.lat, place.lng], {
        icon: createPinMarker(color, { size, label: "!" }),
      });

      marker.bindPopup(buildTNRPriorityPopup({
        id: place.id,
        address: place.address,
        cat_count: place.cat_count,
        altered_count: place.altered_count,
        alteration_rate: place.alteration_rate / 100, // Convert to decimal
        tnr_priority: place.tnr_priority,
        service_zone: place.service_zone,
      }));
      layer.addLayer(marker);
    });

    layer.addTo(mapRef.current);
    layersRef.current.tnr_priority = layer;
  }, [tnrPriority, enabledLayers.tnr_priority]);

  // Update Zones layer
  useEffect(() => {
    if (!mapRef.current) return;
    if (layersRef.current.zones) {
      mapRef.current.removeLayer(layersRef.current.zones);
    }
    if (!enabledLayers.zones || zones.length === 0) return;

    const layer = L.layerGroup();
    zones.forEach((zone) => {
      // Add boundary polygon
      if (zone.boundary) {
        try {
          const geojson = JSON.parse(zone.boundary);
          const color = MAP_COLORS.layers.zones;
          const polygon = L.geoJSON(geojson, {
            style: {
              color,
              weight: 2,
              opacity: 0.8,
              fillColor: color,
              fillOpacity: 0.1,
            },
          });
          polygon.bindPopup(buildZonePopup({
            zone_id: zone.zone_id,
            zone_code: zone.zone_code,
            places_count: zone.places_count,
            total_cats: zone.total_cats,
            observation_status: zone.observation_status,
          }));
          layer.addLayer(polygon);
        } catch (e) {
          console.error("Failed to parse zone boundary:", e);
        }
      }
    });

    layer.addTo(mapRef.current);
    layersRef.current.zones = layer;
  }, [zones, enabledLayers.zones]);

  // Update Volunteers layer
  useEffect(() => {
    if (!mapRef.current) return;
    if (layersRef.current.volunteers) {
      mapRef.current.removeLayer(layersRef.current.volunteers);
    }
    if (!enabledLayers.volunteers || volunteers.length === 0) return;

    const layer = L.layerGroup();
    volunteers.forEach((vol) => {
      if (!vol.lat || !vol.lng) return;

      const color = MAP_COLORS.volunteerRoles[vol.role as keyof typeof MAP_COLORS.volunteerRoles] || MAP_COLORS.layers.volunteers;

      const marker = L.marker([vol.lat, vol.lng], {
        icon: createStarMarker(color, { size: 24 }),
      });

      marker.bindPopup(buildVolunteerPopup({
        id: vol.id,
        name: vol.name,
        role: vol.role,
        role_label: vol.role_label,
        service_zone: vol.service_zone || undefined,
        is_active: vol.is_active,
      }));
      layer.addLayer(marker);
    });

    layer.addTo(mapRef.current);
    layersRef.current.volunteers = layer;
  }, [volunteers, enabledLayers.volunteers]);

  // Update Clinic Clients layer
  useEffect(() => {
    if (!mapRef.current) return;
    if (layersRef.current.clinic_clients) {
      mapRef.current.removeLayer(layersRef.current.clinic_clients);
    }
    if (!enabledLayers.clinic_clients || clinicClients.length === 0) return;

    const layer = L.layerGroup();
    clinicClients.forEach((client) => {
      if (!client.lat || !client.lng) return;

      const marker = L.marker([client.lat, client.lng], {
        icon: createClinicMarker(MAP_COLORS.layers.clinic_clients, { size: 14 }),
      });

      marker.bindPopup(buildClinicClientPopup({
        id: client.id,
        address: client.address,
        appointment_count: client.appointment_count,
        cat_count: client.cat_count,
        last_visit: client.last_visit,
        service_zone: client.service_zone,
      }));
      layer.addLayer(marker);
    });

    layer.addTo(mapRef.current);
    layersRef.current.clinic_clients = layer;
  }, [clinicClients, enabledLayers.clinic_clients]);

  // Update Historical Sources layer
  useEffect(() => {
    if (!mapRef.current) return;
    if (layersRef.current.historical_sources) {
      mapRef.current.removeLayer(layersRef.current.historical_sources);
    }
    if (!enabledLayers.historical_sources || historicalSources.length === 0) return;

    const layer = L.layerGroup();
    historicalSources.forEach((source) => {
      if (!source.lat || !source.lng) return;

      const color = source.display_color || "#9333ea";
      const size = source.peak_cat_count && source.peak_cat_count > 50 ? 32 :
                   source.peak_cat_count && source.peak_cat_count > 20 ? 28 : 24;

      // Create marker with opacity based on how recent
      const markerIcon = L.divIcon({
        className: "historical-source-marker",
        html: `<div style="
          width: ${size}px; height: ${size}px;
          background: ${color};
          border: 3px solid white;
          border-radius: 50%;
          box-shadow: 0 2px 6px rgba(0,0,0,0.3);
          opacity: ${source.opacity};
          display: flex; align-items: center; justify-content: center;
          font-size: ${size * 0.4}px; color: white; font-weight: bold;
        ">📜</div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });

      const marker = L.marker([source.lat, source.lng], { icon: markerIcon });

      const validFrom = new Date(source.valid_from).toLocaleDateString();
      const validTo = source.valid_to ? new Date(source.valid_to).toLocaleDateString() : "Ongoing";

      marker.bindPopup(`
        <div style="min-width: 260px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
          <div style="display: inline-block; background: ${color}; color: white; padding: 2px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; margin-bottom: 8px;">
            ${source.display_label}
          </div>
          <div style="font-weight: 600; font-size: 14px; margin-bottom: 8px;">${source.address}</div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px;">
            <div style="background: #f3f4f6; padding: 8px; border-radius: 6px; text-align: center;">
              <div style="font-size: 16px; font-weight: 700; color: #374151;">${source.peak_cat_count || "?"}</div>
              <div style="font-size: 10px; color: #6b7280;">Peak Cats</div>
            </div>
            <div style="background: ${color}15; padding: 8px; border-radius: 6px; text-align: center;">
              <div style="font-size: 12px; font-weight: 600; color: ${color};">${source.severity}</div>
              <div style="font-size: 10px; color: #6b7280;">Severity</div>
            </div>
          </div>
          <div style="font-size: 12px; color: #6b7280; margin-bottom: 8px;">
            <strong>Period:</strong> ${validFrom} — ${validTo}
          </div>
          ${source.ecological_impact ? `
            <div style="font-size: 12px; background: #fef3c7; color: #92400e; padding: 6px 8px; border-radius: 6px; margin-bottom: 8px;">
              ⚠️ Ecological Impact: <strong>${source.ecological_impact}</strong>
            </div>
          ` : ""}
          ${source.description ? `
            <div style="font-size: 12px; color: #374151; background: #f9fafb; padding: 8px; border-radius: 6px; max-height: 80px; overflow-y: auto;">
              ${source.description}
            </div>
          ` : ""}
          <div style="font-size: 10px; color: #9ca3af; margin-top: 8px;">
            📜 Historical ecological context (${source.valid_to ? "resolved" : "ongoing"})
          </div>
        </div>
      `);
      layer.addLayer(marker);
    });

    layer.addTo(mapRef.current);
    layersRef.current.historical_sources = layer;
  }, [historicalSources, enabledLayers.historical_sources]);

  // Update Data Coverage layer (shows zones as colored polygons based on coverage level)
  useEffect(() => {
    if (!mapRef.current) return;
    if (layersRef.current.data_coverage) {
      mapRef.current.removeLayer(layersRef.current.data_coverage);
    }
    if (!enabledLayers.data_coverage || dataCoverage.length === 0) return;

    const layer = L.layerGroup();

    // Create a simple info panel showing coverage by zone
    // Since we don't have zone polygons, we'll display as text overlay
    const coverageColors: Record<string, string> = {
      rich: "#059669",      // Green
      moderate: "#0891b2",  // Cyan
      sparse: "#f59e0b",    // Amber
      gap: "#dc2626",       // Red
    };

    // For now, add a text marker at the map center showing coverage summary
    // In the future, this could use actual zone polygons
    dataCoverage.forEach((zone) => {
      const color = coverageColors[zone.coverage_level] || "#6b7280";
      const totalPoints = zone.google_maps_entries + zone.airtable_requests +
                          zone.clinic_appointments + zone.intake_submissions;

      // We don't have lat/lng for zones, so we'll show as a legend/info panel instead
      // This is handled in the Legend section below
    });

    // Add info control
    const InfoControl = L.Control.extend({
      onAdd: function() {
        const div = L.DomUtil.create("div", "data-coverage-legend");
        div.style.cssText = `
          background: white;
          padding: 12px 16px;
          border-radius: 8px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.15);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-size: 12px;
          max-width: 280px;
        `;

        let html = `<div style="font-weight: 600; font-size: 14px; margin-bottom: 8px;">📊 Data Coverage by Zone</div>`;

        dataCoverage.forEach((zone) => {
          const color = coverageColors[zone.coverage_level] || "#6b7280";
          const totalPoints = zone.google_maps_entries + zone.airtable_requests +
                              zone.clinic_appointments + zone.intake_submissions;
          html += `
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
              <span style="width: 12px; height: 12px; border-radius: 3px; background: ${color};"></span>
              <span style="flex: 1; font-weight: 500;">${zone.zone_name}</span>
              <span style="color: #6b7280;">${totalPoints} pts</span>
              <span style="
                background: ${color}20;
                color: ${color};
                padding: 1px 6px;
                border-radius: 8px;
                font-size: 10px;
                font-weight: 600;
              ">${zone.coverage_level}</span>
            </div>
          `;
        });

        div.innerHTML = html;
        return div;
      }
    });

    const infoControl = new InfoControl({ position: "bottomleft" });

    // Store the control so we can remove it later
    (layer as L.LayerGroup & { _infoControl?: L.Control })._infoControl = infoControl;
    infoControl.addTo(mapRef.current);

    layer.addTo(mapRef.current);
    layersRef.current.data_coverage = layer;

    // Cleanup function to remove the control when layer is disabled
    return () => {
      if (mapRef.current && infoControl) {
        infoControl.remove();
      }
    };
  }, [dataCoverage, enabledLayers.data_coverage]);

  // =========================================================================
  // Atlas Pins layer — uses Leaflet.markercluster for smooth clustering
  // =========================================================================
  useEffect(() => {
    if (!mapRef.current) return;
    if (layersRef.current.atlas_pins) {
      mapRef.current.removeLayer(layersRef.current.atlas_pins);
    }
    if (!enabledLayers.atlas_pins || atlasPins.length === 0) return;

    // Active pins cluster — full-size pins with disease/watch badges
    const layer = leafletCjsRef.current.markerClusterGroup({
      maxClusterRadius: 50,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      disableClusteringAtZoom: 16,
      chunkedLoading: true,
      chunkInterval: 100,
      chunkDelay: 20,
      iconCreateFunction: (cluster: any) => {
        const count = cluster.getChildCount();
        const markers = cluster.getAllChildMarkers();
        const diseaseCount = markers.filter((m: any) => m.options.diseaseRisk).length;
        const watchCount = markers.filter((m: any) => m.options.watchList).length;
        const diseaseRatio = diseaseCount / count;
        const watchRatio = watchCount / count;
        const sizeClass = count < 10 ? "small" : count < 50 ? "medium" : "large";
        const dim = sizeClass === "small" ? 32 : sizeClass === "medium" ? 40 : 50;

        // Majority-wins: cluster only turns colored if >50% of markers match
        let clusterColor = "#3b82f6"; // default blue
        let badge = "";
        if (diseaseRatio > 0.5) {
          clusterColor = "#ea580c";
        } else if (watchRatio > 0.5) {
          clusterColor = "#8b5cf6";
        } else if (diseaseCount > 0) {
          // Minority disease — blue cluster + small orange badge
          badge = `<div style="position:absolute;top:-4px;right:-4px;width:18px;height:18px;background:#ea580c;border-radius:50%;border:2px solid white;color:white;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;">${diseaseCount}</div>`;
        } else if (watchCount > 0) {
          badge = `<div style="position:absolute;top:-4px;right:-4px;width:18px;height:18px;background:#8b5cf6;border-radius:50%;border:2px solid white;color:white;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;">${watchCount}</div>`;
        }

        return L.divIcon({
          html: `<div style="position:relative;"><div class="map-cluster map-cluster--${sizeClass}" style="--cluster-color: ${clusterColor}">${count}</div>${badge}</div>`,
          className: "map-cluster-icon",
          iconSize: L.point(dim, dim),
        });
      },
    });

    // Reference pins cluster — more aggressive clustering, smaller/muted appearance
    const refLayer = leafletCjsRef.current.markerClusterGroup({
      maxClusterRadius: 80, // Larger radius = clusters more aggressively
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      disableClusteringAtZoom: 17, // Only unclusters at higher zoom than active
      chunkedLoading: true,
      chunkInterval: 100,
      chunkDelay: 20,
      iconCreateFunction: (cluster: any) => {
        const count = cluster.getChildCount();
        const sizeClass = count < 10 ? "small" : count < 50 ? "medium" : "large";
        const dim = sizeClass === "small" ? 24 : sizeClass === "medium" ? 30 : 38;
        return L.divIcon({
          html: `<div style="width:${dim}px;height:${dim}px;border-radius:50%;background:rgba(148,163,184,0.65);color:#475569;font-size:${dim < 30 ? 10 : 11}px;font-weight:600;display:flex;align-items:center;justify-content:center;border:2px solid rgba(255,255,255,0.8);box-shadow:0 1px 3px rgba(0,0,0,0.15);">${count}</div>`,
          className: "map-cluster-icon",
          iconSize: L.point(dim, dim),
        });
      },
    });

    atlasPins.forEach((pin) => {
      if (!pin.lat || !pin.lng) return;

      // Reference tier: smaller, muted pins → separate cluster layer
      if (pin.pin_tier === "reference") {
        const refColor = pin.pin_style === "has_history" ? "#6366f1" : "#94a3b8";
        const marker = L.marker([pin.lat, pin.lng], {
          icon: createReferencePinMarker(refColor, { size: 18, pinStyle: pin.pin_style }),
          diseaseRisk: pin.disease_risk,
          watchList: pin.watch_list,
        } as any);
        // Build data summary parts
        const summaryParts: string[] = [];
        if (pin.person_count > 0) summaryParts.push(`${pin.person_count} ${pin.person_count === 1 ? "person" : "people"}`);
        if (pin.cat_count > 0) summaryParts.push(`${pin.cat_count} ${pin.cat_count === 1 ? "cat" : "cats"}`);
        if (pin.google_entry_count > 0) summaryParts.push(`${pin.google_entry_count} Google Maps ${pin.google_entry_count === 1 ? "note" : "notes"}`);
        if (pin.request_count > 0) summaryParts.push(`${pin.request_count} ${pin.request_count === 1 ? "request" : "requests"}`);
        const dataSummary = summaryParts.length > 0 ? summaryParts.join(" · ") : "Reference location";

        // First GM note snippet
        const gmRawSummary = pin.google_summaries && pin.google_summaries.length > 0 && pin.google_summaries[0]?.summary
          ? String(pin.google_summaries[0].summary).replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "")
          : "";
        const gmSnippet = gmRawSummary
          ? `<div style="color:#6b7280;font-size:11px;margin-top:4px;line-height:1.3;max-height:40px;overflow:hidden;">"${gmRawSummary.substring(0, 120)}${gmRawSummary.length > 120 ? "…" : ""}"</div>`
          : "";

        // People names
        const peopleNames = pin.people && pin.people.length > 0
          ? `<div style="color:#374151;font-size:11px;margin-top:4px;">${pin.people.slice(0, 3).map((p: any) => p.name).join(", ")}${pin.people.length > 3 ? ` +${pin.people.length - 3}` : ""}</div>`
          : "";

        const refPopup = `<div style="min-width:220px;font-family:system-ui;font-size:12px;">
          <div style="font-weight:600;font-size:13px;margin-bottom:4px;">${pin.display_name || pin.address}</div>
          ${pin.display_name && pin.address ? `<div style="color:#6b7280;font-size:11px;margin-bottom:6px;">${pin.address}</div>` : ""}
          <div style="color:#64748b;font-size:11px;margin-bottom:4px;">${dataSummary}</div>
          ${peopleNames}
          ${gmSnippet}
          <div style="margin-top:8px;display:flex;gap:8px;">
            <button onclick="window.atlasMapExpandPlace('${pin.id}')" style="background:#3b82f6;color:white;border:none;padding:4px 10px;border-radius:4px;font-size:11px;cursor:pointer;">Details</button>
            <button onclick="window.open('https://www.google.com/maps/@${pin.lat},${pin.lng},3a,75y,90t/data=!3m6!1e1!3m4!1s!2e0!7i16384!8i8192','_blank')" style="background:#f1f5f9;color:#475569;border:none;padding:4px 10px;border-radius:4px;font-size:11px;cursor:pointer;">Street View</button>
          </div>
        </div>`;
        marker.bindPopup(refPopup, { maxWidth: 320 });
        // Click-switching: if drawer is open, switch directly instead of showing popup
        marker.on('click', (e: L.LeafletMouseEvent) => {
          if (selectedPlaceIdRef.current) {
            setSelectedPlaceId(pin.id);
            mapRef.current?.closePopup();
            mapRef.current?.panTo([pin.lat, pin.lng], { animate: true });
            L.DomEvent.stopPropagation(e);
          }
        });
        refLayer.addLayer(marker);
        return;
      }

      // Active tier: full-size teardrop pins
      // Determine pin color based on style - Google Maps-like color palette
      let color: string;
      let size: number;

      switch (pin.pin_style) {
        case "disease":
          color = "#ea580c";
          size = 32;
          break;
        case "watch_list":
          color = "#8b5cf6";
          size = 30;
          break;
        case "active":
          color = "#22c55e";
          size = 28;
          break;
        case "active_requests":
          color = "#14b8a6";
          size = 26;
          break;
        case "has_history":
          color = "#6366f1";
          size = 26;
          break;
        default:
          color = "#3b82f6";
          size = 24;
      }

      // Check if any people at this pin have volunteer/staff roles
      const hasVolunteerOrStaff = Array.isArray(pin.people) && pin.people.some(
        (p: { roles: string[]; is_staff: boolean }) =>
          p.is_staff || (p.roles && p.roles.some((r: string) => ['trapper', 'foster', 'staff', 'caretaker'].includes(r)))
      );

      // Build disease badge data for sub-icons
      const diseaseBadges = Array.isArray(pin.disease_badges)
        ? pin.disease_badges
            .filter((b: { status: string }) => b.status !== 'historical')
            .map((b: { short_code: string; color: string }) => ({ short_code: b.short_code, color: b.color }))
        : [];

      const marker = L.marker([pin.lat, pin.lng], {
        icon: createAtlasPinMarker(color, {
          size,
          pinStyle: pin.pin_style,
          isClustered: false,
          unitCount: 1,
          catCount: pin.cat_count,
          hasVolunteer: hasVolunteerOrStaff,
          needsTrapper: pin.needs_trapper_count > 0,
          diseaseBadges,
        }),
        diseaseRisk: pin.disease_risk,
        watchList: pin.watch_list,
      } as any);

      // Build consolidated popup
      // Filter out names that look like addresses (contain ", CA" or match the place address)
      const isLikelyAddress = (name: string): boolean => {
        if (!name) return true;
        const lowerName = name.toLowerCase();
        if (lowerName.includes(", ca ") || lowerName.includes(", ca,") || lowerName.endsWith(", ca")) return true;
        if (/\d{5}/.test(name)) return true;
        if (/^\d+\s+\w+\s+(st|rd|ave|blvd|dr|ln|ct|way|pl)\b/i.test(name)) return true;
        if (pin.address && lowerName === pin.address.toLowerCase()) return true;
        return false;
      };

      // Role badge colors
      const roleBadgeStyle = (role: string): string => {
        const styles: Record<string, string> = {
          staff: "background:#eef2ff;color:#4338ca;",
          trapper: "background:#ecfdf5;color:#065f46;",
          foster: "background:#fdf2f8;color:#9d174d;",
          caretaker: "background:#ecfeff;color:#0e7490;",
          volunteer: "background:#f5f3ff;color:#6d28d9;",
        };
        return styles[role] || "background:#f3f4f6;color:#374151;";
      };
      const roleLabel = (role: string): string => {
        const labels: Record<string, string> = {
          staff: "Staff", trapper: "Trapper", foster: "Foster",
          caretaker: "Caretaker", volunteer: "Volunteer",
        };
        return labels[role] || role;
      };

      // People are now objects: {name, roles[], is_staff}
      const filteredPeople = Array.isArray(pin.people)
        ? pin.people.filter((p: { name: string }) => p.name && !isLikelyAddress(p.name))
        : [];
      const peopleList = filteredPeople.length > 0
        ? filteredPeople.slice(0, 3).map((p: { name: string; roles: string[]; is_staff: boolean }) => {
            const badges = (p.roles || [])
              .filter((r: string) => r !== "volunteer") // Don't show generic volunteer badge if they have a specific role
              .map((r: string) => `<span style="display:inline-block;padding:1px 5px;border-radius:9999px;font-size:9px;font-weight:600;margin-left:4px;${roleBadgeStyle(r)}">${roleLabel(r)}</span>`)
              .join("");
            const staffBadge = p.is_staff && !(p.roles || []).includes("staff")
              ? `<span style="display:inline-block;padding:1px 5px;border-radius:9999px;font-size:9px;font-weight:600;margin-left:4px;background:#eef2ff;color:#4338ca;">Staff</span>`
              : "";
            // If they only have volunteer role, show it
            const volOnly = (p.roles || []).length === 1 && (p.roles || [])[0] === "volunteer"
              ? `<span style="display:inline-block;padding:1px 5px;border-radius:9999px;font-size:9px;font-weight:600;margin-left:4px;${roleBadgeStyle("volunteer")}">Volunteer</span>`
              : "";
            return `<div style="font-size: 12px; line-height: 1.6;">&#8226; ${escapeHtml(p.name)}${badges}${staffBadge}${volOnly}</div>`;
          }).join("")
        : "";

      // Helper to check for AI refusal messages in summaries
      const isRefusalSummary = (text: string | null | undefined): boolean => {
        if (!text) return true; // Skip null/empty
        const lowerText = text.toLowerCase();
        return lowerText.includes("i can't paraphrase") ||
               lowerText.includes("i cannot paraphrase") ||
               lowerText.includes("i appreciate the question") ||
               lowerText.includes("i need to clarify my role") ||
               lowerText.includes("violate my instructions") ||
               lowerText.includes("here's the original") ||
               lowerText.includes("here's the cleaned version") ||
               lowerText.includes("no changes needed");
      };

      const validSummaries = Array.isArray(pin.google_summaries)
        ? pin.google_summaries.filter((s: { summary: string; meaning: string | null; date: string | null }) =>
            s.summary && !isRefusalSummary(s.summary))
        : [];

      const historySummaries = validSummaries.length > 0
        ? validSummaries.slice(0, 2).map((s: { summary: string; meaning: string | null; date: string | null }) =>
            `<div style="font-size: 11px; color: #6b7280; margin-top: 4px; padding: 4px; background: #f9fafb; border-radius: 4px;">
              ${s.summary?.substring(0, 120) || ""}${s.summary && s.summary.length > 120 ? "..." : ""}
              ${s.date ? `<span style="color: #9ca3af;"> (${s.date})</span>` : ""}
            </div>`
          ).join("")
        : "";

      // Unit identifier for individual apartment units
      const unitLabel = pin.unit_identifier
        ? `<div style="font-size: 12px; color: #6b7280; margin-top: 2px;">Unit: ${pin.unit_identifier}</div>`
        : "";

      marker.bindPopup(`
        <div style="min-width: 280px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
          <div style="font-weight: 600; font-size: 14px; margin-bottom: 4px;">${pin.address}</div>
          ${unitLabel}

          ${pin.disease_risk ? `
            <div style="background: #fef2f2; border: 1px solid #fecaca; padding: 8px; margin: 8px 0; border-radius: 6px;">
              <div style="color: #dc2626; font-weight: 600; font-size: 13px;">⚠️ Disease Risk</div>
              ${pin.disease_risk_notes ? `<div style="font-size: 12px; color: #7f1d1d; margin-top: 4px;">${pin.disease_risk_notes}</div>` : ""}
            </div>
          ` : ""}

          ${pin.watch_list && !pin.disease_risk ? `
            <div style="background: #f5f3ff; border: 1px solid #c4b5fd; padding: 8px; margin: 8px 0; border-radius: 6px;">
              <div style="color: #7c3aed; font-weight: 600; font-size: 13px;">👁️ Watch List</div>
            </div>
          ` : ""}

          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 12px 0;">
            <div style="background: #f3f4f6; padding: 8px; border-radius: 6px; text-align: center;">
              <div style="font-size: 18px; font-weight: 700; color: #374151;">${pin.cat_count}</div>
              <div style="font-size: 10px; color: #6b7280;">Cats</div>
            </div>
            <div style="background: #f3f4f6; padding: 8px; border-radius: 6px; text-align: center;">
              <div style="font-size: 18px; font-weight: 700; color: #374151;">${filteredPeople.length}</div>
              <div style="font-size: 10px; color: #6b7280;">People</div>
            </div>
            <div style="background: #f3f4f6; padding: 8px; border-radius: 6px; text-align: center;">
              <div style="font-size: 18px; font-weight: 700; color: ${pin.active_request_count > 0 ? "#dc2626" : "#374151"};">${pin.request_count}</div>
              <div style="font-size: 10px; color: #6b7280;">Requests</div>
            </div>
          </div>

          ${filteredPeople.length > 0 ? `
            <div style="margin-top: 8px;">
              <div style="font-size: 12px; font-weight: 600; color: #374151; margin-bottom: 4px;">People:</div>
              ${peopleList}
              ${filteredPeople.length > 3 ? `<div style="font-size: 11px; color: #9ca3af;">+${filteredPeople.length - 3} more</div>` : ""}
            </div>
          ` : ""}

          ${validSummaries.length > 0 ? `
            <div style="margin-top: 12px; padding-top: 8px; border-top: 1px solid #e5e7eb;">
              <div style="font-size: 12px; font-weight: 600; color: #374151; margin-bottom: 4px;">
                📜 Historical Notes (${pin.google_entry_count})
              </div>
              ${historySummaries}
            </div>
          ` : ""}

          ${pin.total_altered > 0 ? `
            <div style="margin-top: 8px; font-size: 12px; color: #059669;">
              ✓ ${pin.total_altered} cats altered at this location
            </div>
          ` : ""}

          ${pin.needs_trapper_count > 0 ? `
            <div style="background: #fff7ed; border: 1px solid #fed7aa; padding: 6px 8px; margin-top: 8px; border-radius: 6px; font-size: 12px; color: #c2410c; font-weight: 500;">
              ${pin.needs_trapper_count} ${pin.needs_trapper_count === 1 ? 'request needs' : 'requests need'} trapper
            </div>
          ` : ""}

          <div style="display: flex; gap: 6px; margin-top: 12px;">
            <button onclick="window.atlasMapExpandPlace('${pin.id}')"
                    style="flex: 1; padding: 8px; background: #f3f4f6; color: #374151; border: 1px solid #d1d5db; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 500;">
              Details
            </button>
            <button onclick="window.atlasMapOpenStreetView(${pin.lat}, ${pin.lng}, '${escapeHtml(pin.address).replace(/'/g, "\\'")}')"
                    style="flex: 1; padding: 8px; background: #fef3c7; color: #92400e; border: 1px solid #fcd34d; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 500;">
              Street View
            </button>
            <a href="/places/${pin.id}" target="_blank"
               style="flex: 1; padding: 8px; background: #3b82f6; color: white; text-decoration: none; border-radius: 6px; text-align: center; font-size: 12px; font-weight: 500;">
              Open Page
            </a>
          </div>
        </div>
      `);

      // Click-switching: if drawer is open, switch directly instead of showing popup
      marker.on('click', (e: L.LeafletMouseEvent) => {
        if (selectedPlaceIdRef.current) {
          setSelectedPlaceId(pin.id);
          mapRef.current?.closePopup();
          mapRef.current?.panTo([pin.lat, pin.lng], { animate: true });
          L.DomEvent.stopPropagation(e);
        }
      });

      layer.addLayer(marker);
    });

    // Add both cluster layers to map as a single layer group
    const combined = L.layerGroup([layer, refLayer]);
    combined.addTo(mapRef.current);
    layersRef.current.atlas_pins = combined;
  }, [atlasPins, enabledLayers.atlas_pins]);

  // Search functionality - uses fuzzy search API for better matching
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setAtlasSearchResults([]);
      setGoogleSuggestions([]);
      return;
    }

    // Also do quick local search for instant results on loaded data
    const query = searchQuery.toLowerCase();
    const localResults: typeof searchResults = [];

    places.filter(p => p.address.toLowerCase().includes(query)).slice(0, 2).forEach(p => {
      localResults.push({ type: "place", item: p, label: p.address });
    });

    googlePins.filter(p => p.name?.toLowerCase().includes(query)).slice(0, 2).forEach(p => {
      localResults.push({ type: "google_pin", item: p, label: p.name || "Unnamed pin" });
    });

    volunteers.filter(v => v.name.toLowerCase().includes(query)).slice(0, 2).forEach(v => {
      localResults.push({ type: "volunteer", item: v, label: `${v.name} (${v.role_label})` });
    });

    setSearchResults(localResults);
  }, [searchQuery, places, googlePins, volunteers]);

  // Fuzzy search via Atlas search API (debounced)
  useEffect(() => {
    if (searchQuery.length < 3) {
      setAtlasSearchResults([]);
      return;
    }

    setSearchLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}&limit=8&suggestions=true`);
        if (res.ok) {
          const data = await res.json();
          // Show all results — those with coordinates navigate on map,
          // those without link to the entity detail page
          setAtlasSearchResults(data.suggestions || []);
        }
      } catch (err) {
        console.error("Atlas search error:", err);
      } finally {
        setSearchLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Google Places autocomplete as fallback (when few Atlas results)
  useEffect(() => {
    if (searchQuery.length < 3) {
      setGoogleSuggestions([]);
      return;
    }

    // Only fetch Google suggestions if we have few Atlas results
    const timer = setTimeout(async () => {
      if (atlasSearchResults.length < 3) {
        try {
          const res = await fetch(`/api/places/autocomplete?input=${encodeURIComponent(searchQuery)}`);
          if (res.ok) {
            const data = await res.json();
            setGoogleSuggestions(data.predictions || []);
          }
        } catch (err) {
          console.error("Google Places error:", err);
        }
      } else {
        setGoogleSuggestions([]);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [searchQuery, atlasSearchResults.length]);

  const handleSearchSelect = (result: typeof searchResults[0]) => {
    const item = result.item as Place | GooglePin | Volunteer;
    if (mapRef.current && item.lat && item.lng) {
      mapRef.current.setView([item.lat, item.lng], 16, { animate: true, duration: 0.5 });
      // Clear any navigated location marker
      setNavigatedLocation(null);
    }
    setSearchQuery("");
    setShowSearchResults(false);
  };

  // Handle Atlas fuzzy search result selection — always try to pan on map
  // For person/cat results, opens Place drawer first then overlays entity drawer (Place→Entity pattern)
  const handleAtlasSearchSelect = async (result: AtlasSearchResult) => {
    setSearchQuery("");
    setShowSearchResults(false);

    // 1. Check API-enriched metadata first
    let lat = result.metadata?.lat;
    let lng = result.metadata?.lng;
    let linkedPlaceId: string | null = null;

    // 2. For places, also check the already-loaded atlas pins
    if ((!lat || !lng) && result.entity_type === "place") {
      const pin = atlasPinsRef.current.find((p) => p.id === result.entity_id);
      if (pin?.lat && pin?.lng) {
        lat = pin.lat;
        lng = pin.lng;
      }
    }

    // 3. For person/cat: always fetch to resolve linked place. For places: fetch only if no coords.
    if (result.entity_type !== "place" || (!lat && !lng)) {
      try {
        const apiPath = result.entity_type === "cat" ? "cats"
          : result.entity_type === "person" ? "people"
          : "places";
        const res = await fetch(`/api/${apiPath}/${result.entity_id}`);
        if (res.ok) {
          const data = await res.json();
          if (data.coordinates?.lat && (!lat || !lng)) {
            lat = data.coordinates.lat;
            lng = data.coordinates.lng;
          }

          // Resolve linked place for person/cat (Place→Entity stacking)
          if (result.entity_type !== "place") {
            const plId = data.associated_places?.[0]?.place_id
              || data.places?.[0]?.place_id
              || null;
            if (plId) {
              linkedPlaceId = plId;
              if (!lat || !lng) {
                const pin = atlasPinsRef.current.find((p) => p.id === plId);
                if (pin?.lat && pin?.lng) {
                  lat = pin.lat;
                  lng = pin.lng;
                }
              }
            }
          }
        }
      } catch {
        // Fall through
      }
    }

    // Close any existing drawers first
    setSelectedPlaceId(null);
    setSelectedPersonId(null);
    setSelectedCatId(null);

    if (mapRef.current && lat && lng) {
      setNavigatedLocation({ lat, lng, address: result.display_name });
      mapRef.current.setView([lat, lng], 16, { animate: true, duration: 0.5 });
    }

    // Open drawers — for person/cat, stack entity drawer on top of place drawer
    if (result.entity_type === "place") {
      setSelectedPlaceId(result.entity_id);
    } else if (result.entity_type === "person") {
      if (linkedPlaceId) setSelectedPlaceId(linkedPlaceId);
      setSelectedPersonId(result.entity_id);
    } else if (result.entity_type === "cat") {
      if (linkedPlaceId) setSelectedPlaceId(linkedPlaceId);
      setSelectedCatId(result.entity_id);
    }
  };

  // Handle Google Places selection - navigate to arbitrary address
  const handleGooglePlaceSelect = async (prediction: PlacePrediction) => {
    try {
      const res = await fetch(`/api/places/details?place_id=${prediction.place_id}`);
      if (res.ok) {
        const data = await res.json();
        const place = data.place;
        if (place?.geometry?.location) {
          const { lat, lng } = place.geometry.location;
          setNavigatedLocation({
            lat,
            lng,
            address: place.formatted_address || prediction.description
          });
          if (mapRef.current) {
            mapRef.current.setView([lat, lng], 16, { animate: true, duration: 0.5 });
          }
        }
      }
    } catch (err) {
      console.error("Failed to get place details:", err);
    }
    setSearchQuery("");
    setShowSearchResults(false);
  };

  // Navigated location marker effect
  useEffect(() => {
    if (!mapRef.current) return;

    // Remove existing marker
    if (navigatedMarkerRef.current) {
      navigatedMarkerRef.current.remove();
      navigatedMarkerRef.current = null;
    }

    if (!navigatedLocation) return;

    // Create marker for navigated location
    const marker = L.marker([navigatedLocation.lat, navigatedLocation.lng], {
      icon: L.divIcon({
        className: "navigated-location-marker",
        html: `<div style="
          width: 32px;
          height: 32px;
          background: linear-gradient(135deg, #3b82f6, #1d4ed8);
          border: 3px solid white;
          border-radius: 50% 50% 50% 0;
          transform: rotate(-45deg);
          box-shadow: 0 3px 8px rgba(0,0,0,0.4);
          display: flex;
          align-items: center;
          justify-content: center;
        ">
          <span style="transform: rotate(45deg); font-size: 14px;">📍</span>
        </div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 32],
        popupAnchor: [0, -32]
      }),
      zIndexOffset: 2000
    }).addTo(mapRef.current);

    // Check if address exists in Atlas — search atlasPins (primary layer) with wider tolerance
    // 0.001 degrees ~ 111m — enough to account for geocoding drift between Google and Atlas
    // Uses ref to avoid re-running this effect when atlasPins array changes from filter toggles
    // Finds the CLOSEST pin within tolerance, not just the first, to avoid wrong matches in dense areas
    const COORD_TOLERANCE = 0.001;
    let matchingPin: AtlasPin | undefined;
    let bestDist = Infinity;
    for (const p of atlasPinsRef.current) {
      if (!p.lat || !p.lng) continue;
      const dLat = Math.abs(p.lat - navigatedLocation.lat);
      const dLng = Math.abs(p.lng - navigatedLocation.lng);
      if (dLat < COORD_TOLERANCE && dLng < COORD_TOLERANCE) {
        const dist = dLat * dLat + dLng * dLng;
        if (dist < bestDist) {
          bestDist = dist;
          matchingPin = p;
        }
      }
    }
    const existsInAtlas = !!matchingPin;

    // Find nearby people within ~200m
    const NEARBY_RADIUS = 0.002; // ~200m in degrees
    const nearbyPeople: { name: string; address: string; dist: number }[] = [];
    const seenNames = new Set<string>();
    for (const p of atlasPinsRef.current) {
      if (!p.lat || !p.lng || p.id === matchingPin?.id) continue;
      const dLat = Math.abs(p.lat - navigatedLocation.lat);
      const dLng = Math.abs(p.lng - navigatedLocation.lng);
      if (dLat < NEARBY_RADIUS && dLng < NEARBY_RADIUS) {
        const dist = Math.round(Math.sqrt(dLat ** 2 + dLng ** 2) * 111000);
        for (const person of (p.people || [])) {
          const pName = typeof person === 'string' ? person : person.name;
          if (pName && !seenNames.has(pName)) {
            seenNames.add(pName);
            nearbyPeople.push({ name: pName, address: p.address, dist });
          }
        }
      }
    }
    nearbyPeople.sort((a, b) => a.dist - b.dist);
    const displayNearby = nearbyPeople.slice(0, 8);
    const nearbyExtra = nearbyPeople.length - displayNearby.length;

    const nearbyHtml = displayNearby.length > 0 ? `
      <div style="margin-top:12px;padding-top:10px;border-top:1px solid #e5e7eb;">
        <div style="font-size:12px;font-weight:600;margin-bottom:6px;color:#374151;">Nearby People</div>
        ${displayNearby.map(n => `
          <div style="font-size:12px;color:#6b7280;padding:2px 0;">
            <span style="font-weight:500;color:#374151;">${n.name}</span>
            <span style="color:#9ca3af;"> — ${n.dist}m</span>
          </div>
        `).join("")}
        ${nearbyExtra > 0 ? `<div style="font-size:11px;color:#9ca3af;margin-top:4px;">+${nearbyExtra} more</div>` : ""}
      </div>
    ` : "";

    marker.bindPopup(`
      <div style="min-width: 240px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
        <div style="font-weight: 600; font-size: 14px; margin-bottom: 8px;">${navigatedLocation.address}</div>
        ${existsInAtlas
          ? `<div style="color: #059669; font-size: 12px; margin-bottom: 8px;">This location has Atlas data</div>
            <div style="display: flex; gap: 8px; margin-top: 12px;">
              <button onclick="window.atlasMapExpandPlace('${matchingPin!.id}')"
                      style="
                        display: inline-flex;
                        align-items: center;
                        gap: 4px;
                        padding: 6px 12px;
                        background: #059669;
                        color: white;
                        border: none;
                        border-radius: 6px;
                        font-size: 12px;
                        font-weight: 500;
                        cursor: pointer;
                      ">
                View Details
              </button>
              <a href="/places/${matchingPin!.id}" target="_blank"
                 style="
                   display: inline-flex;
                   align-items: center;
                   gap: 4px;
                   padding: 6px 12px;
                   background: #f3f4f6;
                   color: #374151;
                   text-decoration: none;
                   border: 1px solid #d1d5db;
                   border-radius: 6px;
                   font-size: 12px;
                   font-weight: 500;
                 ">
                Open Page
              </a>
              <button onclick="window.atlasMapOpenStreetView(${navigatedLocation.lat}, ${navigatedLocation.lng}, '${navigatedLocation.address.replace(/'/g, "\\'")}')"
                      style="
                        padding: 6px 12px;
                        background: #fef3c7;
                        color: #92400e;
                        border: 1px solid #fcd34d;
                        border-radius: 6px;
                        font-size: 12px;
                        font-weight: 500;
                        cursor: pointer;
                      ">
                Street View
              </button>
              <button onclick="window.dispatchEvent(new CustomEvent('clear-navigated-location'))"
                      style="
                        padding: 6px 12px;
                        background: #f3f4f6;
                        border: 1px solid #d1d5db;
                        border-radius: 6px;
                        font-size: 12px;
                        cursor: pointer;
                      ">
                Clear
              </button>
            </div>
            ${nearbyHtml}`
          : `<div style="color: #6b7280; font-size: 12px; margin-bottom: 8px;">No Atlas data at this location yet</div>
            <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px;">
              <a href="/intake/new?address=${encodeURIComponent(navigatedLocation.address)}"
                 style="
                   display: inline-flex;
                   align-items: center;
                   gap: 4px;
                   padding: 6px 12px;
                   background: #3b82f6;
                   color: white;
                   text-decoration: none;
                   border-radius: 6px;
                   font-size: 12px;
                   font-weight: 500;
                 ">
                + Create Request
              </a>
              <button onclick="window.atlasMapOpenStreetView(${navigatedLocation.lat}, ${navigatedLocation.lng}, '${navigatedLocation.address.replace(/'/g, "\\'")}')"
                      style="
                        padding: 6px 12px;
                        background: #fef3c7;
                        color: #92400e;
                        border: 1px solid #fcd34d;
                        border-radius: 6px;
                        font-size: 12px;
                        font-weight: 500;
                        cursor: pointer;
                      ">
                Street View
              </button>
              <button onclick="window.dispatchEvent(new CustomEvent('clear-navigated-location'))"
                      style="
                        padding: 6px 12px;
                        background: #f3f4f6;
                        border: 1px solid #d1d5db;
                        border-radius: 6px;
                        font-size: 12px;
                        cursor: pointer;
                      ">
                Clear
              </button>
            </div>
            ${nearbyHtml}`
        }
      </div>
    `).openPopup();

    navigatedMarkerRef.current = marker;

    // Listen for clear event
    const handleClear = () => setNavigatedLocation(null);
    window.addEventListener('clear-navigated-location', handleClear);

    return () => {
      window.removeEventListener('clear-navigated-location', handleClear);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigatedLocation]);

  const toggleLayer = (layerId: string) => {
    setEnabledLayers(prev => ({ ...prev, [layerId]: !prev[layerId] }));
  };

  // My Location functionality
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [locatingUser, setLocatingUser] = useState(false);
  const userMarkerRef = useRef<L.Marker | null>(null);

  const handleMyLocation = () => {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser");
      return;
    }
    setLocatingUser(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setUserLocation([latitude, longitude]);
        setLocatingUser(false);
        if (mapRef.current) {
          mapRef.current.setView([latitude, longitude], 15, { animate: true, duration: 0.8 });

          // Add/update user location marker
          if (userMarkerRef.current) {
            userMarkerRef.current.setLatLng([latitude, longitude]);
          } else {
            userMarkerRef.current = L.marker([latitude, longitude], {
              icon: createUserLocationMarker(),
              zIndexOffset: 9999
            })
              .addTo(mapRef.current)
              .bindPopup("You are here");
          }
        }
      },
      (error) => {
        setLocatingUser(false);
        alert(`Unable to get location: ${error.message}`);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // Keyboard shortcuts
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        if (e.key === "Escape") {
          (e.target as HTMLElement).blur();
          setShowSearchResults(false);
        }
        return;
      }

      switch (e.key) {
        case "/":
          e.preventDefault();
          searchInputRef.current?.focus();
          break;
        case "Escape":
          setShowSearchResults(false);
          setShowLayerPanel(false);
          if (addPointMode) {
            setAddPointMode(null);
            setPendingClick(null);
            setShowAddPointMenu(false);
          }
          break;
        case "+":
        case "=":
          mapRef.current?.zoomIn();
          break;
        case "-":
          mapRef.current?.zoomOut();
          break;
        case "l":
        case "L":
          setShowLayerPanel(prev => !prev);
          break;
        case "m":
        case "M":
          handleMyLocation();
          break;
        case "1":
          toggleLayer("atlas_pins");
          break;
        case "k":
        case "K":
          setShowLegend(prev => !prev);
          break;
        case "a":
        case "A":
          if (!addPointMode) {
            setShowAddPointMenu(prev => !prev);
          } else {
            setAddPointMode(null);
            setPendingClick(null);
            setShowAddPointMenu(false);
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [addPointMode]);

  // Add Point mode: map click handler and cursor
  useEffect(() => {
    if (!mapRef.current || !addPointMode) return;
    const map = mapRef.current;
    const container = map.getContainer();
    container.style.cursor = 'crosshair';

    const handleMapClick = (e: L.LeafletMouseEvent) => {
      setPendingClick({ lat: e.latlng.lat, lng: e.latlng.lng });
    };

    map.on('click', handleMapClick);
    return () => {
      map.off('click', handleMapClick);
      container.style.cursor = '';
    };
  }, [addPointMode]);

  // Annotations: fetch and render
  const fetchAnnotations = useCallback(async () => {
    try {
      const res = await fetch('/api/annotations');
      const data = await res.json();
      setAnnotations(data.annotations || []);
    } catch (e) {
      console.error('Failed to fetch annotations:', e);
    }
  }, []);

  useEffect(() => {
    fetchAnnotations();
  }, [fetchAnnotations]);

  // Render annotation markers
  useEffect(() => {
    if (!mapRef.current) return;
    if (annotationLayerRef.current) {
      annotationLayerRef.current.clearLayers();
    } else {
      annotationLayerRef.current = L.layerGroup().addTo(mapRef.current);
    }
    for (const ann of annotations) {
      const icon = createAnnotationMarker(ann.annotation_type, ann.label);
      const marker = L.marker([ann.lat, ann.lng], { icon });
      const expiryText = ann.expires_at ? `<div style="font-size:10px;color:#9ca3af;margin-top:4px;">Expires: ${new Date(ann.expires_at).toLocaleDateString()}</div>` : '';
      const photoHtml = ann.photo_url ? `<img src="${ann.photo_url}" style="width:100%;max-height:120px;object-fit:cover;border-radius:4px;margin-top:6px;" />` : '';
      const typeLabel = ann.annotation_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      marker.bindPopup(`
        <div style="min-width:200px;max-width:280px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
          <div style="font-weight:600;font-size:14px;margin-bottom:4px;">${escapeHtml(ann.label)}</div>
          <div style="display:inline-block;padding:2px 6px;border-radius:3px;background:#f3f4f6;font-size:10px;color:#6b7280;margin-bottom:6px;">${typeLabel}</div>
          ${ann.note ? `<div style="font-size:12px;color:#374151;margin-top:4px;">${escapeHtml(ann.note)}</div>` : ''}
          ${photoHtml}
          ${expiryText}
          <div style="margin-top:8px;display:flex;gap:6px;">
            <button onclick="window.__openAnnotationDrawer__&&window.__openAnnotationDrawer__('${ann.annotation_id}')" style="background:#eff6ff;color:#3b82f6;border:none;border-radius:4px;padding:4px 8px;font-size:11px;cursor:pointer;">Details</button>
            <button onclick="fetch('/api/annotations/${ann.annotation_id}',{method:'DELETE'}).then(()=>window.location.reload())" style="background:#fef2f2;color:#dc2626;border:none;border-radius:4px;padding:4px 8px;font-size:11px;cursor:pointer;">Delete</button>
          </div>
        </div>
      `, { maxWidth: 300 });
      marker.addTo(annotationLayerRef.current!);
    }
  }, [annotations]);

  // Register annotation drawer callback for popup buttons
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__openAnnotationDrawer__ = (id: string) => {
      setSelectedAnnotationId(id);
    };
    return () => {
      delete (window as unknown as Record<string, unknown>).__openAnnotationDrawer__;
    };
  }, []);

  // Calculate total counts for display
  const totalMarkers = (enabledLayers.atlas_pins ? atlasPins.length : 0) +
    (enabledLayers.places ? places.length : 0) +
    (enabledLayers.google_pins ? googlePins.length : 0) +
    (enabledLayers.tnr_priority ? tnrPriority.length : 0) +
    (enabledLayers.volunteers ? volunteers.length : 0) +
    (enabledLayers.clinic_clients ? clinicClients.length : 0) +
    (enabledLayers.historical_sources ? historicalSources.length : 0);

  // Invalidate map size when street view panel opens/closes
  useEffect(() => {
    if (!mapRef.current) return;
    // Reset heading/pitch when opening Street View on a new location
    if (streetViewCoords) {
      setStreetViewHeading(0);
      setStreetViewPitch(0);
    }
    // Delay to allow CSS transition to complete
    const timer = setTimeout(() => {
      mapRef.current?.invalidateSize();
    }, 350);
    return () => clearTimeout(timer);
  }, [streetViewCoords]);

  // Street View cone marker on the Leaflet map
  useEffect(() => {
    if (!mapRef.current) return;

    // Remove existing marker
    if (streetViewMarkerRef.current) {
      mapRef.current.removeLayer(streetViewMarkerRef.current);
      streetViewMarkerRef.current = null;
    }

    if (!streetViewCoords) {
      streetViewConePosRef.current = null;
      return;
    }

    // Use walked-to position if available, otherwise the original open position
    const conePos = streetViewConePosRef.current || streetViewCoords;

    // Create SVG view cone icon — rotated by heading
    const coneSvg = `
      <svg width="80" height="80" viewBox="0 0 80 80" style="transform: rotate(${streetViewHeading}deg); transition: transform 0.3s ease;">
        <defs>
          <linearGradient id="coneGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" style="stop-color:rgba(66,133,244,0.35)"/>
            <stop offset="100%" style="stop-color:rgba(66,133,244,0.05)"/>
          </linearGradient>
        </defs>
        <path d="M40,40 L15,5 A35,35 0 0,1 65,5 Z" fill="url(#coneGrad)" stroke="rgba(66,133,244,0.5)" stroke-width="1"/>
        <circle cx="40" cy="40" r="7" fill="#4285f4" stroke="white" stroke-width="2.5"/>
      </svg>
    `;

    const coneIcon = L.divIcon({
      html: coneSvg,
      className: "street-view-cone-marker",
      iconSize: [80, 80],
      iconAnchor: [40, 40],
    });

    const marker = L.marker([conePos.lat, conePos.lng], {
      icon: coneIcon,
      interactive: false,
      zIndexOffset: 9999,
    }).addTo(mapRef.current);

    streetViewMarkerRef.current = marker;

    // Only pan the map on initial open, not on heading changes
    if (!streetViewConePosRef.current) {
      streetViewConePosRef.current = { lat: streetViewCoords.lat, lng: streetViewCoords.lng };
      mapRef.current.panTo([conePos.lat, conePos.lng], { animate: true });
    }

    return () => {
      if (mapRef.current && streetViewMarkerRef.current) {
        mapRef.current.removeLayer(streetViewMarkerRef.current);
        streetViewMarkerRef.current = null;
      }
    };
  }, [streetViewCoords, streetViewHeading]);

  // Build Street View URL — interactive JS API with postMessage (keeps API key server-side)
  const streetViewUrl = streetViewCoords
    ? `/api/streetview/interactive?lat=${streetViewCoords.lat}&lng=${streetViewCoords.lng}`
    : null;

  return (
    <div style={{ position: "relative", height: "100dvh", width: "100%", display: "flex", flexDirection: "column" }}>
      {/* Map container */}
      <div
        ref={mapContainerRef}
        style={{
          flex: (streetViewCoords && !streetViewConeOnly) ? (streetViewFullscreen ? "0 0 0%" : "0 0 55%") : "1 1 100%",
          width: "100%",
          transition: "flex 0.3s ease",
        }}
      />

      {/* Search bar - Google style (minimized during Street View) */}
      {streetViewCoords ? (
        <div style={{
          position: "absolute",
          top: 12,
          left: 16,
          zIndex: 1000,
        }}>
          <button
            onClick={() => { setStreetViewCoords(null); setStreetViewFullscreen(false); searchInputRef.current?.focus(); }}
            style={{
              background: "white",
              borderRadius: 20,
              padding: "8px 14px",
              boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
              border: "none",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 500,
              fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
              display: "flex",
              alignItems: "center",
              gap: 6,
              color: "#374151",
            }}
          >
            <span style={{ fontSize: 14 }}>&#x1F50D;</span> Search
          </button>
        </div>
      ) : (
      <div style={{
        position: "absolute",
        top: 16,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1000,
        width: "100%",
        maxWidth: 600,
        padding: "0 16px",
      }}>
        <div style={{
          background: "white",
          borderRadius: 24,
          boxShadow: "0 2px 6px rgba(0,0,0,0.15), 0 1px 2px rgba(0,0,0,0.1)",
          display: "flex",
          alignItems: "center",
          padding: "8px 16px",
        }}>
          <a
            href="/"
            title="Back to Atlas dashboard"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginRight: 8,
              textDecoration: "none",
              color: "#374151",
              fontWeight: 700,
              fontSize: 14,
              flexShrink: 0,
              padding: "4px 8px 4px 4px",
              borderRadius: 6,
              transition: "background 0.15s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#f3f4f6")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <span style={{ fontSize: 16, lineHeight: 1 }}>←</span>
            <img src="/logo.png" alt="" style={{ height: 22, width: "auto" }} />
            {!isMobile && <span>Atlas</span>}
          </a>
          <span style={{ width: 1, height: 20, background: "#e5e7eb", marginRight: 10, flexShrink: 0 }} />
          <input
            ref={searchInputRef}
            type="text"
            placeholder={isMobile ? "Search..." : "Search people, places, or cats... (press /)"}
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setShowSearchResults(true);
            }}
            onFocus={() => setShowSearchResults(true)}
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              fontSize: 15,
              fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            }}
          />
          {searchQuery && (
            <button
              onClick={() => { setSearchQuery(""); setShowSearchResults(false); }}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, opacity: 0.5 }}
            >
              ✕
            </button>
          )}
        </div>

        {/* Search results dropdown */}
        {showSearchResults && (searchResults.length > 0 || atlasSearchResults.length > 0 || googleSuggestions.length > 0 || (searchQuery.length >= 3 && !searchLoading)) && (
          <div style={{
            background: "white",
            borderRadius: 12,
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            marginTop: 8,
            maxHeight: 400,
            overflowY: "auto",
          }}>
            {/* Atlas Results Section */}
            {(searchResults.length > 0 || atlasSearchResults.length > 0) && (
              <>
                <div style={{
                  padding: "8px 16px 4px",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#6b7280",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  background: "#f9fafb",
                  borderBottom: "1px solid #e5e7eb",
                }}>
                  In Atlas
                </div>

                {/* Quick local results */}
                {searchResults.map((result, i) => (
                  <div
                    key={`local-${i}`}
                    onClick={() => handleSearchSelect(result)}
                    style={{
                      padding: "12px 16px",
                      cursor: "pointer",
                      borderBottom: "1px solid #f3f4f6",
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#f0fdf4")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "white")}
                  >
                    <span style={{ fontSize: 16 }}>
                      {result.type === "place" ? "🐱" : result.type === "google_pin" ? "📍" : "⭐"}
                    </span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 500, fontSize: 14 }}>{result.label}</div>
                      <div style={{ fontSize: 12, color: "#6b7280" }}>
                        {result.type === "place" ? "Colony Site" : result.type === "google_pin" ? "Historical Pin" : "Volunteer"}
                      </div>
                    </div>
                    {result.item.lat && result.item.lng && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setStreetViewCoords({ lat: result.item.lat, lng: result.item.lng, address: result.label });
                          setSearchQuery("");
                        }}
                        style={{ background: "none", border: "none", cursor: "pointer", padding: "4px 6px", fontSize: 14, color: "#6b7280", borderRadius: 4 }}
                        title="Street View"
                        onMouseEnter={(e) => (e.currentTarget.style.color = "#92400e")}
                        onMouseLeave={(e) => (e.currentTarget.style.color = "#6b7280")}
                      >
                        📷
                      </button>
                    )}
                    <span style={{ fontSize: 10, color: "#10b981", fontWeight: 500 }}>LOADED</span>
                  </div>
                ))}

                {/* Fuzzy search results from API (places, people, etc.) */}
                {atlasSearchResults.filter(r => !searchResults.some(sr => sr.label === r.display_name)).map((result, i) => (
                  <div
                    key={`atlas-${i}`}
                    onClick={() => handleAtlasSearchSelect(result)}
                    style={{
                      padding: "12px 16px",
                      cursor: "pointer",
                      borderBottom: "1px solid #f3f4f6",
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#eff6ff")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "white")}
                  >
                    <span style={{ fontSize: 16 }}>
                      {result.entity_type === "person" ? "👤" : result.entity_type === "cat" ? "🐱" : "📍"}
                    </span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 500, fontSize: 14 }}>{result.display_name}</div>
                      {result.subtitle && (
                        <div style={{ fontSize: 12, color: "#6b7280" }}>{result.subtitle}</div>
                      )}
                    </div>
                    {result.metadata?.lat && result.metadata?.lng && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setStreetViewCoords({ lat: result.metadata!.lat!, lng: result.metadata!.lng!, address: result.display_name });
                          setSearchQuery("");
                        }}
                        style={{ background: "none", border: "none", cursor: "pointer", padding: "4px 6px", fontSize: 14, color: "#6b7280", borderRadius: 4 }}
                        title="Street View"
                        onMouseEnter={(e) => (e.currentTarget.style.color = "#92400e")}
                        onMouseLeave={(e) => (e.currentTarget.style.color = "#6b7280")}
                      >
                        📷
                      </button>
                    )}
                    <span style={{
                      fontSize: 10,
                      color: result.metadata?.lat ? "#3b82f6" : "#9ca3af",
                      fontWeight: 500,
                    }}>
                      {result.entity_type === "person" ? "PERSON" : result.entity_type === "cat" ? "CAT" : "PLACE"}
                      {!result.metadata?.lat && " (detail)"}
                    </span>
                  </div>
                ))}
              </>
            )}

            {/* Google Places Section */}
            {googleSuggestions.length > 0 && (
              <>
                <div style={{
                  padding: "8px 16px 4px",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#6b7280",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  background: "#f9fafb",
                  borderBottom: "1px solid #e5e7eb",
                  marginTop: searchResults.length > 0 || atlasSearchResults.length > 0 ? 8 : 0,
                }}>
                  Search All Addresses
                </div>
                {googleSuggestions.map((suggestion, i) => (
                  <div
                    key={`google-${i}`}
                    onClick={() => handleGooglePlaceSelect(suggestion)}
                    style={{
                      padding: "12px 16px",
                      cursor: "pointer",
                      borderBottom: i < googleSuggestions.length - 1 ? "1px solid #f3f4f6" : "none",
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#fef3c7")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "white")}
                  >
                    <span style={{ fontSize: 16 }}>📍</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 500, fontSize: 14 }}>{suggestion.structured_formatting.main_text}</div>
                      <div style={{ fontSize: 12, color: "#6b7280" }}>{suggestion.structured_formatting.secondary_text}</div>
                    </div>
                    <span style={{ fontSize: 10, color: "#d97706", fontWeight: 500 }}>GOOGLE</span>
                  </div>
                ))}
              </>
            )}

            {/* Loading state */}
            {searchLoading && (
              <div style={{ padding: "12px 16px", textAlign: "center", color: "#6b7280", fontSize: 13 }}>
                Searching...
              </div>
            )}

            {/* No results message */}
            {searchQuery.length >= 3 && !searchLoading && searchResults.length === 0 && atlasSearchResults.length === 0 && googleSuggestions.length === 0 && (
              <div style={{ padding: "16px", textAlign: "center", color: "#6b7280" }}>
                <div style={{ fontSize: 14, marginBottom: 4 }}>No matches found</div>
                <div style={{ fontSize: 12 }}>Try a different search term</div>
              </div>
            )}
          </div>
        )}
      </div>
      )}

      {/* Right side controls */}
      <div style={{
        position: "absolute",
        top: 16,
        right: 16,
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}>
        {/* Layer control button */}
        <button
          onClick={() => setShowLayerPanel(!showLayerPanel)}
          title="Toggle layers (L)"
          style={{
            background: "white",
            border: "none",
            borderRadius: 8,
            padding: "10px 14px",
            boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            fontSize: 14,
            fontWeight: 500,
            transition: "background 0.2s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "#f9fafb")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "white")}
        >
          <span style={{ fontSize: 18 }}>☰</span>
          {!isMobile && "Layers"}
        </button>

        {/* Add Point button */}
        <div style={{ position: "relative" }}>
          <button
            onClick={() => {
              if (addPointMode) {
                setAddPointMode(null);
                setPendingClick(null);
                setShowAddPointMenu(false);
              } else {
                setShowAddPointMenu(prev => !prev);
              }
            }}
            title="Add point to map (A)"
            style={{
              background: addPointMode ? "#2563eb" : "white",
              border: "none",
              borderRadius: 8,
              padding: "10px 14px",
              boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
              fontSize: 14,
              fontWeight: 500,
              color: addPointMode ? "white" : "#374151",
              transition: "background 0.2s, color 0.2s",
            }}
            onMouseEnter={(e) => { if (!addPointMode) e.currentTarget.style.background = "#f9fafb"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = addPointMode ? "#2563eb" : "white"; }}
          >
            <span style={{ fontSize: 18 }}>{addPointMode ? "✕" : "+"}</span>
            {!isMobile && (addPointMode ? "Cancel" : "Add Point")}
          </button>
          {showAddPointMenu && !addPointMode && (
            <div style={{
              position: "absolute",
              top: "100%",
              right: 0,
              marginTop: 4,
              background: "white",
              borderRadius: 8,
              boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
              overflow: "hidden",
              minWidth: 160,
              zIndex: 1001,
            }}>
              <button
                onClick={() => { setAddPointMode('place'); setShowAddPointMenu(false); }}
                style={{
                  display: "block", width: "100%", padding: "10px 14px", border: "none",
                  background: "white", textAlign: "left", cursor: "pointer",
                  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
                  fontSize: 13, fontWeight: 500, color: "#374151",
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = "#f3f4f6"}
                onMouseLeave={(e) => e.currentTarget.style.background = "white"}
              >
                📍 Add Place
              </button>
              <button
                onClick={() => { setAddPointMode('annotation'); setShowAddPointMenu(false); }}
                style={{
                  display: "block", width: "100%", padding: "10px 14px", border: "none",
                  background: "white", textAlign: "left", cursor: "pointer", borderTop: "1px solid #f3f4f6",
                  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
                  fontSize: 13, fontWeight: 500, color: "#374151",
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = "#f3f4f6"}
                onMouseLeave={(e) => e.currentTarget.style.background = "white"}
              >
                📝 Add Note
              </button>
            </div>
          )}
        </div>

        {/* My Location button */}
        <button
          onClick={handleMyLocation}
          disabled={locatingUser}
          title="My location (M)"
          style={{
            background: "white",
            border: "none",
            borderRadius: 8,
            padding: "10px 14px",
            boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
            cursor: locatingUser ? "wait" : "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            fontSize: 14,
            fontWeight: 500,
            opacity: locatingUser ? 0.7 : 1,
            transition: "background 0.2s, opacity 0.2s",
          }}
          onMouseEnter={(e) => !locatingUser && (e.currentTarget.style.background = "#f9fafb")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "white")}
        >
          <span style={{ fontSize: 18 }}>{locatingUser ? "⏳" : "📍"}</span>
          {!isMobile && (locatingUser ? "Locating..." : "My Location")}
        </button>

        {/* Satellite toggle */}
        <button
          onClick={() => setIsSatellite(!isSatellite)}
          title={isSatellite ? "Street view" : "Satellite view"}
          style={{
            background: isSatellite ? "#1d4ed8" : "white",
            border: "none",
            borderRadius: 8,
            padding: "10px 14px",
            boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            fontSize: 14,
            fontWeight: 500,
            color: isSatellite ? "white" : "#374151",
            transition: "background 0.2s, color 0.2s",
          }}
          onMouseEnter={(e) => { if (!isSatellite) e.currentTarget.style.background = "#f9fafb"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = isSatellite ? "#1d4ed8" : "white"; }}
        >
          <span style={{ fontSize: 18 }}>{isSatellite ? "🗺️" : "🛰️"}</span>
          {!isMobile && (isSatellite ? "Street" : "Satellite")}
        </button>

        {/* Zoom controls */}
        <div style={{
          background: "white",
          borderRadius: 8,
          boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
          overflow: "hidden",
        }}>
          <button
            onClick={() => mapRef.current?.zoomIn()}
            title="Zoom in (+)"
            style={{
              background: "white",
              border: "none",
              borderBottom: "1px solid #e5e7eb",
              padding: "8px 14px",
              cursor: "pointer",
              display: "block",
              width: "100%",
              fontSize: 20,
              fontWeight: 500,
              transition: "background 0.2s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#f9fafb")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "white")}
          >
            +
          </button>
          <button
            onClick={() => mapRef.current?.zoomOut()}
            title="Zoom out (-)"
            style={{
              background: "white",
              border: "none",
              padding: "8px 14px",
              cursor: "pointer",
              display: "block",
              width: "100%",
              fontSize: 20,
              fontWeight: 500,
              transition: "background 0.2s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#f9fafb")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "white")}
          >
            −
          </button>
        </div>
      </div>

      {/* Layer panel */}
      {showLayerPanel && (
        <div style={isMobile ? {
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 1001,
          background: "white",
          borderRadius: "16px 16px 0 0",
          boxShadow: "0 -4px 20px rgba(0,0,0,0.2)",
          maxHeight: "60dvh",
          overflowY: "auto",
        } : {
          position: "absolute",
          top: 16,
          right: 180,
          zIndex: 1000,
          background: "white",
          borderRadius: 12,
          boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
          width: 300,
          maxHeight: "calc(100dvh - 100px)",
          overflowY: "auto",
        }}>
          <div style={{ padding: 16, borderBottom: "1px solid #e5e7eb" }}>
            <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 4 }}>Map Layers</div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>
              {totalMarkers.toLocaleString()} markers shown
            </div>
          </div>

          {/* Zone filter */}
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #e5e7eb" }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: "#6b7280", marginBottom: 8 }}>
              Service Zone
            </div>
            <select
              value={selectedZone}
              onChange={(e) => setSelectedZone(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 12px",
                border: "1px solid #d1d5db",
                borderRadius: 8,
                fontSize: 14,
                fontFamily: "inherit",
              }}
            >
              {SERVICE_ZONES.map((z) => (
                <option key={z} value={z}>{z}</option>
              ))}
            </select>
          </div>

          {/* Atlas Pins filters (only show when atlas_pins layer is enabled) */}
          {enabledLayers.atlas_pins && (
            <div style={{ padding: "12px 16px", borderBottom: "1px solid #e5e7eb" }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: "#6b7280", marginBottom: 8 }}>
                Filter Atlas Data
              </div>

              {/* Risk filter */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 4 }}>By Risk Level</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {[
                    { value: "all", label: "All", color: "#6b7280" },
                    { value: "disease", label: "Disease Risk", color: "#ea580c" },
                    { value: "watch_list", label: "Watch List", color: "#8b5cf6" },
                    { value: "needs_tnr", label: "Needs TNR", color: "#dc2626" },
                    { value: "needs_trapper", label: "Needs Trapper", color: "#f97316" },
                  ].map(({ value, label, color }) => (
                    <button
                      key={value}
                      onClick={() => setRiskFilter(value as typeof riskFilter)}
                      style={{
                        padding: "4px 10px",
                        fontSize: 11,
                        border: "none",
                        borderRadius: 12,
                        cursor: "pointer",
                        fontWeight: 500,
                        background: riskFilter === value ? color : "#f3f4f6",
                        color: riskFilter === value ? "white" : "#6b7280",
                        transition: "all 0.2s",
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Disease type filter */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 4 }}>By Disease Type</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {[
                    { key: "felv", code: "F", label: "FeLV", color: "#dc2626" },
                    { key: "fiv", code: "V", label: "FIV", color: "#ea580c" },
                    { key: "ringworm", code: "R", label: "Ringworm", color: "#ca8a04" },
                    { key: "heartworm", code: "H", label: "Heartworm", color: "#7c3aed" },
                    { key: "panleukopenia", code: "P", label: "Panleuk", color: "#be185d" },
                  ].map(({ key, code, label, color }) => {
                    const isActive = diseaseFilter.includes(key);
                    return (
                      <button
                        key={key}
                        onClick={() => {
                          setDiseaseFilter(prev =>
                            prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
                          );
                        }}
                        style={{
                          padding: "4px 10px",
                          fontSize: 11,
                          border: isActive ? `2px solid ${color}` : "2px solid transparent",
                          borderRadius: 12,
                          cursor: "pointer",
                          fontWeight: 600,
                          background: isActive ? color : "#f3f4f6",
                          color: isActive ? "white" : "#6b7280",
                          transition: "all 0.2s",
                        }}
                      >
                        {code} {label}
                      </button>
                    );
                  })}
                  {diseaseFilter.length > 0 && (
                    <button
                      onClick={() => setDiseaseFilter([])}
                      style={{
                        padding: "4px 8px",
                        fontSize: 10,
                        border: "none",
                        borderRadius: 12,
                        cursor: "pointer",
                        fontWeight: 500,
                        background: "#fee2e2",
                        color: "#991b1b",
                      }}
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {/* Data filter */}
              <div>
                <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 4 }}>By Data Source</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {[
                    { value: "all", label: "All" },
                    { value: "has_atlas", label: "Has Cats/Requests" },
                    { value: "has_google", label: "Has History" },
                    { value: "has_people", label: "Has People" },
                  ].map(({ value, label }) => (
                    <button
                      key={value}
                      onClick={() => setDataFilter(value as typeof dataFilter)}
                      style={{
                        padding: "4px 10px",
                        fontSize: 11,
                        border: "none",
                        borderRadius: 12,
                        cursor: "pointer",
                        fontWeight: 500,
                        background: dataFilter === value ? "#3b82f6" : "#f3f4f6",
                        color: dataFilter === value ? "white" : "#6b7280",
                        transition: "all 0.2s",
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Primary Layer toggles */}
          <div style={{ padding: "8px 0" }}>
            {PRIMARY_LAYER_CONFIGS.map((layer) => {
              const count = layer.id === "atlas_pins" ? atlasPins.length : 0;

              return (
                <div
                  key={layer.id}
                  onClick={() => toggleLayer(layer.id)}
                  style={{
                    padding: "12px 16px",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    cursor: "pointer",
                    background: enabledLayers[layer.id] ? `${layer.color}10` : "transparent",
                    borderLeft: enabledLayers[layer.id] ? `3px solid ${layer.color}` : "3px solid transparent",
                  }}
                >
                  <span style={{ fontSize: 20 }}>{layer.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                      {layer.label}
                      <span style={{
                        background: "#f3f4f6",
                        padding: "1px 6px",
                        borderRadius: 10,
                        fontSize: 11,
                        color: "#6b7280",
                      }}>
                        {count}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: "#9ca3af" }}>{layer.description}</div>
                  </div>
                  <div style={{
                    width: 20,
                    height: 20,
                    borderRadius: 4,
                    border: `2px solid ${enabledLayers[layer.id] ? layer.color : "#d1d5db"}`,
                    background: enabledLayers[layer.id] ? layer.color : "transparent",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "white",
                    fontSize: 12,
                  }}>
                    {enabledLayers[layer.id] && "✓"}
                  </div>
                </div>
              );
            })}

            {/* Legacy layers toggle */}
            <div
              onClick={() => setShowLegacyLayers(!showLegacyLayers)}
              style={{
                padding: "10px 16px",
                display: "flex",
                alignItems: "center",
                gap: 8,
                cursor: "pointer",
                borderTop: "1px solid #e5e7eb",
                marginTop: 8,
              }}
            >
              <span style={{ fontSize: 12, color: "#6b7280" }}>
                {showLegacyLayers ? "▼" : "▶"}
              </span>
              <span style={{ fontSize: 12, color: "#6b7280", fontWeight: 500 }}>
                Advanced Layers ({LEGACY_LAYER_CONFIGS.length})
              </span>
            </div>

            {/* Legacy layer toggles (hidden by default) */}
            {showLegacyLayers && LEGACY_LAYER_CONFIGS.map((layer) => {
              const count = layer.id === "places" ? places.length :
                layer.id === "google_pins" ? googlePins.length :
                layer.id === "tnr_priority" ? tnrPriority.length :
                layer.id === "zones" ? zones.length :
                layer.id === "volunteers" ? volunteers.length :
                layer.id === "clinic_clients" ? clinicClients.length :
                layer.id === "historical_sources" ? historicalSources.length :
                layer.id === "data_coverage" ? dataCoverage.length : 0;

              return (
                <div
                  key={layer.id}
                  onClick={() => toggleLayer(layer.id)}
                  style={{
                    padding: "10px 16px 10px 32px",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    cursor: "pointer",
                    background: enabledLayers[layer.id] ? `${layer.color}10` : "#f9fafb",
                    borderLeft: enabledLayers[layer.id] ? `3px solid ${layer.color}` : "3px solid transparent",
                  }}
                >
                  <span style={{ fontSize: 16 }}>{layer.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                      {layer.label}
                      {enabledLayers[layer.id] && count > 0 && (
                        <span style={{
                          background: "#f3f4f6",
                          padding: "1px 5px",
                          borderRadius: 8,
                          fontSize: 10,
                          color: "#6b7280",
                        }}>
                          {count}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: "#9ca3af" }}>{layer.description}</div>
                  </div>
                  <div style={{
                    width: 18,
                    height: 18,
                    borderRadius: 4,
                    border: `2px solid ${enabledLayers[layer.id] ? layer.color : "#d1d5db"}`,
                    background: enabledLayers[layer.id] ? layer.color : "transparent",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "white",
                    fontSize: 11,
                  }}>
                    {enabledLayers[layer.id] && "✓"}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Legend */}
          {(enabledLayers.atlas_pins || enabledLayers.google_pins || enabledLayers.tnr_priority || enabledLayers.historical_sources) && (
            <div style={{ padding: 16, borderTop: "1px solid #e5e7eb" }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: "#6b7280", marginBottom: 8 }}>
                Legend
              </div>

              {enabledLayers.atlas_pins && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 500, marginBottom: 4 }}>Atlas Data Pins</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {[
                      { label: "Disease Risk", color: "#ea580c" },
                      { label: "Watch List", color: "#8b5cf6" },
                      { label: "Active Colony", color: "#22c55e" },
                      { label: "Has History", color: "#6366f1" },
                      { label: "Minimal Data", color: "#3b82f6" },
                    ].map(({ label, color }) => (
                      <span key={label} style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 10,
                        padding: "2px 6px",
                        background: `${color}15`,
                        borderRadius: 8,
                      }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
                        {label}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {enabledLayers.google_pins && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 500, marginBottom: 4 }}>AI Classifications</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {[
                      { label: "Disease Risk", color: "#FF0000" },
                      { label: "Watch List", color: "#FF6600" },
                      { label: "Volunteer", color: "#FFD700" },
                      { label: "Active Colony", color: "#00AA00" },
                    ].map(({ label, color }) => (
                      <span key={label} style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 10,
                        padding: "2px 6px",
                        background: `${color}15`,
                        borderRadius: 8,
                      }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
                        {label}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {enabledLayers.tnr_priority && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 500, marginBottom: 4 }}>TNR Priority</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {[
                      { label: "Critical", color: "#dc2626" },
                      { label: "High", color: "#ea580c" },
                      { label: "Medium", color: "#ca8a04" },
                    ].map(({ label, color }) => (
                      <span key={label} style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 10,
                        padding: "2px 6px",
                        background: `${color}15`,
                        borderRadius: 8,
                      }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
                        {label}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {enabledLayers.historical_sources && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 500, marginBottom: 4 }}>Historical Conditions</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {[
                      { label: "Hoarding", color: "#9333ea" },
                      { label: "Breeding Crisis", color: "#dc2626" },
                      { label: "Disease Outbreak", color: "#ef4444" },
                      { label: "Resolved", color: "#10b981" },
                    ].map(({ label, color }) => (
                      <span key={label} style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 10,
                        padding: "2px 6px",
                        background: `${color}15`,
                        borderRadius: 8,
                      }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
                        {label}
                      </span>
                    ))}
                  </div>
                  <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 6 }}>
                    Opacity indicates recency (fainter = older)
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Stats bar — hidden on mobile */}
      {summary && !isMobile && (
        <div style={{
          position: "absolute",
          bottom: 24,
          left: 16,
          zIndex: 1000,
          background: "white",
          borderRadius: 12,
          boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
          padding: "10px 16px",
          display: "flex",
          gap: 24,
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#374151" }}>
              {summary.total_places.toLocaleString()}
            </div>
            <div style={{ fontSize: 11, color: "#6b7280" }}>Total Places</div>
          </div>
          <div style={{ borderLeft: "1px solid #e5e7eb", paddingLeft: 24 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#374151" }}>
              {summary.total_cats.toLocaleString()}
            </div>
            <div style={{ fontSize: 11, color: "#6b7280" }}>Cats Linked</div>
          </div>
        </div>
      )}

      {/* Add Point mode banner */}
      {addPointMode && !pendingClick && (
        <div style={{
          position: "absolute",
          top: 16,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 1001,
          background: "#2563eb",
          color: "white",
          padding: "10px 20px",
          borderRadius: 8,
          boxShadow: "0 4px 12px rgba(37,99,235,0.3)",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          fontSize: 13,
          fontWeight: 500,
          display: "flex",
          alignItems: "center",
          gap: 10,
          whiteSpace: "nowrap",
        }}>
          <span>{addPointMode === 'place' ? '📍' : '📝'}</span>
          Click on the map to {addPointMode === 'place' ? 'place a point' : 'add a note'}.
          <kbd style={{
            background: "rgba(255,255,255,0.2)",
            padding: "2px 6px",
            borderRadius: 4,
            fontSize: 11,
          }}>Esc</kbd>
          to cancel
        </div>
      )}

      {/* PlacementPanel — shown when map is clicked in add-point mode */}
      {pendingClick && addPointMode && (
        <PlacementPanel
          mode={addPointMode}
          coordinates={pendingClick}
          onPlaceSelected={(placeId) => {
            setSelectedPlaceId(placeId);
            setDrawerFromAddPoint(true);
            setPendingClick(null);
            setAddPointMode(null);
            // Pan to the placed point
            mapRef.current?.panTo([pendingClick.lat, pendingClick.lng], { animate: true });
          }}
          onAnnotationCreated={() => {
            setPendingClick(null);
            setAddPointMode(null);
            fetchAnnotations();
          }}
          onCancel={() => {
            setPendingClick(null);
          }}
        />
      )}

      {/* Loading overlay */}
      {loading && (
        <div className="map-loading-overlay">
          <div className="map-loading-spinner" />
          <span className="map-loading-text">Loading map data...</span>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          background: "#fef2f2",
          color: "#b91c1c",
          padding: "16px 24px",
          borderRadius: 12,
          zIndex: 1001,
        }}>
          {error}
        </div>
      )}

      {/* Keyboard shortcuts help — hidden on mobile (no keyboard) */}
      {!isMobile && <div style={{
        position: "absolute",
        bottom: 24,
        right: 16,
        zIndex: 999,
        background: "rgba(255,255,255,0.9)",
        borderRadius: 6,
        boxShadow: "0 1px 4px rgba(0,0,0,0.1)",
        padding: "6px 10px",
        fontSize: 10,
        color: "#9ca3af",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}>
        <kbd style={{ background: "#f3f4f6", padding: "1px 4px", borderRadius: 3 }}>/</kbd> search
        <span style={{ margin: "0 6px" }}>·</span>
        <kbd style={{ background: "#f3f4f6", padding: "1px 4px", borderRadius: 3 }}>L</kbd> layers
        <span style={{ margin: "0 6px" }}>·</span>
        <kbd style={{ background: "#f3f4f6", padding: "1px 4px", borderRadius: 3 }}>A</kbd> add point
        <span style={{ margin: "0 6px" }}>·</span>
        <kbd style={{ background: "#f3f4f6", padding: "1px 4px", borderRadius: 3 }}>M</kbd> location
      </div>}

      {/* Map Legend */}
      <div className="map-legend" style={{
        position: "absolute",
        bottom: 24,
        left: 16,
        zIndex: 1002,
      }}>
        <button
          onClick={() => setShowLegend(prev => !prev)}
          className="map-legend-toggle"
          title="Toggle legend"
        >
          {showLegend ? "Legend \u25BC" : "?"}
        </button>
        {showLegend && (
          <div className="map-legend-panel">
            <div style={{ fontSize: 10, fontWeight: 600, color: "#9ca3af", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.5px" }}>Active Pins</div>
            {[
              { color: "#ea580c", label: "Disease Risk", pinStyle: "disease" },
              { color: "#8b5cf6", label: "Watch List", pinStyle: "watch_list" },
              { color: "#22c55e", label: "Verified Cats", pinStyle: "active" },
              { color: "#14b8a6", label: "Requests Only", pinStyle: "active_requests" },
            ].map(({ color, label, pinStyle }) => (
              <div key={label} className="map-legend-item">
                <span
                  dangerouslySetInnerHTML={{ __html: generateLegendPinSvg(color, pinStyle, 14) }}
                  style={{ display: "inline-flex", width: 14, height: 19, flexShrink: 0 }}
                />
                <span className="map-legend-label">{label}</span>
              </div>
            ))}
            <div style={{ fontSize: 10, fontWeight: 600, color: "#9ca3af", marginTop: 8, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.5px" }}>Reference Pins</div>
            {[
              { color: "#6366f1", label: "History Only", pinStyle: "has_history" },
              { color: "#94a3b8", label: "Minimal Data", pinStyle: "minimal" },
            ].map(({ color, label, pinStyle }) => (
              <div key={label} className="map-legend-item">
                <span
                  dangerouslySetInnerHTML={{ __html: generateLegendPinSvg(color, pinStyle, 12) }}
                  style={{ display: "inline-flex", width: 12, height: 16, flexShrink: 0, opacity: 0.65 }}
                />
                <span className="map-legend-label">{label}</span>
              </div>
            ))}
            <div style={{ fontSize: 10, fontWeight: 600, color: "#9ca3af", marginTop: 8, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.5px" }}>Pin Badges</div>
            <div className="map-legend-item">
              <span style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: 14, height: 14, borderRadius: "50%", background: "#7c3aed", flexShrink: 0,
              }}>
                <svg width="8" height="8" viewBox="-3.5 -3.5 7 7">
                  <polygon points="0,-3.2 1.2,-1 3.4,-1 1.6,0.6 2.4,3 0,1.6 -2.4,3 -1.6,0.6 -3.4,-1 -1.2,-1" fill="white" transform="scale(0.7)" />
                </svg>
              </span>
              <span className="map-legend-label">Volunteer / Staff</span>
            </div>
            <div className="map-legend-item">
              <span style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: 14, height: 14, borderRadius: "50%", background: "#f97316", flexShrink: 0,
                color: "white", fontSize: 9, fontWeight: 700,
              }}>
                T
              </span>
              <span className="map-legend-label">Needs Trapper</span>
            </div>
            <div style={{ fontSize: 10, fontWeight: 600, color: "#9ca3af", marginTop: 8, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.5px" }}>Disease Badges</div>
            {[
              { color: "#dc2626", code: "F", label: "FeLV" },
              { color: "#ea580c", code: "V", label: "FIV" },
              { color: "#ca8a04", code: "R", label: "Ringworm" },
              { color: "#7c3aed", code: "H", label: "Heartworm" },
              { color: "#be185d", code: "P", label: "Panleukopenia" },
            ].map(({ color, code, label }) => (
              <div key={code} className="map-legend-item">
                <span className="map-legend-swatch" style={{
                  background: color,
                  borderRadius: "50%",
                  width: 14,
                  height: 14,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "white",
                  fontSize: 8,
                  fontWeight: 700,
                }}>{code}</span>
                <span className="map-legend-label">{label}</span>
              </div>
            ))}
            <div style={{ borderTop: "1px solid #e5e7eb", marginTop: 8, paddingTop: 6, fontSize: 10, color: "#9ca3af" }}>
              <kbd style={{ background: "#f3f4f6", padding: "1px 4px", borderRadius: 3, fontSize: 9 }}>K</kbd> toggle legend
            </div>
          </div>
        )}
      </div>

      {/* CSS animations are in atlas-map.css */}

      {/* Street View Panel (hidden in cone-only mode — drawer handles the panorama) */}
      {streetViewCoords && streetViewUrl && !streetViewConeOnly && (
        <div className="street-view-panel">
          <div className="street-view-header">
            <div className="street-view-title">
              <span className="street-view-icon">📷</span>
              <span>{streetViewCoords.address || `${streetViewCoords.lat.toFixed(5)}, ${streetViewCoords.lng.toFixed(5)}`}</span>
            </div>
            <div className="street-view-actions">
              <a
                href={`https://www.google.com/maps/@${streetViewCoords.lat},${streetViewCoords.lng},3a,75y,0h,90t/data=!3m4!1e1!3m2!1s!2e0`}
                target="_blank"
                rel="noopener noreferrer"
                className="street-view-gmaps-link"
              >
                Open in Google Maps
              </a>
              <button
                className="sv-ctrl-btn"
                onClick={() => setStreetViewFullscreen(prev => !prev)}
                title={streetViewFullscreen ? "Exit fullscreen" : "Fullscreen"}
                style={{ fontSize: 16, width: 32, height: 32 }}
              >
                {streetViewFullscreen ? "\u2291" : "\u2292"}
              </button>
              <button
                className="street-view-close"
                onClick={() => { setStreetViewCoords(null); setStreetViewFullscreen(false); }}
              >
                &times;
              </button>
            </div>
          </div>
          {/* Heading / Pitch controls */}
          <div className="street-view-controls">
            <div className="street-view-controls-group">
              <button
                className="sv-ctrl-btn"
                onClick={() => {
                  const h = (streetViewHeading - 30 + 360) % 360;
                  setStreetViewHeading(h);
                  streetViewIframeRef.current?.contentWindow?.postMessage({ type: "set-pov", heading: h, pitch: streetViewPitch }, "*");
                }}
                title="Rotate left"
              >
                ◀
              </button>
              <span className="sv-compass">
                {(() => {
                  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
                  return dirs[Math.round(streetViewHeading / 45) % 8];
                })()}
                <span className="sv-degrees">{streetViewHeading}°</span>
              </span>
              <button
                className="sv-ctrl-btn"
                onClick={() => {
                  const h = (streetViewHeading + 30) % 360;
                  setStreetViewHeading(h);
                  streetViewIframeRef.current?.contentWindow?.postMessage({ type: "set-pov", heading: h, pitch: streetViewPitch }, "*");
                }}
                title="Rotate right"
              >
                ▶
              </button>
            </div>
            <div className="street-view-controls-group">
              <button
                className="sv-ctrl-btn"
                onClick={() => {
                  const p = Math.min(90, streetViewPitch + 15);
                  setStreetViewPitch(p);
                  streetViewIframeRef.current?.contentWindow?.postMessage({ type: "set-pov", heading: streetViewHeading, pitch: p }, "*");
                }}
                title="Look up"
              >
                ▲
              </button>
              <span className="sv-pitch">{streetViewPitch > 0 ? "+" : ""}{streetViewPitch}°</span>
              <button
                className="sv-ctrl-btn"
                onClick={() => {
                  const p = Math.max(-90, streetViewPitch - 15);
                  setStreetViewPitch(p);
                  streetViewIframeRef.current?.contentWindow?.postMessage({ type: "set-pov", heading: streetViewHeading, pitch: p }, "*");
                }}
                title="Look down"
              >
                ▼
              </button>
            </div>
          </div>
          <div style={{ position: "relative", flex: 1 }}>
            <iframe
              ref={streetViewIframeRef}
              className="street-view-iframe"
              src={streetViewUrl}
              allowFullScreen
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              style={{ width: "100%", height: "100%", border: "none" }}
            />
            {streetViewFullscreen && (
              <div
                ref={miniMapContainerRef}
                className="street-view-minimap"
                onClick={() => setStreetViewFullscreen(false)}
                title="Click to exit fullscreen"
              />
            )}
          </div>
        </div>
      )}

      {/* Annotation Detail Drawer */}
      {selectedAnnotationId && (
        <AnnotationDetailDrawer
          annotationId={selectedAnnotationId}
          onClose={() => setSelectedAnnotationId(null)}
        />
      )}

      {/* Place Detail Drawer */}
      {selectedPlaceId && (
        <PlaceDetailDrawer
          placeId={selectedPlaceId}
          onClose={() => { setSelectedPlaceId(null); setSelectedPersonId(null); setSelectedCatId(null); setDrawerFromAddPoint(false); }}
          onWatchlistChange={fetchMapData}
          showQuickActions={drawerFromAddPoint}
          shifted={!!(selectedPersonId || selectedCatId)}
          coordinates={(() => {
            const pin = atlasPins.find(p => p.id === selectedPlaceId) ||
                        places.find(p => p.id === selectedPlaceId);
            return pin?.lat && pin?.lng ? { lat: pin.lat, lng: pin.lng } : undefined;
          })()}
        />
      )}

      {/* Person Detail Drawer */}
      {selectedPersonId && (
        <PersonDetailDrawer
          personId={selectedPersonId}
          onClose={() => setSelectedPersonId(null)}
        />
      )}

      {/* Cat Detail Drawer */}
      {selectedCatId && (
        <CatDetailDrawer
          catId={selectedCatId}
          onClose={() => setSelectedCatId(null)}
        />
      )}
    </div>
  );
}
