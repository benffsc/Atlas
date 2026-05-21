"use client";

/**
 * ShowcaseMapTour — scripted fly-through of the Atlas map.
 *
 * Navigates between configurable tour stops using the map URL params.
 * Each stop has coordinates, zoom level, a narration card, and a pause
 * duration. The tour is fully config-driven — add/remove/reorder stops
 * in TOUR_STOPS without changing any logic.
 *
 * To add Beacon visualization layers as tour stops later, add entries
 * with an optional `layers` field that can activate map overlays.
 *
 * Usage: Triggered from ShowcaseToolbar. Opens /map and runs the tour.
 * Communication: dispatches "showcase:maptour" on window, or the
 * component can be rendered directly on the map page.
 */

import { useState, useEffect, useRef, useCallback } from "react";

export interface TourStop {
  /** Display label for the narration card */
  label: string;
  /** Subtitle/description shown during the pause */
  description: string;
  /** Map center coordinates */
  lat: number;
  lng: number;
  /** Zoom level (1-22) */
  zoom: number;
  /** How long to pause at this stop (ms) */
  pauseMs: number;
  /** Optional: stat highlight shown in the card */
  stat?: { value: string; label: string };
  /** Optional: future — layer IDs to activate at this stop */
  layers?: string[];
}

/**
 * Default tour stops — configurable. Reorder, add, or remove freely.
 * Coordinates are real Sonoma County locations.
 */
export const DEFAULT_TOUR_STOPS: TourStop[] = [
  {
    label: "Sonoma County Overview",
    description: "Every pin is a colony site we monitor — over 2,800 active locations across the county.",
    lat: 38.45,
    lng: -122.72,
    zoom: 10,
    pauseMs: 5000,
    stat: { value: "2,800+", label: "colony sites" },
  },
  {
    label: "Santa Rosa — Highest Density",
    description: "Santa Rosa has the most colony activity. Our clinic processes ~22 cats per day from sites across the city.",
    lat: 38.44,
    lng: -122.714,
    zoom: 13,
    pauseMs: 5000,
    stat: { value: "~22", label: "cats per clinic day" },
  },
  {
    label: "Montecito Ave Corridor",
    description: "5 adjacent properties where cats move freely between yards. The system automatically detects these corridors using geographic proximity.",
    lat: 38.4485,
    lng: -122.6945,
    zoom: 17,
    pauseMs: 6000,
    stat: { value: "5", label: "linked addresses" },
  },
  {
    label: "Todd Rd Colony Cluster",
    description: "Multiple colonies along Todd Road — including commercial sites, residential, and industrial. Active disease monitoring here after a recent FIV+ detection.",
    lat: 38.408,
    lng: -122.735,
    zoom: 15,
    pauseMs: 5000,
    stat: { value: "FIV+", label: "disease alert active" },
  },
  {
    label: "Cat Density Heatmap",
    description: "Hexbin view shows concentration of colony activity across Santa Rosa. Darker cells = more cats needing TNR. This helps prioritize trapping resources.",
    lat: 38.44,
    lng: -122.714,
    zoom: 12,
    pauseMs: 6000,
    stat: { value: "Hexbin", label: "density view" },
    layers: ["cat-density-heatmap"],
  },
  {
    label: "TNR Priority Zones",
    description: "Areas color-coded by TNR urgency — red zones have unaltered colonies, green zones are managed. Beacon identifies where our efforts will have the greatest impact.",
    lat: 38.44,
    lng: -122.72,
    zoom: 11,
    pauseMs: 6000,
    stat: { value: "Priority", label: "zone analysis" },
    layers: ["tnr-priority"],
  },
  {
    label: "County-Wide Coverage",
    description: "From Cloverdale to Petaluma, Bodega Bay to Sonoma Valley. 37,000+ cats altered since 2013 — every one verified at our clinic.",
    lat: 38.50,
    lng: -122.78,
    zoom: 10,
    pauseMs: 6000,
    stat: { value: "37,000+", label: "cats altered" },
  },
];

interface ShowcaseMapTourProps {
  /** Google Maps instance from useMap() */
  map: google.maps.Map | null;
  /** Tour stops — defaults to DEFAULT_TOUR_STOPS */
  stops?: TourStop[];
  /** Called when tour finishes or is cancelled */
  onComplete?: () => void;
}

