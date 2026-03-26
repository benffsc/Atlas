"use client";

import { Suspense, useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import "@/styles/map.css";
import { useMapData } from "@/hooks/useMapData";
import { fetchApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { formatRelativeTime } from "@/lib/formatters";
import {
  createPinMarker,
  createCircleMarker,
  createStarMarker,
  createClinicMarker,
  createUserLocationMarker,
  createAtlasPinMarker,
  createReferencePinMarker,
  createAnnotationMarker,
} from "@/lib/map-markers";
import { useMapColors } from "@/hooks/useMapColors";
import { useGeoConfig } from "@/hooks/useGeoConfig";
import { MAP_Z_INDEX } from "@/lib/design-tokens";
import { MAP_COLORS } from "@/lib/map-colors";
import {
  buildPlacePopup,
  buildGooglePinPopup,
  buildTNRPriorityPopup,
  buildVolunteerPopup,
  buildClinicClientPopup,
  buildZonePopup,
  escapeHtml,
  PlaceDetailDrawer,
  AnnotationDetailDrawer,
  PersonDetailDrawer,
  CatDetailDrawer,
  PlacementPanel,
  MapLegend,
  MapControls,
  DateRangeFilter,
  LocationComparisonPanel,
  useMeasurement,
  formatDistance,
  PRIMARY_LAYER_CONFIGS,
  LEGACY_LAYER_CONFIGS,
  LAYER_CONFIGS,
  SERVICE_ZONES,
} from "@/components/map";
import type { BasemapType } from "@/components/map/components/MapControls";
import type { TextSearchResult } from "@/components/map/types";
import { decodePolyline } from "@/lib/polyline";
import { exportPinsToCsv, exportPinsToGeoJson } from "@/lib/map-export";
import {
  SYSTEM_VIEWS,
  loadCustomViews,
  addCustomView,
  deleteCustomView,
  viewToEnabledLayers,
  enabledLayersToList,
  type MapView,
} from "@/lib/map-views";
import { GroupedLayerControl, type LayerGroup } from "@/components/map/GroupedLayerControl";
import { useHeatmapLayer } from "@/components/map/hooks/useHeatmapLayer";
import type {
  Place,
  GooglePin,
  TnrPriorityPlace,
  Zone,
  Volunteer,
  TrapperTerritory,
  ClinicClient,
  HistoricalSource,
  DataCoverageZone,
  AtlasPin,
  MapSummary,
  PlacePrediction,
  AtlasSearchResult,
  NavigatedLocation,
  Annotation,
  RiskFilter,
  DataFilter,
} from "@/components/map";

// Inline SVG icons for context menu (14px, matches menu item text size)
const menuIconProps = { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const RulerMenuIcon = () => <svg {...menuIconProps}><path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.4 2.4 0 0 1 0-3.4l2.6-2.6a2.4 2.4 0 0 1 3.4 0z" /><path d="m14.5 12.5 2-2" /><path d="m11.5 9.5 2-2" /><path d="m8.5 6.5 2-2" /></svg>;
const DirectionsMenuIcon = () => <svg {...menuIconProps}><path d="M3 11l19-9-9 19-2-8-8-2z" /></svg>;
const StreetViewMenuIcon = () => <svg {...menuIconProps}><circle cx="12" cy="5" r="3" /><path d="M12 8v4" /><path d="M6.5 17.5C6.5 15 9 13 12 13s5.5 2 5.5 4.5" /></svg>;
const PlacePinMenuIcon = () => <svg {...menuIconProps}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>;
const NoteMenuIcon = () => <svg {...menuIconProps}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>;
const CopyMenuIcon = () => <svg {...menuIconProps}><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>;

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

// All type definitions and layer configs are now imported from @/components/map

/** Atlas sub-layer IDs — any of these being ON means atlas data is shown */
const ATLAS_SUB_LAYER_IDS = ["atlas_all", "atlas_disease", "atlas_watch", "atlas_needs_tnr", "atlas_needs_trapper"] as const;
/** Disease filter layer IDs */
const DISEASE_FILTER_IDS = ["dis_felv", "dis_fiv", "dis_ringworm", "dis_heartworm", "dis_panleuk"] as const;
/** Heatmap layer IDs — client-side only, use atlasPins data */
const HEATMAP_LAYER_IDS = ["heatmap_density", "heatmap_disease"] as const;

/** Grouped layer definitions for the full Atlas map */
const ATLAS_MAP_LAYER_GROUPS_BASE: LayerGroup[] = [
  {
    id: "atlas_data",
    label: "Atlas Data",
    icon: "\u{1F4CD}",
    color: MAP_COLORS.layers.places,
    defaultExpanded: true,
    exclusive: true,
    children: [
      { id: "atlas_all", label: "All Places", color: MAP_COLORS.layers.places, defaultEnabled: true },
      { id: "atlas_disease", label: "Disease Risk", color: MAP_COLORS.pinStyle.disease, defaultEnabled: false },
      { id: "atlas_watch", label: "Watch List", color: MAP_COLORS.pinStyle.watch_list, defaultEnabled: false },
      { id: "atlas_needs_tnr", label: "Needs TNR", color: MAP_COLORS.priority.critical, defaultEnabled: false },
      { id: "atlas_needs_trapper", label: "Needs Trapper", color: MAP_COLORS.priority.high, defaultEnabled: false },
    ],
  },
  {
    id: "disease_filter",
    label: "Disease Filter",
    icon: "\u{1F9A0}",
    color: MAP_COLORS.pinStyle.disease,
    defaultExpanded: true,
    children: [
      { id: "dis_felv", label: "FeLV", color: MAP_COLORS.disease.felv, defaultEnabled: false },
      { id: "dis_fiv", label: "FIV", color: MAP_COLORS.disease.fiv, defaultEnabled: false },
      { id: "dis_ringworm", label: "Ringworm", color: MAP_COLORS.disease.ringworm, defaultEnabled: false },
      { id: "dis_heartworm", label: "Heartworm", color: MAP_COLORS.disease.heartworm, defaultEnabled: false },
      { id: "dis_panleuk", label: "Panleukopenia", color: MAP_COLORS.disease.panleukopenia, defaultEnabled: false },
    ],
  },
  {
    id: "analytics",
    label: "Analytics",
    icon: "\u{1F525}",
    color: MAP_COLORS.priority.high,
    defaultExpanded: false,
    exclusive: true,
    children: [
      { id: "heatmap_density", label: "Cat Density Heatmap", color: "#f03b20", defaultEnabled: false },
      { id: "heatmap_disease", label: "Disease Heatmap", color: "#e31a1c", defaultEnabled: false },
    ],
  },
  {
    id: "operational",
    label: "Operational",
    icon: "\u{1F4CA}",
    color: MAP_COLORS.layers.zones,
    defaultExpanded: false,
    children: [
      { id: "zones", label: "Observation Zones", color: MAP_COLORS.layers.zones, defaultEnabled: false },
      { id: "volunteers", label: "Volunteers", color: "#FFD700", defaultEnabled: false },
      { id: "clinic_clients", label: "Clinic Clients", color: MAP_COLORS.layers.clinic_clients, defaultEnabled: false },
      { id: "trapper_territories", label: "Trapper Coverage", color: "#0ea5e9", defaultEnabled: false },
    ],
  },
  {
    id: "historical",
    label: "Historical",
    icon: "\u{1F4DC}",
    color: MAP_COLORS.layers.volunteers,
    defaultExpanded: false,
    children: [
      { id: "places", label: "Cat Locations", color: MAP_COLORS.layers.places, defaultEnabled: false },
      { id: "google_pins", label: "Google Pins", color: MAP_COLORS.layers.google_pins, defaultEnabled: false },
      { id: "tnr_priority", label: "TNR Priority", color: MAP_COLORS.layers.tnr_priority, defaultEnabled: false },
      { id: "historical_sources", label: "Historical Sources", color: MAP_COLORS.layers.historical_sources, defaultEnabled: false },
      { id: "data_coverage", label: "Data Coverage", color: MAP_COLORS.layers.data_coverage, defaultEnabled: false },
    ],
  },
];

function getAtlasDefaultEnabledLayers(): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const group of ATLAS_MAP_LAYER_GROUPS_BASE) {
    for (const child of group.children) {
      result[child.id] = child.defaultEnabled;
    }
  }
  for (const l of LEGACY_LAYER_CONFIGS) {
    result[l.id] = l.defaultEnabled;
  }
  return result;
}

function parseLayersParam(param: string | null): Record<string, boolean> | null {
  if (!param) return null;
  if (param === "none") {
    const defaults = getAtlasDefaultEnabledLayers();
    const result: Record<string, boolean> = {};
    for (const id of Object.keys(defaults)) result[id] = false;
    return result;
  }
  const ids = param.split(",").filter(Boolean);
  if (ids.length === 0) return null;
  const defaults = getAtlasDefaultEnabledLayers();
  const knownIds = new Set(Object.keys(defaults));
  const valid = ids.filter(id => knownIds.has(id));
  if (valid.length === 0) return null;
  const result: Record<string, boolean> = {};
  for (const id of Array.from(knownIds)) result[id] = false;
  for (const id of valid) result[id] = true;
  return result;
}

function serializeAtlasLayers(enabledLayers: Record<string, boolean>): string | null {
  const defaults = getAtlasDefaultEnabledLayers();
  const currentKeys = Object.keys(enabledLayers).filter(k => enabledLayers[k]).sort();
  const defaultKeys = Object.keys(defaults).filter(k => defaults[k]).sort();
  if (currentKeys.join(",") === defaultKeys.join(",")) return null;
  if (currentKeys.length === 0) return "none";
  return currentKeys.join(",");
}

function AtlasMapInner() {
  const { addToast } = useToast();
  const isMobile = useIsMobile();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
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
  const [basemap, setBasemap] = useState<BasemapType>("street");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectedZone, setSelectedZone] = useState("All Zones");
  const [dateFrom, setDateFrom] = useState<string | null>(null);
  const [dateTo, setDateTo] = useState<string | null>(null);
  const [enabledLayers, setEnabledLayers] = useState<Record<string, boolean>>(() => {
    const fromUrl = parseLayersParam(searchParams.get("layers"));
    if (fromUrl) return fromUrl;
    return Object.fromEntries(LAYER_CONFIGS.map(l => [l.id, l.defaultEnabled]));
  });

  // Admin-configurable map colors (falls back to hardcoded MAP_COLORS)
  const { colors } = useMapColors();
  const { mapCenter, mapZoom } = useGeoConfig();

  // Saved views
  const [customViews, setCustomViews] = useState<MapView[]>(() => loadCustomViews());
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const allLayerIds = useMemo(() => {
    const ids: string[] = [];
    for (const group of ATLAS_MAP_LAYER_GROUPS_BASE) {
      for (const child of group.children) ids.push(child.id);
    }
    for (const l of LEGACY_LAYER_CONFIGS) ids.push(l.id);
    return ids;
  }, []);

  const handleApplyView = useCallback((view: MapView) => {
    const newLayers = viewToEnabledLayers(view, allLayerIds);
    setEnabledLayers(newLayers);
    setActiveViewId(view.id);
    if (view.zone) setSelectedZone(view.zone);
    if (view.dateFrom !== undefined) setDateFrom(view.dateFrom);
    if (view.dateTo !== undefined) setDateTo(view.dateTo);
    if (view.zoom && view.center && mapRef.current) {
      mapRef.current.setView(view.center, view.zoom);
    }
    addToast({ type: "success", message: `View: ${view.name}` });
  }, [allLayerIds, addToast]);

  const handleSaveView = useCallback((name: string) => {
    const map = mapRef.current;
    const newView = addCustomView({
      name,
      layers: enabledLayersToList(enabledLayers),
      zoom: map?.getZoom(),
      center: map ? [map.getCenter().lat, map.getCenter().lng] : undefined,
      dateFrom,
      dateTo,
      zone: selectedZone !== "All Zones" ? selectedZone : undefined,
    });
    setCustomViews(loadCustomViews());
    setActiveViewId(newView.id);
    addToast({ type: "success", message: `Saved view: ${name}` });
  }, [enabledLayers, dateFrom, dateTo, selectedZone, addToast]);

  const handleDeleteView = useCallback((id: string) => {
    deleteCustomView(id);
    setCustomViews(loadCustomViews());
    if (activeViewId === id) setActiveViewId(null);
  }, [activeViewId]);

  // Clear active view indicator when user manually changes layers
  const prevLayersRef = useRef(enabledLayers);
  useEffect(() => {
    if (prevLayersRef.current !== enabledLayers && activeViewId) {
      // Check if layers still match the active view
      const view = [...SYSTEM_VIEWS, ...customViews].find(v => v.id === activeViewId);
      if (view) {
        const viewLayers = new Set(view.layers);
        const currentLayers = new Set(enabledLayersToList(enabledLayers));
        if (viewLayers.size !== currentLayers.size || ![...viewLayers].every(l => currentLayers.has(l))) {
          setActiveViewId(null);
        }
      }
    }
    prevLayersRef.current = enabledLayers;
  }, [enabledLayers, activeViewId, customViews]);

  // Sync layer state to URL
  useEffect(() => {
    const serialized = serializeAtlasLayers(enabledLayers);
    const params = new URLSearchParams(searchParams.toString());
    if (serialized) {
      params.set("layers", serialized);
    } else {
      params.delete("layers");
    }
    const newUrl = params.toString() ? `${pathname}?${params}` : pathname;
    const currentUrl = searchParams.toString() ? `${pathname}?${searchParams}` : pathname;
    if (newUrl !== currentUrl) {
      router.replace(newUrl, { scroll: false });
    }
  }, [enabledLayers, pathname, router, searchParams]);

  // Data - NEW simplified layers
  const [atlasPins, setAtlasPins] = useState<AtlasPin[]>([]);

  // Data - Legacy layers
  const [places, setPlaces] = useState<Place[]>([]);
  const [googlePins, setGooglePins] = useState<GooglePin[]>([]);
  const [tnrPriority, setTnrPriority] = useState<TnrPriorityPlace[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [volunteers, setVolunteers] = useState<Volunteer[]>([]);
  const [clinicClients, setClinicClients] = useState<ClinicClient[]>([]);
  const [trapperTerritories, setTrapperTerritories] = useState<TrapperTerritory[]>([]);
  const [historicalSources, setHistoricalSources] = useState<HistoricalSource[]>([]);
  const [dataCoverage, setDataCoverage] = useState<DataCoverageZone[]>([]);
  const [summary, setSummary] = useState<MapSummary | null>(null);

  // Derived filter values from enabledLayers (replaces old riskFilter/dataFilter/diseaseFilter state)
  const atlasLayerEnabled = useMemo(
    () => ATLAS_SUB_LAYER_IDS.some(id => enabledLayers[id]),
    [enabledLayers]
  );

  const riskFilter: RiskFilter = useMemo(() => {
    if (enabledLayers.atlas_disease) return "disease";
    if (enabledLayers.atlas_watch) return "watch_list";
    if (enabledLayers.atlas_needs_tnr) return "needs_tnr";
    if (enabledLayers.atlas_needs_trapper) return "needs_trapper";
    return "all";
  }, [enabledLayers]);

  const diseaseFilter: string[] = useMemo(() => {
    const active: string[] = [];
    if (enabledLayers.dis_felv) active.push("felv");
    if (enabledLayers.dis_fiv) active.push("fiv");
    if (enabledLayers.dis_ringworm) active.push("ringworm");
    if (enabledLayers.dis_heartworm) active.push("heartworm");
    if (enabledLayers.dis_panleuk) active.push("panleukopenia");
    return active;
  }, [enabledLayers]);

  const dataFilter: DataFilter = "all";

  const handleDateRangeChange = useCallback((from: string | null, to: string | null) => {
    setDateFrom(from);
    setDateTo(to);
  }, []);

  // Conditionally show disease filter group (only when Disease Risk sub-layer is active)
  const atlasMapLayerGroups = useMemo(() => {
    if (!enabledLayers.atlas_disease) {
      return ATLAS_MAP_LAYER_GROUPS_BASE.filter(g => g.id !== "disease_filter");
    }
    return ATLAS_MAP_LAYER_GROUPS_BASE;
  }, [enabledLayers.atlas_disease]);

  // Single-pass count computation for atlas sub-layers (avoids 10 separate .filter() calls)
  const atlasSubLayerCounts = useMemo(() => {
    const c = {
      atlas_all: atlasPins.length,
      atlas_disease: 0,
      atlas_watch: 0,
      atlas_needs_tnr: 0,
      atlas_needs_trapper: 0,
      dis_felv: 0,
      dis_fiv: 0,
      dis_ringworm: 0,
      dis_heartworm: 0,
      dis_panleuk: 0,
    };
    for (const p of atlasPins) {
      if (p.disease_risk) c.atlas_disease++;
      if (p.watch_list) c.atlas_watch++;
      if (p.cat_count > 0 && p.cat_count > p.total_altered) c.atlas_needs_tnr++;
      if (p.needs_trapper_count > 0) c.atlas_needs_trapper++;
      if (p.disease_badges) {
        for (const b of p.disease_badges) {
          if (b.disease_key === "felv") c.dis_felv++;
          else if (b.disease_key === "fiv") c.dis_fiv++;
          else if (b.disease_key === "ringworm") c.dis_ringworm++;
          else if (b.disease_key === "heartworm") c.dis_heartworm++;
          else if (b.disease_key === "panleukopenia") c.dis_panleuk++;
        }
      }
    }
    return c;
  }, [atlasPins]);

  // Show legacy layers toggle
  // showLegacyLayers removed — GroupedLayerControl handles expand/collapse internally

  // Search suggestions
  const [searchResults, setSearchResults] = useState<Array<{ type: string; item: Place | GooglePin | Volunteer; label: string }>>([]);
  const [atlasSearchResults, setAtlasSearchResults] = useState<AtlasSearchResult[]>([]);
  const [googleSuggestions, setGoogleSuggestions] = useState<PlacePrediction[]>([]);
  const [poiResults, setPoiResults] = useState<TextSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; lat: number; lng: number } | null>(null);
  const [navigatedLocation, setNavigatedLocation] = useState<NavigatedLocation | null>(null);
  const navigatedMarkerRef = useRef<L.Marker | null>(null);
  const atlasPinsRef = useRef<AtlasPin[]>([]);
  const leafletCjsRef = useRef<any>(null);

  // Stable cluster group refs — created once, cleared/refilled on data change (FFS-837)
  const atlasActiveClusterRef = useRef<any>(null);
  const atlasRefClusterRef = useRef<any>(null);
  const atlasCombinedLayerRef = useRef<L.LayerGroup | null>(null);

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

  // Annotations state (Annotation type imported from @/components/map)
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const annotationLayerRef = useRef<L.LayerGroup | null>(null);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);

  // Person and Cat drawer state
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [selectedCatId, setSelectedCatId] = useState<string | null>(null);

  // Location comparison state
  const [comparisonPlaceIds, setComparisonPlaceIds] = useState<string[]>([]);

  // Measurement tool state
  const [measureActive, setMeasureActive] = useState(false);

  // Route polyline state (for driving directions)
  const [routePolyline, setRoutePolyline] = useState<Array<{ lat: number; lng: number }> | null>(null);
  const routeLayerRef = useRef<L.Polyline | null>(null);

  const handleAddToComparison = useCallback((placeId: string) => {
    setComparisonPlaceIds(prev => {
      if (prev.includes(placeId) || prev.length >= 3) return prev;
      return [...prev, placeId];
    });
  }, []);

  const handleRemoveFromComparison = useCallback((placeId: string) => {
    setComparisonPlaceIds(prev => prev.filter(id => id !== placeId));
  }, []);

  const handleClearComparison = useCallback(() => {
    setComparisonPlaceIds([]);
    setRoutePolyline(null);
  }, []);

  // Measurement tool hook
  const measurement = useMeasurement({ mapRef, isActive: measureActive });

  // Heatmap layer hook — uses atlasPins data
  const heatmapEnabled = !!(enabledLayers.heatmap_density || enabledLayers.heatmap_disease);
  const heatmapMode = enabledLayers.heatmap_disease ? "disease" as const : "density" as const;
  useHeatmapLayer({
    map: mapRef.current,
    pins: atlasPins,
    enabled: heatmapEnabled,
    mode: heatmapMode,
  });

  // Measurement and addPointMode are mutually exclusive
  const handleMeasureToggle = useCallback(() => {
    setMeasureActive(prev => {
      if (!prev) {
        setAddPointMode(null);
        setPendingClick(null);
        setShowAddPointMenu(false);
      }
      return !prev;
    });
  }, []);

  // Route polyline rendering
  useEffect(() => {
    if (!mapRef.current) return;

    // Remove existing route
    if (routeLayerRef.current) {
      routeLayerRef.current.remove();
      routeLayerRef.current = null;
    }

    if (!routePolyline || routePolyline.length === 0) return;

    const polyline = L.polyline(
      routePolyline.map(p => [p.lat, p.lng] as L.LatLngExpression),
      { color: MAP_COLORS.layers.places, weight: 4, opacity: 0.8 }
    );
    polyline.addTo(mapRef.current);
    routeLayerRef.current = polyline;

    return () => {
      polyline.remove();
    };
  }, [routePolyline]);

  // Handle route polyline from directions
  const handleRoutePolyline = useCallback((points: Array<{ lat: number; lng: number }> | null) => {
    setRoutePolyline(points);
  }, []);

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
      fillColor: MAP_COLORS.layers.places,
      fillOpacity: 1,
      color: "white",
      weight: 2,
    }).addTo(miniMap);
    miniMap._miniMapConeMarker = coneMarker;

    // Add nearby atlas pins within ~300m
    const MINI_RADIUS = 0.003;
    for (const p of atlasPinsRef.current) {
      if (!p.lat || !p.lng) continue;
      const dLat = Math.abs(p.lat - conePos.lat);
      const dLng = Math.abs(p.lng - conePos.lng);
      if (dLat < MINI_RADIUS && dLng < MINI_RADIUS) {
        const dotColor = MAP_COLORS.pinStyle[p.pin_style as keyof typeof MAP_COLORS.pinStyle]
          ?? MAP_COLORS.pinStyle.minimal;
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

  // Escape key for street view fullscreen is now handled in the unified keyboard handler below

  // Invalidate map size when fullscreen toggles
  useEffect(() => {
    if (mapRef.current) {
      setTimeout(() => mapRef.current?.invalidateSize(), 350);
    }
  }, [streetViewFullscreen]);

  // Sync fullscreen state with browser fullscreen API
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  // Invalidate map size when entering/exiting fullscreen
  useEffect(() => {
    if (mapRef.current) {
      setTimeout(() => mapRef.current?.invalidateSize(), 350);
    }
  }, [isFullscreen]);

  const handleFullscreenToggle = useCallback(() => {
    if (!document.fullscreenElement) {
      const mapContainer = document.querySelector('.map-container');
      if (mapContainer) {
        mapContainer.requestFullscreen().catch(console.error);
      }
    } else {
      document.exitFullscreen().catch(console.error);
    }
  }, []);

  // Export handlers — export the currently visible atlasPins
  const activeFilterName = useMemo(() => {
    if (riskFilter !== "all") return riskFilter;
    if (diseaseFilter.length > 0) return diseaseFilter.join("_");
    return undefined;
  }, [riskFilter, diseaseFilter]);

  const handleExportCsv = useCallback(() => {
    exportPinsToCsv(atlasPins, activeFilterName);
  }, [atlasPins, activeFilterName]);

  const handleExportGeoJson = useCallback(() => {
    exportPinsToGeoJson(atlasPins, activeFilterName);
  }, [atlasPins, activeFilterName]);

  // Keep cone-only ref in sync with state
  useEffect(() => { streetViewConeOnlyRef.current = streetViewConeOnly; }, [streetViewConeOnly]);

  // Auto-collapse legend and layer panel when any drawer is open to reduce clutter
  const legendWasOpenRef = useRef<boolean | null>(null);
  useEffect(() => {
    const anyDrawerOpen = !!(selectedPlaceId || selectedCatId || selectedPersonId || selectedAnnotationId);
    if (anyDrawerOpen) {
      // Close layer panel when a drawer opens
      setShowLayerPanel(false);
      if (legendWasOpenRef.current === null) {
        legendWasOpenRef.current = showLegend;
        setShowLegend(false);
      }
    } else if (legendWasOpenRef.current !== null) {
      setShowLegend(legendWasOpenRef.current);
      legendWasOpenRef.current = null;
    }
  }, [selectedPlaceId, selectedCatId, selectedPersonId, selectedAnnotationId]);

  // Expose setSelectedPlaceId and street view globally for popup buttons + drawer
  useEffect(() => {
    (window as unknown as { atlasMapExpandPlace: (id: string) => void }).atlasMapExpandPlace = (id: string) => {
      setSelectedPlaceId(id);
    };
    // Open full bottom panel + cone (auto-close drawers to prevent overlap)
    (window as unknown as { atlasMapOpenStreetView: (lat: number, lng: number, address?: string) => void }).atlasMapOpenStreetView = (lat: number, lng: number, address?: string) => {
      setSelectedPlaceId(null);
      setSelectedPersonId(null);
      setSelectedCatId(null);
      setSelectedAnnotationId(null);
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

  // Fetch map data using SWR for caching and deduplication
  // Map atlas sub-layer IDs → "atlas_pins" API layer. Disease filter IDs are NOT API layers.
  const layers = useMemo(() => {
    const apiLayers = new Set<string>();
    for (const [id, enabled] of Object.entries(enabledLayers)) {
      if (!enabled) continue;
      if ((ATLAS_SUB_LAYER_IDS as readonly string[]).includes(id)) {
        apiLayers.add("atlas_pins");
      } else if ((DISEASE_FILTER_IDS as readonly string[]).includes(id)) {
        // Disease filter IDs are client-side only, not API layers
      } else if ((HEATMAP_LAYER_IDS as readonly string[]).includes(id)) {
        // Heatmap layers use atlasPins data — ensure it's fetched
        apiLayers.add("atlas_pins");
      } else {
        apiLayers.add(id);
      }
    }
    return Array.from(apiLayers);
  }, [enabledLayers]);

  // Read trapper filter from URL params for territory map highlighting
  const trapperFilter = searchParams.get("trapper") || undefined;

  const {
    data: mapData,
    error: mapError,
    isLoading: mapIsLoading,
    isValidating: mapIsValidating,
    mutate: refreshMapData,
  } = useMapData({
    layers,
    zone: selectedZone,
    riskFilter,
    dataFilter,
    diseaseFilter,
    trapper: enabledLayers.trapper_territories ? trapperFilter : undefined,
    fromDate: dateFrom || undefined,
    toDate: dateTo || undefined,
    enabled: layers.length > 0,
  });

  // Sync SWR data to component state (for compatibility with existing code)
  useEffect(() => {
    if (mapData) {
      setAtlasPins(mapData.atlas_pins || []);
      setPlaces(mapData.places || []);
      setGooglePins(mapData.google_pins || []);
      // Legacy layers: hook types don't match component types exactly
      // Cast through unknown since we know the API returns the correct shapes
      setTnrPriority((mapData.tnr_priority || []) as unknown as TnrPriorityPlace[]);
      setZones((mapData.zones || []) as unknown as Zone[]);
      setVolunteers((mapData.volunteers || []) as unknown as Volunteer[]);
      setClinicClients((mapData.clinic_clients || []) as unknown as ClinicClient[]);
      setTrapperTerritories((mapData.trapper_territories || []) as unknown as TrapperTerritory[]);
      setHistoricalSources((mapData.historical_sources || []) as unknown as HistoricalSource[]);
      setDataCoverage((mapData.data_coverage || []) as unknown as DataCoverageZone[]);
      setSummary(mapData.summary || null);
    } else if (layers.length === 0) {
      // Clear all layers when no layers enabled
      setAtlasPins([]);
      setPlaces([]);
      setGooglePins([]);
      setTnrPriority([]);
      setZones([]);
      setVolunteers([]);
      setClinicClients([]);
      setTrapperTerritories([]);
      setHistoricalSources([]);
      setDataCoverage([]);
    }
  }, [mapData, layers.length]);

  // Sync loading and error state from SWR
  useEffect(() => {
    setLoading(mapIsLoading);
    setError(mapError ? (mapError instanceof Error ? mapError.message : "Failed to load") : null);
  }, [mapIsLoading, mapError]);

  // Per-layer loading state: a layer is "loading" if enabled + validating + no data yet (FFS-838)
  const loadingLayers = useMemo(() => {
    const s = new Set<string>();
    if (!mapIsValidating) return s;
    // Atlas sub-layers: loading if validating + no pins yet
    if (atlasPins.length === 0) {
      for (const id of ATLAS_SUB_LAYER_IDS) {
        if (enabledLayers[id]) s.add(id);
      }
    }
    // Legacy layers: loading if validating + no data in that layer
    const legacyDataMap: Record<string, number> = {
      places: places.length,
      google_pins: googlePins.length,
      tnr_priority: tnrPriority.length,
      zones: zones.length,
      volunteers: volunteers.length,
      clinic_clients: clinicClients.length,
      trapper_territories: trapperTerritories.length,
      historical_sources: historicalSources.length,
      data_coverage: dataCoverage.length,
    };
    for (const [id, count] of Object.entries(legacyDataMap)) {
      if (enabledLayers[id] && count === 0) s.add(id);
    }
    return s;
  }, [mapIsValidating, enabledLayers, atlasPins.length, places.length,
      googlePins.length, tnrPriority.length, zones.length, volunteers.length,
      clinicClients.length, trapperTerritories.length,
      historicalSources.length, dataCoverage.length]);

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
    }).setView(mapCenter, mapZoom);

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
      atlasActiveClusterRef.current = null;
      atlasRefClusterRef.current = null;
      atlasCombinedLayerRef.current = null;
    };
  }, []);

  // Toggle basemap tile layer (street / google / satellite)
  useEffect(() => {
    if (!mapRef.current || !tileLayerRef.current) return;

    // Remove existing layers
    mapRef.current.removeLayer(tileLayerRef.current);
    if (labelsLayerRef.current) {
      mapRef.current.removeLayer(labelsLayerRef.current);
      labelsLayerRef.current = null;
    }

    if (basemap === "satellite") {
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
        pane: "overlayPane",
      });
      labelsTiles.addTo(mapRef.current);
      labelsTiles.setZIndex(1);
      labelsLayerRef.current = labelsTiles;
    } else if (basemap === "google") {
      // Google Maps tiles — includes POI labels naturally
      const googleTiles = L.tileLayer("https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}", {
        attribution: '&copy; Google Maps',
        maxZoom: 20,
      });
      googleTiles.addTo(mapRef.current);
      googleTiles.setZIndex(0);
      tileLayerRef.current = googleTiles;
    } else {
      // Street view — Carto Voyager (includes labels)
      const streetTiles = L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        maxZoom: 19,
      });
      streetTiles.addTo(mapRef.current);
      streetTiles.setZIndex(0);
      tileLayerRef.current = streetTiles;
    }
  }, [basemap]);

  // NOTE: SWR automatically handles fetching on mount and when dependencies change.
  // We intentionally do NOT refetch on pan/zoom. Loading all data once
  // and letting markercluster handle rendering provides much smoother navigation.
  // Viewport-based loading caused 20+ second reloads on every pan which was jarring.

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
      const color = colors.priority[place.priority as keyof typeof colors.priority] || colors.priority.unknown;
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
  }, [places, enabledLayers.places, colors]);

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

      const color = pin.display_color || colors.layers.google_pins;
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
  }, [googlePins, enabledLayers.google_pins, colors]);

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

      const color = colors.priority[place.tnr_priority as keyof typeof colors.priority] || colors.priority.unknown;
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
  }, [tnrPriority, enabledLayers.tnr_priority, colors]);

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
          const color = colors.layers.zones;
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
  }, [zones, enabledLayers.zones, colors]);

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

      const color = colors.volunteerRoles[vol.role as keyof typeof colors.volunteerRoles] || colors.layers.volunteers;

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
  }, [volunteers, enabledLayers.volunteers, colors]);

  // Update Trapper Territories layer (FFS-565)
  useEffect(() => {
    if (!mapRef.current) return;
    if (layersRef.current.trapper_territories) {
      mapRef.current.removeLayer(layersRef.current.trapper_territories);
    }
    if (!enabledLayers.trapper_territories || trapperTerritories.length === 0) return;

    const layer = L.layerGroup();

    // Color by trapper_type (spread from MAP_COLORS to get a mutable Record<string, string>)
    const typeColors: Record<string, string> = { ...MAP_COLORS.trapperType };

    // Size by service_type
    const typeSizes: Record<string, number> = {
      primary_territory: 24,
      regular: 18,
      occasional: 14,
      home_rescue: 16,
    };

    trapperTerritories.forEach((t) => {
      if (!t.lat || !t.lng) return;

      const color = typeColors[t.trapper_type] || MAP_COLORS.trapperType.unknown;
      const size = typeSizes[t.service_type] || 14;
      const isPrimary = t.service_type === "primary_territory";

      const marker = L.marker([t.lat, t.lng], {
        icon: isPrimary
          ? createPinMarker(color, { size })
          : createCircleMarker(color, { size }),
      });

      const availLabel = t.availability_status === "available" ? "Available"
        : t.availability_status === "busy" ? "Busy" : "On Leave";
      const availColor = t.availability_status === "available" ? MAP_COLORS.priority.managed
        : t.availability_status === "busy" ? MAP_COLORS.trapperType.community_trapper : MAP_COLORS.priority.unknown;

      const serviceLabel = t.service_type === "primary_territory" ? "Primary Territory"
        : t.service_type === "regular" ? "Regular"
        : t.service_type === "occasional" ? "Occasional"
        : t.service_type === "home_rescue" ? "Home Rescue"
        : t.service_type;

      marker.bindPopup(`
        <div style="min-width:180px">
          <strong><a href="/trappers/${escapeHtml(t.person_id)}" style="color:#0d6efd">${escapeHtml(t.trapper_name)}</a></strong>
          <div style="margin-top:4px;font-size:12px">
            <span style="display:inline-block;padding:1px 6px;border-radius:3px;background:${color}20;color:${color};font-weight:500">${serviceLabel}</span>
            <span style="display:inline-block;padding:1px 6px;border-radius:3px;color:${availColor};font-weight:500;margin-left:4px">${availLabel}</span>
          </div>
          <div style="margin-top:4px;font-size:11px;color:#666">
            ${escapeHtml(t.place_name)}
          </div>
          <div style="margin-top:2px;font-size:11px;color:#888">
            ${t.active_assignments} active assignment${t.active_assignments !== 1 ? "s" : ""}
            ${t.tier ? ` · ${escapeHtml(t.tier)}` : ""}
          </div>
        </div>
      `);

      layer.addLayer(marker);
    });

    layer.addTo(mapRef.current);
    layersRef.current.trapper_territories = layer;
  }, [trapperTerritories, enabledLayers.trapper_territories]);

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
        icon: createClinicMarker(colors.layers.clinic_clients, { size: 14 }),
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
  }, [clinicClients, enabledLayers.clinic_clients, colors]);

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

      const color = source.display_color || MAP_COLORS.layers.volunteers;
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
      rich: MAP_COLORS.coverage.rich,
      moderate: MAP_COLORS.coverage.moderate,
      sparse: MAP_COLORS.coverage.sparse,
      gap: MAP_COLORS.coverage.gap,
    };

    // For now, add a text marker at the map center showing coverage summary
    // In the future, this could use actual zone polygons
    dataCoverage.forEach((zone) => {
      const color = coverageColors[zone.coverage_level] || MAP_COLORS.priority.unknown;
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
          const color = coverageColors[zone.coverage_level] || MAP_COLORS.priority.unknown;
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
  // Atlas Pins layer — stable cluster groups, batch adds (FFS-837)
  // Cluster groups are created ONCE and reused. On data change we
  // clearLayers() + addLayers(batch) instead of destroy/recreate.
  // =========================================================================
  useEffect(() => {
    if (!mapRef.current || !leafletCjsRef.current) return;

    // When atlas is disabled: remove combined layer from map, clear markers, but keep refs alive
    if (!atlasLayerEnabled) {
      if (atlasCombinedLayerRef.current && mapRef.current.hasLayer(atlasCombinedLayerRef.current)) {
        mapRef.current.removeLayer(atlasCombinedLayerRef.current);
      }
      if (atlasActiveClusterRef.current) atlasActiveClusterRef.current.clearLayers();
      if (atlasRefClusterRef.current) atlasRefClusterRef.current.clearLayers();
      delete layersRef.current.atlas_pins;
      return;
    }

    if (atlasPins.length === 0) {
      if (atlasActiveClusterRef.current) atlasActiveClusterRef.current.clearLayers();
      if (atlasRefClusterRef.current) atlasRefClusterRef.current.clearLayers();
      return;
    }

    // Lazy-create cluster groups once — stable iconCreateFunction closures
    if (!atlasActiveClusterRef.current) {
      atlasActiveClusterRef.current = leafletCjsRef.current.markerClusterGroup({
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

          let clusterColor = MAP_COLORS.layers.places;
          let badge = "";
          if (diseaseRatio > 0.5) {
            clusterColor = MAP_COLORS.pinStyle.disease;
          } else if (watchRatio > 0.5) {
            clusterColor = MAP_COLORS.pinStyle.watch_list;
          } else if (diseaseCount > 0) {
            badge = `<div style="position:absolute;top:-4px;right:-4px;width:18px;height:18px;background:${MAP_COLORS.pinStyle.disease};border-radius:50%;border:2px solid white;color:white;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;">${diseaseCount}</div>`;
          } else if (watchCount > 0) {
            badge = `<div style="position:absolute;top:-4px;right:-4px;width:18px;height:18px;background:${MAP_COLORS.pinStyle.watch_list};border-radius:50%;border:2px solid white;color:white;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;">${watchCount}</div>`;
          }

          return L.divIcon({
            html: `<div style="position:relative;"><div class="map-cluster map-cluster--${sizeClass}" style="--cluster-color: ${clusterColor}">${count}</div>${badge}</div>`,
            className: "map-cluster-icon",
            iconSize: L.point(dim, dim),
          });
        },
      });
    }

    if (!atlasRefClusterRef.current) {
      atlasRefClusterRef.current = leafletCjsRef.current.markerClusterGroup({
        maxClusterRadius: 80,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true,
        disableClusteringAtZoom: 17,
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
    }

    const activeCluster = atlasActiveClusterRef.current;
    const refCluster = atlasRefClusterRef.current;

    // Clear existing markers (O(n) internal grid reset)
    activeCluster.clearLayers();
    refCluster.clearLayers();

    // Build marker arrays for batch add
    const activeMarkers: L.Marker[] = [];
    const refMarkers: L.Marker[] = [];

    atlasPins.forEach((pin) => {
      if (!pin.lat || !pin.lng) return;

      // Reference tier: smaller, muted pins → separate cluster layer
      if (pin.pin_tier === "reference") {
        const refColor = pin.pin_style === "has_history" ? MAP_COLORS.pinStyle.has_history : MAP_COLORS.pinStyle.minimal;
        const marker = L.marker([pin.lat, pin.lng], {
          icon: createReferencePinMarker(refColor, { size: 18, pinStyle: pin.pin_style }),
          diseaseRisk: pin.disease_risk,
          watchList: pin.watch_list,
        });
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

        const refPopup = `<div class="map-popup" style="min-width:220px;padding:12px;">
          <div class="map-popup__title" style="font-size:13px;margin-bottom:4px;">${pin.display_name || pin.address}</div>
          ${pin.display_name && pin.address ? `<div class="map-popup__meta" style="font-size:11px;margin-bottom:6px;">${pin.address}</div>` : ""}
          <div class="map-popup__meta" style="font-size:11px;margin-bottom:4px;">${dataSummary}</div>
          ${peopleNames}
          ${gmSnippet}
          <div class="map-popup__actions" style="margin-top:8px;">
            <button onclick="window.atlasMapExpandPlace('${pin.id}')" class="map-popup__btn map-popup__btn--primary" style="padding:4px 10px;font-size:11px;">Details</button>
            <button onclick="window.open('https://www.google.com/maps/@${pin.lat},${pin.lng},3a,75y,90t/data=!3m6!1e1!3m4!1s!2e0!7i16384!8i8192','_blank')" class="map-popup__btn map-popup__btn--street-view" style="padding:4px 10px;font-size:11px;">Street View</button>
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
        refMarkers.push(marker);
        return;
      }

      // Active tier: full-size teardrop pins
      // Determine pin color based on style - Google Maps-like color palette
      let color: string;
      let size: number;

      switch (pin.pin_style) {
        case "disease":
          color = MAP_COLORS.pinStyle.disease;
          size = 32;
          break;
        case "watch_list":
          color = MAP_COLORS.pinStyle.watch_list;
          size = 30;
          break;
        case "active":
          color = MAP_COLORS.pinStyle.active;
          size = 28;
          break;
        case "active_requests":
          color = MAP_COLORS.pinStyle.active_requests;
          size = 26;
          break;
        case "has_history":
          color = MAP_COLORS.pinStyle.has_history;
          size = 26;
          break;
        default:
          color = MAP_COLORS.pinStyle.default;
          size = 24;
      }

      // Check if any people at this pin have volunteer/staff roles
      const hasVolunteerOrStaff = Array.isArray(pin.people) && pin.people.some(
        (p: { roles: string[]; is_staff: boolean }) =>
          p.is_staff || (p.roles && p.roles.some((r: string) => ['trapper', 'foster', 'staff', 'caretaker'].includes(r)))
      );

      // Build disease badge data for sub-icons
      // Filter out historical badges AND badges where last positive test was >36 months ago
      const diseaseBadges = Array.isArray(pin.disease_badges)
        ? pin.disease_badges
            .filter((b: { status: string; last_positive: string | null }) => {
              if (b.status === 'historical') return false;
              if (b.last_positive) {
                const monthsAgo = (Date.now() - new Date(b.last_positive).getTime()) / (1000 * 60 * 60 * 24 * 30);
                if (monthsAgo > 36) return false;
              }
              return true;
            })
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
      });

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

      // Last alteration time for popup
      const lastAlterationLabel = pin.last_alteration_at ? formatRelativeTime(pin.last_alteration_at) : null;

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
              ✓ ${pin.total_altered} cats altered${lastAlterationLabel ? ` · Last: ${lastAlterationLabel}` : ''}
            </div>
          ` : ""}

          ${pin.needs_trapper_count > 0 ? `
            <div style="background: #fff7ed; border: 1px solid #fed7aa; padding: 6px 8px; margin-top: 8px; border-radius: 6px; font-size: 12px; color: #c2410c; font-weight: 500;">
              ${pin.needs_trapper_count} ${pin.needs_trapper_count === 1 ? 'request needs' : 'requests need'} trapper
            </div>
          ` : ""}

          <div class="map-popup__actions" style="margin-top: 12px;">
            <button onclick="window.atlasMapExpandPlace('${pin.id}')" class="map-popup__btn map-popup__btn--secondary" style="padding: 8px; font-size: 12px;">
              Details
            </button>
            <button onclick="window.atlasMapOpenStreetView(${pin.lat}, ${pin.lng}, '${escapeHtml(pin.address).replace(/'/g, "\\'")}')" class="map-popup__btn map-popup__btn--street-view" style="padding: 8px; font-size: 12px;">
              Street View
            </button>
            <a href="/places/${pin.id}" target="_blank" class="map-popup__btn map-popup__btn--primary" style="padding: 8px; font-size: 12px;">
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

      activeMarkers.push(marker);
    });

    // Batch add markers to cluster groups (uses chunkedLoading internally)
    activeCluster.addLayers(activeMarkers);
    refCluster.addLayers(refMarkers);

    // Create or reuse combined layer group, ensure it's on the map
    if (!atlasCombinedLayerRef.current) {
      atlasCombinedLayerRef.current = L.layerGroup([activeCluster, refCluster]);
    }
    if (!mapRef.current.hasLayer(atlasCombinedLayerRef.current)) {
      atlasCombinedLayerRef.current.addTo(mapRef.current);
    }
    layersRef.current.atlas_pins = atlasCombinedLayerRef.current;
  }, [atlasPins, atlasLayerEnabled]);

  // Search: local instant filtering
  const searchAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
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

  // Search: parallel remote (Atlas + Google Autocomplete + Text Search) — single debounced effect
  useEffect(() => {
    if (searchQuery.length < 3) {
      setAtlasSearchResults([]);
      setGoogleSuggestions([]);
      setPoiResults([]);
      setSearchLoading(false);
      return;
    }

    setSearchLoading(true);
    const timer = setTimeout(async () => {
      searchAbortRef.current?.abort();
      const controller = new AbortController();
      searchAbortRef.current = controller;

      const isLikelyAddress = /^\d/.test(searchQuery.trim());

      try {
        const results = await Promise.allSettled([
          fetchApi<{ suggestions?: AtlasSearchResult[] }>(
            `/api/search?q=${encodeURIComponent(searchQuery)}&limit=8&suggestions=true`,
            { signal: controller.signal }
          ),
          fetchApi<{ predictions?: PlacePrediction[] }>(
            `/api/places/autocomplete?input=${encodeURIComponent(searchQuery)}`,
            { signal: controller.signal }
          ),
          isLikelyAddress
            ? Promise.resolve(null)
            : fetchApi<{ results?: TextSearchResult[] }>(
                `/api/places/text-search?query=${encodeURIComponent(searchQuery)}`,
                { signal: controller.signal }
              ),
        ]);

        if (controller.signal.aborted) return;

        const atlasData = results[0].status === "fulfilled" ? results[0].value : null;
        const googleData = results[1].status === "fulfilled" ? results[1].value : null;
        const textData = results[2].status === "fulfilled" ? results[2].value : null;

        const newAtlas = atlasData?.suggestions || [];
        const newGoogle = googleData?.predictions || [];
        let newPoi: TextSearchResult[] = textData?.results || [];

        // Only show Google address suggestions if <3 Atlas results
        const showGoogle = newAtlas.length < 3;

        // Deduplicate POI results that match autocomplete place_ids
        if (newPoi.length > 0 && newGoogle.length > 0) {
          const ids = new Set(newGoogle.map(s => s.place_id));
          newPoi = newPoi.filter(r => !ids.has(r.place_id));
        }

        setAtlasSearchResults(newAtlas);
        setGoogleSuggestions(showGoogle ? newGoogle : []);
        setPoiResults(newPoi);
        setSearchLoading(false);
      } catch {
        if (!controller.signal.aborted) setSearchLoading(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [searchQuery]);

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
        const data = await fetchApi<{
          coordinates?: { lat: number; lng: number };
          associated_places?: { place_id: string }[];
          places?: { place_id: string }[];
        }>(`/api/${apiPath}/${result.entity_id}`);
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
      } catch {
        /* optional: entity coordinate lookup failed, proceed without location */
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
      const data = await fetchApi<{
        place?: { geometry?: { location?: { lat: number; lng: number } }; formatted_address?: string };
      }>(`/api/places/details?place_id=${prediction.place_id}`);
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
    } catch (err) {
      console.error("Failed to get place details:", err);
    }
    setSearchQuery("");
    setShowSearchResults(false);
  };

  // Handle POI/business search result selection — navigate to location
  const handlePoiSelect = (result: TextSearchResult) => {
    const { lat, lng } = result.geometry.location;
    setNavigatedLocation({ lat, lng, address: result.formatted_address });
    if (mapRef.current) {
      mapRef.current.setView([lat, lng], 16, { animate: true, duration: 0.5 });
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
            <div class="map-popup__actions" style="margin-top: 12px; flex-wrap: wrap;">
              <button onclick="window.atlasMapExpandPlace('${matchingPin!.id}')" class="map-popup__btn map-popup__btn--success" style="padding: 6px 12px; font-size: 12px;">
                View Details
              </button>
              <a href="/places/${matchingPin!.id}" target="_blank" class="map-popup__btn map-popup__btn--secondary" style="padding: 6px 12px; font-size: 12px;">
                Open Page
              </a>
              <button onclick="window.atlasMapOpenStreetView(${navigatedLocation.lat}, ${navigatedLocation.lng}, '${navigatedLocation.address.replace(/'/g, "\\'")}')" class="map-popup__btn map-popup__btn--street-view" style="padding: 6px 12px; font-size: 12px;">
                Street View
              </button>
              <button onclick="window.dispatchEvent(new CustomEvent('clear-navigated-location'))" class="map-popup__btn map-popup__btn--tertiary" style="padding: 6px 12px; font-size: 12px;">
                Clear
              </button>
            </div>
            ${nearbyHtml}`
          : `<div class="map-popup__meta" style="font-size: 12px; margin-bottom: 8px;">No Atlas data at this location yet</div>
            <div class="map-popup__actions" style="margin-top: 12px; flex-wrap: wrap;">
              <a href="/intake/new?address=${encodeURIComponent(navigatedLocation.address)}" class="map-popup__btn map-popup__btn--primary" style="padding: 6px 12px; font-size: 12px;">
                + Create Request
              </a>
              <button onclick="window.atlasMapOpenStreetView(${navigatedLocation.lat}, ${navigatedLocation.lng}, '${navigatedLocation.address.replace(/'/g, "\\'")}')" class="map-popup__btn map-popup__btn--street-view" style="padding: 6px 12px; font-size: 12px;">
                Street View
              </button>
              <button onclick="window.dispatchEvent(new CustomEvent('clear-navigated-location'))" class="map-popup__btn map-popup__btn--tertiary" style="padding: 6px 12px; font-size: 12px;">
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

  const toggleLayer = useCallback((layerId: string) => {
    setEnabledLayers(prev => {
      const next = { ...prev };

      // Find which group this layer belongs to
      const group = ATLAS_MAP_LAYER_GROUPS_BASE.find(g =>
        g.children.some(c => c.id === layerId)
      );

      if (group?.exclusive) {
        // Radio behavior: turn off siblings, toggle this one
        const wasOn = !!prev[layerId];
        for (const child of group.children) {
          next[child.id] = false;
        }
        // Clear disease filters when leaving Disease Risk
        // (unless we're turning ON atlas_disease for the first time)
        if (layerId !== 'atlas_disease' || wasOn) {
          for (const disId of DISEASE_FILTER_IDS) {
            next[disId] = false;
          }
        }
        // Only turn on if it wasn't already on (allow deselecting all)
        if (!wasOn) next[layerId] = true;
      } else {
        // Checkbox behavior
        next[layerId] = !prev[layerId];
      }

      return next;
    });
  }, []);

  // My Location functionality
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [locatingUser, setLocatingUser] = useState(false);
  const userMarkerRef = useRef<L.Marker | null>(null);

  const handleMyLocation = () => {
    if (!navigator.geolocation) {
      addToast({ type: "error", message: "Geolocation is not supported by your browser" });
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
        addToast({ type: "error", message: `Unable to get location: ${error.message}` });
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
          // Escape cascade: highest-priority UI element closes first
          if (contextMenu) {
            setContextMenu(null);
          } else if (streetViewFullscreenRef.current) {
            setStreetViewFullscreen(false);
          } else if (streetViewCoordsRef.current && !streetViewConeOnlyRef.current) {
            setStreetViewCoords(null);
            setStreetViewFullscreen(false);
          } else if (selectedCatId) {
            setSelectedCatId(null);
          } else if (selectedPersonId) {
            setSelectedPersonId(null);
          } else if (selectedAnnotationId) {
            setSelectedAnnotationId(null);
          } else if (selectedPlaceId) {
            setSelectedPlaceId(null);
            setDrawerFromAddPoint(false);
          } else if (measureActive) {
            setMeasureActive(false);
          } else if (addPointMode) {
            setAddPointMode(null);
            setPendingClick(null);
            setShowAddPointMenu(false);
          } else {
            setShowSearchResults(false);
            setShowLayerPanel(false);
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
          toggleLayer("atlas_all");
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
        case "d":
        case "D":
          handleMeasureToggle();
          break;
        case "f":
        case "F":
          handleFullscreenToggle();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [addPointMode, measureActive, selectedPlaceId, selectedPersonId, selectedCatId, selectedAnnotationId, contextMenu, handleFullscreenToggle, handleMeasureToggle]);

  // Add Point mode / Measurement mode: map click handler and cursor
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;
    const container = map.getContainer();

    if (!addPointMode && !measureActive) return;

    container.style.cursor = 'crosshair';

    const handleMapClick = (e: L.LeafletMouseEvent) => {
      if (measureActive) {
        measurement.addPoint({ lat: e.latlng.lat, lng: e.latlng.lng });
      } else if (addPointMode) {
        setPendingClick({ lat: e.latlng.lat, lng: e.latlng.lng });
      }
    };

    map.on('click', handleMapClick);
    return () => {
      map.off('click', handleMapClick);
      container.style.cursor = '';
    };
  }, [addPointMode, measureActive, measurement]);

  // Street View click-to-navigate: clicking the map repositions street view
  const streetViewCoordsRef = useRef(streetViewCoords);
  const streetViewFullscreenRef = useRef(streetViewFullscreen);
  useEffect(() => { streetViewCoordsRef.current = streetViewCoords; }, [streetViewCoords]);
  useEffect(() => { streetViewFullscreenRef.current = streetViewFullscreen; }, [streetViewFullscreen]);

  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;

    const handleSvClick = (e: L.LeafletMouseEvent) => {
      // Only reposition when street view panel is active (not fullscreen, not cone-only, not add-point mode)
      if (!streetViewCoordsRef.current || streetViewFullscreenRef.current || streetViewConeOnlyRef.current || addPointMode) return;
      const { lat, lng } = e.latlng;
      // Send set-position to iframe for smooth repositioning
      streetViewIframeRef.current?.contentWindow?.postMessage({ type: "set-position", lat, lng }, "*");
      // Update cone marker position immediately
      if (streetViewMarkerRef.current) {
        streetViewMarkerRef.current.setLatLng([lat, lng]);
      }
      streetViewConePosRef.current = { lat, lng };
    };

    map.on('click', handleSvClick);
    return () => { map.off('click', handleSvClick); };
  }, [addPointMode]);

  // Set crosshair cursor when street view panel is active (not fullscreen/cone-only)
  useEffect(() => {
    if (!mapRef.current) return;
    const container = mapRef.current.getContainer();
    const svPanelActive = streetViewCoords && !streetViewFullscreen && !streetViewConeOnly && !addPointMode;
    if (svPanelActive) {
      container.style.cursor = 'crosshair';
      return () => { container.style.cursor = ''; };
    }
  }, [streetViewCoords, streetViewFullscreen, streetViewConeOnly, addPointMode]);

  // Right-click context menu
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;

    const handleContextMenu = (e: L.LeafletMouseEvent) => {
      e.originalEvent.preventDefault();
      const containerPoint = map.latLngToContainerPoint(e.latlng);
      setContextMenu({
        x: containerPoint.x,
        y: containerPoint.y,
        lat: e.latlng.lat,
        lng: e.latlng.lng,
      });
    };

    const closeContextMenu = () => setContextMenu(null);

    map.on('contextmenu', handleContextMenu);
    map.on('click', closeContextMenu);
    map.on('movestart', closeContextMenu);

    return () => {
      map.off('contextmenu', handleContextMenu);
      map.off('click', closeContextMenu);
      map.off('movestart', closeContextMenu);
    };
  }, []);

  // Context menu actions
  const handleContextMeasure = useCallback(() => {
    if (!contextMenu) return;
    setMeasureActive(true);
    setAddPointMode(null);
    setPendingClick(null);
    setShowAddPointMenu(false);
    // Use setTimeout to let the measurement hook activate first
    setTimeout(() => {
      measurement.addPoint({ lat: contextMenu.lat, lng: contextMenu.lng });
    }, 50);
    setContextMenu(null);
  }, [contextMenu, measurement]);

  const handleContextAddPlace = useCallback(() => {
    if (!contextMenu) return;
    setAddPointMode("place");
    setMeasureActive(false);
    setPendingClick({ lat: contextMenu.lat, lng: contextMenu.lng });
    setContextMenu(null);
  }, [contextMenu]);

  const handleContextAddNote = useCallback(() => {
    if (!contextMenu) return;
    setAddPointMode("annotation");
    setMeasureActive(false);
    setPendingClick({ lat: contextMenu.lat, lng: contextMenu.lng });
    setContextMenu(null);
  }, [contextMenu]);

  const handleContextDirections = useCallback(() => {
    if (!contextMenu) return;
    const url = `https://www.google.com/maps/dir/?api=1&destination=${contextMenu.lat},${contextMenu.lng}`;
    window.open(url, '_blank');
    setContextMenu(null);
  }, [contextMenu]);

  const handleContextStreetView = useCallback(() => {
    if (!contextMenu) return;
    setStreetViewCoords({ lat: contextMenu.lat, lng: contextMenu.lng });
    setStreetViewFullscreen(false);
    setStreetViewConeOnly(false);
    setContextMenu(null);
  }, [contextMenu]);

  const handleContextCopyCoords = useCallback(() => {
    if (!contextMenu) return;
    const text = `${contextMenu.lat.toFixed(6)}, ${contextMenu.lng.toFixed(6)}`;
    navigator.clipboard.writeText(text).then(() => {
      addToast({ type: "success", message: `Copied: ${text}` });
    });
    setContextMenu(null);
  }, [contextMenu, addToast]);

  // Annotations: fetch and render
  const fetchAnnotations = useCallback(async () => {
    try {
      const data = await fetchApi<{ annotations?: Annotation[] }>('/api/annotations');
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
        <div class="map-popup" style="min-width:200px;max-width:280px;padding:12px;">
          <div class="map-popup__title" style="font-size:14px;margin-bottom:4px;">${escapeHtml(ann.label)}</div>
          <div class="map-popup__badge map-popup__badge--low" style="font-size:10px;margin-bottom:6px;">${typeLabel}</div>
          ${ann.note ? `<div class="map-popup__meta" style="font-size:12px;margin-top:4px;">${escapeHtml(ann.note)}</div>` : ''}
          ${photoHtml}
          ${expiryText}
          <div class="map-popup__actions" style="margin-top:8px;">
            <button onclick="window.__openAnnotationDrawer__&&window.__openAnnotationDrawer__('${ann.annotation_id}')" class="map-popup__btn map-popup__btn--secondary" style="padding:4px 8px;font-size:11px;">Details</button>
            <button onclick="fetch('/api/annotations/${ann.annotation_id}',{method:'DELETE'}).then(()=>window.location.reload())" class="map-popup__btn map-popup__btn--danger" style="padding:4px 8px;font-size:11px;">Delete</button>
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
  const totalMarkers = (atlasLayerEnabled ? atlasPins.length : 0) +
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
    <div
      className={`map-container${streetViewCoords && !streetViewConeOnly && !streetViewFullscreen ? " map-sv-active" : ""}`}
      style={{ position: "relative", height: "100dvh", width: "100%", display: "flex", flexDirection: "column" }}
    >
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
          zIndex: MAP_Z_INDEX.searchBox,
        }}>
          <button
            onClick={() => { setStreetViewCoords(null); setStreetViewFullscreen(false); searchInputRef.current?.focus(); }}
            style={{
              background: "var(--background)",
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
              color: "var(--text-secondary)",
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
        zIndex: MAP_Z_INDEX.searchBox,
        width: "100%",
        maxWidth: 600,
        padding: "0 16px",
      }}>
        <div style={{
          background: "var(--background)",
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
              color: "var(--text-secondary)",
              fontWeight: 700,
              fontSize: 14,
              flexShrink: 0,
              padding: "4px 8px 4px 4px",
              borderRadius: 6,
              transition: "background 0.15s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-secondary)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <span style={{ fontSize: 16, lineHeight: 1 }}>←</span>
            <img src="/logo.png" alt="" style={{ height: 22, width: "auto" }} />
            {!isMobile && <span>Atlas</span>}
          </a>
          <span style={{ width: 1, height: 20, background: "var(--bg-secondary)", marginRight: 10, flexShrink: 0 }} />
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
        {showSearchResults && (searchResults.length > 0 || atlasSearchResults.length > 0 || poiResults.length > 0 || googleSuggestions.length > 0 || searchLoading || (searchQuery.length >= 3 && !searchLoading)) && (
          <div style={{
            background: "var(--background)",
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
                  color: "var(--text-secondary)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  background: "var(--section-bg)",
                  borderBottom: "1px solid var(--border)",
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
                      borderBottom: "1px solid var(--border-default)",
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--healthy-bg)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "var(--background)")}
                  >
                    <span style={{ fontSize: 16 }}>
                      {result.type === "place" ? "🐱" : result.type === "google_pin" ? "📍" : "⭐"}
                    </span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 500, fontSize: 14 }}>{result.label}</div>
                      <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
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
                        style={{ background: "none", border: "none", cursor: "pointer", padding: "4px 6px", fontSize: 14, color: "var(--text-secondary)", borderRadius: 4 }}
                        title="Street View"
                        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--warning-text)")}
                        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-secondary)")}
                      >
                        📷
                      </button>
                    )}
                    <span style={{ fontSize: 10, color: MAP_COLORS.layers.zones, fontWeight: 500 }}>LOADED</span>
                  </div>
                ))}

                {/* Fuzzy search results from API (places, people, etc.) — deduplicated by entity_id (FFS-483) */}
                {atlasSearchResults.filter((r, i, arr) => !searchResults.some(sr => sr.label === r.display_name) && arr.findIndex(a => a.entity_id === r.entity_id) === i).map((result, i) => (
                  <div
                    key={`atlas-${i}`}
                    onClick={() => handleAtlasSearchSelect(result)}
                    style={{
                      padding: "12px 16px",
                      cursor: "pointer",
                      borderBottom: "1px solid var(--border-default)",
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--info-bg)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "var(--background)")}
                  >
                    <span style={{ fontSize: 16 }}>
                      {result.entity_type === "person" ? "👤" : result.entity_type === "cat" ? "🐱" : "📍"}
                    </span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 500, fontSize: 14 }}>{result.display_name}</div>
                      {result.subtitle && (
                        <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{result.subtitle}</div>
                      )}
                    </div>
                    {result.metadata?.lat && result.metadata?.lng && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setStreetViewCoords({ lat: result.metadata!.lat!, lng: result.metadata!.lng!, address: result.display_name });
                          setSearchQuery("");
                        }}
                        style={{ background: "none", border: "none", cursor: "pointer", padding: "4px 6px", fontSize: 14, color: "var(--text-secondary)", borderRadius: 4 }}
                        title="Street View"
                        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--warning-text)")}
                        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-secondary)")}
                      >
                        📷
                      </button>
                    )}
                    <span style={{
                      fontSize: 10,
                      color: result.metadata?.lat ? "var(--primary)" : "var(--text-tertiary)",
                      fontWeight: 500,
                    }}>
                      {result.entity_type === "person" ? "PERSON" : result.entity_type === "cat" ? "CAT" : "PLACE"}
                      {!result.metadata?.lat && " (detail)"}
                    </span>
                  </div>
                ))}
              </>
            )}

            {/* Nearby Places (POI/Business) Section */}
            {poiResults.length > 0 && (
              <>
                <div style={{
                  padding: "8px 16px 4px",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--text-secondary)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  background: "var(--section-bg)",
                  borderBottom: "1px solid var(--border)",
                  marginTop: searchResults.length > 0 || atlasSearchResults.length > 0 ? 8 : 0,
                }}>
                  Nearby Places
                </div>
                {poiResults.map((result, i) => (
                  <div
                    key={`poi-${i}`}
                    onClick={() => handlePoiSelect(result)}
                    style={{
                      padding: "12px 16px",
                      cursor: "pointer",
                      borderBottom: "1px solid var(--border-default)",
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--info-bg)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "var(--background)")}
                  >
                    <span style={{ fontSize: 16 }}>🏪</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 500, fontSize: 14 }}>{result.name}</div>
                      <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{result.formatted_address}</div>
                    </div>
                    <span style={{ fontSize: 10, color: MAP_COLORS.layers.places, fontWeight: 500 }}>PLACE</span>
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
                  color: "var(--text-secondary)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  background: "var(--section-bg)",
                  borderBottom: "1px solid var(--border)",
                  marginTop: searchResults.length > 0 || atlasSearchResults.length > 0 || poiResults.length > 0 ? 8 : 0,
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
                      borderBottom: i < googleSuggestions.length - 1 ? "1px solid var(--border-default)" : "none",
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--warning-bg)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "var(--background)")}
                  >
                    <span style={{ fontSize: 16 }}>📍</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 500, fontSize: 14 }}>{suggestion.structured_formatting.main_text}</div>
                      <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{suggestion.structured_formatting.secondary_text}</div>
                    </div>
                    <span style={{ fontSize: 10, color: MAP_COLORS.trapperType.community_trapper, fontWeight: 500 }}>GOOGLE</span>
                  </div>
                ))}
              </>
            )}

            {/* Loading skeleton */}
            {searchLoading && (
              <div style={{ padding: "4px 0" }}>
                {[1, 2, 3].map((n) => (
                  <div key={n} style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ width: 24, height: 24, borderRadius: "50%", background: "var(--border-default)", animation: "map-shimmer 1.5s infinite linear", backgroundSize: "200% 100%", backgroundImage: "linear-gradient(90deg, var(--border-default) 25%, var(--bg-secondary) 50%, var(--border-default) 75%)" }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ height: 14, width: "70%", borderRadius: 4, background: "var(--border-default)", marginBottom: 4, animation: "map-shimmer 1.5s infinite linear", backgroundSize: "200% 100%", backgroundImage: "linear-gradient(90deg, var(--border-default) 25%, var(--bg-secondary) 50%, var(--border-default) 75%)" }} />
                      <div style={{ height: 10, width: "45%", borderRadius: 4, background: "var(--border-default)", animation: "map-shimmer 1.5s infinite linear", backgroundSize: "200% 100%", backgroundImage: "linear-gradient(90deg, var(--border-default) 25%, var(--bg-secondary) 50%, var(--border-default) 75%)" }} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* No results message */}
            {searchQuery.length >= 3 && !searchLoading && searchResults.length === 0 && atlasSearchResults.length === 0 && googleSuggestions.length === 0 && poiResults.length === 0 && (
              <div style={{ padding: "16px", textAlign: "center", color: "var(--text-secondary)" }}>
                <div style={{ fontSize: 14, marginBottom: 4 }}>No matches found</div>
                <div style={{ fontSize: 12 }}>Try a different search term</div>
              </div>
            )}
          </div>
        )}
      </div>
      )}

      {/* Measurement floating panel */}
      {measureActive && (
        <div className="map-measure-panel">
          <span className="map-measure-panel__distance">
            {measurement.points.length >= 2 ? formatDistance(measurement.totalDistance) : "Click to measure"}
          </span>
          <span className="map-measure-panel__info">
            {measurement.points.length} point{measurement.points.length !== 1 ? "s" : ""}
          </span>
          {measurement.points.length > 0 && (
            <>
              <button className="map-measure-panel__btn" onClick={measurement.undoLastPoint}>Undo</button>
              <button className="map-measure-panel__btn map-measure-panel__btn--danger" onClick={measurement.clearMeasurement}>Clear</button>
            </>
          )}
        </div>
      )}

      {/* Date range filter (hidden during Street View) */}
      {!streetViewCoords && (
        <DateRangeFilter
          fromDate={dateFrom}
          toDate={dateTo}
          onDateRangeChange={handleDateRangeChange}
        />
      )}

      {/* Right side controls */}
      <MapControls
        isMobile={isMobile}
        showLayerPanel={showLayerPanel}
        onToggleLayerPanel={() => setShowLayerPanel(!showLayerPanel)}
        addPointMode={addPointMode}
        onAddPointModeChange={(mode) => {
          setAddPointMode(mode);
          if (mode === null) setPendingClick(null);
          if (mode) setMeasureActive(false);
        }}
        showAddPointMenu={showAddPointMenu}
        onShowAddPointMenuChange={setShowAddPointMenu}
        locatingUser={locatingUser}
        onMyLocation={handleMyLocation}
        basemap={basemap}
        onBasemapChange={setBasemap}
        measureActive={measureActive}
        onMeasureToggle={handleMeasureToggle}
        isFullscreen={isFullscreen}
        onFullscreenToggle={handleFullscreenToggle}
        onZoomIn={() => mapRef.current?.zoomIn()}
        onZoomOut={() => mapRef.current?.zoomOut()}
        onExportCsv={handleExportCsv}
        onExportGeoJson={handleExportGeoJson}
        exportPinCount={atlasPins.length}
      />

      {/* Layer panel */}
      {showLayerPanel && (
        <div className={isMobile ? "map-layer-panel--mobile" : "map-layer-panel"}>
          <div className="map-layer-panel__header">
            <div className="map-layer-panel__title">Map Layers</div>
            <div className="map-layer-panel__subtitle">
              {totalMarkers.toLocaleString()} markers shown
            </div>
          </div>

          {/* Saved Views */}
          <div className="map-layer-panel__views">
            <div className="map-layer-panel__zone-label">Quick Views</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
              {SYSTEM_VIEWS.map((view) => (
                <button
                  key={view.id}
                  onClick={() => handleApplyView(view)}
                  className="map-view-chip"
                  data-active={activeViewId === view.id || undefined}
                >
                  {view.name}
                </button>
              ))}
            </div>
            {customViews.length > 0 && (
              <>
                <div className="map-layer-panel__zone-label" style={{ marginTop: 4 }}>My Views</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
                  {customViews.map((view) => (
                    <span key={view.id} style={{ display: "inline-flex", alignItems: "center", gap: 0 }}>
                      <button
                        onClick={() => handleApplyView(view)}
                        className="map-view-chip"
                        data-active={activeViewId === view.id || undefined}
                      >
                        {view.name}
                      </button>
                      <button
                        onClick={() => handleDeleteView(view.id)}
                        className="map-view-chip-delete"
                        title="Delete view"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              </>
            )}
            <button
              onClick={() => {
                const name = window.prompt("View name:");
                if (name?.trim()) handleSaveView(name.trim());
              }}
              className="map-view-save-btn"
            >
              + Save Current View
            </button>
          </div>

          {/* Zone filter */}
          <div className="map-layer-panel__zone">
            <div className="map-layer-panel__zone-label">
              Service Zone
            </div>
            <select
              value={selectedZone}
              onChange={(e) => setSelectedZone(e.target.value)}
              className="map-layer-panel__zone-select"
            >
              {SERVICE_ZONES.map((z) => (
                <option key={z} value={z}>{z}</option>
              ))}
            </select>
          </div>

          {/* Layer toggles — GroupedLayerControl */}
          <div className="map-layer-panel__layers">
            <GroupedLayerControl
              groups={atlasMapLayerGroups}
              enabledLayers={enabledLayers}
              onToggleLayer={toggleLayer}
              loadingLayers={loadingLayers}
              inline
              counts={{
                ...atlasSubLayerCounts,
                places: places.length,
                google_pins: googlePins.length,
                tnr_priority: tnrPriority.length,
                zones: zones.length,
                volunteers: volunteers.length,
                clinic_clients: clinicClients.length,
                historical_sources: historicalSources.length,
                data_coverage: dataCoverage.length,
              }}
            />
          </div>

          {/* Legend */}
          {(atlasLayerEnabled || enabledLayers.google_pins || enabledLayers.tnr_priority || enabledLayers.historical_sources) && (
            <div style={{ padding: 16, borderTop: "1px solid var(--border)" }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 8 }}>
                Legend
              </div>

              {atlasLayerEnabled && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 500, marginBottom: 4 }}>Atlas Data Pins</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {[
                      { label: "Disease Risk", color: MAP_COLORS.pinStyle.disease },
                      { label: "Watch List", color: MAP_COLORS.pinStyle.watch_list },
                      { label: "Active Colony", color: MAP_COLORS.pinStyle.active },
                      { label: "Has History", color: MAP_COLORS.pinStyle.has_history },
                      { label: "Minimal Data", color: MAP_COLORS.pinStyle.default },
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
                      { label: "Disease Risk", color: MAP_COLORS.classification.disease_risk },
                      { label: "Watch List", color: MAP_COLORS.classification.watch_list },
                      { label: "Volunteer", color: MAP_COLORS.classification.volunteer },
                      { label: "Active Colony", color: MAP_COLORS.classification.active_colony },
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
                      { label: "Critical", color: MAP_COLORS.priority.critical },
                      { label: "High", color: MAP_COLORS.priority.high },
                      { label: "Medium", color: MAP_COLORS.priority.medium },
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
                      { label: "Hoarding", color: MAP_COLORS.layers.volunteers },
                      { label: "Breeding Crisis", color: MAP_COLORS.priority.critical },
                      { label: "Disease Outbreak", color: MAP_COLORS.annotationType.hazard },
                      { label: "Resolved", color: MAP_COLORS.layers.zones },
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
                  <div style={{ fontSize: 10, color: "var(--text-tertiary)", marginTop: 6 }}>
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
          zIndex: MAP_Z_INDEX.statsBar,
          background: "var(--background)",
          borderRadius: 12,
          boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
          padding: "10px 16px",
          display: "flex",
          gap: 24,
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-secondary)" }}>
              {summary.total_places.toLocaleString()}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>Total Places</div>
          </div>
          <div style={{ borderLeft: "1px solid var(--border-default)", paddingLeft: 24 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-secondary)" }}>
              {summary.total_cats.toLocaleString()}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>Cats Linked</div>
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
          zIndex: MAP_Z_INDEX.notification,
          background: "var(--primary)",
          color: "var(--primary-foreground)",
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
          background: "var(--danger-bg)",
          color: "var(--danger-text)",
          padding: "16px 24px",
          borderRadius: 12,
          zIndex: MAP_Z_INDEX.notification,
        }}>
          {error}
        </div>
      )}

      {/* Right-click context menu */}
      {contextMenu && (
        <div
          className="map-context-menu"
          style={{
            position: "absolute",
            left: contextMenu.x,
            top: contextMenu.y,
            zIndex: MAP_Z_INDEX.controls + 10,
          }}
        >
          <div className="map-context-menu__coords">
            {contextMenu.lat.toFixed(5)}, {contextMenu.lng.toFixed(5)}
          </div>
          <button className="map-context-menu__item" onClick={handleContextMeasure}>
            <RulerMenuIcon /> Measure from here
          </button>
          <button className="map-context-menu__item" onClick={handleContextDirections}>
            <DirectionsMenuIcon /> Directions to here
          </button>
          <button className="map-context-menu__item" onClick={handleContextStreetView}>
            <StreetViewMenuIcon /> Street View
          </button>
          <div className="map-context-menu__divider" />
          <button className="map-context-menu__item" onClick={handleContextAddPlace}>
            <PlacePinMenuIcon /> Add place here
          </button>
          <button className="map-context-menu__item" onClick={handleContextAddNote}>
            <NoteMenuIcon /> Add note here
          </button>
          <div className="map-context-menu__divider" />
          <button className="map-context-menu__item" onClick={handleContextCopyCoords}>
            <CopyMenuIcon /> Copy coordinates
          </button>
        </div>
      )}

      {/* Keyboard shortcuts help — hidden on mobile (no keyboard) */}
      {!isMobile && <div style={{
        position: "absolute",
        bottom: 24,
        right: 16,
        zIndex: MAP_Z_INDEX.keyboardHelp,
        background: "rgba(255,255,255,0.9)",
        borderRadius: 6,
        boxShadow: "0 1px 4px rgba(0,0,0,0.1)",
        padding: "6px 10px",
        fontSize: 10,
        color: "var(--text-tertiary)",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}>
        <kbd style={{ background: "var(--bg-secondary)", padding: "1px 4px", borderRadius: 3 }}>/</kbd> search
        <span style={{ margin: "0 6px" }}>·</span>
        <kbd style={{ background: "var(--bg-secondary)", padding: "1px 4px", borderRadius: 3 }}>L</kbd> layers
        <span style={{ margin: "0 6px" }}>·</span>
        <kbd style={{ background: "var(--bg-secondary)", padding: "1px 4px", borderRadius: 3 }}>A</kbd> add point
        <span style={{ margin: "0 6px" }}>·</span>
        <kbd style={{ background: "var(--bg-secondary)", padding: "1px 4px", borderRadius: 3 }}>D</kbd> measure
        <span style={{ margin: "0 6px" }}>·</span>
        <kbd style={{ background: "var(--bg-secondary)", padding: "1px 4px", borderRadius: 3 }}>M</kbd> location
        <span style={{ margin: "0 6px" }}>·</span>
        <kbd style={{ background: "var(--bg-secondary)", padding: "1px 4px", borderRadius: 3 }}>F</kbd> fullscreen
      </div>}

      {/* Map Legend */}
      <MapLegend
        showLegend={showLegend}
        onToggle={() => setShowLegend(prev => !prev)}
        isMobile={isMobile}
        colors={colors}
      />

      {/* Location Comparison Panel */}
      <LocationComparisonPanel
        placeIds={comparisonPlaceIds}
        onRemovePlace={handleRemoveFromComparison}
        onClear={handleClearComparison}
        onRoutePolyline={handleRoutePolyline}
      />

      {/* CSS animations are in map.css */}

      {/* Street View Panel (hidden in cone-only mode — drawer handles the panorama) */}
      {streetViewCoords && streetViewUrl && !streetViewConeOnly && (
        <div className={`street-view-panel${streetViewFullscreen ? " fullscreen" : ""}`}>
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
                style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                {streetViewFullscreen ? (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 1 1 1 1 6" /><polyline points="10 15 15 15 15 10" />
                    <polyline points="15 1 10 1 10 6" /><polyline points="1 15 6 15 6 10" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="5 1 1 1 1 5" /><line x1="1" y1="1" x2="5.5" y2="5.5" />
                    <polyline points="11 15 15 15 15 11" /><line x1="15" y1="15" x2="10.5" y2="10.5" />
                    <polyline points="15 1 11 1 11 5" /><line x1="15" y1="1" x2="10.5" y2="5.5" />
                    <polyline points="1 15 5 15 5 11" /><line x1="1" y1="15" x2="5.5" y2="10.5" />
                  </svg>
                )}
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
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
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
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
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
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15" /></svg>
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
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
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
          onWatchlistChange={refreshMapData}
          showQuickActions={drawerFromAddPoint}
          shifted={!!(selectedPersonId || selectedCatId)}
          coordinates={(() => {
            const pin = atlasPins.find(p => p.id === selectedPlaceId) ||
                        places.find(p => p.id === selectedPlaceId);
            return pin?.lat && pin?.lng ? { lat: pin.lat, lng: pin.lng } : undefined;
          })()}
          onAddToComparison={handleAddToComparison}
          comparisonCount={comparisonPlaceIds.length}
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

export default function AtlasMap() {
  return (
    <Suspense fallback={<div style={{ height: "100dvh" }} />}>
      <AtlasMapInner />
    </Suspense>
  );
}
