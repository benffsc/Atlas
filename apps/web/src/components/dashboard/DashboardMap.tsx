"use client";

import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { APIProvider, Map, AdvancedMarker, InfoWindow, useMap } from "@vis.gl/react-google-maps";
import Supercluster from "supercluster";
import {
  GroupedLayerControl,
  type LayerGroup,
} from "@/components/map/GroupedLayerControl";
import type { AtlasPin } from "@/hooks/useMapData";
import type { AtlasSearchResult, PlacePrediction } from "@/components/map/types";
import { fetchApi } from "@/lib/api-client";
import { useGeoConfig } from "@/hooks/useGeoConfig";

export interface DashboardMapPin {
  request_id: string;
  status: string;
  priority: string;
  summary: string | null;
  place_name: string | null;
  place_address: string | null;
  lat: number;
  lng: number;
  estimated_cat_count: number | null;
  has_kittens: boolean;
  created_at: string;
  layer?: string;
}

export type MapLayer = "active" | "all" | "completed" | "intake";

interface DashboardMapProps {
  requestPins: DashboardMapPin[];
  intakePins: DashboardMapPin[];
  atlasPins: AtlasPin[];
  enabledLayers: Record<string, boolean>;
  onToggleLayer: (layerId: string) => void;
  onPinClick: (entityType: "request" | "place", entityId: string) => void;
  onSearch: (query: string) => void;
  loading?: boolean;
  layerCounts?: Record<string, number>;
}

// Pin style → color (matches AtlasMap.tsx — 4-color urgency palette)
const ATLAS_PIN_COLORS: Record<string, string> = {
  disease: "#dc2626",
  watch_list: "#d97706",
  active: "#3b82f6",
  active_requests: "#3b82f6",
  reference: "#94a3b8",
};

// Match StatusBadge + design-tokens exactly
const STATUS_COLORS: Record<string, string> = {
  new: "#3b82f6",
  triaged: "#3b82f6",
  working: "#f59e0b",
  scheduled: "#f59e0b",
  in_progress: "#f59e0b",
  paused: "#ec4899",
  on_hold: "#ec4899",
  completed: "#10b981",
  redirected: "#9ca3af",
  handed_off: "#0d9488",
  cancelled: "#9ca3af",
  default: "#9ca3af",
};

const PRIORITY_LABELS: Record<string, string> = {
  urgent: "Urgent",
  high: "High",
  normal: "Normal",
  low: "Low",
};

// Cluster colors per layer (matches old Leaflet createClusterGroup colors)
const LAYER_CLUSTER_COLORS: Record<string, string> = {
  requests: "#3b82f6",
  intake: "#f97316",
  atlas: "#22c55e",
};

/** Dashboard layer group definitions */
export const DASHBOARD_LAYER_GROUPS: LayerGroup[] = [
  {
    id: "requests",
    label: "Requests",
    icon: "\u{1F4CB}",
    color: "#3b82f6",
    defaultExpanded: true,
    exclusive: true,
    children: [
      { id: "requests_active", label: "Active", color: "#3b82f6", defaultEnabled: true },
      { id: "requests_all", label: "All", color: "#9ca3af", defaultEnabled: false },
      { id: "requests_completed", label: "Completed", color: "#10b981", defaultEnabled: false },
    ],
  },
  {
    id: "intake",
    label: "Intake",
    icon: "\u{1F4E5}",
    color: "#f97316",
    defaultExpanded: false,
    children: [
      { id: "intake_pending", label: "Pending", color: "#f97316", defaultEnabled: false },
    ],
  },
  {
    id: "atlas",
    label: "Atlas Data",
    icon: "\u{1F4CD}",
    color: "#22c55e",
    defaultExpanded: false,
    children: [
      { id: "atlas_all", label: "All Places", color: "#22c55e", defaultEnabled: false },
      { id: "atlas_disease", label: "Disease Risk", color: "#ea580c", defaultEnabled: false },
      { id: "atlas_watch", label: "Watch List", color: "#8b5cf6", defaultEnabled: false },
      { id: "out_of_county", label: "Out of County", color: "#ef4444", defaultEnabled: false },
    ],
  },
];

/** Get default enabled layers from group definitions */
export function getDefaultEnabledLayers(): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const group of DASHBOARD_LAYER_GROUPS) {
    for (const child of group.children) {
      if (child.defaultEnabled) result[child.id] = true;
    }
  }
  return result;
}

function getPinColor(pin: DashboardMapPin): string {
  if (pin.layer === "intake") return "#f97316";
  return STATUS_COLORS[pin.status] || STATUS_COLORS.default;
}

function formatStatus(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

// ---------------------------------------------------------------------------
// Clustering helpers (mirrors old Leaflet markercluster behavior)
// ---------------------------------------------------------------------------

interface ClusterPoint {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    layer: "requests" | "intake" | "atlas";
    requestPin?: DashboardMapPin;
    atlasPin?: AtlasPin;
  };
}

