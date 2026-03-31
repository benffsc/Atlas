"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { APIProvider, Map, AdvancedMarker, AdvancedMarkerAnchorPoint, InfoWindow, useMap, CollisionBehavior } from "@vis.gl/react-google-maps";
import { useMapData } from "@/hooks/useMapData";
import { useMapColors } from "@/hooks/useMapColors";
import { useMapPinConfig } from "@/hooks/useMapPinConfig";
import { useGeoConfig } from "@/hooks/useGeoConfig";
import { useToast } from "@/components/feedback/Toast";
import { fetchApi } from "@/lib/api-client";
import { MAP_COLORS } from "@/lib/map-colors";
import { formatRelativeTime } from "@/lib/formatters";
import { useMapLayers, ATLAS_MAP_LAYER_GROUPS_BASE } from "@/components/map/hooks/useMapLayers";
import { useMapViews } from "@/components/map/hooks/useMapViews";
import { useMapExport } from "@/components/map/hooks/useMapExport";
import { useMapSearchV2 } from "@/components/map/hooks/useMapSearchV2";
import { useMapClustering } from "@/components/map/hooks/useMapClustering";
import { useImperativeMarkers } from "@/components/map/hooks/useImperativeMarkers";
import { MapControls } from "@/components/map/components/MapControls";
import { MeasurementPanel } from "@/components/map/components/MeasurementPanel";
import { SavedViewsPanel } from "@/components/map/components/SavedViewsPanel";
import { SearchResultsPanel } from "@/components/map/components/SearchResultsPanel";
import { MapContextMenu } from "@/components/map/components/MapContextMenu";
import { BottomSheet } from "@/components/map/components/BottomSheet";
import { BulkActionBar } from "@/components/map/components/BulkActionBar";
import { GroupedLayerControl } from "@/components/map/GroupedLayerControl";
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
import { useMapUrlState } from "@/components/map/hooks/useMapUrlState";
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

