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
} from "@/lib/map-markers";
import { MAP_COLORS, getPriorityColor } from "@/lib/map-colors";
import {
  buildPlacePopup,
  buildGooglePinPopup,
  buildTNRPriorityPopup,
  buildVolunteerPopup,
  buildClinicClientPopup,
  buildZonePopup,
} from "@/components/map/MapPopup";
import { PlaceDetailDrawer } from "@/components/map/PlaceDetailDrawer";

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
  people: string[];
  person_count: number;
  disease_risk: boolean;
  disease_risk_notes: string | null;
  watch_list: boolean;
  google_entry_count: number;
  google_summaries: Array<{ summary: string; meaning: string | null; date: string | null }>;
  request_count: number;
  active_request_count: number;
  total_altered: number;
  last_alteration_at: string | null;
  pin_style: "disease" | "watch_list" | "active" | "has_history" | "minimal";
}

// NEW: Historical Pin from v_map_historical_pins view (unlinked Google Maps entries)
interface HistoricalPin {
  id: string;
  name: string;
  lat: number;
  lng: number;
  notes: string;
  ai_summary: string | null;
  ai_meaning: string | null;
  parsed_date: string | null;
  disease_risk: boolean;
  watch_list: boolean;
  icon_type: string | null;
  icon_color: string | null;
  nearest_place_id: string | null;
  nearest_place_distance_m: number | null;
  requires_unit_selection: boolean;
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
  { id: "historical_pins", label: "Historical Notes", icon: "⚪", color: "#9ca3af", description: "Unlinked Google Maps notes", defaultEnabled: true },
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