interface ClusterResult {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    cluster?: boolean;
    cluster_id?: number;
    point_count?: number;
    // For individual pins
    layer?: "requests" | "intake" | "atlas";
    requestPin?: DashboardMapPin;
    atlasPin?: AtlasPin;
  };
}

function useDashboardClusters(
  requestPins: DashboardMapPin[],
  intakePins: DashboardMapPin[],
  atlasPins: AtlasPin[],
  enabledLayers: Record<string, boolean>,
  bounds: { west: number; south: number; east: number; north: number } | null,
  zoom: number,
) {
  // Build SuperCluster instances per layer (matches old Leaflet createClusterGroup per-layer pattern)
  const requestIndex = useMemo(() => {
    const sc = new Supercluster({ radius: 45, maxZoom: 15, minPoints: 2 });
    const show = enabledLayers.requests_active || enabledLayers.requests_all || enabledLayers.requests_completed;
    if (!show) { sc.load([]); return sc; }
    const features: ClusterPoint[] = requestPins
      .filter(p => p.lat && p.lng)
      .map(pin => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [pin.lng, pin.lat] as [number, number] },
        properties: { layer: "requests" as const, requestPin: pin },
      }));
    sc.load(features);
    return sc;
  }, [requestPins, enabledLayers]);

  const intakeIndex = useMemo(() => {
    const sc = new Supercluster({ radius: 45, maxZoom: 15, minPoints: 2 });
    if (!enabledLayers.intake_pending) { sc.load([]); return sc; }
    const features: ClusterPoint[] = intakePins
      .filter(p => p.lat && p.lng)
      .map(pin => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [pin.lng, pin.lat] as [number, number] },
        properties: { layer: "intake" as const, requestPin: pin },
      }));
    sc.load(features);
    return sc;
  }, [intakePins, enabledLayers]);

  const atlasIndex = useMemo(() => {
    const sc = new Supercluster({ radius: 45, maxZoom: 15, minPoints: 2 });
    const showAtlas = enabledLayers.atlas_all || enabledLayers.atlas_disease || enabledLayers.atlas_watch;
    if (!showAtlas) { sc.load([]); return sc; }
    const filtered = atlasPins.filter(pin => {
      if (!pin.lat || !pin.lng) return false;
      if (enabledLayers.atlas_all) return true;
      if (enabledLayers.atlas_disease && pin.pin_style === "disease") return true;
      if (enabledLayers.atlas_watch && pin.pin_style === "watch_list") return true;
      return false;
    });
    const features: ClusterPoint[] = filtered.map(pin => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [pin.lng, pin.lat] as [number, number] },
      properties: { layer: "atlas" as const, atlasPin: pin },
    }));
    sc.load(features);
    return sc;
  }, [atlasPins, enabledLayers]);

  // Get clusters for current viewport
  const clusters = useMemo(() => {
    if (!bounds) return { requests: [] as ClusterResult[], intake: [] as ClusterResult[], atlas: [] as ClusterResult[] };
    const bbox: [number, number, number, number] = [bounds.west, bounds.south, bounds.east, bounds.north];
    return {
      requests: requestIndex.getClusters(bbox, zoom) as ClusterResult[],
      intake: intakeIndex.getClusters(bbox, zoom) as ClusterResult[],
      atlas: atlasIndex.getClusters(bbox, zoom) as ClusterResult[],
    };
  }, [requestIndex, intakeIndex, atlasIndex, bounds, zoom]);

  const getExpansionZoom = useCallback((layer: "requests" | "intake" | "atlas", clusterId: number) => {
    try {
      const idx = layer === "requests" ? requestIndex : layer === "intake" ? intakeIndex : atlasIndex;
      return idx.getClusterExpansionZoom(clusterId);
    } catch { return zoom + 2; }
  }, [requestIndex, intakeIndex, atlasIndex, zoom]);

  const getClusterLeaves = useCallback((layer: "requests" | "intake" | "atlas", clusterId: number) => {
    const idx = layer === "requests" ? requestIndex : layer === "intake" ? intakeIndex : atlasIndex;
    return idx.getLeaves(clusterId, Infinity) as ClusterResult[];
  }, [requestIndex, intakeIndex, atlasIndex]);

  return { clusters, getExpansionZoom, getClusterLeaves };
}

// ---------------------------------------------------------------------------
// Cluster bubble component
// ---------------------------------------------------------------------------

