"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { APIProvider, Map, AdvancedMarker, InfoWindow, useMap } from "@vis.gl/react-google-maps";
import { AtlasPinMarker } from "@/components/map/components/AtlasPinMarker";
import { useMapData } from "@/hooks/useMapData";
import { useMapColors } from "@/hooks/useMapColors";
import { useGeoConfig } from "@/hooks/useGeoConfig";
import { useToast } from "@/components/feedback/Toast";
import { fetchApi } from "@/lib/api-client";
import { MAP_COLORS } from "@/lib/map-colors";
import { useMapLayers, ATLAS_MAP_LAYER_GROUPS_BASE } from "@/components/map/hooks/useMapLayers";
import { useMapViews } from "@/components/map/hooks/useMapViews";
import { useMapExport } from "@/components/map/hooks/useMapExport";
import { useMapSearchV2 } from "@/components/map/hooks/useMapSearchV2";
import { useMapClustering, isCluster, getClusterColor, getClusterSizeClass } from "@/components/map/hooks/useMapClustering";
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
  MapLegend,
  DateRangeFilter,
  LocationComparisonPanel,
  SERVICE_ZONES,
} from "@/components/map";
import { formatDistance } from "@/components/map/hooks/useMeasurement";
import type { BasemapType } from "@/components/map/components/MapControls";
import type {
  AtlasPin,
  Place,
  GooglePin,
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

function getPinColor(style: string): string {
  switch (style) {
    case "disease": return MAP_COLORS.pinStyle.disease;
    case "watch_list": return MAP_COLORS.pinStyle.watch_list;
    case "active": return MAP_COLORS.pinStyle.active;
    case "active_requests": return MAP_COLORS.pinStyle.active_requests;
    case "has_history": return MAP_COLORS.pinStyle.has_history;
    default: return MAP_COLORS.pinStyle.default;
  }
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

const CLUSTER_SIZE_CONFIG = {
  small: { size: 30, fontSize: 12 },
  medium: { size: 40, fontSize: 14 },
  large: { size: 50, fontSize: 16 },
};

// ---------------------------------------------------------------------------
// Inner map component (inside APIProvider)
// ---------------------------------------------------------------------------

function AtlasMapV2Inner() {
  const { addToast } = useToast();
  const isMobile = useIsMobile();
  const map = useMap();
  const { mapCenter, mapZoom } = useGeoConfig();
  const { colors } = useMapColors();

  // ── Core state ──
  const [loading, setLoading] = useState(true);
  const [showLayerPanel, setShowLayerPanel] = useState(false);
  const [showLegend, setShowLegend] = useState(!isMobile);
  const [basemap, setBasemap] = useState<BasemapType>("street");
  const [selectedZone, setSelectedZone] = useState("All Zones");
  const [dateFrom, setDateFrom] = useState<string | null>(null);
  const [dateTo, setDateTo] = useState<string | null>(null);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [selectedPin, setSelectedPin] = useState<AtlasPin | null>(null);

  // ── Drawer state (Step 2) ──
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [selectedCatId, setSelectedCatId] = useState<string | null>(null);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [drawerFromAddPoint, setDrawerFromAddPoint] = useState(false);
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

  // ── Basemap switching ──
  useEffect(() => {
    if (!map) return;
    map.setMapTypeId(basemap === "satellite" ? "hybrid" : "roadmap");
  }, [map, basemap]);

  // ── Clustering (Step 11) ──
  useEffect(() => {
    if (!map) return;
    const listener = map.addListener("idle", () => {
      const bounds = map.getBounds();
      const zoom = map.getZoom();
      if (bounds && zoom !== undefined) {
        setMapBounds({
          west: bounds.getSouthWest().lng(),
          south: bounds.getSouthWest().lat(),
          east: bounds.getNorthEast().lng(),
          north: bounds.getNorthEast().lat(),
        });
        setMapZoomLevel(zoom);
      }
    });
    return () => google.maps.event.removeListener(listener);
  }, [map]);

  const { clusters, getClusterExpansionZoom } = useMapClustering({
    pins: atlasPins,
    bounds: mapBounds,
    zoom: mapZoomLevel,
    enabled: atlasLayerEnabled,
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

  // Draw/redraw measurement polylines & point markers on Google Maps
  useEffect(() => {
    if (!map || !measureActive) {
      // Clean up
      measurePolylineRef.current?.setMap(null);
      measurePolylineRef.current = null;
      measureMarkersRef.current.forEach(m => m.setMap(null));
      measureMarkersRef.current = [];
      return;
    }

    // Remove old
    measurePolylineRef.current?.setMap(null);
    measureMarkersRef.current.forEach(m => m.setMap(null));
    measureMarkersRef.current = [];

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

    return () => {
      polyline.setMap(null);
    };
  }, [map, measureActive, measurePoints]);

  // Rubber band line (no cursor-following label — live distance shows in MeasurementPanel)
  const [measureCursorDistance, setMeasureCursorDistance] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!map || !measureActive || measurePoints.length === 0) {
      rubberBandRef.current?.setMap(null);
      rubberBandRef.current = null;
      setMeasureCursorDistance(0);
      return;
    }

    const lastPt = measurePoints[measurePoints.length - 1];

    const listener = map.addListener("mousemove", (e: google.maps.MapMouseEvent) => {
      if (!e.latLng) return;
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
        setMeasureCursorDistance(measureTotalDistance + segDist);
      });
    });

    return () => {
      google.maps.event.removeListener(listener);
      rubberBandRef.current?.setMap(null);
      rubberBandRef.current = null;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [map, measureActive, measurePoints, measureTotalDistance]);

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

    panorama.addListener("pov_changed", () => {
      setStreetViewHeading(panorama.getPov().heading);
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

  // ── Tippy map context events (Step 14) ──
  useEffect(() => {
    if (!map) return;
    const emitMapContext = () => {
      const center = map.getCenter();
      const bounds = map.getBounds();
      const zoom = map.getZoom();
      if (!center || !bounds || zoom === undefined) return;

      const selectedPlace = selectedPlaceId
        ? atlasPinsRef.current.find(p => p.id === selectedPlaceId) || null
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
          navigatedLocation: search.navigatedLocation,
          drawerOpen: !!selectedPlaceId,
        },
      }));
    };

    const listeners = [
      map.addListener("idle", emitMapContext),
      map.addListener("zoom_changed", emitMapContext),
    ];
    return () => { listeners.forEach(l => google.maps.event.removeListener(l)); };
  }, [map, selectedPlaceId, search.navigatedLocation]);

  // ── Keyboard shortcuts (Step 4) — full set ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        if (e.key === "Escape") {
          (e.target as HTMLElement).blur();
          search.setShowResults(false);
        }
        return;
      }

      switch (e.key) {
        case "/":
          e.preventDefault();
          searchInputRef.current?.focus();
          break;
        case "Escape":
          // Escape cascade — highest-priority UI closes first
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
  }, [map, addPointMode, measureActive, selectedPlaceId, selectedPersonId, selectedCatId, selectedAnnotationId, contextMenu, handleFullscreenToggle, handleMeasureToggle, handleMyLocation, toggleLayer, search]);

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
            setContextMenu(null);
          }
        }}
      >
        {/* ── Clustered markers (Step 11) ── */}
        {clusters.map((feature, idx) => {
          const [lng, lat] = feature.geometry.coordinates;

          if (isCluster(feature)) {
            const pointCount = feature.properties.point_count || 0;
            const color = getClusterColor(feature);
            const sizeClass = getClusterSizeClass(pointCount);
            const { size, fontSize } = CLUSTER_SIZE_CONFIG[sizeClass];

            return (
              <AdvancedMarker
                key={`cluster-${feature.properties.cluster_id}`}
                position={{ lat, lng }}
                onClick={() => {
                  const zoom = getClusterExpansionZoom(feature.properties.cluster_id);
                  map?.panTo({ lat, lng });
                  map?.setZoom(zoom);
                }}
              >
                <div style={{
                  width: size, height: size,
                  background: color, border: "3px solid white", borderRadius: "50%",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "white", fontWeight: 700, fontSize,
                  boxShadow: "0 2px 8px rgba(0,0,0,0.3)", cursor: "pointer",
                }}>
                  {pointCount}
                </div>
              </AdvancedMarker>
            );
          }

          // Individual pin
          const pin = feature.properties.pin;
          if (!pin) return null;

          const isSelected = bulkSelectedPlaceIds.has(pin.id);
          const hasVol = Array.isArray(pin.people) && pin.people.some(
            (p: { roles: string[]; is_staff: boolean }) => p.is_staff || p.roles?.some((r: string) => r === 'trapper' || r === 'foster' || r === 'staff' || r === 'caretaker')
          );

          return (
            <AdvancedMarker
              key={pin.id}
              position={{ lat, lng }}
              onClick={(e) => {
                // Ctrl/Cmd+click for bulk select (Step 10)
                const domEvent = (e as any)?.domEvent as MouseEvent | undefined;
                if (domEvent && (domEvent.ctrlKey || domEvent.metaKey)) {
                  setBulkSelectedPlaceIds(prev => {
                    const next = new Set(prev);
                    if (next.has(pin.id)) next.delete(pin.id);
                    else next.add(pin.id);
                    return next;
                  });
                  return;
                }
                setSelectedPin(pin);
                setSelectedPlaceId(pin.id);
              }}
            >
              <AtlasPinMarker
                color={getPinColor(pin.pin_style)}
                pinStyle={pin.pin_style as any}
                catCount={pin.cat_count}
                hasVolunteer={hasVol}
                needsTrapper={pin.needs_trapper_count > 0}
                diseaseBadges={pin.disease_badges}
                isSelected={isSelected}
                isReference={pin.pin_style === 'has_history' || pin.pin_style === 'minimal'}
              />
            </AdvancedMarker>
          );
        })}

        {/* ── Annotation markers (Step 13) ── */}
        {enabledLayers.atlas_all && annotations.map(ann => (
          <AdvancedMarker
            key={ann.annotation_id}
            position={{ lat: ann.lat, lng: ann.lng }}
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
          <AdvancedMarker position={{ lat: search.navigatedLocation.lat, lng: search.navigatedLocation.lng }}>
            <div style={{
              width: 20, height: 20, borderRadius: "50%",
              background: "#3b82f6", border: "3px solid white",
              boxShadow: "0 0 0 3px rgba(59,130,246,0.3), 0 2px 6px rgba(0,0,0,0.3)",
              animation: "pulse 2s infinite",
            }} />
            <style>{`@keyframes pulse { 0%, 100% { box-shadow: 0 0 0 3px rgba(59,130,246,0.3), 0 2px 6px rgba(0,0,0,0.3); } 50% { box-shadow: 0 0 0 8px rgba(59,130,246,0.1), 0 2px 6px rgba(0,0,0,0.3); } }`}</style>
          </AdvancedMarker>
        )}

        {/* ── Street View cone marker (Step 7) ── */}
        {streetViewCoords && (
          <AdvancedMarker position={{ lat: streetViewCoords.lat, lng: streetViewCoords.lng }}>
            <div style={{ transform: `rotate(${streetViewHeading}deg)`, transition: "transform 0.3s ease" }}>
              <svg width="36" height="36" viewBox="0 0 36 36">
                <path d="M18 2 L30 32 L18 26 L6 32 Z" fill="rgba(59,130,246,0.6)" stroke="#3b82f6" strokeWidth="2" />
              </svg>
            </div>
          </AdvancedMarker>
        )}

        {/* ── Measurement segment distance labels (declarative AdvancedMarkers) ── */}
        {measureActive && measureSegments.map((seg, i) => (
          <AdvancedMarker key={`measure-seg-${i}`} position={{ lat: seg.lat, lng: seg.lng }}>
            <div style={{
              background: "white", borderRadius: 4, padding: "2px 6px",
              fontSize: 12, fontWeight: 600, boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
              whiteSpace: "nowrap", pointerEvents: "none",
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
            <div style={{ minWidth: 240, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>{selectedPin.address}</div>
              {selectedPin.disease_risk && (
                <div style={{ background: "#fef2f2", border: "1px solid #fecaca", padding: 8, marginBottom: 8, borderRadius: 6, color: "#dc2626", fontWeight: 600, fontSize: 13 }}>
                  Disease Risk
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
                <div style={{ background: "#f3f4f6", padding: 8, borderRadius: 6, textAlign: "center" }}>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{selectedPin.cat_count}</div>
                  <div style={{ fontSize: 10, color: "#6b7280" }}>Cats</div>
                </div>
                <div style={{ background: "#f3f4f6", padding: 8, borderRadius: 6, textAlign: "center" }}>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{selectedPin.person_count}</div>
                  <div style={{ fontSize: 10, color: "#6b7280" }}>People</div>
                </div>
                <div style={{ background: "#f3f4f6", padding: 8, borderRadius: 6, textAlign: "center" }}>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{selectedPin.request_count}</div>
                  <div style={{ fontSize: 10, color: "#6b7280" }}>Requests</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => setSelectedPlaceId(selectedPin.id)}
                  style={{ flex: 1, padding: "8px 12px", background: "var(--primary, #3b82f6)", color: "white", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: "pointer" }}
                >
                  Details
                </button>
                <a
                  href={`/places/${selectedPin.id}`}
                  target="_blank"
                  style={{ flex: 1, padding: "8px 12px", background: "#f3f4f6", color: "#374151", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 500, textAlign: "center", textDecoration: "none" }}
                >
                  Open Page
                </a>
              </div>
            </div>
          </InfoWindow>
        )}
      </Map>

      {/* ── Search bar ── */}
      <div style={{
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
            aria-expanded={search.showResults}
            aria-autocomplete="list"
            placeholder={isMobile ? "Search..." : "Search people, places, or cats... (press /)"}
            value={search.query}
            onChange={(e) => { search.setQuery(e.target.value); search.setShowResults(true); }}
            onFocus={() => search.setShowResults(true)}
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
            onSearchSelect={(r) => { search.handleLocalSelect(r); if (search.query.length >= 3) addToSearchHistory(search.query); }}
            onAtlasSearchSelect={(r) => { search.handleAtlasSelect(r); if (search.query.length >= 3) addToSearchHistory(search.query); }}
            onGooglePlaceSelect={(p) => { search.handleGoogleSelect(p); }}
            onPoiSelect={(r) => { search.handlePoiSelect(r); }}
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

      {/* ── Legend ── */}
      {!isMobile && <MapLegend showLegend={showLegend} onToggle={() => setShowLegend(prev => !prev)} colors={colors} />}

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
            setDrawerFromAddPoint(true);
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
            onClose={() => { setSelectedPlaceId(null); setSelectedPersonId(null); setSelectedCatId(null); setDrawerFromAddPoint(false); }}
            initialHeight={45}
            maxHeight={90}
          >
            <PlaceDetailDrawer
              placeId={selectedPlaceId}
              onClose={() => { setSelectedPlaceId(null); setSelectedPersonId(null); setSelectedCatId(null); setDrawerFromAddPoint(false); }}
              onWatchlistChange={refreshMapData}
              showQuickActions={drawerFromAddPoint}
              shifted={false}
              coordinates={getPlaceCoords(selectedPlaceId)}
              onAddToComparison={handleAddToComparison}
              comparisonCount={comparisonPlaceIds.length}
              embedded
            />
          </BottomSheet>
        ) : (
          <PlaceDetailDrawer
            placeId={selectedPlaceId}
            onClose={() => { setSelectedPlaceId(null); setSelectedPersonId(null); setSelectedCatId(null); setDrawerFromAddPoint(false); }}
            onWatchlistChange={refreshMapData}
            showQuickActions={drawerFromAddPoint}
            shifted={!!(selectedPersonId || selectedCatId)}
            coordinates={getPlaceCoords(selectedPlaceId)}
            onAddToComparison={handleAddToComparison}
            comparisonCount={comparisonPlaceIds.length}
          />
        )
      )}

      {/* ── Person Detail Drawer (Step 2) ── */}
      {selectedPersonId && (
        <PersonDetailDrawer
          personId={selectedPersonId}
          onClose={() => setSelectedPersonId(null)}
        />
      )}

      {/* ── Cat Detail Drawer (Step 2) ── */}
      {selectedCatId && (
        <CatDetailDrawer
          catId={selectedCatId}
          onClose={() => setSelectedCatId(null)}
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

      {/* ── V2 badge ── */}
      <div style={{
        position: "absolute", bottom: isMobile ? 8 : 56, right: isMobile ? 8 : 160, zIndex: 10,
        background: "rgba(59,130,246,0.9)", color: "white", padding: "4px 10px",
        borderRadius: 6, fontSize: 11, fontWeight: 600,
      }}>
        Google Maps V2
      </div>
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
    <APIProvider apiKey={apiKey} libraries={["visualization", "marker"]}>
      <AtlasMapV2Inner />
    </APIProvider>
  );
}
