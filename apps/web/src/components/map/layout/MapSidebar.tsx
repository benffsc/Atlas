"use client";

import { useMapLayout } from "./MapLayoutContext";

export function MapSidebar() {
  const { sidebarOpen, toggleSidebar } = useMapLayout();

  return (
    <aside
      className={`map-sidebar ${sidebarOpen ? "map-sidebar--open" : "map-sidebar--closed"}`}
      aria-label="Map layers"
    >
      <div className="map-sidebar__header">
        <button
          className="map-sidebar__toggle"
          onClick={toggleSidebar}
          title="Collapse sidebar (L)"
          aria-label="Collapse sidebar"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      </div>
      <div className="map-sidebar__content" id="map-sidebar-portal" />
    </aside>
  );
}
