"use client";

import { useState } from "react";
import { MAP_Z_INDEX } from "@/lib/design-tokens";

/**
 * MapControls - Control buttons for Atlas Map
 *
 * Includes:
 * - Layer toggle button
 * - Add Point button with menu
 * - My Location button
 * - Measure distance tool
 * - Basemap selector (Street / Google / Satellite)
 * - Zoom controls
 */

// Inline SVG icon components for clean, scalable map controls
const LayersIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 2 7 12 12 22 7 12 2" />
    <polyline points="2 17 12 22 22 17" />
    <polyline points="2 12 12 17 22 12" />
  </svg>
);

const PlusIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const CloseIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const LocationIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
  </svg>
);

const LoadingIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: "spin 1s linear infinite" }}>
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
);

const RulerIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.4 2.4 0 0 1 0-3.4l2.6-2.6a2.4 2.4 0 0 1 3.4 0z" />
    <path d="m14.5 12.5 2-2" /><path d="m11.5 9.5 2-2" /><path d="m8.5 6.5 2-2" /><path d="m17.5 15.5 2-2" />
  </svg>
);

const SatelliteIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 0 0 0 20" /><path d="M12 2a14.5 14.5 0 0 1 0 20" /><line x1="2" y1="12" x2="22" y2="12" />
  </svg>
);

const MapIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
    <line x1="8" y1="2" x2="8" y2="18" /><line x1="16" y1="6" x2="16" y2="22" />
  </svg>
);

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

const ExpandIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
    <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
  </svg>
);

const CollapseIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" />
    <line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" />
  </svg>
);

const DownloadIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const PlacePinIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
  </svg>
);

const NoteIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
  </svg>
);

export type BasemapType = "street" | "google" | "satellite";

interface MapControlsProps {
  isMobile: boolean;
  showLayerPanel: boolean;
  onToggleLayerPanel: () => void;
  addPointMode: "place" | "annotation" | null;
  onAddPointModeChange: (mode: "place" | "annotation" | null) => void;
  showAddPointMenu: boolean;
  onShowAddPointMenuChange: (show: boolean) => void;
  locatingUser: boolean;
  onMyLocation: () => void;
  basemap: BasemapType;
  onBasemapChange: (basemap: BasemapType) => void;
  measureActive: boolean;
  onMeasureToggle: () => void;
  isFullscreen: boolean;
  onFullscreenToggle: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onExportCsv?: () => void;
  onExportGeoJson?: () => void;
  exportPinCount?: number;
}

