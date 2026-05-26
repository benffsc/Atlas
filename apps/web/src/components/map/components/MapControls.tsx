"use client";

import { useState } from "react";
import { MAP_Z_INDEX } from "@/lib/design-tokens";

/**
 * MapControls — Minimal right-side control strip.
 *
 * Only map-viewport tools: Fullscreen, My Location, Basemap, Zoom.
 * All data/layer controls moved to view pills in the top bar.
 */

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

const MapIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
    <line x1="8" y1="2" x2="8" y2="18" /><line x1="16" y1="6" x2="16" y2="22" />
  </svg>
);

const SatelliteIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 0 0 0 20" /><path d="M12 2a14.5 14.5 0 0 1 0 20" /><line x1="2" y1="12" x2="22" y2="12" />
  </svg>
);

const DarkModeIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

const CompareIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6L6 18" /><path d="M6 6l12 12" />
    <circle cx="6" cy="6" r="2.5" fill="currentColor" /><circle cx="18" cy="18" r="2.5" fill="currentColor" />
  </svg>
);

export type BasemapType = "street" | "satellite" | "dark";

interface MapControlsProps {
  locatingUser: boolean;
  onMyLocation: () => void;
  basemap: BasemapType;
  onBasemapChange: (basemap: BasemapType) => void;
  isFullscreen?: boolean;
  onFullscreenToggle?: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  compareActive?: boolean;
  onCompareToggle?: () => void;
}

const basemapOptions: Array<{ type: BasemapType; label: string; icon: React.ReactNode }> = [
  { type: "street", label: "Street", icon: <MapIcon /> },
  { type: "satellite", label: "Satellite", icon: <SatelliteIcon /> },
  { type: "dark", label: "Dark", icon: <DarkModeIcon /> },
];

export function MapControls({
  locatingUser,
  onMyLocation,
  basemap,
  onBasemapChange,
  isFullscreen = false,
  onFullscreenToggle,
  onZoomIn,
  onZoomOut,
  compareActive = false,
  onCompareToggle,
}: MapControlsProps) {
  const [showBasemapMenu, setShowBasemapMenu] = useState(false);

  return (
    <div
      className="map-controls-strip"
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
        transition: "right 0.3s ease",
      }}
    >
      {/* Basemap */}
      <div style={{ position: "relative" }}>
        <button
          onClick={() => setShowBasemapMenu(!showBasemapMenu)}
          title="Change basemap"
          className={`map-control-btn map-control-btn--icon ${basemap !== "street" ? "map-control-btn--active" : ""}`}
        >
          {basemap === "dark" ? <DarkModeIcon /> : basemap === "satellite" ? <SatelliteIcon /> : <MapIcon />}
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

      {/* Fullscreen */}
      {onFullscreenToggle && (
        <button
          onClick={onFullscreenToggle}
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
      )}

      {/* Compare distances */}
      {onCompareToggle && (
        <button
          onClick={onCompareToggle}
          title={compareActive ? "Exit compare" : "Compare distances"}
          className={`map-control-btn map-control-btn--icon ${compareActive ? "map-control-btn--active" : ""}`}
        >
          <CompareIcon />
        </button>
      )}

      {/* My Location */}
      <button
        onClick={onMyLocation}
        disabled={locatingUser}
        title="My location (M)"
        className="map-control-btn map-control-btn--icon"
        style={{
          opacity: locatingUser ? 0.7 : 1,
          cursor: locatingUser ? "wait" : "pointer",
        }}
      >
        {locatingUser ? <LoadingIcon /> : <LocationIcon />}
      </button>

      {/* Zoom */}
      {onZoomIn && onZoomOut && (
        <div className="map-zoom-controls" role="group" aria-label="Zoom controls">
          <button onClick={onZoomIn} title="Zoom in (+)" aria-label="Zoom in">+</button>
          <button onClick={onZoomOut} title="Zoom out (-)" aria-label="Zoom out">{"\u2212"}</button>
        </div>
      )}
    </div>
  );
}
