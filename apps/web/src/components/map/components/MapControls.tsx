"use client";

import { MAP_Z_INDEX } from "@/lib/design-tokens";

/**
 * MapControls - Control buttons for Atlas Map
 *
 * Includes:
 * - Layer toggle button
 * - Add Point button with menu
 * - My Location button
 * - Satellite toggle
 * - Zoom controls
 */

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
  isSatellite: boolean;
  onSatelliteToggle: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
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
  isSatellite,
  onSatelliteToggle,
  onZoomIn,
  onZoomOut,
}: MapControlsProps) {
  const handleAddPointClick = () => {
    if (addPointMode) {
      onAddPointModeChange(null);
      onShowAddPointMenuChange(false);
    } else {
      onShowAddPointMenuChange(!showAddPointMenu);
    }
  };

  return (
    <div
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
        <span style={{ fontSize: 18 }}>☰</span>
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
          <span style={{ fontSize: 18 }}>{addPointMode ? "✕" : "+"}</span>
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
              📍 Add Place
            </button>
            <button
              onClick={() => {
                onAddPointModeChange("annotation");
                onShowAddPointMenuChange(false);
              }}
              className="map-add-point-menu__item"
            >
              📝 Add Note
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
        <span style={{ fontSize: 18 }}>{locatingUser ? "⏳" : "📍"}</span>
        {!isMobile && (locatingUser ? "Locating..." : "My Location")}
      </button>

      {/* Satellite toggle */}
      <button
        onClick={onSatelliteToggle}
        title={isSatellite ? "Street view" : "Satellite view"}
        className={`map-control-btn ${
          isSatellite ? "map-control-btn--active" : ""
        }`}
      >
        <span style={{ fontSize: 18 }}>{isSatellite ? "🗺️" : "🛰️"}</span>
        {!isMobile && (isSatellite ? "Street" : "Satellite")}
      </button>

      {/* Zoom controls */}
      <div className="map-zoom-controls">
        <button onClick={onZoomIn} title="Zoom in (+)">
          +
        </button>
        <button onClick={onZoomOut} title="Zoom out (-)">
          −
        </button>
      </div>
    </div>
  );
}
