"use client";

import type { ReactNode } from "react";
import { MapLayoutProvider } from "./MapLayoutContext";
import { MapNavRail } from "./MapNavRail";
import { MapTopBar } from "./MapTopBar";
import { MapSidebar } from "./MapSidebar";

interface MapShellProps {
  children: ReactNode;
}

export function MapShell({ children }: MapShellProps) {
  return (
    <MapLayoutProvider>
      <div className="map-shell">
        <MapNavRail />
        <MapTopBar />
        <div className="map-shell__content">
          <MapSidebar />
          <div className="map-shell__viewport">
            {children}
          </div>
        </div>
      </div>
    </MapLayoutProvider>
  );
}
