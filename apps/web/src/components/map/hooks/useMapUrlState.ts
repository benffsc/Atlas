import { useState, useCallback, useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// URL state management for map drawers with pushState/popstate support
// ---------------------------------------------------------------------------

const URL_PARAMS = ["place", "person", "cat", "annotation"] as const;
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

export interface UseMapUrlStateReturn {
  selectedPlaceId: string | null;
  selectedPersonId: string | null;
  selectedCatId: string | null;
  selectedAnnotationId: string | null;
  setSelectedPlaceId: (id: string | null) => void;
  setSelectedPersonId: (id: string | null) => void;
  setSelectedCatId: (id: string | null) => void;
  setSelectedAnnotationId: (id: string | null) => void;
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
  };
}
