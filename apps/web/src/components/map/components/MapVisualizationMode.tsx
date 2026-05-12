"use client";

import { useMemo } from "react";

/**
 * MapVisualizationMode — top-level mode switcher for the map layer panel.
 *
 * Replaces the separate "Atlas Data" + "Analytics" exclusive groups with a
 * single 3-mode selector: Places | Heatmap | Hexbin.
 *
 * Each mode auto-configures which layers are visible:
 *   - Places: pins visible, sub-filter (all/disease/watch/needs_tnr/needs_trapper)
 *   - Heatmap: heatmap overlay, pins faded (30%), sub-mode (density/intact/disease)
 *   - Hexbin: hexbin overlay, pins hidden, compare available, sub-mode + risk labels
 *
 * Operational layers (zones, volunteers, trappers) stay independent below.
 */

export type VisualizationMode = "places" | "heatmap" | "hexbin";

interface MapVisualizationModeProps {
  enabledLayers: Record<string, boolean>;
  onToggleLayer: (layerId: string) => void;
  counts?: Record<string, number>;
  compareMode: boolean;
  compareCount: number;
  onCompareToggle: () => void;
}

// ── Sub-options per mode ───────────────────────────────────────────────

const PLACES_OPTIONS = [
  { id: "atlas_all", label: "All Places" },
  { id: "atlas_disease", label: "Disease Risk" },
  { id: "atlas_watch", label: "Watch List" },
  { id: "atlas_needs_tnr", label: "Needs TNR" },
  { id: "atlas_needs_trapper", label: "Needs Trapper" },
] as const;

const HEATMAP_OPTIONS = [
  { id: "heatmap_density", label: "Cat Density" },
  { id: "heatmap_intact", label: "Intact Cats" },
  { id: "heatmap_disease", label: "Disease" },
] as const;

const HEXBIN_OPTIONS = [
  { id: "hexbin_density", label: "Cat Density" },
  { id: "hexbin_intact", label: "Intact Cats" },
  { id: "hexbin_disease", label: "Disease" },
] as const;

const OPERATIONAL_OPTIONS = [
  { id: "zones", label: "Observation Zones" },
  { id: "volunteers", label: "Volunteers" },
  { id: "clinic_clients", label: "Clinic Clients" },
  { id: "trapper_territories", label: "Trapper Coverage" },
] as const;

// ── Mode icons (inline SVG for clean rendering) ────────────────────────

function PinIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function HeatmapIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" opacity="0.3" />
      <circle cx="12" cy="12" r="6" opacity="0.6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}

function HexbinIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l8 4.5v9L12 20l-8-4.5v-9z" />
    </svg>
  );
}

function CompareIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
    </svg>
  );
}

// ── Helper: derive current mode from enabled layers ────────────────────

function deriveMode(enabledLayers: Record<string, boolean>): VisualizationMode {
  if (enabledLayers.hexbin_density || enabledLayers.hexbin_intact || enabledLayers.hexbin_disease || enabledLayers.hexbin_insights) return "hexbin";
  if (enabledLayers.heatmap_density || enabledLayers.heatmap_intact || enabledLayers.heatmap_disease) return "heatmap";
  return "places";
}

// All layer IDs that the mode switcher manages (not operational)
const ALL_MODE_LAYER_IDS = [
  ...PLACES_OPTIONS.map(o => o.id),
  ...HEATMAP_OPTIONS.map(o => o.id),
  ...HEXBIN_OPTIONS.map(o => o.id),
  "hexbin_insights",
];

// ── Component ──────────────────────────────────────────────────────────