export function ShowcaseMapTour({ map, stops = DEFAULT_TOUR_STOPS, onComplete }: ShowcaseMapTourProps) {
  const [active, setActive] = useState(false);
  const [currentStop, setCurrentStop] = useState(0);
  const [progress, setProgress] = useState(0);
  const timerRef = useRef<number>(0);
  const progressRef = useRef<number>(0);

  // Listen for tour trigger event
  useEffect(() => {
    const handler = () => {
      setActive(true);
      setCurrentStop(0);
      setProgress(0);
    };
    window.addEventListener("showcase:maptour", handler);

    // Check for pending tour from toolbar navigation
    if (sessionStorage.getItem("showcase:maptour-pending")) {
      sessionStorage.removeItem("showcase:maptour-pending");
      // Wait for map to load before starting
      const delay = setTimeout(handler, 1500);
      return () => { clearTimeout(delay); window.removeEventListener("showcase:maptour", handler); };
    }

    return () => window.removeEventListener("showcase:maptour", handler);
  }, []);

  // Run tour step
  useEffect(() => {
    if (!active || !map || currentStop >= stops.length) {
      if (active && currentStop >= stops.length) {
        setActive(false);
        onComplete?.();
      }
      return;
    }

    const stop = stops[currentStop];

    // Fly to location
    map.panTo({ lat: stop.lat, lng: stop.lng });
    map.setZoom(stop.zoom);

    // Activate map layers if specified (e.g., hexbin views)
    if (stop.layers && stop.layers.length > 0) {
      window.dispatchEvent(new CustomEvent("showcase:layers", { detail: stop.layers }));
    } else {
      // Reset layers when stop has none
      window.dispatchEvent(new CustomEvent("showcase:layers", { detail: [] }));
    }

    // Progress bar animation
    setProgress(0);
    const startTime = Date.now();
    const tick = () => {
      const elapsed = Date.now() - startTime;
      const pct = Math.min(elapsed / stop.pauseMs, 1);
      setProgress(pct);
      if (pct < 1) {
        progressRef.current = requestAnimationFrame(tick);
      }
    };
    progressRef.current = requestAnimationFrame(tick);

    // Advance to next stop after pause
    timerRef.current = window.setTimeout(() => {
      setCurrentStop((prev) => prev + 1);
    }, stop.pauseMs);

    return () => {
      clearTimeout(timerRef.current);
      cancelAnimationFrame(progressRef.current);
    };
  }, [active, currentStop, map, stops, onComplete]);

  const cancel = useCallback(() => {
    clearTimeout(timerRef.current);
    cancelAnimationFrame(progressRef.current);
    setActive(false);
    onComplete?.();
  }, [onComplete]);

  const skip = useCallback(() => {
    clearTimeout(timerRef.current);
    cancelAnimationFrame(progressRef.current);
    setCurrentStop((prev) => prev + 1);
  }, []);

  if (!active || currentStop >= stops.length) return null;

  const stop = stops[currentStop];

  return (
    <div className="showcase-tour-card">
      {/* Progress bar */}
      <div className="showcase-tour-progress">
        <div
          className="showcase-tour-progress-fill"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      {/* Stop counter */}
      <div className="showcase-tour-counter">
        {currentStop + 1} / {stops.length}
      </div>

      {/* Content */}
      <div className="showcase-tour-label">{stop.label}</div>
      <div className="showcase-tour-desc">{stop.description}</div>

      {/* Stat highlight */}
      {stop.stat && (
        <div className="showcase-tour-stat">
          <span className="showcase-tour-stat-value">{stop.stat.value}</span>
          <span className="showcase-tour-stat-label">{stop.stat.label}</span>
        </div>
      )}

      {/* Controls */}
      <div className="showcase-tour-controls">
        <button onClick={skip} className="showcase-tour-btn">
          {currentStop < stops.length - 1 ? "Next" : "Finish"}
        </button>
        <button onClick={cancel} className="showcase-tour-btn-muted">
          End Tour
        </button>
      </div>
    </div>
  );
}