  // State
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showLayerPanel, setShowLayerPanel] = useState(false);
  const [isSatellite, setIsSatellite] = useState(false);
  const [selectedZone, setSelectedZone] = useState("All Zones");
  const [enabledLayers, setEnabledLayers] = useState<Record<string, boolean>>(
    Object.fromEntries(LAYER_CONFIGS.map(l => [l.id, l.defaultEnabled]))
  );

  // Data - NEW simplified layers
  const [atlasPins, setAtlasPins] = useState<AtlasPin[]>([]);
  const [historicalPins, setHistoricalPins] = useState<HistoricalPin[]>([]);

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
  const [riskFilter, setRiskFilter] = useState<"all" | "disease" | "watch_list" | "needs_tnr">("all");
  const [dataFilter, setDataFilter] = useState<"all" | "has_atlas" | "has_google" | "has_people">("all");

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

  // Expose setSelectedPlaceId globally for popup buttons
  useEffect(() => {
    (window as unknown as { atlasMapExpandPlace: (id: string) => void }).atlasMapExpandPlace = (id: string) => {
      setSelectedPlaceId(id);
    };
    return () => {
      delete (window as unknown as { atlasMapExpandPlace?: (id: string) => void }).atlasMapExpandPlace;
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
      setHistoricalPins([]);
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
      }

      const response = await fetch(`/api/beacon/map-data?${params}`);
      if (!response.ok) throw new Error("Failed to fetch map data");

      const data = await response.json();
      // New layers
      setAtlasPins(data.atlas_pins || []);
      setHistoricalPins(data.historical_pins || []);
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
  }, [enabledLayers, selectedZone, riskFilter, dataFilter]);

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

    if (urlLat && urlLng) {
      const lat = parseFloat(urlLat);
      const lng = parseFloat(urlLng);
      const zoom = urlZoom ? parseInt(urlZoom, 10) : 16;

      if (!isNaN(lat) && !isNaN(lng)) {
        map.setView([lat, lng], zoom);
        // Set navigated location to show a marker at this point
        setNavigatedLocation({ lat, lng, address: 'Selected location' });
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
    mapRef.current.removeLayer(tileLayerRef.current);
    const newTiles = isSatellite
      ? L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
          attribution: "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics",
          maxZoom: 19,
        })
      : L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
          maxZoom: 19,
        });
    newTiles.addTo(mapRef.current);
    // Keep tiles behind all markers
    newTiles.setZIndex(0);
    tileLayerRef.current = newTiles;
  }, [isSatellite]);

  // Fetch data on mount and when filters change (debounced to avoid rapid re-fetches)
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchMapData();
    }, 150);
    return () => clearTimeout(timer);
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
        const hasDisease = markers.some((m: any) => m.options.diseaseRisk);
        const hasWatchList = markers.some((m: any) => m.options.watchList);
        const sizeClass = count < 10 ? "small" : count < 50 ? "medium" : "large";
        const dim = sizeClass === "small" ? 32 : sizeClass === "medium" ? 40 : 50;
        const clusterColor = hasDisease ? "#ea580c" : hasWatchList ? "#8b5cf6" : "#3b82f6";
        return L.divIcon({
          html: `<div class="map-cluster map-cluster--${sizeClass}" style="--cluster-color: ${clusterColor}">${count}</div>`,
          className: "map-cluster-icon",
          iconSize: L.point(dim, dim),
        });
      },
    });

    atlasPins.forEach((pin) => {
      if (!pin.lat || !pin.lng) return;

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
        case "has_history":
          color = "#6366f1";
          size = 26;
          break;
        default:
          color = "#3b82f6";
          size = 24;
      }

      const marker = L.marker([pin.lat, pin.lng], {
        icon: createAtlasPinMarker(color, {
          size,
          pinStyle: pin.pin_style,
          isClustered: false,
          unitCount: 1,
          catCount: pin.cat_count,
        }),
        diseaseRisk: pin.disease_risk,
        watchList: pin.watch_list,
      } as any);

      // Build consolidated popup
      // Filter out names that look like addresses (contain ", CA" or match the place address)
      const isLikelyAddress = (name: string): boolean => {
        if (!name) return true;
        const lowerName = name.toLowerCase();
        // Check for address patterns
        if (lowerName.includes(", ca ") || lowerName.includes(", ca,") || lowerName.endsWith(", ca")) return true;
        if (/\d{5}/.test(name)) return true; // Contains 5-digit zip
        if (/^\d+\s+\w+\s+(st|rd|ave|blvd|dr|ln|ct|way|pl)\b/i.test(name)) return true; // Starts with street address
        // Check if it matches the pin's address (ignoring case)
        if (pin.address && lowerName === pin.address.toLowerCase()) return true;
        return false;
      };
      const filteredPeople = Array.isArray(pin.people)
        ? pin.people.filter((name: string) => !isLikelyAddress(name))
        : [];
      const peopleList = filteredPeople.length > 0
        ? filteredPeople.slice(0, 3).map((name: string) => `<div style="font-size: 12px;">• ${name}</div>`).join("")
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

          <div style="display: flex; gap: 8px; margin-top: 12px;">
            <button onclick="window.atlasMapExpandPlace('${pin.id}')"
                    style="flex: 1; padding: 8px; background: #f3f4f6; color: #374151; border: 1px solid #d1d5db; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500;">
              Expand Details
            </button>
            <a href="/places/${pin.id}" target="_blank"
               style="flex: 1; padding: 8px; background: #3b82f6; color: white; text-decoration: none; border-radius: 6px; text-align: center; font-size: 13px; font-weight: 500;">
              Open Page →
            </a>
          </div>
        </div>
      `);

      layer.addLayer(marker);
    });

    layer.addTo(mapRef.current);
    layersRef.current.atlas_pins = layer;
  }, [atlasPins, enabledLayers.atlas_pins]);

  // =========================================================================
  // Historical Pins layer — uses Canvas renderer for performance
  // =========================================================================
  useEffect(() => {
    if (!mapRef.current) return;
    if (layersRef.current.historical_pins) {
      mapRef.current.removeLayer(layersRef.current.historical_pins);
    }
    if (!enabledLayers.historical_pins || historicalPins.length === 0) return;

    const canvasRenderer = L.canvas({ padding: 0.5 });
    const layer = L.layerGroup();

    historicalPins.forEach((pin) => {
      if (!pin.lat || !pin.lng) return;

      const isDisease = pin.disease_risk;
      const isWatchList = pin.watch_list;
      const color = isDisease ? "#ea580c" : isWatchList ? "#8b5cf6" : "#9ca3af";

      // Canvas-rendered circle markers — no DOM element per pin
      const marker = L.circleMarker([pin.lat, pin.lng], {
        radius: isDisease ? 6 : isWatchList ? 5 : 4,
        fillColor: color,
        fillOpacity: 0.7,
        color: "#fff",
        weight: 1.5,
        renderer: canvasRenderer,
      });

      // Check if AI summary is a refusal message (don't show those)
      const isAiRefusal = (text: string | null | undefined): boolean => {
        if (!text) return false;
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

      // Get the best available note text - prefer original, skip AI refusals
      const getNoteText = (): string => {
        // If AI summary exists and is not a refusal, use it
        if (pin.ai_summary && !isAiRefusal(pin.ai_summary)) {
          return pin.ai_summary;
        }
        // Otherwise use original notes
        if (pin.notes) return pin.notes;
        return "No notes available";
      };
      const noteText = getNoteText();

      // Build nearest place info for popup
      const nearestInfo = pin.nearest_place_id && pin.nearest_place_distance_m !== null
        ? `<div style="font-size: 11px; color: #6b7280; margin-top: 8px; padding: 8px; background: #f0f9ff; border-radius: 4px; border: 1px solid #bae6fd;">
            📍 Nearest Atlas place: <strong>${Math.round(pin.nearest_place_distance_m)}m away</strong>
            ${pin.requires_unit_selection
              ? `<div style="color: #ea580c; font-size: 10px; margin-top: 4px;">🏢 Multi-unit building - unit selection required</div>`
              : ``
            }
            <div style="margin-top: 6px;">
              <a href="/admin/google-map-entries/${pin.id}/link"
                 style="display: inline-block; padding: 4px 10px; background: #3b82f6; color: white; text-decoration: none; border-radius: 4px; font-size: 11px; font-weight: 500;">
                ${pin.requires_unit_selection ? "Select Unit & Link" : "Link to Place"}
              </a>
            </div>
          </div>`
        : `<div style="font-size: 11px; color: #9ca3af; margin-top: 8px;">
            No nearby Atlas place found
          </div>`;

      marker.bindPopup(`
        <div style="min-width: 260px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
          <div style="font-weight: 600; font-size: 14px; margin-bottom: 8px;">${pin.name || "Historical Note"}</div>

          ${isDisease ? `
            <div style="background: #fef2f2; border: 1px solid #fecaca; padding: 6px 8px; margin-bottom: 8px; border-radius: 4px; color: #dc2626; font-size: 12px; font-weight: 600;">
              ⚠️ Disease Risk Mentioned
            </div>
          ` : ""}

          ${isWatchList && !isDisease ? `
            <div style="background: #f5f3ff; border: 1px solid #c4b5fd; padding: 6px 8px; margin-bottom: 8px; border-radius: 4px; color: #7c3aed; font-size: 12px; font-weight: 600;">
              👁️ Watch List
            </div>
          ` : ""}

          <div style="font-size: 12px; color: #374151; background: #f9fafb; padding: 8px; border-radius: 6px; max-height: 100px; overflow-y: auto;">
            ${noteText}
          </div>

          ${pin.parsed_date ? `
            <div style="font-size: 11px; color: #9ca3af; margin-top: 8px;">
              📅 Date: ${pin.parsed_date}
            </div>
          ` : ""}

          ${nearestInfo}

          <div style="font-size: 10px; color: #9ca3af; margin-top: 8px; padding-top: 8px; border-top: 1px solid #e5e7eb;">
            ⚪ Unlinked historical data from Google Maps
          </div>
        </div>
      `);

      layer.addLayer(marker);
    });

    layer.addTo(mapRef.current);
    layersRef.current.historical_pins = layer;
  }, [historicalPins, enabledLayers.historical_pins]);

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

  // Handle Atlas fuzzy search result selection
  const handleAtlasSearchSelect = (result: AtlasSearchResult) => {
    if (mapRef.current && result.metadata?.lat && result.metadata?.lng) {
      // Has coordinates — navigate on map and drop a marker (same as Google Places flow)
      setNavigatedLocation({
        lat: result.metadata.lat,
        lng: result.metadata.lng,
        address: result.display_name,
      });
      mapRef.current.setView([result.metadata.lat, result.metadata.lng], 16, { animate: true, duration: 0.5 });
    } else {
      // No coordinates — open the entity detail page
      const path = result.entity_type === "person" ? "/people"
        : result.entity_type === "cat" ? "/cats"
        : "/places";
      window.open(`${path}/${result.entity_id}`, "_blank");
    }
    setSearchQuery("");
    setShowSearchResults(false);
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
      zIndexOffset: 1000
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
            </div>`
          : `<div style="color: #6b7280; font-size: 12px; margin-bottom: 8px;">No Atlas data at this location yet</div>
            <div style="display: flex; gap: 8px; margin-top: 12px;">
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
            </div>`
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
        case "2":
          toggleLayer("historical_pins");
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Calculate total counts for display
  const totalMarkers = (enabledLayers.atlas_pins ? atlasPins.length : 0) +
    (enabledLayers.historical_pins ? historicalPins.length : 0) +
    (enabledLayers.places ? places.length : 0) +
    (enabledLayers.google_pins ? googlePins.length : 0) +
    (enabledLayers.tnr_priority ? tnrPriority.length : 0) +
    (enabledLayers.volunteers ? volunteers.length : 0) +
    (enabledLayers.clinic_clients ? clinicClients.length : 0) +
    (enabledLayers.historical_sources ? historicalSources.length : 0);

  return (
    <div style={{ position: "relative", height: "100dvh", width: "100%" }}>
      {/* Map container */}
      <div ref={mapContainerRef} style={{ height: "100%", width: "100%" }} />

      {/* Search bar - Google style */}
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
            placeholder={isMobile ? "Search..." : "Search addresses, pins, or volunteers... (press /)"}
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
              const count = layer.id === "atlas_pins" ? atlasPins.length :
                layer.id === "historical_pins" ? historicalPins.length : 0;

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
          {(enabledLayers.atlas_pins || enabledLayers.historical_pins || enabledLayers.google_pins || enabledLayers.tnr_priority || enabledLayers.historical_sources) && (
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

              {enabledLayers.historical_pins && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 500, marginBottom: 4 }}>Historical Context</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {[
                      { label: "Disease Mentioned", color: "#ea580c" },
                      { label: "Watch List", color: "#8b5cf6" },
                      { label: "General Note", color: "#9ca3af" },
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
                  <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 4 }}>
                    Small dots = unlinked Google Maps data
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
        <kbd style={{ background: "#f3f4f6", padding: "1px 4px", borderRadius: 3 }}>M</kbd> location
      </div>}

      {/* CSS animations are in atlas-map.css */}

      {/* Place Detail Drawer */}
      {selectedPlaceId && (
        <PlaceDetailDrawer
          placeId={selectedPlaceId}
          onClose={() => setSelectedPlaceId(null)}
          onWatchlistChange={fetchMapData}
        />
      )}
    </div>
  );
}
