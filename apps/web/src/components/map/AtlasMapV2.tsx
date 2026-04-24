"use client";

import { useEffect, useState, useCallback, useRef, useMemo, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { APIProvider, Map, AdvancedMarker, AdvancedMarkerAnchorPoint, InfoWindow, useMap, CollisionBehavior } from "@vis.gl/react-google-maps";
import { useMapData } from "@/hooks/useMapData";
import { useMapColors } from "@/hooks/useMapColors";
import { useMapPinConfig } from "@/hooks/useMapPinConfig";
import { useGeoConfig } from "@/hooks/useGeoConfig";
import { useToast } from "@/components/feedback/Toast";
import { fetchApi } from "@/lib/api-client";
import { MAP_COLORS } from "@/lib/map-colors";
import { useMapLayers, ATLAS_MAP_LAYER_GROUPS_BASE } from "@/components/map/hooks/useMapLayers";
import { useMapViews } from "@/components/map/hooks/useMapViews";
import { useMapExport } from "@/components/map/hooks/useMapExport";
import { useMapSearchV2 } from "@/components/map/hooks/useMapSearchV2";
import { useMapClustering, isCluster } from "@/components/map/hooks/useMapClustering";
import { useImperativeMarkers } from "@/components/map/hooks/useImperativeMarkers";
import { MapControls } from "@/components/map/components/MapControls";
import { MeasurementPanel } from "@/components/map/components/MeasurementPanel";
import { SavedViewsPanel } from "@/components/map/components/SavedViewsPanel";
import { SearchResultsPanel } from "@/components/map/components/SearchResultsPanel";
import { MapContextMenu } from "@/components/map/components/MapContextMenu";
import { BottomSheet } from "@/components/map/components/BottomSheet";
import { BulkActionBar } from "@/components/map/components/BulkActionBar";
import { MapInfoWindowContent } from "@/components/map/components/MapInfoWindowContent";
// MapStatsBar removed — stats integrated into sidebar (FFS-1375)
import { MapErrorBoundary } from "@/components/map/components/MapErrorBoundary";
import { StreetViewPanel } from "@/components/map/components/StreetViewPanel";
import { MapPinKey } from "@/components/map/components/MapPinKey";
import { GroupedLayerControl, type PinKeyConfig } from "@/components/map/GroupedLayerControl";
import {
  PlaceDetailDrawer,
  PersonDetailDrawer,
  CatDetailDrawer,
  AnnotationDetailDrawer,
  PlacementPanel,
  DateRangeFilter,
  LocationComparisonPanel,
  SERVICE_ZONES,
} from "@/components/map";
import { formatDistance } from "@/components/map/hooks/useMeasurement";
import { GooglePinMarkers, PlaceMarkers, VolunteerMarkers, ClinicClientMarkers, TrapperTerritoryMarkers } from "@/components/map/components/LayerMarkers";
import { ZoneBoundaries } from "@/components/map/components/ZoneBoundaries";
import { useMapUrlState, readMapInitialUrlState } from "@/components/map/hooks/useMapUrlState";
import { useMapLayout } from "@/components/map/layout/MapLayoutContext";
import { MapTimeSlider } from "@/components/map/components/MapTimeSlider";
import type { BasemapType } from "@/components/map/components/MapControls";
import type {
  AtlasPin,
  Place,
  GooglePin,
  Zone,
  Volunteer,
  TrapperTerritory,
  ClinicClient,
  MapSummary,
  Annotation,
} from "@/components/map";
import { MAP_Z_INDEX } from "@/lib/design-tokens";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/**
 * Renders children into a portal target if it exists, otherwise renders inline.
 * Used by MapShell layout — if portal targets aren't present (e.g. Beacon),
 * everything falls back to current inline rendering.
 */
function PortalOrInline({ portalId, children, fallback }: { portalId: string; children: ReactNode; fallback?: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(() => {
    if (typeof document === "undefined") return null;
    return document.getElementById(portalId);
  });

  useEffect(() => {
    // Re-check after mount in case layout rendered after this component
    const el = document.getElementById(portalId);
    if (el !== target) setTarget(el);
  }, [portalId, target]);

  if (target) return createPortal(children, target);
  return <>{fallback ?? children}</>;
}

/** Haversine distance in meters */
function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/** Quantize zoom to bands: 8, 11, 14, 16. Prevents re-renders on every fractional zoom change. */
function quantizeZoom(zoom: number): number {
  if (zoom >= 16) return 16;
  if (zoom >= 14) return 14;
  if (zoom >= 11) return 11;
  return 8;
}

// ---------------------------------------------------------------------------
// Inner map component (inside APIProvider)
// ---------------------------------------------------------------------------

/**
 * Props that customize the map's behavior. All optional — defaults match
 * the staff-ops Atlas experience used at /map. Beacon and other product
 * surfaces pass `analystMode` and friends to opt into analyst-first defaults.
 */
export interface AtlasMapV2Props {
  /** When true, applies analyst-friendly defaults (Beacon framing). */
  analystMode?: boolean;
}

function AtlasMapV2Inner({ analystMode = false }: AtlasMapV2Props) {
  const { addToast } = useToast();
  const isMobile = useIsMobile();
  const { sidebarOpen, toggleSidebar } = useMapLayout();
  const map = useMap();
  const { mapCenter, mapZoom } = useGeoConfig();
  const { colors } = useMapColors();
  const { pinConfig } = useMapPinConfig();

  // Pin key for layer panel legend (derived from admin-configurable pinConfig)
  const pinKey = useMemo<PinKeyConfig>(() => ({
    colors: [
      { color: pinConfig.colors.disease || "#dc2626", label: pinConfig.labels.disease || "Disease Risk", shape: "teardrop" as const },
      { color: pinConfig.colors.watch_list || "#d97706", label: pinConfig.labels.watch_list || "Watch List", shape: "teardrop" as const },
      { color: pinConfig.colors.active || "#3b82f6", label: pinConfig.labels.active || "Verified Cats", shape: "teardrop" as const },
      { color: pinConfig.colors.active_requests || "#3b82f6", label: pinConfig.labels.active_requests || "Active Requests", shape: "teardrop" as const },
      { color: pinConfig.colors.reference || "#94a3b8", label: pinConfig.labels.reference || "Reference", shape: "circle" as const },
    ],
    statusDots: [
      { color: pinConfig.statusDots.disease || "#dc2626", label: "Disease at location" },
      { color: pinConfig.statusDots.needs_trapper || "#f97316", label: "Needs trapper" },
      { color: pinConfig.statusDots.has_volunteer || "#7c3aed", label: "Has volunteer / staff" },
    ],
    sizes: [
      { label: "Large", detail: `${pinConfig.sizes.hotspot}px — 10+ cats, disease, 2+ requests` },
      { label: "Medium", detail: `${pinConfig.sizes.active}px — active places` },
      { label: "Small", detail: `${pinConfig.sizes.reference}px — reference (zoom 14+)` },
    ],
  }), [pinConfig]);

  // ── Core state ──
  const [loading, setLoading] = useState(true);
  const [showLayerPanel, setShowLayerPanel] = useState(false);
  const [basemap, setBasemap] = useState<BasemapType>("street");
  const [selectedZone, setSelectedZone] = useState("All Zones");

  // Read initial date + viewport state from URL once on mount (FFS-1178)
  const initialUrlState = useMemo(() => readMapInitialUrlState(), []);
  const [dateFrom, setDateFrom] = useState<string | null>(initialUrlState.dateFrom);
  const [dateTo, setDateTo] = useState<string | null>(initialUrlState.dateTo);
  // Time slider visible by default in analystMode, toggleable elsewhere
  const [showTimeSlider, setShowTimeSlider] = useState<boolean>(analystMode);

  // ── URL-synced drawer state (Phase 3) ──
  const {
    selectedPlaceId, setSelectedPlaceId,
    selectedPersonId, setSelectedPersonId,
    selectedCatId, setSelectedCatId,
    selectedAnnotationId, setSelectedAnnotationId,
    syncDatesToUrl, syncViewportToUrl,
  } = useMapUrlState();
  const [selectedPin, setSelectedPin] = useState<AtlasPin | null>(null);
  const [comparisonPlaceIds, setComparisonPlaceIds] = useState<string[]>([]);

  // ── Add Point state (Step 5/12) ──
  const [addPointMode, setAddPointMode] = useState<"place" | "annotation" | null>(null);
  const [pendingClick, setPendingClick] = useState<{ lat: number; lng: number } | null>(null);
  const [showAddPointMenu, setShowAddPointMenu] = useState(false);

  // ── Measurement state (Step 6) ──
  const [measureActive, setMeasureActive] = useState(false);
  const [measurePoints, setMeasurePoints] = useState<Array<{ lat: number; lng: number }>>([]);

  // ── Street View state (Step 7) ──
  const [streetViewCoords, setStreetViewCoords] = useState<{ lat: number; lng: number; address?: string } | null>(null);
  const [streetViewFullscreen, setStreetViewFullscreen] = useState(false);
  const [streetViewConeOnly, setStreetViewConeOnly] = useState(false);
  const streetViewConeOnlyRef = useRef(false);
  const streetViewCoordsRef = useRef(streetViewCoords);
  const streetViewFullscreenRef = useRef(streetViewFullscreen);
  // panoramaRef / panoramaContainerRef removed — StreetViewPanel manages its own panorama
  const [streetViewHeading, setStreetViewHeading] = useState(0);

  // ── Bulk selection state (Step 10) ──
  const [bulkSelectedPlaceIds, setBulkSelectedPlaceIds] = useState<Set<string>>(new Set());

  // ── Route polyline state (Step 9) ──
  const [routePolyline, setRoutePolyline] = useState<Array<{ lat: number; lng: number }> | null>(null);

  // ── Annotations state (Step 13) ──
  const [annotations, setAnnotations] = useState<Annotation[]>([]);

  // ── Clustering state (Step 11) ──
  const [mapBounds, setMapBounds] = useState<{ west: number; south: number; east: number; north: number } | null>(null);
  const [mapZoomLevel, setMapZoomLevel] = useState(initialUrlState.zoom ?? mapZoom);

  // ── Fullscreen state ──
  const [isFullscreen, setIsFullscreen] = useState(false);

  // ── Locating user state ──
  const [locatingUser, setLocatingUser] = useState(false);

  // ── Data arrays ──
  const [atlasPins, setAtlasPins] = useState<AtlasPin[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [googlePins, setGooglePins] = useState<GooglePin[]>([]);
  const [volunteers, setVolunteers] = useState<Volunteer[]>([]);
  const [clinicClients, setClinicClients] = useState<ClinicClient[]>([]);
  const [trapperTerritories, setTrapperTerritories] = useState<TrapperTerritory[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [summary, setSummary] = useState<MapSummary | null>(null);

  const atlasPinsRef = useRef<AtlasPin[]>([]);
  useEffect(() => { atlasPinsRef.current = atlasPins; }, [atlasPins]);

  // Keep refs in sync
  useEffect(() => { streetViewConeOnlyRef.current = streetViewConeOnly; }, [streetViewConeOnly]);
  useEffect(() => { streetViewCoordsRef.current = streetViewCoords; }, [streetViewCoords]);
  useEffect(() => { streetViewFullscreenRef.current = streetViewFullscreen; }, [streetViewFullscreen]);

  // ── Extracted hooks ──
  const {
    enabledLayers, setEnabledLayers, toggleLayer,
    atlasLayerEnabled, riskFilter, diseaseFilter, dataFilter,
    atlasMapLayerGroups, atlasSubLayerCounts,
    apiLayers: layers, heatmapEnabled, heatmapMode,
  } = useMapLayers({ atlasPins });

  const { customViews, activeViewId, handleApplyView, handleSaveView, handleDeleteView } = useMapViews({
    mapRef: { current: map } as React.MutableRefObject<any>,
    enabledLayers, setEnabledLayers, setSelectedZone, setDateFrom, setDateTo,
    dateFrom, dateTo, selectedZone, atlasMapLayerGroupsBase: ATLAS_MAP_LAYER_GROUPS_BASE,
  });

  const { handleExportCsv, handleExportGeoJson } = useMapExport({ atlasPins, riskFilter, diseaseFilter });

  const handleDateRangeChange = useCallback((from: string | null, to: string | null) => {
    setDateFrom(from);
    setDateTo(to);
    syncDatesToUrl(from, to);
  }, [syncDatesToUrl]);

  // Viewport URL sync — listen to map 'idle' and write center/zoom (debounced by Google's
  // idle event, which only fires after pan/zoom settles).
  useEffect(() => {
    if (!map) return;
    const listener = map.addListener("idle", () => {
      const c = map.getCenter();
      const z = map.getZoom();
      if (c && z != null) {
        syncViewportToUrl({ lat: c.lat(), lng: c.lng() }, z);
      }
    });
    return () => { google.maps.event.removeListener(listener); };
  }, [map, syncViewportToUrl]);

  // ── SWR data fetch ──
  const { data: mapData, isLoading: mapIsLoading, mutate: refreshMapData } = useMapData({
    layers, zone: selectedZone, riskFilter, dataFilter, diseaseFilter,
    fromDate: dateFrom || undefined, toDate: dateTo || undefined,
    enabled: layers.length > 0,
  });

  useEffect(() => {
    if (mapData) {
      setAtlasPins(mapData.atlas_pins || []);
      setPlaces(mapData.places || []);
      setGooglePins(mapData.google_pins || []);
      setVolunteers((mapData.volunteers || []) as unknown as Volunteer[]);
      setClinicClients((mapData.clinic_clients || []) as unknown as ClinicClient[]);
      setTrapperTerritories((mapData.trapper_territories || []) as unknown as TrapperTerritory[]);
      setZones((mapData.zones || []) as unknown as Zone[]);
      setSummary(mapData.summary || null);
    }
    setLoading(mapIsLoading);
  }, [mapData, mapIsLoading]);

  // ── Search (Step 1) ──
  const searchInputRef = useRef<HTMLInputElement>(null);

  const dismissAllSelection = useCallback(() => {
    setSelectedPin(null);
    setSelectedPlaceId(null);
    setSelectedPersonId(null);
    setSelectedCatId(null);
    setSelectedAnnotationId(null);
  }, [setSelectedPlaceId, setSelectedPersonId, setSelectedCatId, setSelectedAnnotationId]);

  const search = useMapSearchV2({
    places, googlePins, volunteers, atlasPinsRef,
    map,
    onPlaceSelect: setSelectedPlaceId,
    onPersonSelect: setSelectedPersonId,
    onCatSelect: setSelectedCatId,
    onDismissSelection: dismissAllSelection,
  });

  // Search history (localStorage)
  const SEARCH_HISTORY_KEY = "map-search-history";
  const MAX_HISTORY = 10;
  const [searchHistory, setSearchHistory] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try { return JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) || "[]"); } catch { return []; }
  });

  const addToSearchHistory = useCallback((query: string) => {
    setSearchHistory(prev => {
      const filtered = prev.filter(q => q !== query);
      const next = [query, ...filtered].slice(0, MAX_HISTORY);
      try { localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const clearSearchHistory = useCallback(() => {
    setSearchHistory([]);
    try { localStorage.removeItem(SEARCH_HISTORY_KEY); } catch {}
  }, []);

  // ── Search keyboard navigation ──
  const [searchHighlight, setSearchHighlight] = useState(-1);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Reset highlight when results change
  useEffect(() => {
    setSearchHighlight(-1);
  }, [search.query, search.atlasResults, search.localResults]);

  // Close search results on click outside the search container
  useEffect(() => {
    if (!search.showResults) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        search.setShowResults(false);
        setSearchHighlight(-1);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [search.showResults, search]);

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!search.showResults) return;
    const items = searchContainerRef.current?.querySelectorAll<HTMLElement>('[role="option"]');
    const total = items?.length ?? 0;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSearchHighlight((prev) => (prev + 1) % Math.max(total, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSearchHighlight((prev) => (prev <= 0 ? total - 1 : prev - 1));
    } else if (e.key === "Enter" && searchHighlight >= 0 && items?.[searchHighlight]) {
      e.preventDefault();
      items[searchHighlight].click();
      setSearchHighlight(-1);
    } else if (e.key === "Escape") {
      search.setQuery("");
      search.setShowResults(false);
      setSearchHighlight(-1);
    }
  }, [search, searchHighlight]);

  // ── Basemap switching ──
  useEffect(() => {
    if (!map) return;
    map.setMapTypeId(basemap === "satellite" ? "hybrid" : "roadmap");
  }, [map, basemap]);

  // ── Clustering (Step 11) — debounced + deduped to prevent rapid re-clustering ──
  const boundsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevBoundsRef = useRef<{ west: number; south: number; east: number; north: number; zoom: number } | null>(null);
  useEffect(() => {
    if (!map) return;
    const listener = map.addListener("idle", () => {
      if (boundsTimerRef.current) clearTimeout(boundsTimerRef.current);
      boundsTimerRef.current = setTimeout(() => {
        const bounds = map.getBounds();
        const zoom = map.getZoom();
        if (bounds && zoom !== undefined) {
          const next = {
            west: bounds.getSouthWest().lng(),
            south: bounds.getSouthWest().lat(),
            east: bounds.getNorthEast().lng(),
            north: bounds.getNorthEast().lat(),
            zoom,
          };
          const prev = prevBoundsRef.current;
          // Skip update if bounds/zoom haven't changed meaningfully (0.0001° ≈ 11m)
          if (prev &&
              Math.abs(prev.west - next.west) < 0.0001 &&
              Math.abs(prev.south - next.south) < 0.0001 &&
              Math.abs(prev.east - next.east) < 0.0001 &&
              Math.abs(prev.north - next.north) < 0.0001 &&
              prev.zoom === next.zoom) {
            return;
          }
          prevBoundsRef.current = next;
          setMapBounds({ west: next.west, south: next.south, east: next.east, north: next.north });
          setMapZoomLevel(zoom);
        }
      }, 150);
    });
    return () => {
      google.maps.event.removeListener(listener);
      if (boundsTimerRef.current) clearTimeout(boundsTimerRef.current);
    };
  }, [map]);

  const { clusters, getClusterExpansionZoom } = useMapClustering({
    pins: atlasPins,
    bounds: mapBounds,
    zoom: mapZoomLevel,
    enabled: atlasLayerEnabled,
  });

  // Quantized zoom for pin rendering — prevents re-renders on fractional changes
  const quantizedZoomLevel = useMemo(() => quantizeZoom(mapZoomLevel), [mapZoomLevel]);

  // FFS-1255: Attention layer — needs-trapper pins that should always be visible
  // These render as a separate unclustered overlay so they're never hidden in clusters
  const attentionPins = useMemo(() =>
    atlasPins.filter(p => p.needs_trapper_count > 0),
    [atlasPins]
  );

  // Visible (unclustered) pin IDs for "Select all visible" in BulkActionBar
  const visiblePinIds = useMemo(() => {
    const ids: string[] = [];
    for (const feature of clusters) {
      if (!isCluster(feature) && feature.properties.pin) {
        ids.push(feature.properties.pin.id);
      }
    }
    return ids;
  }, [clusters]);

  // ── Imperative marker management — eliminates React reconciliation for main marker loop ──
  useImperativeMarkers({
    map,
    clusters,
    quantizedZoomLevel,
    bulkSelectedPlaceIds,
    onPinClick: useCallback((pin: AtlasPin, domEvent: MouseEvent) => {
      setBulkSelectedPlaceIds(prev => {
        const next = new Set(prev);
        if (next.has(pin.id)) next.delete(pin.id);
        else next.add(pin.id);
        return next;
      });
    }, []),
    onClusterClick: useCallback((clusterId: number, lat: number, lng: number) => {
      const zoom = getClusterExpansionZoom(clusterId);
      map?.panTo({ lat, lng });
      map?.setZoom(zoom);
    }, [map, getClusterExpansionZoom]),
    onPinSelect: useCallback((pin: AtlasPin) => {
      // Clear any secondary drawers (person/cat) — single-slot selection model
      setSelectedPersonId(null);
      setSelectedCatId(null);
      // If a drawer is already open, swap directly to the new place
      if (selectedPlaceId) {
        setSelectedPlaceId(pin.id);
      } else {
        // No drawer open — show InfoWindow
        setSelectedPin(pin);
      }
    }, [selectedPlaceId, setSelectedPersonId, setSelectedCatId]),
    measureActive,
    onMeasurePoint: useCallback((latlng: { lat: number; lng: number }) => {
      setMeasurePoints(prev => [...prev, latlng]);
    }, []),
    pinConfig,
  });

  // ── Comparison handlers (Step 2) ──
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

  // ── Measurement (Step 6) — inline instead of hook, uses google.maps.Polyline ──
  const measurePolylineRef = useRef<google.maps.Polyline | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const measureMarkersRef = useRef<any[]>([]);
  const measureLabelsRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const rubberBandRef = useRef<google.maps.Polyline | null>(null);

  const measureTotalDistance = measurePoints.reduce((sum, pt, i) => {
    if (i === 0) return 0;
    return sum + haversine(measurePoints[i - 1], pt);
  }, 0);

  const addMeasurePoint = useCallback((latlng: { lat: number; lng: number }) => {
    setMeasurePoints(prev => [...prev, latlng]);
  }, []);

  const undoMeasurePoint = useCallback(() => {
    setMeasurePoints(prev => prev.length === 0 ? prev : prev.slice(0, -1));
  }, []);

  const clearMeasurement = useCallback(() => {
    setMeasurePoints([]);
  }, []);

  // Compute segment midpoints + distances for declarative AdvancedMarker labels
  const measureSegments = useMemo(() => {
    if (measurePoints.length < 2) return [];
    return measurePoints.slice(1).map((pt, i) => {
      const a = measurePoints[i];
      return {
        lat: (a.lat + pt.lat) / 2,
        lng: (a.lng + pt.lng) / 2,
        distance: haversine(a, pt),
      };
    });
  }, [measurePoints]);

  // Draw/redraw measurement polylines, point markers, and inline distance labels
  useEffect(() => {
    if (!map || !measureActive) {
      // Clean up
      measurePolylineRef.current?.setMap(null);
      measurePolylineRef.current = null;
      measureMarkersRef.current.forEach(m => m.setMap(null));
      measureMarkersRef.current = [];
      measureLabelsRef.current.forEach(m => (m.map = null));
      measureLabelsRef.current = [];
      return;
    }

    // Remove old
    measurePolylineRef.current?.setMap(null);
    measureMarkersRef.current.forEach(m => m.setMap(null));
    measureMarkersRef.current = [];
    measureLabelsRef.current.forEach(m => (m.map = null));
    measureLabelsRef.current = [];

    if (measurePoints.length === 0) return;

    // Draw polyline
    const path = measurePoints.map(p => ({ lat: p.lat, lng: p.lng }));
    const polyline = new google.maps.Polyline({
      path,
      strokeColor: "#3b82f6",
      strokeWeight: 3,
      strokeOpacity: 1,
      map,
    });
    measurePolylineRef.current = polyline;

    // Draw circle markers at each point
    for (const pt of measurePoints) {
      const marker = new google.maps.Marker({
        position: { lat: pt.lat, lng: pt.lng },
        map,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 5,
          fillColor: "#3b82f6",
          fillOpacity: 1,
          strokeColor: "white",
          strokeWeight: 2,
        },
      });
      measureMarkersRef.current.push(marker);
    }

    // Inline distance labels at segment midpoints (like Google MyMaps)
    let cumulative = 0;
    for (let i = 1; i < measurePoints.length; i++) {
      const a = measurePoints[i - 1];
      const b = measurePoints[i];
      const segDist = haversine(a, b);
      cumulative += segDist;
      const midLat = (a.lat + b.lat) / 2;
      const midLng = (a.lng + b.lng) / 2;

      const el = document.createElement("div");
      el.style.cssText =
        "background:#3b82f6;color:#fff;font-size:11px;font-weight:600;" +
        "padding:2px 6px;border-radius:4px;white-space:nowrap;" +
        "box-shadow:0 1px 3px rgba(0,0,0,0.3);pointer-events:none;";
      el.textContent = formatDistance(cumulative);

      const adv = new google.maps.marker.AdvancedMarkerElement({
        position: { lat: midLat, lng: midLng },
        map,
        content: el,
        zIndex: 15,
      });
      measureLabelsRef.current.push(adv);
    }

    return () => {
      polyline.setMap(null);
    };
  }, [map, measureActive, measurePoints]);

  // Rubber band line (no cursor-following label — live distance shows in MeasurementPanel)
  const [measureCursorDistance, setMeasureCursorDistance] = useState(0);
  const rafRef = useRef<number | null>(null);
  // Use refs so the mousemove listener reads current values without re-registering
  const measurePointsRef = useRef(measurePoints);
  useEffect(() => { measurePointsRef.current = measurePoints; }, [measurePoints]);
  const measureTotalDistRef = useRef(measureTotalDistance);
  useEffect(() => { measureTotalDistRef.current = measureTotalDistance; }, [measureTotalDistance]);

  useEffect(() => {
    if (!map || !measureActive) {
      rubberBandRef.current?.setMap(null);
      rubberBandRef.current = null;
      setMeasureCursorDistance(0);
      return;
    }

    const listener = map.addListener("mousemove", (e: google.maps.MapMouseEvent) => {
      if (!e.latLng) return;
      const pts = measurePointsRef.current;
      if (pts.length === 0) return;
      const lastPt = pts[pts.length - 1];
      const to = { lat: e.latLng.lat(), lng: e.latLng.lng() };

      // Update rubber band polyline (lightweight — no DOM creation)
      if (rubberBandRef.current) {
        rubberBandRef.current.setPath([lastPt, to]);
      } else {
        rubberBandRef.current = new google.maps.Polyline({
          path: [lastPt, to],
          strokeColor: "#3b82f6",
          strokeWeight: 2,
          strokeOpacity: 0.5,
          map,
        });
      }

      // Throttle React state updates to animation frames
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const segDist = haversine(lastPt, to);
        setMeasureCursorDistance(measureTotalDistRef.current + segDist);
      });
    });

    return () => {
      google.maps.event.removeListener(listener);
      rubberBandRef.current?.setMap(null);
      rubberBandRef.current = null;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [map, measureActive]); // stable deps — listener registered once, reads refs for current data

  // Clean up measurement when deactivated
  useEffect(() => {
    if (!measureActive) setMeasurePoints([]);
  }, [measureActive]);

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

  // ── Heatmap (Step 8) ──
  const heatmapLayerRef = useRef<google.maps.visualization.HeatmapLayer | null>(null);

  useEffect(() => {
    if (!map) return;

    if (!heatmapEnabled) {
      heatmapLayerRef.current?.setMap(null);
      heatmapLayerRef.current = null;
      return;
    }

    const data = atlasPins
      .filter(p => p.lat && p.lng)
      .map(p => {
        let intensity: number;
        if (heatmapMode === "disease") {
          intensity = p.disease_count || 0;
        } else if (heatmapMode === "intact") {
          // Intact = cat_count - total_altered. Pin has no intact signal if all known.
          intensity = Math.max(p.cat_count - (p.total_altered || 0), 0);
        } else {
          intensity = Math.max(p.cat_count, 1);
        }
        return intensity > 0 ? { location: new google.maps.LatLng(p.lat, p.lng), weight: intensity } : null;
      })
      .filter(Boolean) as google.maps.visualization.WeightedLocation[];

    // Always rebuild the layer when mode changes so gradient/maxIntensity take effect.
    // HeatmapLayer doesn't support setOptions for gradient, so setData alone isn't enough.
    heatmapLayerRef.current?.setMap(null);

    const gradient =
      heatmapMode === "disease"
        ? ["rgba(0,0,0,0)", "#fed976", "#fd8d3c", "#e31a1c", "#800026"]
        : heatmapMode === "intact"
        ? ["rgba(0,0,0,0)", "#fde68a", "#f59e0b", "#dc2626", "#7c2d12"]
        : ["rgba(0,0,0,0)", "#ffffb2", "#fecc5c", "#fd8d3c", "#f03b20", "#bd0026"];

    const maxIntensity =
      heatmapMode === "disease" ? 5 : heatmapMode === "intact" ? 10 : 20;

    heatmapLayerRef.current = new google.maps.visualization.HeatmapLayer({
      data,
      radius: 25,
      maxIntensity,
      gradient,
      map,
    });

    return () => {
      heatmapLayerRef.current?.setMap(null);
      heatmapLayerRef.current = null;
    };
  }, [map, atlasPins, heatmapEnabled, heatmapMode]);

  // Fade atlas pins when a heatmap layer is active so the heat colors read clearly.
  // Toggles a body class that a one-time injected style rule targets.
  useEffect(() => {
    const STYLE_ID = "atlas-map-heatmap-fade";
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent =
        "body.map-heatmap-active .atlas-pin-active, " +
        "body.map-heatmap-active .atlas-pin-ref { opacity: 0.3; transition: opacity 150ms ease-out; } " +
        ".atlas-pin-active, .atlas-pin-ref { transition: opacity 150ms ease-out; }";
      document.head.appendChild(style);
    }
    if (heatmapEnabled) {
      document.body.classList.add("map-heatmap-active");
    } else {
      document.body.classList.remove("map-heatmap-active");
    }
    return () => { document.body.classList.remove("map-heatmap-active"); };
  }, [heatmapEnabled]);

  // ── Route polyline (Step 9) ──
  const routePolylineRef = useRef<google.maps.Polyline | null>(null);

  useEffect(() => {
    routePolylineRef.current?.setMap(null);
    routePolylineRef.current = null;

    if (!map || !routePolyline || routePolyline.length === 0) return;

    const polyline = new google.maps.Polyline({
      path: routePolyline.map(p => ({ lat: p.lat, lng: p.lng })),
      strokeColor: MAP_COLORS.layers.places,
      strokeWeight: 4,
      strokeOpacity: 0.8,
      map,
    });
    routePolylineRef.current = polyline;

    return () => { polyline.setMap(null); };
  }, [map, routePolyline]);

  const handleRoutePolyline = useCallback((points: Array<{ lat: number; lng: number }> | null) => {
    setRoutePolyline(points);
  }, []);

  // ── Bulk selection helpers (Step 10) ──
  const bulkPlaceRequestMap = useMemo(() => {
    const m: globalThis.Map<string, string[]> = new globalThis.Map();
    for (const pin of atlasPins) {
      if (bulkSelectedPlaceIds.has(pin.id) && pin.active_request_count > 0) {
        m.set(pin.id, [pin.id]);
      }
    }
    return m;
  }, [atlasPins, bulkSelectedPlaceIds]);

  // ── Annotations fetch (Step 13) ──
  const fetchAnnotations = useCallback(async () => {
    try {
      const data = await fetchApi<{ annotations?: Annotation[] }>("/api/annotations");
      setAnnotations(data.annotations || []);
    } catch (e) {
      console.error("Failed to fetch annotations:", e);
    }
  }, []);

  useEffect(() => { fetchAnnotations(); }, [fetchAnnotations]);

  // ── Context menu (Step 5) ──
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!map) return;

    const container = document.querySelector(".map-container-v2") as HTMLElement | null;
    const handleRightClick = (e: google.maps.MapMouseEvent) => {
      if (!e.latLng || !e.domEvent) return;
      const rect = container?.getBoundingClientRect() || { left: 0, top: 0 };
      const de = e.domEvent as MouseEvent;
      setContextMenu({
        x: de.clientX - rect.left,
        y: de.clientY - rect.top,
        lat: e.latLng.lat(),
        lng: e.latLng.lng(),
      });
    };
    const closeCtx = () => setContextMenu(null);

    const listeners = [
      map.addListener("rightclick", handleRightClick),
      map.addListener("click", closeCtx),
      map.addListener("dragstart", closeCtx),
    ];
    return () => { listeners.forEach(l => google.maps.event.removeListener(l)); };
  }, [map]);

  const handleContextMeasure = useCallback(() => {
    if (!contextMenu) return;
    setMeasureActive(true);
    setAddPointMode(null);
    setPendingClick(null);
    setShowAddPointMenu(false);
    setTimeout(() => addMeasurePoint({ lat: contextMenu.lat, lng: contextMenu.lng }), 50);
    setContextMenu(null);
  }, [contextMenu, addMeasurePoint]);

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
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${contextMenu.lat},${contextMenu.lng}`, "_blank");
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

  // Street View panorama is now managed by StreetViewPanel component

  // ── My Location handler ──
  const handleMyLocation = useCallback(() => {
    if (!navigator.geolocation) {
      addToast({ type: "error", message: "Geolocation is not supported by your browser" });
      return;
    }
    setLocatingUser(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setLocatingUser(false);
        map?.panTo({ lat: latitude, lng: longitude });
        map?.setZoom(15);
      },
      () => {
        setLocatingUser(false);
        addToast({ type: "error", message: "Unable to get your location" });
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, [map, addToast]);

  // ── Fullscreen handler ──
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const handleFullscreenToggle = useCallback(() => {
    const el = document.querySelector(".map-container-v2");
    if (!document.fullscreenElement) {
      el?.requestFullscreen?.().catch(console.error);
    } else {
      document.exitFullscreen().catch(console.error);
    }
  }, []);

  // ── Add point mode / measurement: map click handler + cursor (Step 12) ──
  useEffect(() => {
    if (!map) return;
    if (!addPointMode && !measureActive) {
      map.setOptions({ draggableCursor: undefined });
      return;
    }

    map.setOptions({ draggableCursor: "crosshair" });

    const listener = map.addListener("click", (e: google.maps.MapMouseEvent) => {
      if (!e.latLng) return;
      const latlng = { lat: e.latLng.lat(), lng: e.latLng.lng() };
      if (measureActive) {
        addMeasurePoint(latlng);
      } else if (addPointMode) {
        setPendingClick(latlng);
      }
    });

    return () => {
      google.maps.event.removeListener(listener);
      map.setOptions({ draggableCursor: undefined });
    };
  }, [map, addPointMode, measureActive, addMeasurePoint]);

  // ── atlas:navigate-place event listener (Step 2) ──
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

  // ── Global functions for popup/drawer interop (Step 14) ──
  useEffect(() => {
    const w = window as any;
    w.atlasMapExpandPlace = (id: string) => setSelectedPlaceId(id);
    w.atlasMapOpenStreetView = (lat: number, lng: number, address?: string) => {
      setSelectedPlaceId(null);
      setSelectedPersonId(null);
      setSelectedCatId(null);
      setSelectedAnnotationId(null);
      setStreetViewCoords({ lat, lng, address });
      setStreetViewConeOnly(false);
    };
    w.atlasMapShowStreetViewCone = (lat: number, lng: number) => {
      setStreetViewCoords({ lat, lng });
      setStreetViewConeOnly(true);
    };
    w.atlasMapHideStreetViewCone = () => {
      if (streetViewConeOnlyRef.current) {
        setStreetViewCoords(null);
        setStreetViewConeOnly(false);
      }
    };
    w.atlasMapExpandStreetViewFullscreen = (lat: number, lng: number, address?: string) => {
      setStreetViewCoords({ lat, lng, address });
      setStreetViewConeOnly(false);
      setStreetViewFullscreen(true);
    };
    return () => {
      delete w.atlasMapExpandPlace;
      delete w.atlasMapOpenStreetView;
      delete w.atlasMapShowStreetViewCone;
      delete w.atlasMapHideStreetViewCone;
      delete w.atlasMapExpandStreetViewFullscreen;
    };
  }, []);

  // ── Tippy map context events (Step 14) — use refs to avoid listener re-registration ──
  const selectedPlaceIdRef = useRef(selectedPlaceId);
  useEffect(() => { selectedPlaceIdRef.current = selectedPlaceId; }, [selectedPlaceId]);
  const searchNavRef = useRef(search.navigatedLocation);
  useEffect(() => { searchNavRef.current = search.navigatedLocation; }, [search.navigatedLocation]);

  useEffect(() => {
    if (!map) return;
    const emitMapContext = () => {
      const center = map.getCenter();
      const bounds = map.getBounds();
      const zoom = map.getZoom();
      if (!center || !bounds || zoom === undefined) return;

      const placeId = selectedPlaceIdRef.current;
      const selectedPlace = placeId
        ? atlasPinsRef.current.find(p => p.id === placeId) || null
        : null;

      window.dispatchEvent(new CustomEvent("tippy-map-context", {
        detail: {
          center: { lat: center.lat(), lng: center.lng() },
          zoom,
          bounds: {
            north: bounds.getNorthEast().lat(),
            south: bounds.getSouthWest().lat(),
            east: bounds.getNorthEast().lng(),
            west: bounds.getSouthWest().lng(),
          },
          selectedPlace: selectedPlace ? { place_id: selectedPlace.id, address: selectedPlace.address } : null,
          navigatedLocation: searchNavRef.current,
          drawerOpen: !!placeId,
        },
      }));
    };

    const listeners = [
      map.addListener("idle", emitMapContext),
      map.addListener("zoom_changed", emitMapContext),
    ];
    return () => { listeners.forEach(l => google.maps.event.removeListener(l)); };
  }, [map]);

  // ── Keyboard shortcuts (Step 4) — use refs to avoid constant re-registration ──
  const kbStateRef = useRef({
    addPointMode, measureActive, selectedPin, selectedPlaceId,
    selectedPersonId, selectedCatId, selectedAnnotationId, contextMenu,
  });
  useEffect(() => {
    kbStateRef.current = {
      addPointMode, measureActive, selectedPin, selectedPlaceId,
      selectedPersonId, selectedCatId, selectedAnnotationId, contextMenu,
    };
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        if (e.key === "Escape") {
          (e.target as HTMLElement).blur();
          search.setShowResults(false);
        }
        return;
      }

      const st = kbStateRef.current;
      switch (e.key) {
        case "/":
          e.preventDefault();
          searchInputRef.current?.focus();
          break;
        case "Escape":
          // Escape cascade — highest-priority UI closes first
          if (st.contextMenu) {
            setContextMenu(null);
          } else if (streetViewFullscreenRef.current) {
            setStreetViewFullscreen(false);
          } else if (streetViewCoordsRef.current && !streetViewConeOnlyRef.current) {
            setStreetViewCoords(null);
            setStreetViewFullscreen(false);
          } else if (st.selectedCatId) {
            setSelectedCatId(null);
          } else if (st.selectedPersonId) {
            setSelectedPersonId(null);
          } else if (st.selectedAnnotationId) {
            setSelectedAnnotationId(null);
          } else if (st.selectedPin) {
            setSelectedPin(null);
          } else if (st.selectedPlaceId) {
            setSelectedPlaceId(null);
          } else if (st.measureActive) {
            setMeasureActive(false);
          } else if (st.addPointMode) {
            setAddPointMode(null);
            setPendingClick(null);
            setShowAddPointMenu(false);
          } else {
            search.setShowResults(false);
            setShowLayerPanel(false);
          }
          break;
        case "+":
        case "=":
          map?.setZoom((map.getZoom() || 11) + 1);
          break;
        case "-":
          map?.setZoom((map.getZoom() || 11) - 1);
          break;
        case "l":
        case "L":
          // If MapShell sidebar portal exists, toggle sidebar; else toggle inline layer panel
          if (document.getElementById("map-sidebar-portal")) {
            toggleSidebar();
          } else {
            setShowLayerPanel(prev => !prev);
          }
          break;
        case "m":
        case "M":
          handleMyLocation();
          break;
        case "1":
          toggleLayer("atlas_all");
          break;
        // K shortcut removed — legend replaced by layer toggle panel (FFS-1021)
        case "a":
        case "A":
          if (!st.addPointMode) {
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, handleFullscreenToggle, handleMeasureToggle, handleMyLocation, toggleLayer]);

  // ── Street View from search ──
  const handleStreetViewFromSearch = useCallback((lat: number, lng: number, address?: string) => {
    setStreetViewCoords({ lat, lng, address });
    setStreetViewConeOnly(false);
    setStreetViewFullscreen(false);
  }, []);

  // ── Total markers for display ──
  const totalMarkers = (atlasLayerEnabled ? atlasPins.length : 0) +
    (enabledLayers.places ? places.length : 0) +
    (enabledLayers.volunteers ? volunteers.length : 0);

  // ── Visible pins — now clustered ──
  const visiblePins = useMemo(() => {
    if (!atlasLayerEnabled) return [];
    return atlasPins.filter(p => p.lat && p.lng);
  }, [atlasPins, atlasLayerEnabled]);

  // Helper: get coordinates for a place
  const getPlaceCoords = useCallback((placeId: string) => {
    const pin = atlasPins.find(p => p.id === placeId) || places.find(p => p.id === placeId);
    return pin?.lat && pin?.lng ? { lat: pin.lat, lng: pin.lng } : undefined;
  }, [atlasPins, places]);

  // ──────────────────────────────────────────────────────────────────────────
  // RENDER
  // ──────────────────────────────────────────────────────────────────────────

  return (
    <div className="map-container-v2" role="application" aria-roledescription="interactive map" style={{ position: "relative", height: "100%", width: "100%" }}>
      <Map
        mapId={process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || "atlas-map-v2"}
        defaultCenter={initialUrlState.center ?? { lat: mapCenter[0], lng: mapCenter[1] }}
        defaultZoom={initialUrlState.zoom ?? mapZoom}
        gestureHandling="greedy"
        disableDefaultUI
        style={{ width: "100%", height: "100%" }}
        onClick={(e) => {
          // Only clear selection if not in add-point or measure mode (those handle click separately)
          if (!addPointMode && !measureActive) {
            setSelectedPin(null);
            setSelectedPlaceId(null);
            setSelectedPersonId(null);
            setSelectedCatId(null);
            setContextMenu(null);
          }
        }}
      >
        {/* ── Clustered + individual pin markers managed imperatively via useImperativeMarkers ── */}
        {/* (no React <AdvancedMarker> components — eliminates reconciliation overhead) */}

        {/* ── FFS-1255: Attention layer — needs-trapper pins always visible, never clustered ── */}
        {atlasLayerEnabled && attentionPins.map(pin => (
          <AdvancedMarker
            key={`attn-${pin.id}`}
            position={{ lat: pin.lat, lng: pin.lng }}
            collisionBehavior={CollisionBehavior.REQUIRED_AND_HIDES_OPTIONAL}
            zIndex={50}
            onClick={() => {
              setSelectedPersonId(null);
              setSelectedCatId(null);
              if (selectedPlaceId) {
                setSelectedPlaceId(pin.id);
              } else {
                setSelectedPin(pin);
              }
            }}
          >
            <div title={`${pin.address || pin.display_name} — needs trapper`} style={{ cursor: "pointer", position: "relative" }}>
              {/* Pulsing orange ring */}
              <div style={{
                width: 28, height: 28, borderRadius: "50%",
                border: "3px solid #f97316",
                background: "rgba(249, 115, 22, 0.15)",
                display: "flex", alignItems: "center", justifyContent: "center",
                animation: "attentionPulse 2s infinite",
              }}>
                {/* Inner icon — small trap silhouette */}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 21h18M4 18l4-12M20 18l-4-12M8 6h8"/>
                </svg>
              </div>
              {/* Count badge if multiple requests */}
              {pin.needs_trapper_count > 1 && (
                <div style={{
                  position: "absolute", top: -4, right: -4,
                  minWidth: 14, height: 14, borderRadius: 7,
                  background: "#f97316", border: "2px solid white",
                  color: "white", fontSize: 8, fontWeight: 700,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  padding: "0 2px",
                }}>
                  {pin.needs_trapper_count}
                </div>
              )}
            </div>
          </AdvancedMarker>
        ))}
        <style>{`@keyframes attentionPulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(249, 115, 22, 0.4); } 50% { box-shadow: 0 0 0 8px rgba(249, 115, 22, 0); } }`}</style>

        {/* ── Annotation markers (Step 13) ── */}
        {enabledLayers.atlas_all && annotations.map(ann => (
          <AdvancedMarker
            key={ann.annotation_id}
            position={{ lat: ann.lat, lng: ann.lng }}
            collisionBehavior={CollisionBehavior.OPTIONAL_AND_HIDES_LOWER_PRIORITY}
            zIndex={1}
            onClick={() => setSelectedAnnotationId(ann.annotation_id)}
          >
            <div style={{
              width: 28, height: 28, borderRadius: "50%",
              background: ann.annotation_type === "hazard" ? "#ef4444" : ann.annotation_type === "colony_sighting" ? "#8b5cf6" : "#6366f1",
              border: "2px solid white",
              boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 14, cursor: "pointer",
            }}>
              {ann.annotation_type === "hazard" ? "⚠" : ann.annotation_type === "colony_sighting" ? "👁" : "📌"}
            </div>
          </AdvancedMarker>
        ))}

        {/* ── Navigated location marker (Step 13) — small dot, click to dismiss ── */}
        {search.navigatedLocation && (
          <AdvancedMarker
            position={{ lat: search.navigatedLocation.lat, lng: search.navigatedLocation.lng }}
            collisionBehavior={CollisionBehavior.REQUIRED}
            zIndex={1}
            onClick={() => {
              // Dismiss search pin on click — reveals atlas pins underneath
              search.clearNavigatedLocation();
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              {/* Label: pointer-events none so clicks pass through to data pins below */}
              <div style={{
                background: "var(--background, #fff)", borderRadius: 6,
                padding: "3px 7px", fontSize: 10, fontWeight: 600,
                boxShadow: "0 1px 4px rgba(0,0,0,0.15)", whiteSpace: "nowrap",
                maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis",
                marginBottom: 3, color: "var(--foreground, #111)",
                display: "flex", alignItems: "center", gap: 3,
                pointerEvents: "none", opacity: 0.85,
              }}>
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                {search.navigatedLocation.address || "Searched location"}
              </div>
              {/* Dot: click to dismiss search pin and reveal data pins */}
              <div title="Click to dismiss search pin" style={{
                width: 14, height: 14, borderRadius: "50%",
                background: "#3b82f6", border: "2px solid white",
                boxShadow: "0 0 0 2px rgba(59,130,246,0.3), 0 1px 4px rgba(0,0,0,0.3)",
                animation: "searchPulse 2s infinite",
                cursor: "pointer",
              }} />
            </div>
            <style>{`@keyframes searchPulse { 0%, 100% { box-shadow: 0 0 0 2px rgba(59,130,246,0.3), 0 1px 4px rgba(0,0,0,0.3); } 50% { box-shadow: 0 0 0 6px rgba(59,130,246,0.1), 0 1px 4px rgba(0,0,0,0.3); } }`}</style>
          </AdvancedMarker>
        )}

        {/* ── Street View cone marker (Step 7) ── */}
        {streetViewCoords && (
          <AdvancedMarker position={{ lat: streetViewCoords.lat, lng: streetViewCoords.lng }} collisionBehavior={CollisionBehavior.REQUIRED} zIndex={20}>
            <div style={{ transform: `rotate(${streetViewHeading}deg)`, transition: "transform 0.3s ease" }}>
              <svg width="36" height="36" viewBox="0 0 36 36">
                <path d="M18 2 L30 32 L18 26 L6 32 Z" fill="rgba(59,130,246,0.6)" stroke="#3b82f6" strokeWidth="2" />
              </svg>
            </div>
          </AdvancedMarker>
        )}

        {/* ── Layer markers (Phase 1) ── */}
        {enabledLayers.google_pins && googlePins.length > 0 && (
          <GooglePinMarkers pins={googlePins} onInfoWindowOpen={() => setSelectedPin(null)} />
        )}
        {enabledLayers.places && places.length > 0 && (
          <PlaceMarkers places={places} onPlaceSelect={setSelectedPlaceId} onInfoWindowOpen={() => setSelectedPin(null)} />
        )}
        {enabledLayers.volunteers && volunteers.length > 0 && (
          <VolunteerMarkers volunteers={volunteers} onPersonSelect={setSelectedPersonId} onInfoWindowOpen={() => setSelectedPin(null)} />
        )}
        {enabledLayers.clinic_clients && clinicClients.length > 0 && (
          <ClinicClientMarkers clients={clinicClients} onInfoWindowOpen={() => setSelectedPin(null)} />
        )}
        {enabledLayers.trapper_territories && trapperTerritories.length > 0 && (
          <TrapperTerritoryMarkers territories={trapperTerritories} onPersonSelect={setSelectedPersonId} onInfoWindowOpen={() => setSelectedPin(null)} />
        )}

        {/* ── Zone boundaries (Phase 2) ── */}
        {enabledLayers.zones && zones.length > 0 && (
          <ZoneBoundaries zones={zones} />
        )}

        {/* ── Measurement segment distance labels — anchored at center like Google My Maps ── */}
        {measureActive && measureSegments.map((seg, i) => (
          <AdvancedMarker
            key={`measure-seg-${i}`}
            position={{ lat: seg.lat, lng: seg.lng }}
            collisionBehavior={CollisionBehavior.REQUIRED}
            zIndex={20}
            anchorPoint={AdvancedMarkerAnchorPoint.CENTER}
          >
            <div style={{
              background: "rgba(255,255,255,0.92)", borderRadius: 10, padding: "1px 6px",
              fontSize: 11, fontWeight: 600, color: "#1a73e8",
              boxShadow: "0 1px 2px rgba(0,0,0,0.15)",
              whiteSpace: "nowrap", pointerEvents: "none",
              lineHeight: "16px", letterSpacing: "-0.01em",
              border: "1px solid rgba(26,115,232,0.2)",
            }}>
              {formatDistance(seg.distance)}
            </div>
          </AdvancedMarker>
        ))}

        {/* ── InfoWindow for selected pin ── */}
        {selectedPin && !selectedPlaceId && (
          <InfoWindow
            position={{ lat: selectedPin.lat, lng: selectedPin.lng }}
            onCloseClick={() => setSelectedPin(null)}
          >
            <MapInfoWindowContent
              pin={selectedPin}
              onOpenDetails={(id) => { setSelectedPlaceId(id); setSelectedPin(null); }}
              onStreetView={(coords) => { setStreetViewCoords(coords); setSelectedPin(null); }}
            />
          </InfoWindow>
        )}
      </Map>

      {/* ── Search bar — portalled into top bar when MapShell present ── */}
      <PortalOrInline
        portalId="map-search-portal"
        fallback={
          <div ref={searchContainerRef} style={{
            position: "absolute", top: 16, left: "50%", transform: "translateX(-50%)",
            zIndex: MAP_Z_INDEX.searchBox, width: "100%", maxWidth: 600, padding: "0 16px",
          }}>
            <div style={{
              background: "var(--background)", borderRadius: 24,
              boxShadow: "0 2px 6px rgba(0,0,0,0.15), 0 1px 2px rgba(0,0,0,0.1)",
              display: "flex", alignItems: "center", padding: "8px 16px",
            }}>
              <a href="/" title="Back to Beacon" style={{ display: "flex", alignItems: "center", gap: 6, marginRight: 8, textDecoration: "none", color: "var(--text-secondary)", fontWeight: 700, fontSize: 14, flexShrink: 0, padding: "4px 8px 4px 4px", borderRadius: 6 }}>
                <span style={{ fontSize: 16, lineHeight: 1 }}>&#x2190;</span>
                <img src="/beacon-logo.jpeg" alt="Beacon" style={{ height: 24, width: "auto" }} />
              </a>
              <span style={{ width: 1, height: 20, background: "var(--bg-secondary)", marginRight: 10, flexShrink: 0 }} />
              <input
                ref={searchInputRef}
                type="text"
                role="combobox"
                aria-expanded={search.showResults}
                aria-autocomplete="list"
                aria-controls="map-search-listbox"
                aria-activedescendant={searchHighlight >= 0 ? `srp-item-${searchHighlight}` : undefined}
                placeholder={isMobile ? "Search..." : "Search people, places, or cats... (press /)"}
                value={search.query}
                onChange={(e) => { search.setQuery(e.target.value); search.setShowResults(true); }}
                onFocus={() => search.setShowResults(true)}
                onKeyDown={handleSearchKeyDown}
                style={{ flex: 1, border: "none", outline: "none", fontSize: 15 }}
              />
              {search.query && (
                <button onClick={() => { search.setQuery(""); search.setShowResults(false); }} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, opacity: 0.5 }}>
                  &#x2715;
                </button>
              )}
            </div>

            {/* Recent searches */}
            {search.showResults && !search.query && searchHistory.length > 0 && (
              <div style={{ background: "var(--background)", borderRadius: 12, boxShadow: "0 4px 12px rgba(0,0,0,0.15)", marginTop: 8, maxHeight: 300, overflowY: "auto" }}>
                <div style={{ padding: "8px 16px 4px", fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", background: "var(--section-bg)", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  Recent Searches
                  <button onClick={clearSearchHistory} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "var(--text-tertiary)", padding: "2px 6px" }}>Clear</button>
                </div>
                {searchHistory.map((q, i) => (
                  <div key={i} onClick={() => { search.setQuery(q); search.setShowResults(true); }} style={{ padding: "10px 16px", cursor: "pointer", borderBottom: "1px solid var(--border-default)", display: "flex", alignItems: "center", gap: 10 }} onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-secondary)")} onMouseLeave={(e) => (e.currentTarget.style.background = "var(--background)")}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                    </svg>
                    <span style={{ fontSize: 14 }}>{q}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Search results — desktop: floating dropdown */}
            {search.showResults && search.query && (search.localResults.length > 0 || search.atlasResults.length > 0 || search.poiResults.length > 0 || search.googleSuggestions.length > 0 || search.loading || (search.query.length >= 3 && !search.loading)) && !isMobile && (
              <SearchResultsPanel
                searchResults={search.localResults}
                atlasSearchResults={search.atlasResults}
                googleSuggestions={search.googleSuggestions}
                poiResults={search.poiResults}
                searchLoading={search.loading}
                searchQuery={search.query}
                selectedIndex={searchHighlight}
                onSelectedIndexChange={setSearchHighlight}
                onSearchSelect={(r) => { const q = search.query; search.handleLocalSelect(r); if (q.length >= 3) addToSearchHistory(q); setSearchHighlight(-1); }}
                onAtlasSearchSelect={(r) => { const q = search.query; search.handleAtlasSelect(r); if (q.length >= 3) addToSearchHistory(q); setSearchHighlight(-1); }}
                onGooglePlaceSelect={(p) => { const q = search.query; search.handleGoogleSelect(p); if (q.length >= 3) addToSearchHistory(q); setSearchHighlight(-1); }}
                onPoiSelect={(r) => { const q = search.query; search.handlePoiSelect(r); if (q.length >= 3) addToSearchHistory(q); setSearchHighlight(-1); }}
                onStreetView={handleStreetViewFromSearch}
                onClearSearch={() => { search.setQuery(""); search.setShowResults(false); }}
              />
            )}
          </div>
        }
      >
        {/* Portalled version — simpler search bar for top bar */}
        <div ref={searchContainerRef} className="map-search-bar-portalled" style={{ position: "relative" }}>
          <div style={{
            background: "var(--background)", borderRadius: 8,
            border: "1px solid var(--map-control-border)",
            display: "flex", alignItems: "center", padding: "4px 12px",
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginRight: 8 }}>
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={searchInputRef}
              type="text"
              role="combobox"
              aria-expanded={search.showResults}
              aria-autocomplete="list"
              aria-controls="map-search-listbox"
              aria-activedescendant={searchHighlight >= 0 ? `srp-item-${searchHighlight}` : undefined}
              placeholder="Search people, places, or cats... (press /)"
              value={search.query}
              onChange={(e) => { search.setQuery(e.target.value); search.setShowResults(true); }}
              onFocus={() => search.setShowResults(true)}
              onKeyDown={handleSearchKeyDown}
              style={{ flex: 1, border: "none", outline: "none", fontSize: 14, background: "transparent", padding: "4px 0" }}
            />
            {search.query && (
              <button onClick={() => { search.setQuery(""); search.setShowResults(false); }} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, opacity: 0.5, padding: "2px 4px" }}>
                &#x2715;
              </button>
            )}
          </div>

          {/* Recent searches */}
          {search.showResults && !search.query && searchHistory.length > 0 && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "var(--background)", borderRadius: 8, boxShadow: "0 4px 12px rgba(0,0,0,0.15)", marginTop: 4, maxHeight: 300, overflowY: "auto", zIndex: 10 }}>
              <div style={{ padding: "8px 12px 4px", fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                Recent Searches
                <button onClick={clearSearchHistory} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "var(--text-tertiary)", padding: "2px 6px" }}>Clear</button>
              </div>
              {searchHistory.map((q, i) => (
                <div key={i} onClick={() => { search.setQuery(q); search.setShowResults(true); }} style={{ padding: "8px 12px", cursor: "pointer", borderBottom: "1px solid var(--border-default)", display: "flex", alignItems: "center", gap: 8 }} onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-secondary)")} onMouseLeave={(e) => (e.currentTarget.style.background = "var(--background)")}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                  </svg>
                  <span style={{ fontSize: 13 }}>{q}</span>
                </div>
              ))}
            </div>
          )}

          {/* Search results — floating dropdown */}
          {search.showResults && search.query && (search.localResults.length > 0 || search.atlasResults.length > 0 || search.poiResults.length > 0 || search.googleSuggestions.length > 0 || search.loading || (search.query.length >= 3 && !search.loading)) && !isMobile && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10, marginTop: 4 }}>
              <SearchResultsPanel
                searchResults={search.localResults}
                atlasSearchResults={search.atlasResults}
                googleSuggestions={search.googleSuggestions}
                poiResults={search.poiResults}
                searchLoading={search.loading}
                searchQuery={search.query}
                selectedIndex={searchHighlight}
                onSelectedIndexChange={setSearchHighlight}
                onSearchSelect={(r) => { const q = search.query; search.handleLocalSelect(r); if (q.length >= 3) addToSearchHistory(q); setSearchHighlight(-1); }}
                onAtlasSearchSelect={(r) => { const q = search.query; search.handleAtlasSelect(r); if (q.length >= 3) addToSearchHistory(q); setSearchHighlight(-1); }}
                onGooglePlaceSelect={(p) => { const q = search.query; search.handleGoogleSelect(p); if (q.length >= 3) addToSearchHistory(q); setSearchHighlight(-1); }}
                onPoiSelect={(r) => { const q = search.query; search.handlePoiSelect(r); if (q.length >= 3) addToSearchHistory(q); setSearchHighlight(-1); }}
                onStreetView={handleStreetViewFromSearch}
                onClearSearch={() => { search.setQuery(""); search.setShowResults(false); }}
              />
            </div>
          )}
        </div>
      </PortalOrInline>

      {/* ── Mobile search results in BottomSheet ── */}
      {isMobile && (
        <BottomSheet
          isOpen={search.showResults && !!search.query && (search.localResults.length > 0 || search.atlasResults.length > 0 || search.poiResults.length > 0 || search.googleSuggestions.length > 0 || search.loading || (search.query.length >= 3 && !search.loading))}
          onClose={() => search.setShowResults(false)}
          initialHeight={50}
          maxHeight={85}
          snapPoints={[30, 50, 85]}
        >
          <SearchResultsPanel
            searchResults={search.localResults}
            atlasSearchResults={search.atlasResults}
            googleSuggestions={search.googleSuggestions}
            poiResults={search.poiResults}
            searchLoading={search.loading}
            searchQuery={search.query}
            selectedIndex={searchHighlight}
            onSelectedIndexChange={setSearchHighlight}
            onSearchSelect={(r) => { const q = search.query; search.handleLocalSelect(r); if (q.length >= 3) addToSearchHistory(q); setSearchHighlight(-1); }}
            onAtlasSearchSelect={(r) => { const q = search.query; search.handleAtlasSelect(r); if (q.length >= 3) addToSearchHistory(q); setSearchHighlight(-1); }}
            onGooglePlaceSelect={(p) => { const q = search.query; search.handleGoogleSelect(p); if (q.length >= 3) addToSearchHistory(q); setSearchHighlight(-1); }}
            onPoiSelect={(r) => { const q = search.query; search.handlePoiSelect(r); if (q.length >= 3) addToSearchHistory(q); setSearchHighlight(-1); }}
            onStreetView={handleStreetViewFromSearch}
            onClearSearch={() => { search.setQuery(""); search.setShowResults(false); }}
          />
        </BottomSheet>
      )}

      {/* ── Basemap toggle — portalled into top bar ── */}
      <PortalOrInline portalId="map-basemap-portal" fallback={null}>
        <div className="map-basemap-segmented">
          <button data-active={basemap === "street"} onClick={() => setBasemap("street")}>Street</button>
          <button data-active={basemap === "satellite"} onClick={() => setBasemap("satellite")}>Satellite</button>
        </div>
      </PortalOrInline>

      {/* ── Action buttons — portalled into top bar ── */}
      <PortalOrInline
        portalId="map-actions-portal"
        fallback={
          <MapControls
            isMobile={isMobile}
            showLayerPanel={showLayerPanel}
            onToggleLayerPanel={() => setShowLayerPanel(!showLayerPanel)}
            addPointMode={addPointMode}
            onAddPointModeChange={(mode) => {
              setAddPointMode(mode);
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
            onZoomIn={() => map?.setZoom((map.getZoom() || 11) + 1)}
            onZoomOut={() => map?.setZoom((map.getZoom() || 11) - 1)}
            onExportCsv={handleExportCsv}
            onExportGeoJson={handleExportGeoJson}
            exportPinCount={atlasPins.length}
            onCopyLink={async () => {
              try {
                await navigator.clipboard.writeText(window.location.href);
                addToast({ type: "success", message: "Link copied to clipboard" });
              } catch {
                addToast({ type: "error", message: "Couldn't copy link — check clipboard permissions" });
                throw new Error("clipboard unavailable");
              }
            }}
          />
        }
      >
        {/* Portalled action buttons — compact style for top bar */}
        <div style={{ position: "relative" }}>
          <button
            onClick={() => {
              if (addPointMode) {
                setAddPointMode(null);
                setShowAddPointMenu(false);
              } else {
                setShowAddPointMenu(!showAddPointMenu);
              }
            }}
            title="Add point (A)"
            className={`map-control-btn ${addPointMode ? "map-control-btn--active" : ""}`}
          >
            {addPointMode ? "\u2715" : "+"}
          </button>
          {showAddPointMenu && !addPointMode && (
            <div className="map-add-point-menu">
              <button onClick={() => { setAddPointMode("place"); setShowAddPointMenu(false); }} className="map-add-point-menu__item">
                Add Place
              </button>
              <button onClick={() => { setAddPointMode("annotation"); setShowAddPointMenu(false); }} className="map-add-point-menu__item">
                Add Note
              </button>
            </div>
          )}
        </div>
        <button
          onClick={handleMeasureToggle}
          title="Measure (D)"
          className={`map-control-btn ${measureActive ? "map-control-btn--active" : ""}`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.4 2.4 0 0 1 0-3.4l2.6-2.6a2.4 2.4 0 0 1 3.4 0z" />
            <path d="m14.5 12.5 2-2" /><path d="m11.5 9.5 2-2" /><path d="m8.5 6.5 2-2" /><path d="m17.5 15.5 2-2" />
          </svg>
        </button>
        <button
          onClick={() => {
            handleExportCsv?.();
          }}
          title="Export (E)"
          className="map-control-btn"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </button>
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(window.location.href);
              addToast({ type: "success", message: "Link copied to clipboard" });
            } catch {
              addToast({ type: "error", message: "Couldn't copy link — check clipboard permissions" });
            }
          }}
          title="Copy link"
          className="map-control-btn"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
        </button>
      </PortalOrInline>

      {/* ── "Return to search" chip ── */}
      {search.navigatedLocation && (selectedPin || selectedPlaceId || selectedPersonId || selectedCatId) && (
        <button
          onClick={() => {
            map?.panTo({ lat: search.navigatedLocation!.lat, lng: search.navigatedLocation!.lng });
            map?.setZoom(Math.max(map?.getZoom() || 18, 18));
            dismissAllSelection();
          }}
          style={{
            position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)",
            zIndex: MAP_Z_INDEX.searchBox - 1,
            background: "var(--background, #fff)", borderRadius: 20,
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            padding: "6px 14px", border: "1px solid var(--border, #e5e7eb)",
            cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
            fontSize: 12, fontWeight: 500, color: "var(--primary, #3b82f6)",
            whiteSpace: "nowrap",
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back to {search.navigatedLocation.address?.split(",")[0] || "search result"}
        </button>
      )}

      {/* ── Layer panel — portalled into sidebar ── */}
      <PortalOrInline
        portalId="map-sidebar-portal"
        fallback={
          showLayerPanel ? (
            <div className={isMobile ? "map-layer-panel--mobile" : "map-layer-panel"}>
              <div className="map-layer-panel__header">
                <div className="map-layer-panel__title">Map Layers</div>
                <div className="map-layer-panel__subtitle">{totalMarkers.toLocaleString()} markers shown</div>
              </div>
              <SavedViewsPanel customViews={customViews} activeViewId={activeViewId} onApplyView={handleApplyView} onSaveView={handleSaveView} onDeleteView={handleDeleteView} />
              <div className="map-layer-panel__zone">
                <div className="map-layer-panel__zone-label">Service Zone</div>
                <select value={selectedZone} onChange={(e) => setSelectedZone(e.target.value)} className="map-layer-panel__zone-select">
                  {SERVICE_ZONES.map((z) => <option key={z} value={z}>{z}</option>)}
                </select>
              </div>
              <div className="map-layer-panel__layers">
                <GroupedLayerControl groups={atlasMapLayerGroups} enabledLayers={enabledLayers} onToggleLayer={toggleLayer} inline counts={atlasSubLayerCounts} pinKey={pinKey} />
              </div>
              <DateRangeFilter fromDate={dateFrom} toDate={dateTo} onDateRangeChange={handleDateRangeChange} />
            </div>
          ) : (
            <DateRangeFilter fromDate={dateFrom} toDate={dateTo} onDateRangeChange={handleDateRangeChange} />
          )
        }
      >
        {/* Portalled sidebar content — always visible when sidebar is open */}
        <div className="map-layer-panel" style={{ position: "static", width: "100%", maxHeight: "none", border: "none", borderRadius: 0, boxShadow: "none", background: "transparent" }}>
          <div className="map-layer-panel__header">
            <div className="map-layer-panel__title">Map Layers</div>
            <div className="map-layer-panel__subtitle">{totalMarkers.toLocaleString()} markers shown</div>
          </div>
          <SavedViewsPanel customViews={customViews} activeViewId={activeViewId} onApplyView={handleApplyView} onSaveView={handleSaveView} onDeleteView={handleDeleteView} />
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--map-control-border)" }}>
            <DateRangeFilter fromDate={dateFrom} toDate={dateTo} onDateRangeChange={handleDateRangeChange} inline />
          </div>
          <div className="map-layer-panel__zone">
            <div className="map-layer-panel__zone-label">Service Zone</div>
            <select value={selectedZone} onChange={(e) => setSelectedZone(e.target.value)} className="map-layer-panel__zone-select">
              {SERVICE_ZONES.map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </div>
          <div className="map-layer-panel__layers">
            <GroupedLayerControl groups={atlasMapLayerGroups} enabledLayers={enabledLayers} onToggleLayer={toggleLayer} inline counts={atlasSubLayerCounts} pinKey={pinKey} />
          </div>
        </div>
      </PortalOrInline>

      {/* ── Time slider (FFS-1174) ── */}
      {showTimeSlider && (
        <MapTimeSlider
          value={dateTo}
          onChange={(iso) => handleDateRangeChange(dateFrom, iso)}
        />
      )}

      {/* ── Legend — bottom-left of map viewport ── */}
      <div className="map-legend-shell">
        <MapPinKey pinConfig={pinConfig} isMobile={isMobile} />
      </div>

      {/* ── Bottom controls — zoom + fullscreen (always in map viewport) ── */}
      <div className="map-bottom-controls">
        <button
          onClick={handleFullscreenToggle}
          title={isFullscreen ? "Exit fullscreen (F)" : "Fullscreen (F)"}
          className={`map-control-btn map-control-btn--icon ${isFullscreen ? "map-control-btn--active" : ""}`}
        >
          {isFullscreen ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" />
              <line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          )}
        </button>
        <div className="map-zoom-controls" role="group" aria-label="Zoom controls">
          <button onClick={() => map?.setZoom((map.getZoom() || 11) + 1)} title="Zoom in (+)" aria-label="Zoom in">+</button>
          <button onClick={() => map?.setZoom((map.getZoom() || 11) - 1)} title="Zoom out (-)" aria-label="Zoom out">{"\u2212"}</button>
        </div>
      </div>

      {/* ── Screen reader announcements ── */}
      <div aria-live="polite" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)" }}>
        {summary ? `Showing ${summary.total_places.toLocaleString()} places` : ""}
      </div>

      {/* ── Measurement panel (Step 6) ── */}
      {measureActive && (
        <MeasurementPanel
          points={measurePoints}
          totalDistance={measureTotalDistance}
          cursorDistance={measureCursorDistance}
          onUndo={undoMeasurePoint}
          onClear={clearMeasurement}
          onCancel={() => setMeasureActive(false)}
        />
      )}

      {/* ── Context menu (Step 5) ── */}
      {contextMenu && (
        <MapContextMenu
          contextMenu={contextMenu}
          onMeasure={handleContextMeasure}
          onDirections={handleContextDirections}
          onStreetView={handleContextStreetView}
          onAddPlace={handleContextAddPlace}
          onAddNote={handleContextAddNote}
          onCopyCoords={handleContextCopyCoords}
        />
      )}

      {/* ── PlacementPanel (Step 12) ── */}
      {pendingClick && addPointMode && (
        <PlacementPanel
          mode={addPointMode}
          coordinates={pendingClick}
          onPlaceSelected={(placeId) => {
            setSelectedPlaceId(placeId);
            setPendingClick(null);
            setAddPointMode(null);
            map?.panTo({ lat: pendingClick.lat, lng: pendingClick.lng });
          }}
          onAnnotationCreated={() => {
            setPendingClick(null);
            setAddPointMode(null);
            fetchAnnotations();
          }}
          onCancel={() => { setPendingClick(null); }}
        />
      )}

      {/* ── Bulk action bar (Step 10) ── */}
      <BulkActionBar
        selectedPlaceIds={bulkSelectedPlaceIds}
        onClear={() => setBulkSelectedPlaceIds(new Set())}
        placeRequestMap={bulkPlaceRequestMap}
        visiblePinCount={visiblePinIds.length}
        onSelectAllVisible={() => setBulkSelectedPlaceIds(new Set(visiblePinIds))}
      />

      {/* ── Location comparison panel (Step 2/9) ── */}
      <LocationComparisonPanel
        placeIds={comparisonPlaceIds}
        onRemovePlace={handleRemoveFromComparison}
        onClear={handleClearComparison}
        onRoutePolyline={handleRoutePolyline}
      />

      {/* ── Street View panel (Step 7) — redesigned split view ── */}
      {streetViewCoords && !streetViewConeOnly && (
        <StreetViewPanel
          coords={streetViewCoords}
          onClose={() => { setStreetViewCoords(null); setStreetViewFullscreen(false); }}
          onPositionChange={(lat, lng) => { streetViewCoordsRef.current = { lat, lng }; }}
          onHeadingChange={setStreetViewHeading}
        />
      )}

      {/* ── Annotation Detail Drawer (Step 2) ── */}
      {selectedAnnotationId && (
        <AnnotationDetailDrawer
          annotationId={selectedAnnotationId}
          onClose={() => setSelectedAnnotationId(null)}
        />
      )}

      {/* ── Place Detail Drawer with BottomSheet on mobile (Step 3) ── */}
      {selectedPlaceId && (
        isMobile ? (
          <BottomSheet
            isOpen={!!selectedPlaceId}
            onClose={() => { setSelectedPlaceId(null); setSelectedPersonId(null); setSelectedCatId(null); }}
            maxHeight={90}
          >
            <PlaceDetailDrawer
              key={selectedPlaceId}
              placeId={selectedPlaceId}
              onClose={() => { setSelectedPlaceId(null); setSelectedPersonId(null); setSelectedCatId(null); }}
              onWatchlistChange={refreshMapData}
              shifted={false}
              coordinates={getPlaceCoords(selectedPlaceId)}
              onAddToComparison={handleAddToComparison}
              comparisonCount={comparisonPlaceIds.length}
              onNavigateCat={setSelectedCatId}
              onNavigatePerson={setSelectedPersonId}
              embedded
            />
          </BottomSheet>
        ) : (
          <PlaceDetailDrawer
            key={selectedPlaceId}
            placeId={selectedPlaceId}
            onClose={() => { setSelectedPlaceId(null); setSelectedPersonId(null); setSelectedCatId(null); }}
            onWatchlistChange={refreshMapData}
            shifted={!!(selectedPersonId || selectedCatId)}
            coordinates={getPlaceCoords(selectedPlaceId)}
            onAddToComparison={handleAddToComparison}
            comparisonCount={comparisonPlaceIds.length}
            onNavigateCat={setSelectedCatId}
            onNavigatePerson={setSelectedPersonId}
          />
        )
      )}

      {/* ── Person Detail Drawer (Step 2) — exclusive with CatDetailDrawer ── */}
      {selectedPersonId && !selectedCatId && (
        <PersonDetailDrawer
          key={selectedPersonId}
          personId={selectedPersonId}
          onClose={() => setSelectedPersonId(null)}
          onNavigateCat={(catId) => { setSelectedPersonId(null); setSelectedCatId(catId); }}
        />
      )}

      {/* ── Cat Detail Drawer (Step 2) — exclusive with PersonDetailDrawer ── */}
      {selectedCatId && !selectedPersonId && (
        <CatDetailDrawer
          key={selectedCatId}
          catId={selectedCatId}
          onClose={() => setSelectedCatId(null)}
          onNavigatePerson={(personId) => { setSelectedCatId(null); setSelectedPersonId(personId); }}
          onNavigatePlace={(placeId) => {
            setSelectedCatId(null);
            setSelectedPersonId(null);
            setSelectedPlaceId(placeId);
          }}
        />
      )}

      {/* ── Loading overlay ── */}
      {loading && (
        <div className="map-loading-overlay" role="status">
          <div className="map-loading-spinner" />
          <span className="map-loading-text">Loading map data...</span>
        </div>
      )}

    </div>
  );
}

// ---------------------------------------------------------------------------
// Root component with APIProvider
// ---------------------------------------------------------------------------

export default function AtlasMapV2({ analystMode = false }: AtlasMapV2Props = {}) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  // CSS fallback to hide any auth error UI Google manages to create.
  // The main gm_authFailure noop is in layout.tsx <head> (runs before Google's script).
  useEffect(() => {
    const style = document.createElement("style");
    style.id = "gm-auth-suppress";
    style.textContent = [
      ".gm-style-pbc { display: none !important; }",
      ".gm-err-container { display: none !important; }",
      ".dismissButton { display: none !important; }",
      'div[style*="background-color: white"][style*="position: absolute"][style*="z-index"] { display: none !important; }',
    ].join("\n");
    if (!document.getElementById("gm-auth-suppress")) {
      document.head.appendChild(style);
    }
    return () => { document.getElementById("gm-auth-suppress")?.remove(); };
  }, []);

  if (!apiKey) {
    return (
      <div style={{ height: "100%", minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>Google Maps API key not configured</div>
        <div style={{ fontSize: 13, color: "#6b7280" }}>Set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY in .env.local</div>
      </div>
    );
  }

  return (
    <MapErrorBoundary>
      <APIProvider apiKey={apiKey} libraries={["visualization", "marker"]} version="quarterly">
        <AtlasMapV2Inner analystMode={analystMode} />
      </APIProvider>
    </MapErrorBoundary>
  );
}
