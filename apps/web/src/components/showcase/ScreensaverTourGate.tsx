"use client";

/**
 * ScreensaverTourGate — mounts ScreensaverTour when showcase mode is active.
 * Rendered at the app layout level so idle detection works from ANY page
 * (dashboard, map, requests, etc.), not just /map.
 */

import { useState, useEffect } from "react";
import { ScreensaverTour } from "./ScreensaverTour";

export function ScreensaverTourGate() {
  const [active, setActive] = useState(false);

  useEffect(() => {
    // Check on mount
    setActive(localStorage.getItem("beacon.presentation_mode") === "true");

    // Listen for showcase mode toggling
    const handler = () => {
      setActive(localStorage.getItem("beacon.presentation_mode") === "true");
    };
    window.addEventListener("storage", handler);
    window.addEventListener("showcase:toggle", handler);
    return () => {
      window.removeEventListener("storage", handler);
      window.removeEventListener("showcase:toggle", handler);
    };
  }, []);

  if (!active) return null;
  return <ScreensaverTour enabled />;
}
