"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { APIProvider, Map, AdvancedMarker, InfoWindow, useMap } from "@vis.gl/react-google-maps";
import { useMapData } from "@/hooks/useMapData";
import { useMapColors } from "@/hooks/useMapColors";
import { useGeoConfig } from "@/hooks/useGeoConfig";
import { useToast } from "@/components/feedback/Toast";
import { fetchApi } from "@/lib/api-client";
import { MAP_COLORS } from "@/lib/map-colors";
import { useMapLayers, ATLAS_MAP_LAYER_GROUPS_BASE } from "@/components/map/hooks/useMapLayers";
import { useMapViews } from "@/components/map/hooks/useMapViews";
import { useMapExport } from "@/components/map/hooks/useMapExport";
import { MapControls } from "@/components/map/components/MapControls";
import { MeasurementPanel } from "@/components/map/components/MeasurementPanel";
import { SavedViewsPanel } from "@/components/map/components/SavedViewsPanel";
import { GroupedLayerControl } from "@/components/map/GroupedLayerControl";
import { PlaceDetailDrawer, MapLegend, DateRangeFilter, LocationComparisonPanel, SERVICE_ZONES } from "@/components/map";
import type { BasemapType } from "@/components/map/components/MapControls";
import type { AtlasPin, Place, GooglePin, TnrPriorityPlace, Zone, Volunteer, TrapperTerritory, ClinicClient, HistoricalSource, DataCoverageZone, MapSummary, AtlasSearchResult, PlacePrediction, NavigatedLocation, Annotation } from "@/components/map";
import { MAP_Z_INDEX } from "@/lib/design-tokens";

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

/** Pin color by style (hex for Google Maps markers) */
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

function getPinSize(style: string): number {
  switch (style) {
    case "disease": return 14;
    case "watch_list": return 13;
    case "active": return 12;
    case "active_requests": return 11;
    case "has_history": return 10;
    default: return 8;
  }
}