export function MapVisualizationMode({
  enabledLayers,
  onToggleLayer,
  counts,
  compareMode,
  compareCount,
  onCompareToggle,
}: MapVisualizationModeProps) {
  const currentMode = useMemo(() => deriveMode(enabledLayers), [enabledLayers]);

  // Switch to a mode — turn off all mode layers, then turn on the default for that mode
  const switchMode = (mode: VisualizationMode) => {
    // Turn off everything first
    for (const id of ALL_MODE_LAYER_IDS) {
      if (enabledLayers[id]) onToggleLayer(id);
    }

    // Turn on the default for the new mode
    // Small timeout to let the toggle cascade settle (exclusive group logic)
    setTimeout(() => {
      if (mode === "places") onToggleLayer("atlas_all");
      else if (mode === "heatmap") onToggleLayer("heatmap_density");
      else if (mode === "hexbin") onToggleLayer("hexbin_density");
    }, 0);
  };

  // Select a sub-option within the current mode (the toggle function handles exclusive behavior)
  const selectSubOption = (layerId: string) => {
    onToggleLayer(layerId);
  };

  const modes: Array<{ id: VisualizationMode; label: string; icon: React.ReactNode }> = [
    { id: "places", label: "Places", icon: <PinIcon /> },
    { id: "heatmap", label: "Heatmap", icon: <HeatmapIcon /> },
    { id: "hexbin", label: "Hexbin", icon: <HexbinIcon /> },
  ];

  const subOptions = currentMode === "places" ? PLACES_OPTIONS
    : currentMode === "heatmap" ? HEATMAP_OPTIONS
    : HEXBIN_OPTIONS;

  return (
    <div className="map-viz-mode">
      {/* ── Mode tabs ── */}
      <div className="map-viz-mode__tabs">
        {modes.map(m => (
          <button
            key={m.id}
            onClick={() => { if (currentMode !== m.id) switchMode(m.id); }}
            className={`map-viz-mode__tab ${currentMode === m.id ? "map-viz-mode__tab--active" : ""}`}
            title={m.label}
          >
            {m.icon}
            <span>{m.label}</span>
          </button>
        ))}
      </div>

      {/* ── Sub-options ── */}
      <div className="map-viz-mode__options">
        {subOptions.map(opt => {
          const isActive = !!enabledLayers[opt.id];
          const count = counts?.[opt.id];
          return (
            <button
              key={opt.id}
              onClick={() => selectSubOption(opt.id)}
              className={`map-viz-mode__option ${isActive ? "map-viz-mode__option--active" : ""}`}
            >
              <span className="map-viz-mode__radio">
                {isActive && <span className="map-viz-mode__radio-dot" />}
              </span>
              <span className="map-viz-mode__option-label">{opt.label}</span>
              {count != null && count > 0 && (
                <span className="map-viz-mode__option-count">{count.toLocaleString()}</span>
              )}
            </button>
          );
        })}

        {/* Risk labels toggle — hexbin mode only */}
        {currentMode === "hexbin" && (
          <button
            onClick={() => onToggleLayer("hexbin_insights")}
            className={`map-viz-mode__option ${enabledLayers.hexbin_insights ? "map-viz-mode__option--active" : ""}`}
          >
            <span className="map-viz-mode__checkbox">
              {enabledLayers.hexbin_insights && (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </span>
            <span className="map-viz-mode__option-label">Show Risk Labels</span>
          </button>
        )}
      </div>

      {/* ── Compare button — hexbin mode only ── */}
      {currentMode === "hexbin" && (
        <div className="map-viz-mode__compare">
          <button
            onClick={onCompareToggle}
            className={`map-viz-mode__compare-btn ${compareMode ? "map-viz-mode__compare-btn--active" : ""}`}
          >
            <CompareIcon />
            {compareMode
              ? `Selecting Areas (${compareCount}/4)...`
              : "Compare Areas"}
          </button>
          {!compareMode && (
            <span className="map-viz-mode__compare-hint">
              Click hexagons to compare side-by-side
            </span>
          )}
        </div>
      )}

      {/* ── Operational layers (always visible) ── */}
      <div className="map-viz-mode__section">
        <div className="map-viz-mode__section-label">Operational</div>
        {OPERATIONAL_OPTIONS.map(opt => {
          const isActive = !!enabledLayers[opt.id];
          return (
            <button
              key={opt.id}
              onClick={() => onToggleLayer(opt.id)}
              className={`map-viz-mode__option ${isActive ? "map-viz-mode__option--active" : ""}`}
            >
              <span className="map-viz-mode__checkbox">
                {isActive && (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </span>
              <span className="map-viz-mode__option-label">{opt.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
