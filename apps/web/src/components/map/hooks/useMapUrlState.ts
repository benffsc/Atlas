import { useState, useCallback, useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// URL state management for map drawers, dates, and viewport (FFS-1178)
// with pushState/popstate support
// ---------------------------------------------------------------------------

const URL_PARAMS = [
  "place", "person", "cat", "annotation",
  "from", "to",         // date filter (FFS-1174/1178)
  "center", "zoom",     // viewport (FFS-1178)
] as const;
type UrlParamKey = (typeof URL_PARAMS)[number];

function readParam(key: UrlParamKey): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(key) || null;
}

function writeUrl(updates: Partial<Record<UrlParamKey, string | null>>, replace = false) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(updates)) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  const newUrl = url.toString();
  if (newUrl === window.location.href) return;
  if (replace) {
    window.history.replaceState({}, "", newUrl);
  } else {
    window.history.pushState({}, "", newUrl);
  }
}

/** Parse "lat,lng" pair. Returns null if malformed. */
function parseCenter(raw: string | null): { lat: number; lng: number } | null {
  if (!raw) return null;
  const [latStr, lngStr] = raw.split(",");
  const lat = Number(latStr);
  const lng = Number(lngStr);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

/** Round a coordinate to 5 decimals (~1m precision) for URL compactness. */
function formatCoord(n: number): string {
  return n.toFixed(5);
}

export function readMapInitialUrlState() {
  if (typeof window === "undefined") {
    return { dateFrom: null, dateTo: null, center: null, zoom: null };
  }
  const params = new URLSearchParams(window.location.search);
  const zoomRaw = params.get("zoom");
  const zoom = zoomRaw ? Number(zoomRaw) : null;
  return {
    dateFrom: params.get("from") || null,
    dateTo: params.get("to") || null,
    center: parseCenter(params.get("center")),
    zoom: zoom && Number.isFinite(zoom) && zoom >= 1 && zoom <= 22 ? zoom : null,
  };
}

export interface UseMapUrlStateReturn {
  selectedPlaceId: string | null;
  selectedPersonId: string | null;
  selectedCatId: string | null;
  selectedAnnotationId: string | null;
  setSelectedPlaceId: (id: string | null) => void;
  setSelectedPersonId: (id: string | null) => void;
  setSelectedCatId: (id: string | null) => void;
  setSelectedAnnotationId: (id: string | null) => void;
  /** Sync date filter to URL without pushing a history entry. */
  syncDatesToUrl: (from: string | null, to: string | null) => void;
  /** Sync viewport (center + zoom) to URL without pushing a history entry. */
  syncViewportToUrl: (center: { lat: number; lng: number } | null, zoom: number | null) => void;
}

export function useMapUrlState(): UseMapUrlStateReturn {
  // Initialize from URL on mount
  const [selectedPlaceId, setPlaceIdState] = useState<string | null>(() => readParam("place"));
  const [selectedPersonId, setPersonIdState] = useState<string | null>(() => readParam("person"));
  const [selectedCatId, setCatIdState] = useState<string | null>(() => readParam("cat"));
  const [selectedAnnotationId, setAnnotationIdState] = useState<string | null>(() => readParam("annotation"));

  // Track whether we're handling a popstate (to avoid pushing a new history entry)
  const isPopstateRef = useRef(false);
  // Track mount for replaceState on first load
  const isMountRef = useRef(true);

  // Setters that push URL state
  const setSelectedPlaceId = useCallback((id: string | null) => {
    setPlaceIdState(id);
    if (!isPopstateRef.current) {
      writeUrl({ place: id }, isMountRef.current);
      isMountRef.current = false;
    }
  }, []);

  const setSelectedPersonId = useCallback((id: string | null) => {
    setPersonIdState(id);
    if (!isPopstateRef.current) {
      writeUrl({ person: id }, isMountRef.current);
      isMountRef.current = false;
    }
  }, []);

  const setSelectedCatId = useCallback((id: string | null) => {
    setCatIdState(id);
    if (!isPopstateRef.current) {
      writeUrl({ cat: id }, isMountRef.current);
      isMountRef.current = false;
    }
  }, []);

  const setSelectedAnnotationId = useCallback((id: string | null) => {
    setAnnotationIdState(id);
    if (!isPopstateRef.current) {
      writeUrl({ annotation: id }, isMountRef.current);
      isMountRef.current = false;
    }
  }, []);

  // Dates + viewport use replaceState (no history entries for scrub/pan/zoom spam).
  const syncDatesToUrl = useCallback((from: string | null, to: string | null) => {
    if (isPopstateRef.current) return;
    writeUrl({ from, to }, true);
  }, []);

  const syncViewportToUrl = useCallback(
    (center: { lat: number; lng: number } | null, zoom: number | null) => {
      if (isPopstateRef.current) return;
      writeUrl(
        {
          center: center ? `${formatCoord(center.lat)},${formatCoord(center.lng)}` : null,
          zoom: zoom != null ? String(Math.round(zoom)) : null,
        },
        true
      );
    },
    []
  );

  // Clear mount flag after first render
  useEffect(() => {
    isMountRef.current = false;
  }, []);

  // Listen for back/forward navigation
  useEffect(() => {
    const handlePopstate = () => {
      isPopstateRef.current = true;
      setPlaceIdState(readParam("place"));
      setPersonIdState(readParam("person"));
      setCatIdState(readParam("cat"));
      setAnnotationIdState(readParam("annotation"));
      // Reset flag after React has processed the state updates
      requestAnimationFrame(() => { isPopstateRef.current = false; });
    };
    window.addEventListener("popstate", handlePopstate);
    return () => window.removeEventListener("popstate", handlePopstate);
  }, []);

  return {
    selectedPlaceId,
    selectedPersonId,
    selectedCatId,
    selectedAnnotationId,
    setSelectedPlaceId,
    setSelectedPersonId,
    setSelectedCatId,
    setSelectedAnnotationId,
    syncDatesToUrl,
    syncViewportToUrl,
  };
}
