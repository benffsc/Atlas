"use client";

/**
 * MapLayerPills — Horizontal floating pill row for quick layer toggles.
 * Positioned below the top bar, centered above the map.
 * Uses existing toggleLayer() from useMapLayers — no new state.
 */

interface LayerPill {
  id: string;
  label: string;
  icon: React.ReactNode;
}

const PILLS: LayerPill[] = [
  {
    id: "atlas_all",
    label: "All Places",
    icon: (
      <svg className="map-layer-pill__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
      </svg>
    ),
  },
  {
    id: "hexbin_density",
    label: "Density",
    icon: (
      <svg className="map-layer-pill__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2l9 5v10l-9 5-9-5V7z" />
      </svg>
    ),
  },
  {
    id: "atlas_disease",
    label: "Disease",
    icon: (
      <svg className="map-layer-pill__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ),
  },
  {
    id: "atlas_needs_tnr",
    label: "Needs TNR",
    icon: (
      <svg className="map-layer-pill__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><line x1="22" y1="12" x2="18" y2="12" /><line x1="6" y1="12" x2="2" y2="12" /><line x1="12" y1="6" x2="12" y2="2" /><line x1="12" y1="22" x2="12" y2="18" />
      </svg>
    ),
  },
  {
    id: "hexbin_insights",
    label: "Risk Labels",
    icon: (
      <svg className="map-layer-pill__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
];

interface MapLayerPillsProps {
  enabledLayers: Record<string, boolean>;
  toggleLayer: (id: string) => void;
}

export function MapLayerPills({ enabledLayers, toggleLayer }: MapLayerPillsProps) {
  return (
    <div className="map-layer-pills" role="toolbar" aria-label="Quick layer toggles">
      {PILLS.map((pill) => (
        <button
          key={pill.id}
          onClick={() => toggleLayer(pill.id)}
          className={`map-layer-pill ${enabledLayers[pill.id] ? "map-layer-pill--active" : ""}`}
          title={`Toggle ${pill.label}`}
          aria-pressed={!!enabledLayers[pill.id]}
        >
          {pill.icon}
          {pill.label}
        </button>
      ))}
    </div>
  );
}
