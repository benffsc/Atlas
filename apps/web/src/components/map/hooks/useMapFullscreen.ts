import { useState, useCallback, useEffect } from "react";
import type * as L from "leaflet";

interface UseMapFullscreenOptions {
  mapRef: React.MutableRefObject<L.Map | null>;
}

export function useMapFullscreen({ mapRef }: UseMapFullscreenOptions) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(() => {
    if (mapRef.current) {
      setTimeout(() => mapRef.current?.invalidateSize(), 350);
    }
  }, [isFullscreen, mapRef]);

  const handleFullscreenToggle = useCallback(() => {
    if (!document.fullscreenElement) {
      const mapContainer = document.querySelector(".map-container");
      if (mapContainer) {
        mapContainer.requestFullscreen().catch(console.error);
      }
    } else {
      document.exitFullscreen().catch(console.error);
    }
  }, []);

  return { isFullscreen, setIsFullscreen, handleFullscreenToggle };
}
