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
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect width="18" height="18" x="3" y="3" rx="2" />
            <path d="M9 3v18" />
            <path d="m16 15-3-3 3-3" />
          </svg>
        </button>
      </div>
      <div className="map-sidebar__content" id="map-sidebar-portal" />
    </aside>
  );
}