/** Inner map component — needs to be inside APIProvider */
function AtlasMapV2Inner() {
  const { addToast } = useToast();
  const isMobile = useIsMobile();
  const map = useMap();
  const { mapCenter, mapZoom } = useGeoConfig();
  const { colors } = useMapColors();

  // State
  const [loading, setLoading] = useState(true);
  const [showLayerPanel, setShowLayerPanel] = useState(false);
  const [showLegend, setShowLegend] = useState(!isMobile);
  const [basemap, setBasemap] = useState<BasemapType>("street");
  const [selectedZone, setSelectedZone] = useState("All Zones");
  const [dateFrom, setDateFrom] = useState<string | null>(null);
  const [dateTo, setDateTo] = useState<string | null>(null);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [selectedPin, setSelectedPin] = useState<AtlasPin | null>(null);

  // Data
  const [atlasPins, setAtlasPins] = useState<AtlasPin[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [googlePins, setGooglePins] = useState<GooglePin[]>([]);
  const [volunteers, setVolunteers] = useState<Volunteer[]>([]);
  const [clinicClients, setClinicClients] = useState<ClinicClient[]>([]);
  const [trapperTerritories, setTrapperTerritories] = useState<TrapperTerritory[]>([]);
  const [summary, setSummary] = useState<MapSummary | null>(null);

  // Extracted hooks (zero Leaflet dependency)
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

  // Fetch data via SWR
  const { data: mapData, isLoading: mapIsLoading } = useMapData({
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

  // Basemap switching
  useEffect(() => {
    if (!map) return;
    if (basemap === "satellite") {
      map.setMapTypeId("hybrid");
    } else {
      map.setMapTypeId("roadmap");
    }
  }, [map, basemap]);

  // Search
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Filtered visible pins
  const visiblePins = useMemo(() => {
    if (!atlasLayerEnabled) return [];
    return atlasPins.filter(p => p.lat && p.lng);
  }, [atlasPins, atlasLayerEnabled]);

  // Keyboard shortcut: / to focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "/") { e.preventDefault(); searchInputRef.current?.focus(); }
      if (e.key === "l" || e.key === "L") setShowLayerPanel(prev => !prev);
      if (e.key === "Escape") { setShowLayerPanel(false); setSelectedPin(null); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Total markers for display
  const totalMarkers = visiblePins.length +
    (enabledLayers.places ? places.length : 0) +
    (enabledLayers.volunteers ? volunteers.length : 0);

  return (
    <div style={{ position: "relative", height: "100dvh", width: "100%" }}>
      <Map
        mapId={process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || undefined}
        defaultCenter={{ lat: mapCenter[0], lng: mapCenter[1] }}
        defaultZoom={mapZoom}
        gestureHandling="greedy"
        disableDefaultUI
        style={{ width: "100%", height: "100%" }}
        onClick={() => setSelectedPin(null)}
      >
        {/* Atlas pins as AdvancedMarkers */}
        {visiblePins.map(pin => (
          <AdvancedMarker
            key={pin.id}
            position={{ lat: pin.lat, lng: pin.lng }}
            onClick={() => {
              setSelectedPin(pin);
              setSelectedPlaceId(pin.id);
            }}
          >
            <div style={{
              width: getPinSize(pin.pin_style) * 2,
              height: getPinSize(pin.pin_style) * 2,
              borderRadius: "50%",
              background: getPinColor(pin.pin_style),
              border: "2px solid white",
              boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 9,
              fontWeight: 700,
              color: "white",
            }}>
              {pin.cat_count > 0 ? pin.cat_count : ""}
            </div>
          </AdvancedMarker>
        ))}

        {/* InfoWindow for selected pin */}
        {selectedPin && (
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

      {/* Search bar */}
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
            placeholder={isMobile ? "Search..." : "Search people, places, or cats... (press /)"}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ flex: 1, border: "none", outline: "none", fontSize: 15 }}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, opacity: 0.5 }}>
              &#x2715;
            </button>
          )}
        </div>
      </div>

      {/* Right side controls */}
      <MapControls
        isMobile={isMobile}
        showLayerPanel={showLayerPanel}
        onToggleLayerPanel={() => setShowLayerPanel(!showLayerPanel)}
        addPointMode={null}
        onAddPointModeChange={() => {}}
        showAddPointMenu={false}
        onShowAddPointMenuChange={() => {}}
        locatingUser={false}
        onMyLocation={() => {
          navigator.geolocation?.getCurrentPosition((pos) => {
            map?.panTo({ lat: pos.coords.latitude, lng: pos.coords.longitude });
            map?.setZoom(15);
          });
        }}
        basemap={basemap}
        onBasemapChange={setBasemap}
        measureActive={false}
        onMeasureToggle={() => addToast({ type: "info", message: "Measurement tool coming soon in V2" })}
        isFullscreen={false}
        onFullscreenToggle={() => {
          const el = document.querySelector(".map-container-v2");
          if (el) el.requestFullscreen?.().catch(() => {});
        }}
        onZoomIn={() => map?.setZoom((map.getZoom() || 11) + 1)}
        onZoomOut={() => map?.setZoom((map.getZoom() || 11) - 1)}
        onExportCsv={handleExportCsv}
        onExportGeoJson={handleExportGeoJson}
        exportPinCount={atlasPins.length}
      />

      {/* Layer panel */}
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

      {/* Date range filter */}
      <DateRangeFilter fromDate={dateFrom} toDate={dateTo} onDateRangeChange={handleDateRangeChange} />

      {/* Stats bar */}
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

      {/* Loading */}
      {loading && (
        <div className="map-loading-overlay" role="status">
          <div className="map-loading-spinner" />
          <span className="map-loading-text">Loading map data...</span>
        </div>
      )}

      {/* Place Detail Drawer */}
      {selectedPlaceId && (
        <PlaceDetailDrawer
          placeId={selectedPlaceId}
          onClose={() => { setSelectedPlaceId(null); setSelectedPin(null); }}
          coordinates={(() => {
            const pin = atlasPins.find(p => p.id === selectedPlaceId);
            return pin?.lat && pin?.lng ? { lat: pin.lat, lng: pin.lng } : undefined;
          })()}
        />
      )}

      {/* V2 badge */}
      <div style={{
        position: "absolute", bottom: 24, right: 16, zIndex: 10,
        background: "rgba(59,130,246,0.9)", color: "white", padding: "4px 10px",
        borderRadius: 6, fontSize: 11, fontWeight: 600,
      }}>
        Google Maps V2 Preview
      </div>
    </div>
  );
}

export default function AtlasMapV2() {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    return (
      <div style={{ height: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>Google Maps API key not configured</div>
        <div style={{ fontSize: 13, color: "#6b7280" }}>Set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY in .env.local</div>
      </div>
    );
  }

  return (
    <APIProvider apiKey={apiKey}>
      <AtlasMapV2Inner />
    </APIProvider>
  );
}
