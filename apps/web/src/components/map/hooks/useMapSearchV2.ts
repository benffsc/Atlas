/**
 * useMapSearchV2 - Search functionality for Google Maps V2
 *
 * Adapts useMapSearch.ts for Google Maps API:
 * - Replaces mapRef.current.setView([lat,lng], zoom) with map.panTo/setZoom
 * - Same multi-source search: local + Atlas API + Google Places + POI
 * - Same batched state updates — no staggered pop-in
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { fetchApi } from "@/lib/api-client";
import type {
  Place,
  GooglePin,
  Volunteer,
  AtlasSearchResult,
  PlacePrediction,
  NavigatedLocation,
  AtlasPin,
  TextSearchResult,
} from "../types";

interface LocalSearchResult {
  type: string;
  item: Place | GooglePin | Volunteer;
  label: string;
}

interface UseMapSearchV2Options {
  places: Place[];
  googlePins: GooglePin[];
  volunteers: Volunteer[];
  atlasPinsRef: React.MutableRefObject<AtlasPin[]>;
  /** Google Maps instance from useMap() */
  map: google.maps.Map | null;
  onPlaceSelect?: (placeId: string) => void;
  onPersonSelect?: (personId: string) => void;
  onCatSelect?: (catId: string) => void;
}

interface UseMapSearchV2Return {
  query: string;
  localResults: LocalSearchResult[];
  atlasResults: AtlasSearchResult[];
  googleSuggestions: PlacePrediction[];
  poiResults: TextSearchResult[];
  loading: boolean;
  showResults: boolean;
  navigatedLocation: NavigatedLocation | null;
  setQuery: (query: string) => void;
  setShowResults: (show: boolean) => void;
  clearNavigatedLocation: () => void;
  handleLocalSelect: (result: LocalSearchResult) => void;
  handleAtlasSelect: (result: AtlasSearchResult) => Promise<void>;
  handleGoogleSelect: (prediction: PlacePrediction) => Promise<void>;
  handlePoiSelect: (result: TextSearchResult) => void;
}

export type { LocalSearchResult };