function AtlasMapV2Inner() {
  const { addToast } = useToast();
  const isMobile = useIsMobile();
  const map = useMap();
  const { mapCenter, mapZoom } = useGeoConfig();
  const { colors } = useMapColors();
  const { pinConfig } = useMapPinConfig();

  // ── Core state ──
  const [loading, setLoading] = useState(true);
  const [showLayerPanel, setShowLayerPanel] = useState(false);
  const [basemap, setBasemap] = useState<BasemapType>("street");
  const [selectedZone, setSelectedZone] = useState("All Zones");
  const [dateFrom, setDateFrom] = useState<string | null>(null);
  const [dateTo, setDateTo] = useState<string | null>(null);
  // ── URL-synced drawer state (Phase 3) ──
  const {
    selectedPlaceId, setSelectedPlaceId,
    selectedPersonId, setSelectedPersonId,
    selectedCatId, setSelectedCatId,
    selectedAnnotationId, setSelectedAnnotationId,
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
  const panoramaRef = useRef<google.maps.StreetViewPanorama | null>(null);
  const panoramaContainerRef = useRef<HTMLDivElement>(null);
  const [streetViewHeading, setStreetViewHeading] = useState(0);

  // ── Bulk selection state (Step 10) ──
  const [bulkSelectedPlaceIds, setBulkSelectedPlaceIds] = useState<Set<string>>(new Set());

  // ── Route polyline state (Step 9) ──
  const [routePolyline, setRoutePolyline] = useState<Array<{ lat: number; lng: number }> | null>(null);

  // ── Annotations state (Step 13) ──
  const [annotations, setAnnotations] = useState<Annotation[]>([]);

  // ── Clustering state (Step 11) ──
  const [mapBounds, setMapBounds] = useState<{ west: number; south: number; east: number; north: number } | null>(null);
  const [mapZoomLevel, setMapZoomLevel] = useState(mapZoom);

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
  }, []);

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

  const search = useMapSearchV2({
    places, googlePins, volunteers, atlasPinsRef,
    map,
    onPlaceSelect: setSelectedPlaceId,
    onPersonSelect: setSelectedPersonId,
    onCatSelect: setSelectedCatId,
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
      setSelectedPin(pin);
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
        const intensity = heatmapMode === "disease" ? (p.disease_count || 0) : Math.max(p.cat_count, 1);
        return intensity > 0 ? { location: new google.maps.LatLng(p.lat, p.lng), weight: intensity } : null;
      })
      .filter(Boolean) as google.maps.visualization.WeightedLocation[];

    if (heatmapLayerRef.current) {
      heatmapLayerRef.current.setData(data);
    } else {
      const gradient = heatmapMode === "disease"
        ? ["rgba(0,0,0,0)", "#fed976", "#fd8d3c", "#e31a1c", "#800026"]
        : ["rgba(0,0,0,0)", "#ffffb2", "#fecc5c", "#fd8d3c", "#f03b20", "#bd0026"];

      heatmapLayerRef.current = new google.maps.visualization.HeatmapLayer({
        data,
        radius: 25,
        maxIntensity: heatmapMode === "disease" ? 5 : 20,
        gradient,
        map,
      });
    }

    return () => {
      heatmapLayerRef.current?.setMap(null);
      heatmapLayerRef.current = null;
    };
  }, [map, atlasPins, heatmapEnabled, heatmapMode]);

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

  // ── Street View (Step 7) — native StreetViewPanorama ──
  useEffect(() => {
    if (!streetViewCoords || streetViewConeOnly) {
      if (panoramaRef.current) {
        panoramaRef.current.setVisible(false);
        panoramaRef.current = null;
      }
      return;
    }
    if (!panoramaContainerRef.current) return;

    const panorama = new google.maps.StreetViewPanorama(panoramaContainerRef.current, {
      position: { lat: streetViewCoords.lat, lng: streetViewCoords.lng },
      pov: { heading: 0, pitch: 0 },
      zoom: 1,
      addressControl: false,
      showRoadLabels: false,
    });
    panoramaRef.current = panorama;

    let svRaf: number | null = null;
    panorama.addListener("pov_changed", () => {
      if (svRaf) return; // throttle to animation frames
      svRaf = requestAnimationFrame(() => {
        svRaf = null;
        setStreetViewHeading(panorama.getPov().heading);
      });
    });

    panorama.addListener("position_changed", () => {
      const pos = panorama.getPosition();
      if (pos) {
        streetViewCoordsRef.current = { lat: pos.lat(), lng: pos.lng() };
      }
    });

    return () => {
      google.maps.event.clearInstanceListeners(panorama);
    };
  }, [streetViewCoords, streetViewConeOnly]);

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
          setShowLayerPanel(prev => !prev);
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
    <div className="map-container-v2" style={{ position: "relative", height: "100dvh", width: "100%" }}>
      <Map
        mapId={process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || "atlas-map-v2"}
        defaultCenter={{ lat: mapCenter[0], lng: mapCenter[1] }}
        defaultZoom={mapZoom}
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

        {/* ── Navigated location marker (Step 13) ── */}
        {search.navigatedLocation && (
          <AdvancedMarker position={{ lat: search.navigatedLocation.lat, lng: search.navigatedLocation.lng }} collisionBehavior={CollisionBehavior.REQUIRED} zIndex={20}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{
                background: "var(--background, #fff)", borderRadius: 6,
                padding: "4px 8px", fontSize: 11, fontWeight: 600,
                boxShadow: "0 2px 6px rgba(0,0,0,0.2)", whiteSpace: "nowrap",
                maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis",
                marginBottom: 4, color: "var(--foreground, #111)",
              }}>
                {search.navigatedLocation.address || "Searched location"}
              </div>
              <div style={{
                width: 20, height: 20, borderRadius: "50%",
                background: "#3b82f6", border: "3px solid white",
                boxShadow: "0 0 0 3px rgba(59,130,246,0.3), 0 2px 6px rgba(0,0,0,0.3)",
                animation: "pulse 2s infinite",
              }} />
            </div>
            <style>{`@keyframes pulse { 0%, 100% { box-shadow: 0 0 0 3px rgba(59,130,246,0.3), 0 2px 6px rgba(0,0,0,0.3); } 50% { box-shadow: 0 0 0 8px rgba(59,130,246,0.1), 0 2px 6px rgba(0,0,0,0.3); } }`}</style>
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
            {(selectedPin.pin_tier === "reference" || selectedPin.pin_style === "reference") ? (
              /* ── Reference pin popup (compact but useful) ── */
              <div style={{ minWidth: 220, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
                  {selectedPin.display_name || selectedPin.address}
                </div>
                <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 6 }}>
                  {selectedPin.service_zone || "Unknown zone"}
                  {selectedPin.place_kind ? ` · ${selectedPin.place_kind.replace(/_/g, " ")}` : ""}
                </div>

                {/* Stats row — show whatever data exists */}
                {(selectedPin.cat_count > 0 || selectedPin.request_count > 0 || selectedPin.person_count > 0 || selectedPin.total_altered > 0) && (
                  <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                    {selectedPin.cat_count > 0 && (
                      <span style={{ background: "#f3f4f6", padding: "2px 8px", borderRadius: 10, fontSize: 11 }}>
                        {selectedPin.cat_count} cat{selectedPin.cat_count !== 1 ? "s" : ""}
                      </span>
                    )}
                    {selectedPin.total_altered > 0 && (
                      <span style={{ background: "#dcfce7", padding: "2px 8px", borderRadius: 10, fontSize: 11, color: "#16a34a" }}>
                        {selectedPin.total_altered} altered
                      </span>
                    )}
                    {selectedPin.request_count > 0 && (
                      <span style={{ background: selectedPin.active_request_count > 0 ? "#fef2f2" : "#f3f4f6", padding: "2px 8px", borderRadius: 10, fontSize: 11, color: selectedPin.active_request_count > 0 ? "#dc2626" : undefined }}>
                        {selectedPin.request_count} request{selectedPin.request_count !== 1 ? "s" : ""}
                      </span>
                    )}
                    {selectedPin.person_count > 0 && (
                      <span style={{ background: "#f3f4f6", padding: "2px 8px", borderRadius: 10, fontSize: 11 }}>
                        {selectedPin.person_count} people
                      </span>
                    )}
                  </div>
                )}

                {selectedPin.last_alteration_at && (
                  <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 6 }}>
                    Last TNR: {formatRelativeTime(selectedPin.last_alteration_at)}
                  </div>
                )}

                {selectedPin.google_summaries?.length > 0 && (
                  <div style={{ fontSize: 12, color: "#374151", marginBottom: 8, fontStyle: "italic", maxHeight: 40, overflow: "hidden", textOverflow: "ellipsis" }}>
                    &ldquo;{selectedPin.google_summaries[0].summary.slice(0, 120)}{selectedPin.google_summaries[0].summary.length > 120 ? "..." : ""}&rdquo;
                  </div>
                )}

                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={() => { setSelectedPlaceId(selectedPin.id); setSelectedPin(null); }}
                    style={{ flex: 1, padding: "6px 12px", background: "#3b82f6", color: "white", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: "pointer" }}
                  >
                    Details
                  </button>
                  <a
                    href={`/places/${selectedPin.id}`}
                    target="_blank"
                    style={{ padding: "6px 12px", background: "#f3f4f6", color: "#374151", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 500, textDecoration: "none" }}
                  >
                    Open Page
                  </a>
                </div>
              </div>
            ) : (
              /* ── Active pin popup (rich) ── */
              <div style={{ minWidth: 280, maxWidth: 340, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
                {/* Header */}
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{selectedPin.address}</div>
                  {selectedPin.disease_risk && (
                    <span style={{ background: "#fef2f2", border: "1px solid #fecaca", padding: "2px 8px", borderRadius: 10, color: "#dc2626", fontWeight: 600, fontSize: 10, whiteSpace: "nowrap", flexShrink: 0 }}>
                      Disease Risk
                    </span>
                  )}
                  {selectedPin.watch_list && !selectedPin.disease_risk && (
                    <span style={{ background: "#f5f3ff", border: "1px solid #c4b5fd", padding: "2px 8px", borderRadius: 10, color: "#7c3aed", fontWeight: 600, fontSize: 10, whiteSpace: "nowrap", flexShrink: 0 }}>
                      Watch List
                    </span>
                  )}
                </div>
                {/* Subtitle */}
                <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 10 }}>
                  {[selectedPin.service_zone, selectedPin.place_kind?.replace(/_/g, " ")].filter(Boolean).join(" · ") || "Unknown zone"}
                </div>

                {/* Stats grid */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 10 }}>
                  <div style={{ background: "#f3f4f6", padding: "6px 4px", borderRadius: 6, textAlign: "center" }}>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>{selectedPin.cat_count}</div>
                    <div style={{ fontSize: 9, color: "#6b7280" }}>Cats</div>
                  </div>
                  <div style={{ background: "#f3f4f6", padding: "6px 4px", borderRadius: 6, textAlign: "center" }}>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>{selectedPin.total_altered}</div>
                    <div style={{ fontSize: 9, color: "#6b7280" }}>Altered</div>
                  </div>
                  <div style={{ background: selectedPin.active_request_count > 0 ? "#fef2f2" : "#f3f4f6", padding: "6px 4px", borderRadius: 6, textAlign: "center" }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: selectedPin.active_request_count > 0 ? "#dc2626" : undefined }}>
                      {selectedPin.active_request_count > 0 ? `${selectedPin.active_request_count}/${selectedPin.request_count}` : selectedPin.request_count}
                    </div>
                    <div style={{ fontSize: 9, color: "#6b7280" }}>{selectedPin.active_request_count > 0 ? "Active/Total" : "Requests"}</div>
                  </div>
                </div>

                {/* Last TNR subtitle */}
                {selectedPin.last_alteration_at && (
                  <div style={{ fontSize: 11, color: "#6b7280", textAlign: "center", marginBottom: 8 }}>
                    Last TNR: {formatRelativeTime(selectedPin.last_alteration_at)}
                  </div>
                )}

                {/* Alert banners */}
                {selectedPin.disease_risk && selectedPin.disease_badges?.length > 0 && (
                  <div style={{ background: "#fef2f2", border: "1px solid #fecaca", padding: "6px 8px", marginBottom: 6, borderRadius: 6, fontSize: 11, color: "#991b1b" }}>
                    <strong>Disease Alert:</strong>{" "}
                    {selectedPin.disease_badges.map(b =>
                      `${b.short_code}${b.positive_cats ? ` (${b.positive_cats} cat${b.positive_cats > 1 ? "s" : ""})` : ""}`
                    ).join(", ")}
                  </div>
                )}
                {selectedPin.watch_list && selectedPin.disease_risk_notes && (
                  <div style={{ background: "#f5f3ff", border: "1px solid #c4b5fd", padding: "6px 8px", marginBottom: 6, borderRadius: 6, fontSize: 11, color: "#5b21b6" }}>
                    <strong>Watch List:</strong> {selectedPin.disease_risk_notes}
                  </div>
                )}
                {selectedPin.needs_trapper_count > 0 && (
                  <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", padding: "6px 8px", marginBottom: 6, borderRadius: 6, fontSize: 11, color: "#c2410c" }}>
                    {selectedPin.needs_trapper_count} request{selectedPin.needs_trapper_count > 1 ? "s" : ""} need{selectedPin.needs_trapper_count === 1 ? "s" : ""} trapper
                  </div>
                )}

                {/* People (compact, with role badges) */}
                {selectedPin.people?.length > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>People</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {selectedPin.people.slice(0, 4).map((p: { name: string; roles: string[]; is_staff: boolean }, i: number) => (
                        <span key={i} style={{
                          display: "inline-flex", alignItems: "center", gap: 3,
                          background: p.is_staff ? "#eef2ff" : "#f3f4f6",
                          padding: "2px 8px", borderRadius: 10, fontSize: 11,
                          color: p.is_staff ? "#4338ca" : "#374151",
                        }}>
                          {p.name}
                          {p.roles?.[0] && (
                            <span style={{ fontSize: 9, color: "#6b7280" }}>[{p.roles[0]}]</span>
                          )}
                        </span>
                      ))}
                      {selectedPin.people.length > 4 && (
                        <span style={{ fontSize: 11, color: "#6b7280", padding: "2px 4px" }}>
                          +{selectedPin.people.length - 4} more
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Action buttons */}
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={() => { setSelectedPlaceId(selectedPin.id); setSelectedPin(null); }}
                    style={{ flex: 1, padding: "7px 10px", background: "#3b82f6", color: "white", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: "pointer" }}
                  >
                    Details
                  </button>
                  <button
                    onClick={() => {
                      setStreetViewCoords({ lat: selectedPin.lat, lng: selectedPin.lng, address: selectedPin.address });
                      setSelectedPin(null);
                    }}
                    style={{ padding: "7px 10px", background: "#f3f4f6", color: "#374151", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: "pointer" }}
                  >
                    Street View
                  </button>
                  <a
                    href={`/places/${selectedPin.id}`}
                    target="_blank"
                    style={{ padding: "7px 10px", background: "#f3f4f6", color: "#374151", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 500, textAlign: "center", textDecoration: "none" }}
                  >
                    Open Page
                  </a>
                </div>
              </div>
            )}
          </InfoWindow>
        )}
      </Map>

      {/* ── Search bar ── */}
      <div ref={searchContainerRef} style={{
        position: "absolute", top: 16, left: "50%", transform: "translateX(-50%)",
        zIndex: MAP_Z_INDEX.searchBox, width: "100%", maxWidth: 600, padding: "0 16px",
      }}>
        <div style={{
          background: "var(--background)", borderRadius: 24,
          boxShadow: "0 2px 6px rgba(0,0,0,0.15), 0 1px 2px rgba(0,0,0,0.1)",
          display: "flex", alignItems: "center", padding: "8px 16px",
        }}>
          <a href="/" title="Back to Atlas" style={{ display: "flex", alignItems: "center", gap: 6, marginRight: 8, textDecoration: "none", color: "var(--text-secondary)", fontWeight: 700, fontSize: 14, flexShrink: 0, padding: "4px 8px 4px 4px", borderRadius: 6 }}>
            <span style={{ fontSize: 16, lineHeight: 1 }}>&#x2190;</span>
            <img src="/logo.png" alt="" style={{ height: 22, width: "auto" }} />
            {!isMobile && <span>Atlas</span>}
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
                <span style={{ fontSize: 14, color: "var(--text-tertiary)" }}>&#x1F50D;</span>
                <span style={{ fontSize: 14 }}>{q}</span>
              </div>
            ))}
          </div>
        )}

        {/* Search results (Step 1) */}
        {search.showResults && search.query && (search.localResults.length > 0 || search.atlasResults.length > 0 || search.poiResults.length > 0 || search.googleSuggestions.length > 0 || search.loading || (search.query.length >= 3 && !search.loading)) && (
          <SearchResultsPanel
            searchResults={search.localResults}
            atlasSearchResults={search.atlasResults}
            googleSuggestions={search.googleSuggestions}
            poiResults={search.poiResults}
            searchLoading={search.loading}
            searchQuery={search.query}
            selectedIndex={searchHighlight}
            onSelectedIndexChange={setSearchHighlight}
            onSearchSelect={(r) => { search.handleLocalSelect(r); if (search.query.length >= 3) addToSearchHistory(search.query); setSearchHighlight(-1); }}
            onAtlasSearchSelect={(r) => { search.handleAtlasSelect(r); if (search.query.length >= 3) addToSearchHistory(search.query); setSearchHighlight(-1); }}
            onGooglePlaceSelect={(p) => { search.handleGoogleSelect(p); setSearchHighlight(-1); }}
            onPoiSelect={(r) => { search.handlePoiSelect(r); setSearchHighlight(-1); }}
            onStreetView={handleStreetViewFromSearch}
            onClearSearch={() => { search.setQuery(""); search.setShowResults(false); }}
          />
        )}
      </div>

      {/* ── Right side controls ── */}
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
      />

      {/* ── Layer panel ── */}
      {showLayerPanel && (
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
            <GroupedLayerControl groups={atlasMapLayerGroups} enabledLayers={enabledLayers} onToggleLayer={toggleLayer} inline counts={atlasSubLayerCounts} />
          </div>
        </div>
      )}

      {/* ── Date range filter ── */}
      <DateRangeFilter fromDate={dateFrom} toDate={dateTo} onDateRangeChange={handleDateRangeChange} />

      {/* Legend removed — layer toggle panel IS the legend (FFS-1021) */}

      {/* ── Stats bar ── */}
      {summary && !isMobile && (
        <div style={{
          position: "absolute", bottom: 24, left: 16, zIndex: MAP_Z_INDEX.statsBar,
          background: "var(--background)", borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
          padding: "10px 16px", display: "flex", gap: 24,
        }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-secondary)" }}>{summary.total_places.toLocaleString()}</div>
            <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>Total Places</div>
          </div>
          <div style={{ borderLeft: "1px solid var(--border-default)", paddingLeft: 24 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-secondary)" }}>{summary.total_cats.toLocaleString()}</div>
            <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>Cats Linked</div>
          </div>
        </div>
      )}

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
      />

      {/* ── Location comparison panel (Step 2/9) ── */}
      <LocationComparisonPanel
        placeIds={comparisonPlaceIds}
        onRemovePlace={handleRemoveFromComparison}
        onClear={handleClearComparison}
        onRoutePolyline={handleRoutePolyline}
      />

      {/* ── Street View panel (Step 7) ── */}
      {streetViewCoords && !streetViewConeOnly && (
        <div
          className={`street-view-panel${streetViewFullscreen ? " fullscreen" : ""}`}
          style={!streetViewFullscreen ? {
            position: "absolute", bottom: 0, left: 0, right: 0, height: 300,
            zIndex: MAP_Z_INDEX.panel, background: "#000",
          } : {
            position: "fixed", inset: 0, zIndex: MAP_Z_INDEX.streetViewFullscreen, background: "#000",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: "rgba(0,0,0,0.7)", color: "white", fontSize: 13 }}>
            <span>{streetViewCoords.address || `${streetViewCoords.lat.toFixed(5)}, ${streetViewCoords.lng.toFixed(5)}`}</span>
            <div style={{ display: "flex", gap: 8 }}>
              <a
                href={`https://www.google.com/maps/@${streetViewCoords.lat},${streetViewCoords.lng},3a,75y,0h,90t/data=!3m4!1e1!3m2!1s!2e0`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#93c5fd", fontSize: 12, textDecoration: "none" }}
              >
                Open in Google Maps
              </a>
              <button onClick={() => setStreetViewFullscreen(prev => !prev)} style={{ background: "none", border: "none", color: "white", cursor: "pointer", fontSize: 14 }}>
                {streetViewFullscreen ? "Exit Fullscreen" : "Fullscreen"}
              </button>
              <button onClick={() => { setStreetViewCoords(null); setStreetViewFullscreen(false); }} style={{ background: "none", border: "none", color: "white", cursor: "pointer", fontSize: 16 }}>
                &#x2715;
              </button>
            </div>
          </div>
          <div ref={panoramaContainerRef} style={{ flex: 1, width: "100%", height: "calc(100% - 40px)" }} />
        </div>
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

      {/* ── Keyboard shortcuts help ── */}
      {!isMobile && (
        <div style={{
          position: "absolute", bottom: 24, right: 16, zIndex: MAP_Z_INDEX.keyboardHelp,
          background: "rgba(255,255,255,0.9)", borderRadius: 6,
          boxShadow: "0 1px 4px rgba(0,0,0,0.1)", padding: "6px 10px",
          fontSize: 10, color: "var(--text-tertiary)",
        }}>
          <kbd style={{ background: "var(--bg-secondary)", padding: "1px 4px", borderRadius: 3 }}>/</kbd> search
          {" "}
          <kbd style={{ background: "var(--bg-secondary)", padding: "1px 4px", borderRadius: 3 }}>L</kbd> layers
          {" "}
          <kbd style={{ background: "var(--bg-secondary)", padding: "1px 4px", borderRadius: 3 }}>D</kbd> measure
          {" "}
          <kbd style={{ background: "var(--bg-secondary)", padding: "1px 4px", borderRadius: 3 }}>A</kbd> add
          {" "}
          <kbd style={{ background: "var(--bg-secondary)", padding: "1px 4px", borderRadius: 3 }}>Esc</kbd> close
        </div>
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

export default function AtlasMapV2() {
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
      <div style={{ height: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>Google Maps API key not configured</div>
        <div style={{ fontSize: 13, color: "#6b7280" }}>Set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY in .env.local</div>
      </div>
    );
  }

  return (
    <APIProvider apiKey={apiKey} libraries={["visualization", "marker"]} version="quarterly">
      <AtlasMapV2Inner />
    </APIProvider>
  );
}
