"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

interface MapLayoutContextValue {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
}

const MapLayoutContext = createContext<MapLayoutContextValue | null>(null);

export function MapLayoutProvider({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      return localStorage.getItem("map-sidebar-collapsed") !== "true";
    } catch {
      return true;
    }
  });

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("map-sidebar-collapsed", next ? "false" : "true");
      } catch {}
      return next;
    });
  }, []);

  return (
    <MapLayoutContext.Provider value={{ sidebarOpen, setSidebarOpen, toggleSidebar }}>
      {children}
    </MapLayoutContext.Provider>
  );
}

export function useMapLayout() {
  const ctx = useContext(MapLayoutContext);
  if (!ctx) {
    // Fallback for when MapShell isn't wrapping (e.g., Beacon /beacon/map)
    return { sidebarOpen: false, setSidebarOpen: () => {}, toggleSidebar: () => {} };
  }
  return ctx;
}