function ClusterBubble({ count, color }: { count: number; color: string }) {
  const sizeClass = count < 10 ? "small" : count < 50 ? "medium" : "large";
  const alpha = count < 10 ? 0.7 : count < 50 ? 0.75 : 0.8;
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);

  return (
    <div className="map-cluster-icon">
      <div
        className={`map-cluster map-cluster--${sizeClass}`}
        style={{ "--cluster-color": `rgba(${r}, ${g}, ${b}, ${alpha})` } as React.CSSProperties}
      >
        {count}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Spiderfy-lite: spiral offset when cluster can't expand further
// ---------------------------------------------------------------------------

interface ExpandedCluster {
  layer: "requests" | "intake" | "atlas";
  clusterId: number;
  lat: number;
  lng: number;
}

function spiralOffset(index: number, count: number): { dlat: number; dlng: number } {
  const angle = index * (2 * Math.PI / count);
  const SPIRAL_FOOT = 13;
  const SPIRAL_LENGTH_START = 11;
  const SPIRAL_LENGTH_FACTOR = 5;
  const radius = SPIRAL_FOOT + SPIRAL_LENGTH_START + index * SPIRAL_LENGTH_FACTOR;
  const pixelScale = 0.00003; // approx lat/lng per pixel at zoom 16
  return { dlat: Math.sin(angle) * radius * pixelScale, dlng: Math.cos(angle) * radius * pixelScale };
}

// ---------------------------------------------------------------------------
// Map search combobox — Atlas results + Google Places, keyboard nav, recents
// ---------------------------------------------------------------------------

const RECENT_SEARCHES_KEY = "dashboard-map-recent-searches";
const MAX_RECENTS = 5;

interface SearchItem {
  id: string;
  kind: "atlas" | "google" | "recent";
  label: string;
  subtitle?: string;
  entityType?: string;
  lat?: number;
  lng?: number;
  placeId?: string; // Google place_id
}

function getRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveRecentSearch(query: string) {
  try {
    const recents = getRecentSearches().filter(r => r !== query);
    recents.unshift(query);
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(recents.slice(0, MAX_RECENTS)));
  } catch { /* localStorage unavailable */ }
}

function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query || query.length < 2) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <strong>{text.slice(idx, idx + query.length)}</strong>
      {text.slice(idx + query.length)}
    </>
  );
}

const ENTITY_ICONS: Record<string, string> = {
  place: "\u{1F4CD}",
  person: "\u{1F464}",
  cat: "\u{1F431}",
  request: "\u{1F4CB}",
  intake: "\u{1F4E5}",
  google: "\u{1F30E}",
  recent: "\u{1F552}",
};