export function MapControls({
  isMobile,
  showLayerPanel,
  onToggleLayerPanel,
  addPointMode,
  onAddPointModeChange,
  showAddPointMenu,
  onShowAddPointMenuChange,
  locatingUser,
  onMyLocation,
  basemap,
  onBasemapChange,
  measureActive,
  onMeasureToggle,
  isFullscreen,
  onFullscreenToggle,
  onZoomIn,
  onZoomOut,
  onExportCsv,
  onExportGeoJson,
  exportPinCount,
}: MapControlsProps) {
  const [showBasemapMenu, setShowBasemapMenu] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);

  const handleAddPointClick = () => {
    if (addPointMode) {
      onAddPointModeChange(null);
      onShowAddPointMenuChange(false);
    } else {
      onShowAddPointMenuChange(!showAddPointMenu);
    }
  };

  const basemapOptions: Array<{ type: BasemapType; label: string; icon: React.ReactNode }> = [
    { type: "street", label: "Street", icon: <MapIcon /> },
    { type: "google", label: "Google Maps", icon: <GoogleIcon /> },
    { type: "satellite", label: "Satellite", icon: <SatelliteIcon /> },
  ];

  return (
    <div
      role="region"
      aria-label="Map controls"
      style={{
        position: "absolute",
        top: 16,
        right: 16,
        zIndex: MAP_Z_INDEX.controls,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {/* Layer control button */}
      <button
        onClick={onToggleLayerPanel}
        title="Toggle layers (L)"
        className="map-control-btn"
      >
        <LayersIcon />
        {!isMobile && "Layers"}
      </button>

      {/* Add Point button */}
      <div style={{ position: "relative" }}>
        <button
          onClick={handleAddPointClick}
          title="Add point to map (A)"
          className={`map-control-btn ${
            addPointMode ? "map-control-btn--active" : ""
          }`}
        >
          {addPointMode ? <CloseIcon /> : <PlusIcon />}
          {!isMobile && (addPointMode ? "Cancel" : "Add Point")}
        </button>
        {showAddPointMenu && !addPointMode && (
          <div className="map-add-point-menu">
            <button
              onClick={() => {
                onAddPointModeChange("place");
                onShowAddPointMenuChange(false);
              }}
              className="map-add-point-menu__item"
            >
              <PlacePinIcon /> Add Place
            </button>
            <button
              onClick={() => {
                onAddPointModeChange("annotation");
                onShowAddPointMenuChange(false);
              }}
              className="map-add-point-menu__item"
            >
              <NoteIcon /> Add Note
            </button>
          </div>
        )}
      </div>

      {/* My Location button */}
      <button
        onClick={onMyLocation}
        disabled={locatingUser}
        title="My location (M)"
        className="map-control-btn"
        style={{
          opacity: locatingUser ? 0.7 : 1,
          cursor: locatingUser ? "wait" : "pointer",
        }}
      >
        {locatingUser ? <LoadingIcon /> : <LocationIcon />}
        {!isMobile && (locatingUser ? "Locating..." : "My Location")}
      </button>

      {/* Measure button */}
      <button
        onClick={onMeasureToggle}
        title="Measure distance (D)"
        className={`map-control-btn ${measureActive ? "map-control-btn--active" : ""}`}
      >
        <RulerIcon />
        {!isMobile && (measureActive ? "Stop" : "Measure")}
      </button>

      {/* Export button */}
      {onExportCsv && (
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setShowExportMenu(!showExportMenu)}
            title="Export visible data (E)"
            className="map-control-btn"
          >
            <DownloadIcon />
            {!isMobile && "Export"}
          </button>
          {showExportMenu && (
            <div className="map-basemap-menu">
              <button
                onClick={() => {
                  onExportCsv();
                  setShowExportMenu(false);
                }}
                className="map-basemap-menu__item"
              >
                CSV{exportPinCount != null && ` (${exportPinCount.toLocaleString()} rows)`}
              </button>
              {onExportGeoJson && (
                <button
                  onClick={() => {
                    onExportGeoJson();
                    setShowExportMenu(false);
                  }}
                  className="map-basemap-menu__item"
                >
                  GeoJSON
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Basemap selector */}
      <div style={{ position: "relative" }}>
        <button
          onClick={() => setShowBasemapMenu(!showBasemapMenu)}
          title="Change basemap"
          className={`map-control-btn ${basemap !== "street" ? "map-control-btn--active" : ""}`}
        >
          {basemap === "satellite" ? <SatelliteIcon /> : basemap === "google" ? <GoogleIcon /> : <MapIcon />}
          {!isMobile && (basemap === "street" ? "Basemap" : basemap === "google" ? "Google" : "Satellite")}
        </button>
        {showBasemapMenu && (
          <div className="map-basemap-menu">
            {basemapOptions.map(({ type, label, icon }) => (
              <button
                key={type}
                onClick={() => {
                  onBasemapChange(type);
                  setShowBasemapMenu(false);
                }}
                className={`map-basemap-menu__item ${basemap === type ? "map-basemap-menu__item--active" : ""}`}
              >
                {icon} {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Fullscreen toggle */}
      <button
        onClick={onFullscreenToggle}
        title={isFullscreen ? "Exit fullscreen (F)" : "Fullscreen (F)"}
        className={`map-control-btn ${isFullscreen ? "map-control-btn--active" : ""}`}
      >
        {isFullscreen ? <CollapseIcon /> : <ExpandIcon />}
        {!isMobile && (isFullscreen ? "Exit" : "Fullscreen")}
      </button>

      {/* Zoom controls */}
      <div className="map-zoom-controls" role="group" aria-label="Zoom controls">
        <button onClick={onZoomIn} title="Zoom in (+)" aria-label="Zoom in">
          +
        </button>
        <button onClick={onZoomOut} title="Zoom out (-)" aria-label="Zoom out">
          −
        </button>
      </div>
    </div>
  );
}
