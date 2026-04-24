"use client";

import { useMapLayout } from "./MapLayoutContext";

export function MapSidebar() {
  const { sidebarOpen } = useMapLayout();

  return (
    <aside
      className={`map-sidebar ${sidebarOpen ? "map-sidebar--open" : "map-sidebar--closed"}`}
      aria-label="Map layers"
    >
      <div className="map-sidebar__content" id="map-sidebar-portal" />
    </aside>
  );
}
