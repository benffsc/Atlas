"use client";

/**
 * MapLayerPills — Primary view switcher for the map.
 *
 * Each pill is a complete, self-contained view preset from SYSTEM_VIEWS.
 * One click applies a full layer configuration via handleApplyView —
 * no sidebar needed. This is the main way staff switch between map views.
 */

import { SYSTEM_VIEWS, type MapView } from "@/lib/map-views";

/** Curated subset of system views for the pill bar — the daily-driver views */
const PILL_VIEWS: Array<{ viewId: string; label: string; icon: React.ReactNode }> = [
  {
    viewId: "sys_full_picture",
    label: "All Places",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
      </svg>
    ),
  },
  {
    viewId: "sys_hexbin",
    label: "Hexbin",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2l9 5v10l-9 5-9-5V7z" />
      </svg>
    ),
  },
  {
    viewId: "sys_disease_overview",
    label: "Disease",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ),
  },
  {
    viewId: "sys_tnr_priority",
    label: "Needs TNR",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><line x1="22" y1="12" x2="18" y2="12" /><line x1="6" y1="12" x2="2" y2="12" /><line x1="12" y1="6" x2="12" y2="2" /><line x1="12" y1="22" x2="12" y2="18" />
      </svg>
    ),
  },
  {
    viewId: "sys_trapper_assignments",
    label: "Trappers",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
];

interface MapLayerPillsProps {
  activeViewId: string | null;
  onApplyView: (view: MapView) => void;
}

export function MapLayerPills({ activeViewId, onApplyView }: MapLayerPillsProps) {
  return (
    <div className="map-view-pills" role="toolbar" aria-label="Map views">
      {PILL_VIEWS.map((pill) => {
        const view = SYSTEM_VIEWS.find((v) => v.id === pill.viewId);
        if (!view) return null;
        const isActive = activeViewId === pill.viewId;
        return (
          <button
            key={pill.viewId}
            onClick={() => onApplyView(view)}
            className={`map-view-pill ${isActive ? "map-view-pill--active" : ""}`}
            title={view.name}
            aria-pressed={isActive}
          >
            {pill.icon}
            {pill.label}
          </button>
        );
      })}
    </div>
  );
}