export function useMapSearchV2({
  places,
  googlePins,
  volunteers,
  atlasPinsRef,
  map,
  onPlaceSelect,
  onPersonSelect,
  onCatSelect,
}: UseMapSearchV2Options): UseMapSearchV2Return {
  const [query, setQuery] = useState("");
  const [localResults, setLocalResults] = useState<LocalSearchResult[]>([]);
  const [atlasResults, setAtlasResults] = useState<AtlasSearchResult[]>([]);
  const [googleSuggestions, setGoogleSuggestions] = useState<PlacePrediction[]>([]);
  const [poiResults, setPoiResults] = useState<TextSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [navigatedLocation, setNavigatedLocation] = useState<NavigatedLocation | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  // Local search — instant filtering on loaded data
  useEffect(() => {
    if (!query.trim()) {
      setLocalResults([]);
      return;
    }

    const q = query.toLowerCase();
    const results: LocalSearchResult[] = [];

    places
      .filter((p) => p.address.toLowerCase().includes(q))
      .slice(0, 2)
      .forEach((p) => {
        results.push({ type: "place", item: p, label: p.address });
      });

    googlePins
      .filter((p) => p.name?.toLowerCase().includes(q))
      .slice(0, 2)
      .forEach((p) => {
        results.push({ type: "google_pin", item: p, label: p.name || "Unnamed pin" });
      });

    volunteers
      .filter((v) => v.name.toLowerCase().includes(q))
      .slice(0, 2)
      .forEach((v) => {
        results.push({ type: "volunteer", item: v, label: `${v.name} (${v.role_label})` });
      });

    setLocalResults(results);
  }, [query, places, googlePins, volunteers]);

  // Parallel remote search — debounced Atlas + Google + Text Search
  useEffect(() => {
    if (query.length < 3) {
      setAtlasResults([]);
      setGoogleSuggestions([]);
      setPoiResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const isLikelyAddress = /^\d/.test(query.trim());

      try {
        const results = await Promise.allSettled([
          fetchApi<{ suggestions?: AtlasSearchResult[] }>(
            `/api/search?q=${encodeURIComponent(query)}&limit=8&suggestions=true`,
            { signal: controller.signal }
          ),
          fetchApi<{ predictions?: PlacePrediction[] }>(
            `/api/places/autocomplete?input=${encodeURIComponent(query)}`,
            { signal: controller.signal }
          ),
          isLikelyAddress
            ? Promise.resolve(null)
            : fetchApi<{ results?: TextSearchResult[] }>(
                `/api/places/text-search?query=${encodeURIComponent(query)}`,
                { signal: controller.signal }
              ),
        ]);

        if (controller.signal.aborted) return;

        const atlasData = results[0].status === "fulfilled" ? results[0].value : null;
        const googleData = results[1].status === "fulfilled" ? results[1].value : null;
        const textData = results[2].status === "fulfilled" ? results[2].value : null;

        const newAtlasResults = atlasData?.suggestions || [];
        const newGoogleSuggestions = googleData?.predictions || [];
        let newPoiResults: TextSearchResult[] = textData?.results || [];

        const showGoogle = newAtlasResults.length < 3;

        if (newPoiResults.length > 0 && newGoogleSuggestions.length > 0) {
          const autocompletePlaceIds = new Set(newGoogleSuggestions.map((s) => s.place_id));
          newPoiResults = newPoiResults.filter((r) => !autocompletePlaceIds.has(r.place_id));
        }

        setAtlasResults(newAtlasResults);
        setGoogleSuggestions(showGoogle ? newGoogleSuggestions : []);
        setPoiResults(newPoiResults);
        setLoading(false);
      } catch {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }, 200);

    return () => { clearTimeout(timer); };
  }, [query]);

  /** Pan Google Map to coordinates */
  const panTo = useCallback(
    (lat: number, lng: number, zoom = 16) => {
      if (!map) return;
      map.panTo({ lat, lng });
      map.setZoom(zoom);
    },
    [map]
  );

  const handleLocalSelect = useCallback(
    (result: LocalSearchResult) => {
      const item = result.item as Place | GooglePin | Volunteer;
      if (item.lat && item.lng) {
        panTo(item.lat, item.lng);
        setNavigatedLocation(null);
      }
      setQuery("");
      setShowResults(false);
    },
    [panTo]
  );

  const handleAtlasSelect = useCallback(
    async (result: AtlasSearchResult) => {
      setQuery("");
      setShowResults(false);

      let lat = result.metadata?.lat;
      let lng = result.metadata?.lng;
      let linkedPlaceId: string | null = null;

      if ((!lat || !lng) && result.entity_type === "place") {
        const pin = atlasPinsRef.current.find((p) => p.id === result.entity_id);
        if (pin?.lat && pin?.lng) {
          lat = pin.lat;
          lng = pin.lng;
        }
      }

      if (result.entity_type !== "place" || (!lat && !lng)) {
        try {
          const apiPath = result.entity_type === "cat" ? "cats" : result.entity_type === "person" ? "people" : "places";
          const data = await fetchApi<Record<string, unknown>>(`/api/${apiPath}/${result.entity_id}`);
          const coords = data.coordinates as { lat?: number; lng?: number } | undefined;
          if (coords?.lat && (!lat || !lng)) {
            lat = coords.lat;
            lng = coords.lng;
          }

          if (result.entity_type !== "place") {
            const assocPlaces = data.associated_places as { place_id: string }[] | undefined;
            const placesArr = data.places as { place_id: string }[] | undefined;
            const plId = assocPlaces?.[0]?.place_id || placesArr?.[0]?.place_id || null;
            if (plId) {
              linkedPlaceId = plId;
              if (!lat || !lng) {
                const pin = atlasPinsRef.current.find((p) => p.id === plId);
                if (pin?.lat && pin?.lng) {
                  lat = pin.lat;
                  lng = pin.lng;
                }
              }
            }
          }
        } catch {
          /* entity location lookup failed */
        }
      }

      if (lat && lng) {
        setNavigatedLocation({ lat, lng, address: result.display_name });
        panTo(lat, lng);
      }

      if (result.entity_type === "place") {
        onPlaceSelect?.(result.entity_id);
      } else if (result.entity_type === "person") {
        if (linkedPlaceId) onPlaceSelect?.(linkedPlaceId);
        onPersonSelect?.(result.entity_id);
      } else if (result.entity_type === "cat") {
        if (linkedPlaceId) onPlaceSelect?.(linkedPlaceId);
        onCatSelect?.(result.entity_id);
      }
    },
    [atlasPinsRef, panTo, onPlaceSelect, onPersonSelect, onCatSelect]
  );

  const handleGoogleSelect = useCallback(
    async (prediction: PlacePrediction) => {
      try {
        const data = await fetchApi<{ place: { geometry?: { location?: { lat: number; lng: number } }; formatted_address?: string } }>(
          `/api/places/details?place_id=${prediction.place_id}`
        );
        const place = data.place;
        if (place?.geometry?.location) {
          const { lat, lng } = place.geometry.location;
          setNavigatedLocation({ lat, lng, address: place.formatted_address || prediction.description });
          panTo(lat, lng);
        }
      } catch (err) {
        console.error("Failed to get place details:", err);
      }
      setQuery("");
      setShowResults(false);
    },
    [panTo]
  );

  const handlePoiSelect = useCallback(
    (result: TextSearchResult) => {
      const { lat, lng } = result.geometry.location;
      setNavigatedLocation({ lat, lng, address: result.formatted_address });
      panTo(lat, lng);
      setQuery("");
      setShowResults(false);
    },
    [panTo]
  );

  const clearNavigatedLocation = useCallback(() => {
    setNavigatedLocation(null);
  }, []);

  return useMemo(() => ({
    query,
    localResults,
    atlasResults,
    googleSuggestions,
    poiResults,
    loading,
    showResults,
    navigatedLocation,
    setQuery,
    setShowResults,
    clearNavigatedLocation,
    handleLocalSelect,
    handleAtlasSelect,
    handleGoogleSelect,
    handlePoiSelect,
  }), [
    query, localResults, atlasResults, googleSuggestions, poiResults,
    loading, showResults, navigatedLocation, setQuery, setShowResults,
    clearNavigatedLocation, handleLocalSelect, handleAtlasSelect,
    handleGoogleSelect, handlePoiSelect,
  ]);
}