function DashboardMapSearch({
  onFilterPins,
  map,
  onPinClick,
  onNavigate,
}: {
  onFilterPins: (query: string) => void;
  map: google.maps.Map | null;
  onPinClick: (entityType: "request" | "place", entityId: string) => void;
  onNavigate: (pin: { lat: number; lng: number; label: string } | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<SearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const filterTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced pin filter (existing behavior)
  const handleInput = useCallback((value: string) => {
    setQuery(value);
    setActiveIdx(-1);
    if (filterTimeoutRef.current) clearTimeout(filterTimeoutRef.current);
    filterTimeoutRef.current = setTimeout(() => onFilterPins(value), 400);
  }, [onFilterPins]);

  // Fetch suggestions when query changes (3+ chars)
  useEffect(() => {
    if (query.length < 3) {
      setItems([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const [atlasRes, googleRes] = await Promise.allSettled([
          fetchApi<{ suggestions?: AtlasSearchResult[] }>(
            `/api/search?q=${encodeURIComponent(query)}&limit=5&suggestions=true`,
            { signal: controller.signal },
          ),
          fetchApi<{ predictions?: PlacePrediction[] }>(
            `/api/places/autocomplete?input=${encodeURIComponent(query)}`,
            { signal: controller.signal },
          ),
        ]);

        if (controller.signal.aborted) return;

        const atlas = atlasRes.status === "fulfilled" ? atlasRes.value?.suggestions || [] : [];
        const google = googleRes.status === "fulfilled" ? googleRes.value?.predictions || [] : [];

        const newItems: SearchItem[] = [];

        // Atlas results (up to 5)
        for (const r of atlas.slice(0, 5)) {
          newItems.push({
            id: `atlas-${r.entity_id}`,
            kind: "atlas",
            label: r.display_name,
            subtitle: r.subtitle || undefined,
            entityType: r.entity_type,
            lat: r.metadata?.lat,
            lng: r.metadata?.lng,
          });
        }

        // Google Places (up to 3, suppressed if Atlas has 5+ results)
        if (atlas.length < 5) {
          for (const p of google.slice(0, 3)) {
            newItems.push({
              id: `google-${p.place_id}`,
              kind: "google",
              label: p.structured_formatting.main_text,
              subtitle: p.structured_formatting.secondary_text,
              placeId: p.place_id,
            });
          }
        }

        setItems(newItems);
        setLoading(false);
      } catch {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [query]);

  // Show recents on focus with empty query
  const handleFocus = () => {
    setOpen(true);
    if (!query) {
      const recents = getRecentSearches();
      setItems(recents.map((r, i) => ({
        id: `recent-${i}`,
        kind: "recent" as const,
        label: r,
      })));
    }
  };

  // Navigate to coordinates
  const panTo = useCallback((lat: number, lng: number, zoom = 15) => {
    if (!map) return;
    map.panTo({ lat, lng });
    map.setZoom(zoom);
  }, [map]);

  // Handle selecting a result
  const handleSelect = useCallback(async (item: SearchItem) => {
    setOpen(false);
    saveRecentSearch(item.label);

    if (item.kind === "recent") {
      // Re-run the search with this text
      setQuery(item.label);
      onFilterPins(item.label);
      return;
    }

    if (item.kind === "atlas") {
      if (item.lat && item.lng) {
        panTo(item.lat, item.lng);
        onNavigate({ lat: item.lat, lng: item.lng, label: item.label });
      }
      // Also open preview if it's a place or request
      if (item.entityType === "place") {
        onPinClick("place", item.id.replace("atlas-", ""));
      } else if (item.entityType === "request") {
        onPinClick("request", item.id.replace("atlas-", ""));
      }
      setQuery("");
      onFilterPins("");
      return;
    }

    if (item.kind === "google" && item.placeId) {
      try {
        const data = await fetchApi<{
          place: { geometry?: { location?: { lat: number; lng: number } }; formatted_address?: string };
        }>(`/api/places/details?place_id=${item.placeId}`);
        const loc = data.place?.geometry?.location;
        if (loc) {
          panTo(loc.lat, loc.lng);
          onNavigate({ lat: loc.lat, lng: loc.lng, label: data.place?.formatted_address || item.label });
        }
      } catch { /* details lookup failed */ }
      setQuery("");
      onFilterPins("");
    }
  }, [map, panTo, onPinClick, onFilterPins, onNavigate]);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;
    const selectable = items;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx(prev => (prev + 1) % selectable.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx(prev => (prev <= 0 ? selectable.length - 1 : prev - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIdx >= 0 && activeIdx < selectable.length) {
        handleSelect(selectable[activeIdx]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIdx(-1);
    }
  };

  // Scroll active item into view
  useEffect(() => {
    if (activeIdx < 0 || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${activeIdx}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (inputRef.current && !inputRef.current.closest(".dashboard-map-search")?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Group items by kind for section headers
  const atlasItems = items.filter(i => i.kind === "atlas");
  const googleItems = items.filter(i => i.kind === "google");
  const recentItems = items.filter(i => i.kind === "recent");
  const hasResults = items.length > 0;
  const showDropdown = open && (hasResults || loading || query.length >= 3);

  return (
    <div className="dashboard-map-search" style={{ position: "relative" }}>
      <div className="dms-input-wrap">
        <svg className="dms-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          placeholder="Search places, addresses..."
          value={query}
          onChange={e => handleInput(e.target.value)}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          className="map-search-input dms-input"
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls="dms-listbox"
          aria-activedescendant={activeIdx >= 0 ? `dms-item-${activeIdx}` : undefined}
          aria-autocomplete="list"
          aria-label="Search places and addresses"
        />
        {query && (
          <button
            className="dms-clear"
            onClick={() => { setQuery(""); onFilterPins(""); setItems([]); inputRef.current?.focus(); }}
            aria-label="Clear search"
          >
            &times;
          </button>
        )}
      </div>

      {showDropdown && (
        <div id="dms-listbox" role="listbox" ref={listRef} className="dms-dropdown">
          {/* Recent searches */}
          {recentItems.length > 0 && (
            <>
              <div className="dms-section-header">Recent</div>
              {recentItems.map((item, i) => {
                const globalIdx = items.indexOf(item);
                return (
                  <div
                    key={item.id}
                    data-idx={globalIdx}
                    id={`dms-item-${globalIdx}`}
                    role="option"
                    aria-selected={globalIdx === activeIdx}
                    className={`dms-item${globalIdx === activeIdx ? " dms-item--active" : ""}`}
                    onClick={() => handleSelect(item)}
                    onMouseEnter={() => setActiveIdx(globalIdx)}
                  >
                    <span className="dms-item-icon">{ENTITY_ICONS.recent}</span>
                    <span className="dms-item-label">{item.label}</span>
                  </div>
                );
              })}
            </>
          )}

          {/* Atlas results */}
          {atlasItems.length > 0 && (
            <>
              <div className="dms-section-header">In Atlas</div>
              {atlasItems.map((item) => {
                const globalIdx = items.indexOf(item);
                return (
                  <div
                    key={item.id}
                    data-idx={globalIdx}
                    id={`dms-item-${globalIdx}`}
                    role="option"
                    aria-selected={globalIdx === activeIdx}
                    className={`dms-item${globalIdx === activeIdx ? " dms-item--active" : ""}`}
                    onClick={() => handleSelect(item)}
                    onMouseEnter={() => setActiveIdx(globalIdx)}
                  >
                    <span className="dms-item-icon">{ENTITY_ICONS[item.entityType || "place"]}</span>
                    <div className="dms-item-content">
                      <span className="dms-item-label">
                        <HighlightMatch text={item.label} query={query} />
                      </span>
                      {item.subtitle && (
                        <span className="dms-item-subtitle">{item.subtitle}</span>
                      )}
                    </div>
                    <span className="dms-item-badge" data-kind={item.entityType}>
                      {item.entityType?.toUpperCase()}
                    </span>
                  </div>
                );
              })}
            </>
          )}

          {/* Google Places */}
          {googleItems.length > 0 && (
            <>
              <div className="dms-section-header">Addresses</div>
              {googleItems.map((item) => {
                const globalIdx = items.indexOf(item);
                return (
                  <div
                    key={item.id}
                    data-idx={globalIdx}
                    id={`dms-item-${globalIdx}`}
                    role="option"
                    aria-selected={globalIdx === activeIdx}
                    className={`dms-item${globalIdx === activeIdx ? " dms-item--active" : ""}`}
                    onClick={() => handleSelect(item)}
                    onMouseEnter={() => setActiveIdx(globalIdx)}
                  >
                    <span className="dms-item-icon">{ENTITY_ICONS.google}</span>
                    <div className="dms-item-content">
                      <span className="dms-item-label">
                        <HighlightMatch text={item.label} query={query} />
                      </span>
                      {item.subtitle && (
                        <span className="dms-item-subtitle">{item.subtitle}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {/* Loading skeleton */}
          {loading && items.length === 0 && (
            <div className="dms-loading">
              {[1, 2, 3].map(n => (
                <div key={n} className="dms-skeleton-row">
                  <div className="dms-skeleton-circle" />
                  <div className="dms-skeleton-lines">
                    <div className="dms-skeleton-line dms-skeleton-line--long" />
                    <div className="dms-skeleton-line dms-skeleton-line--short" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Empty state */}
          {!loading && query.length >= 3 && items.length === 0 && (
            <div className="dms-empty">
              <span>No results for &ldquo;{query}&rdquo;</span>
              <span className="dms-empty-hint">Try a different address or name</span>
            </div>
          )}

          {/* Live region for screen readers */}
          <div aria-live="polite" className="sr-only">
            {!loading && items.length > 0 && `${items.length} result${items.length !== 1 ? "s" : ""} found`}
            {!loading && query.length >= 3 && items.length === 0 && "No results found"}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inner map component (inside APIProvider)
// ---------------------------------------------------------------------------

function DashboardMapInner({
  requestPins,
  intakePins,
  atlasPins,
  enabledLayers,
  onToggleLayer,
  onPinClick,
  onSearch,
  loading,
  layerCounts,
}: DashboardMapProps) {
  const { mapCenter, mapZoom } = useGeoConfig();
  const map = useMap();
  const [infoPin, setInfoPin] = useState<{ type: "request" | "atlas"; pin: DashboardMapPin | AtlasPin } | null>(null);
  const [navigatedPin, setNavigatedPin] = useState<{ lat: number; lng: number; label: string } | null>(null);

  // Track map bounds + zoom for SuperCluster
  const [mapBounds, setMapBounds] = useState<{ west: number; south: number; east: number; north: number } | null>(null);
  const [currentZoom, setCurrentZoom] = useState(mapZoom);

  useEffect(() => {
    if (!map) return;
    const update = () => {
      const b = map.getBounds();
      const z = map.getZoom();
      if (b) {
        setMapBounds({
          west: b.getSouthWest().lng(),
          south: b.getSouthWest().lat(),
          east: b.getNorthEast().lng(),
          north: b.getNorthEast().lat(),
        });
      }
      if (z != null) setCurrentZoom(z);
    };
    // Initial update after idle
    const idleListener = map.addListener("idle", update);
    // Also update on bounds_changed (throttled by idle)
    update();
    return () => { google.maps.event.removeListener(idleListener); };
  }, [map]);

  // Clustering
  const { clusters, getExpansionZoom, getClusterLeaves } = useDashboardClusters(
    requestPins, intakePins, atlasPins, enabledLayers, mapBounds, currentZoom,
  );

  // Spiderfy-lite: expanded cluster at max zoom
  const [expandedCluster, setExpandedCluster] = useState<ExpandedCluster | null>(null);

  // Fit bounds when data loads (only once)
  const hasFittedRef = useRef(false);
  useEffect(() => {
    if (!map || hasFittedRef.current) return;

    const allCoords: Array<{ lat: number; lng: number }> = [];
    const showRequests = enabledLayers.requests_active || enabledLayers.requests_all || enabledLayers.requests_completed;
    if (showRequests) requestPins.forEach(p => { if (p.lat && p.lng) allCoords.push({ lat: p.lat, lng: p.lng }); });
    if (enabledLayers.intake_pending) intakePins.forEach(p => { if (p.lat && p.lng) allCoords.push({ lat: p.lat, lng: p.lng }); });
    const showAtlas = enabledLayers.atlas_all || enabledLayers.atlas_disease || enabledLayers.atlas_watch;
    if (showAtlas) atlasPins.forEach(p => { if (p.lat && p.lng) allCoords.push({ lat: p.lat, lng: p.lng }); });

    if (allCoords.length > 0) {
      hasFittedRef.current = true;
      const bounds = new google.maps.LatLngBounds();
      allCoords.forEach(c => bounds.extend(c));
      map.fitBounds(bounds, { top: 40, right: 40, bottom: 40, left: 40 });
      const listener = map.addListener("idle", () => {
        const z = map.getZoom();
        if (z && z > 13) map.setZoom(13);
        google.maps.event.removeListener(listener);
      });
    }
  }, [map, requestPins, intakePins, atlasPins, enabledLayers]);

  // Total visible pin count (individual + clustered)
  const totalPins = useMemo(() => {
    const showReq = enabledLayers.requests_active || enabledLayers.requests_all || enabledLayers.requests_completed;
    const showAtlas = enabledLayers.atlas_all || enabledLayers.atlas_disease || enabledLayers.atlas_watch;
    return (showReq ? requestPins.filter(p => p.lat && p.lng).length : 0)
      + (enabledLayers.intake_pending ? intakePins.filter(p => p.lat && p.lng).length : 0)
      + (showAtlas ? atlasPins.filter(p => p.lat && p.lng).length : 0);
  }, [requestPins, intakePins, atlasPins, enabledLayers]);

  const handleClusterClick = (layer: "requests" | "intake" | "atlas", clusterId: number, lat: number, lng: number) => {
    if (!map) return;
    const expansionZoom = getExpansionZoom(layer, clusterId);
    if (expansionZoom > 16) {
      // Max zoom reached — expand leaves with spiral offset (spiderfy-lite)
      setExpandedCluster({ layer, clusterId, lat, lng });
    } else {
      setExpandedCluster(null);
      map.setCenter({ lat, lng });
      map.setZoom(Math.min(expansionZoom, 16));
    }
  };

  // Enable scroll-wheel zoom after first click on map + clear spiderfy
  useEffect(() => {
    if (!map) return;
    let greedySet = false;
    const listener = map.addListener("click", () => {
      setExpandedCluster(null);
      setNavigatedPin(null);
      if (!greedySet) {
        map.setOptions({ gestureHandling: "greedy" });
        greedySet = true;
      }
    });
    return () => { google.maps.event.removeListener(listener); };
  }, [map]);

  return (
    <div className="dashboard-map-container">
      {/* Controls overlay */}
      <div className="dashboard-map-controls">
        <GroupedLayerControl
          groups={DASHBOARD_LAYER_GROUPS}
          enabledLayers={enabledLayers}
          onToggleLayer={onToggleLayer}
          counts={layerCounts}
          compact
        />
        <DashboardMapSearch
          onFilterPins={onSearch}
          map={map}
          onPinClick={onPinClick}
          onNavigate={setNavigatedPin}
        />
      </div>

      {/* Pin count badge */}
      <div className="dashboard-map-count">
        {totalPins} pin{totalPins !== 1 ? "s" : ""}
        {loading && " ..."}
      </div>

      {loading && totalPins === 0 && (
        <div className="dashboard-map-skeleton">
          <span>Loading map...</span>
        </div>
      )}

      <Map
        mapId={process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || "atlas-map-v2"}
        defaultCenter={{ lat: mapCenter[0], lng: mapCenter[1] }}
        defaultZoom={mapZoom}
        gestureHandling="cooperative"
        disableDefaultUI
        style={{ width: "100%", height: "100%", minHeight: "500px" }}
      >
        {/* ── Request layer (clusters + individual) ── */}
        {clusters.requests.map((feature) => {
          const [lng, lat] = feature.geometry.coordinates;
          if (feature.properties.cluster) {
            return (
              <AdvancedMarker
                key={`req-c-${feature.properties.cluster_id}`}
                position={{ lat, lng }}
                zIndex={5}
                onClick={() => handleClusterClick("requests", feature.properties.cluster_id!, lat, lng)}
              >
                <ClusterBubble count={feature.properties.point_count!} color={LAYER_CLUSTER_COLORS.requests} />
              </AdvancedMarker>
            );
          }
          const pin = feature.properties.requestPin!;
          const color = getPinColor(pin);
          const isActive = ["new", "triaged", "working", "scheduled", "in_progress"].includes(pin.status);
          const isUrgent = pin.priority === "urgent";
          const size = isActive ? 18 : 12;
          return (
            <AdvancedMarker
              key={`req-${pin.request_id}`}
              position={{ lat, lng }}
              zIndex={isActive ? 3 : 1}
              onClick={() => { setInfoPin({ type: "request", pin }); onPinClick("request", pin.request_id); }}
            >
              <div
                className={isActive ? `dashboard-pin-active${isUrgent ? " dashboard-pin-urgent" : ""}` : "dashboard-pin-completed"}
                style={{
                  width: size, height: size, background: color,
                  borderRadius: "50%", border: "2px solid #fff",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.3)", cursor: "pointer",
                }}
              />
            </AdvancedMarker>
          );
        })}

        {/* ── Intake layer (clusters + individual) ── */}
        {clusters.intake.map((feature) => {
          const [lng, lat] = feature.geometry.coordinates;
          if (feature.properties.cluster) {
            return (
              <AdvancedMarker
                key={`int-c-${feature.properties.cluster_id}`}
                position={{ lat, lng }}
                zIndex={5}
                onClick={() => handleClusterClick("intake", feature.properties.cluster_id!, lat, lng)}
              >
                <ClusterBubble count={feature.properties.point_count!} color={LAYER_CLUSTER_COLORS.intake} />
              </AdvancedMarker>
            );
          }
          const pin = feature.properties.requestPin!;
          return (
            <AdvancedMarker
              key={`intake-${pin.request_id}`}
              position={{ lat, lng }}
              zIndex={2}
              onClick={() => { setInfoPin({ type: "request", pin: { ...pin, layer: "intake" } }); onPinClick("request", pin.request_id); }}
            >
              <div style={{
                width: 14, height: 14, borderRadius: "50%",
                background: "#f97316", border: "2px solid #fff",
                boxShadow: "0 1px 3px rgba(0,0,0,0.3)", cursor: "pointer",
              }} />
            </AdvancedMarker>
          );
        })}

        {/* ── Atlas layer (clusters + individual) ── */}
        {clusters.atlas.map((feature) => {
          const [lng, lat] = feature.geometry.coordinates;
          if (feature.properties.cluster) {
            return (
              <AdvancedMarker
                key={`atl-c-${feature.properties.cluster_id}`}
                position={{ lat, lng }}
                zIndex={5}
                onClick={() => handleClusterClick("atlas", feature.properties.cluster_id!, lat, lng)}
              >
                <ClusterBubble count={feature.properties.point_count!} color={LAYER_CLUSTER_COLORS.atlas} />
              </AdvancedMarker>
            );
          }
          const pin = feature.properties.atlasPin!;
          const color = ATLAS_PIN_COLORS[pin.pin_style] || ATLAS_PIN_COLORS.minimal;
          const isActive = pin.pin_tier === "active";
          const size = isActive ? 24 : 14;
          return (
            <AdvancedMarker
              key={`atlas-${pin.id}`}
              position={{ lat, lng }}
              zIndex={isActive ? 2 : 0}
              onClick={() => { setInfoPin({ type: "atlas", pin }); onPinClick("place", pin.id); }}
            >
              <div
                className={isActive ? "atlas-pin-active" : "atlas-pin-ref"}
                style={{
                  width: size, height: size, borderRadius: "50%",
                  background: color, border: `2px solid ${isActive ? "#fff" : "rgba(255,255,255,0.6)"}`,
                  boxShadow: "0 1px 4px rgba(0,0,0,0.3)", opacity: isActive ? 1 : 0.65,
                  cursor: "pointer",
                }}
              />
            </AdvancedMarker>
          );
        })}

        {/* ── Spiderfy-lite: expanded cluster leaves ── */}
        {expandedCluster && (() => {
          const leaves = getClusterLeaves(expandedCluster.layer, expandedCluster.clusterId);
          const clusterColor = LAYER_CLUSTER_COLORS[expandedCluster.layer];
          return leaves.map((leaf, i) => {
            const offset = spiralOffset(i, leaves.length);
            const lat = expandedCluster.lat + offset.dlat;
            const lng = expandedCluster.lng + offset.dlng;
            const pin = leaf.properties.requestPin || leaf.properties.atlasPin;
            if (!pin) return null;
            const isAtlas = !!leaf.properties.atlasPin;
            const color = isAtlas
              ? ATLAS_PIN_COLORS[(pin as AtlasPin).pin_style] || ATLAS_PIN_COLORS.minimal
              : getPinColor(pin as DashboardMapPin);
            return (
              <AdvancedMarker
                key={`spider-${i}`}
                position={{ lat, lng }}
                zIndex={10}
                onClick={() => {
                  if (isAtlas) {
                    setInfoPin({ type: "atlas", pin });
                    onPinClick("place", (pin as AtlasPin).id);
                  } else {
                    setInfoPin({ type: "request", pin });
                    onPinClick("request", (pin as DashboardMapPin).request_id);
                  }
                }}
              >
                <div style={{
                  width: 14, height: 14, borderRadius: "50%",
                  background: color, border: "2px solid #fff",
                  boxShadow: `0 1px 3px rgba(0,0,0,0.3), 0 0 0 2px ${clusterColor}40`,
                  cursor: "pointer",
                }} />
              </AdvancedMarker>
            );
          });
        })()}

        {/* ── Navigated location marker (search result) ── */}
        {navigatedPin && (
          <AdvancedMarker position={{ lat: navigatedPin.lat, lng: navigatedPin.lng }} zIndex={20}>
            <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{
                background: "var(--background, #fff)", borderRadius: 6,
                padding: "4px 8px", fontSize: 11, fontWeight: 600,
                boxShadow: "0 2px 6px rgba(0,0,0,0.2)", whiteSpace: "nowrap",
                maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis",
                marginBottom: 4,
              }}>
                {navigatedPin.label}
              </div>
              <div style={{
                width: 18, height: 18, borderRadius: "50%",
                background: "#3b82f6", border: "3px solid #fff",
                boxShadow: "0 0 0 3px rgba(59,130,246,0.3), 0 2px 6px rgba(0,0,0,0.3)",
                animation: "dashboard-pin-pulse 2s infinite",
              }} />
            </div>
          </AdvancedMarker>
        )}

        {/* ── InfoWindow ── */}
        {infoPin && (() => {
          const pos = infoPin.type === "request"
            ? { lat: (infoPin.pin as DashboardMapPin).lat, lng: (infoPin.pin as DashboardMapPin).lng }
            : { lat: (infoPin.pin as AtlasPin).lat, lng: (infoPin.pin as AtlasPin).lng };

          if (infoPin.type === "request") {
            const pin = infoPin.pin as DashboardMapPin;
            const name = pin.place_name || pin.place_address || "Unknown location";
            const color = getPinColor(pin);
            const priorityLabel = PRIORITY_LABELS[pin.priority] || pin.priority;
            const catInfo = pin.estimated_cat_count
              ? `${pin.estimated_cat_count} cat${pin.estimated_cat_count > 1 ? "s" : ""}${pin.has_kittens ? " (kittens)" : ""}`
              : pin.has_kittens ? "Has kittens" : "";

            return (
              <InfoWindow position={pos} onCloseClick={() => setInfoPin(null)}>
                <div style={{ minWidth: 200, maxWidth: 280, fontFamily: "system-ui, -apple-system, sans-serif" }}>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{name}</div>
                  {pin.summary && <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>{pin.summary}</div>}
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
                    <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 3, background: color, color: "#fff" }}>{formatStatus(pin.status)}</span>
                    <span style={{ fontSize: 10, opacity: 0.6 }}>{priorityLabel}</span>
                    <span style={{ fontSize: 10, opacity: 0.5 }}>{timeAgo(pin.created_at)}</span>
                  </div>
                  {catInfo && <div style={{ fontSize: 11, color: "#7c3aed" }}>{catInfo}</div>}
                  <div style={{ marginTop: 8, borderTop: "1px solid rgba(128,128,128,0.25)", paddingTop: 6 }}>
                    <a href={`/requests/${pin.request_id}`} style={{ fontSize: 11, color: "#3b82f6", textDecoration: "none" }}>View Details</a>
                  </div>
                </div>
              </InfoWindow>
            );
          } else {
            const pin = infoPin.pin as AtlasPin;
            const name = pin.display_name || pin.address || "Unknown location";
            const pinColor = ATLAS_PIN_COLORS[pin.pin_style] || ATLAS_PIN_COLORS.minimal;
            const stats: string[] = [];
            if (pin.cat_count > 0) stats.push(`${pin.cat_count} cat${pin.cat_count !== 1 ? "s" : ""}`);
            if (pin.person_count > 0) stats.push(`${pin.person_count} ${pin.person_count !== 1 ? "people" : "person"}`);
            if (pin.active_request_count > 0) stats.push(`${pin.active_request_count} active req${pin.active_request_count !== 1 ? "s" : ""}`);

            return (
              <InfoWindow position={pos} onCloseClick={() => setInfoPin(null)}>
                <div style={{ minWidth: 200, maxWidth: 280, fontFamily: "system-ui, -apple-system, sans-serif" }}>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{name}</div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
                    <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 3, background: pinColor, color: "#fff" }}>{formatStatus(pin.pin_style)}</span>
                    {pin.service_zone && <span style={{ fontSize: 10, opacity: 0.5 }}>{pin.service_zone}</span>}
                  </div>
                  {stats.length > 0 && <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>{stats.join(" \u00B7 ")}</div>}
                  {pin.disease_badges.length > 0 && (
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                      {pin.disease_badges.slice(0, 3).map((b, i) => (
                        <span key={i} style={{ fontSize: 9, fontWeight: 600, padding: "1px 4px", borderRadius: 3, background: b.color, color: "#fff" }}>{b.short_code}</span>
                      ))}
                    </div>
                  )}
                  <div style={{ marginTop: 8, borderTop: "1px solid rgba(128,128,128,0.25)", paddingTop: 6, display: "flex", gap: 12 }}>
                    <a href={`/places/${pin.id}`} onClick={(e) => { e.preventDefault(); onPinClick("place", pin.id); }} style={{ fontSize: 11, color: "#3b82f6", textDecoration: "none", cursor: "pointer" }}>Preview</a>
                    <a href={`/places/${pin.id}`} style={{ fontSize: 11, color: "#3b82f6", textDecoration: "none" }}>Full Page &rarr;</a>
                  </div>
                </div>
              </InfoWindow>
            );
          }
        })()}
      </Map>

      <a href="/map" className="dashboard-map-fullscreen-link">
        Open Full Map
      </a>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root component with APIProvider
// ---------------------------------------------------------------------------

export function DashboardMap(props: DashboardMapProps) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    return (
      <div className="dashboard-map-container" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 500 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Google Maps API key not configured</div>
          <div style={{ fontSize: 13, color: "#6b7280" }}>Set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY in .env.local</div>
        </div>
      </div>
    );
  }

  return (
    <APIProvider apiKey={apiKey} libraries={["marker"]} version="quarterly">
      <DashboardMapInner {...props} />
    </APIProvider>
  );
}
