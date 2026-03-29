/**
 * useMapSearch - Search functionality for Atlas Map
 *
 * Handles:
 * - Local search filtering on loaded data (instant)
 * - Atlas API fuzzy search (debounced, parallel)
 * - Google Places autocomplete (parallel with Atlas)
 * - Google Text Search for POI/business queries (parallel)
 * - All results batched in single state update — no staggered pop-in
 */

import { useState, useEffect, useCallback, useRef } from "react";
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

interface UseMapSearchOptions {
  /** Loaded places for local search */
  places: Place[];
  /** Loaded Google pins for local search */
  googlePins: GooglePin[];
  /** Loaded volunteers for local search */
  volunteers: Volunteer[];
  /** Atlas pins ref for coordinate lookup */
  atlasPinsRef: React.MutableRefObject<AtlasPin[]>;
  /** Map ref for panning/zooming */
  mapRef: React.MutableRefObject<google.maps.Map | null>;
  /** Callback when place is selected */
  onPlaceSelect?: (placeId: string) => void;
  /** Callback when person is selected */
  onPersonSelect?: (personId: string) => void;
  /** Callback when cat is selected */
  onCatSelect?: (catId: string) => void;
}

interface UseMapSearchReturn {
  // State
  query: string;
  localResults: LocalSearchResult[];
  atlasResults: AtlasSearchResult[];
  googleSuggestions: PlacePrediction[];
  poiResults: TextSearchResult[];
  loading: boolean;
  showResults: boolean;
  navigatedLocation: NavigatedLocation | null;

  // Actions
  setQuery: (query: string) => void;
  setShowResults: (show: boolean) => void;
  clearNavigatedLocation: () => void;
  handleLocalSelect: (result: LocalSearchResult) => void;
  handleAtlasSelect: (result: AtlasSearchResult) => Promise<void>;
  handleGoogleSelect: (prediction: PlacePrediction) => Promise<void>;
  handlePoiSelect: (result: TextSearchResult) => void;
}

export function useMapSearch({
  places,
  googlePins,
  volunteers,
  atlasPinsRef,
  mapRef,
  onPlaceSelect,
  onPersonSelect,
  onCatSelect,
}: UseMapSearchOptions): UseMapSearchReturn {
  const [query, setQuery] = useState("");
  const [localResults, setLocalResults] = useState<LocalSearchResult[]>([]);
  const [atlasResults, setAtlasResults] = useState<AtlasSearchResult[]>([]);
  const [googleSuggestions, setGoogleSuggestions] = useState<PlacePrediction[]>([]);
  const [poiResults, setPoiResults] = useState<TextSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [navigatedLocation, setNavigatedLocation] =
    useState<NavigatedLocation | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  // Local search - instant filtering on loaded data
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
        results.push({
          type: "google_pin",
          item: p,
          label: p.name || "Unnamed pin",
        });
      });

    volunteers
      .filter((v) => v.name.toLowerCase().includes(q))
      .slice(0, 2)
      .forEach((v) => {
        results.push({
          type: "volunteer",
          item: v,
          label: `${v.name} (${v.role_label})`,
        });
      });

    setLocalResults(results);
  }, [query, places, googlePins, volunteers]);

  // Parallel remote search — single debounced effect for Atlas + Google + Text Search
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
      // Cancel any in-flight requests
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      // Heuristic: query starts with digit → likely address, skip text search
      const isLikelyAddress = /^\d/.test(query.trim());

      try {
        const results = await Promise.allSettled([
          // 1. Atlas API search
          fetchApi<{ suggestions?: AtlasSearchResult[] }>(
            `/api/search?q=${encodeURIComponent(query)}&limit=8&suggestions=true`,
            { signal: controller.signal }
          ),
          // 2. Google Places autocomplete (always fetch)
          fetchApi<{ predictions?: PlacePrediction[] }>(
            `/api/places/autocomplete?input=${encodeURIComponent(query)}`,
            { signal: controller.signal }
          ),
          // 3. Google Text Search for POI/business queries
          isLikelyAddress
            ? Promise.resolve(null)
            : fetchApi<{ results?: TextSearchResult[] }>(
                `/api/places/text-search?query=${encodeURIComponent(query)}`,
                { signal: controller.signal }
              ),
        ]);

        // Don't update state if this request was aborted
        if (controller.signal.aborted) return;

        // Extract results from settled promises
        const atlasData =
          results[0].status === "fulfilled" ? results[0].value : null;
        const googleData =
          results[1].status === "fulfilled" ? results[1].value : null;
        const textData =
          results[2].status === "fulfilled" ? results[2].value : null;

        const newAtlasResults = atlasData?.suggestions || [];
        const newGoogleSuggestions = googleData?.predictions || [];
        let newPoiResults: TextSearchResult[] = textData?.results || [];

        // Display-time decision: only show Google suggestions if <3 Atlas results
        const showGoogle = newAtlasResults.length < 3;

        // Deduplicate: skip text search results whose place_id matches an autocomplete result
        if (newPoiResults.length > 0 && newGoogleSuggestions.length > 0) {
          const autocompletePlaceIds = new Set(
            newGoogleSuggestions.map((s) => s.place_id)
          );
          newPoiResults = newPoiResults.filter(
            (r) => !autocompletePlaceIds.has(r.place_id)
          );
        }

        // Batch-set all results in one render cycle
        setAtlasResults(newAtlasResults);
        setGoogleSuggestions(showGoogle ? newGoogleSuggestions : []);
        setPoiResults(newPoiResults);
        setLoading(false);
      } catch {
        // Only clear loading if not aborted (aborted means new search replaced this one)
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }, 200);

    return () => {
      clearTimeout(timer);
    };
  }, [query]);

  const handleLocalSelect = useCallback(
    (result: LocalSearchResult) => {
      const item = result.item as Place | GooglePin | Volunteer;
      if (mapRef.current && item.lat && item.lng) {
        mapRef.current.setCenter({ lat: item.lat, lng: item.lng });
        mapRef.current.setZoom(16);
        setNavigatedLocation(null);
      }
      setQuery("");
      setShowResults(false);
    },
    [mapRef]
  );

  const handleAtlasSelect = useCallback(
    async (result: AtlasSearchResult) => {
      setQuery("");
      setShowResults(false);

      // 1. Check API-enriched metadata first
      let lat = result.metadata?.lat;
      let lng = result.metadata?.lng;
      let linkedPlaceId: string | null = null;

      // 2. For places, also check the already-loaded atlas pins
      if ((!lat || !lng) && result.entity_type === "place") {
        const pin = atlasPinsRef.current.find((p) => p.id === result.entity_id);
        if (pin?.lat && pin?.lng) {
          lat = pin.lat;
          lng = pin.lng;
        }
      }

      // 3. For person/cat: always fetch to resolve linked place
      if (result.entity_type !== "place" || (!lat && !lng)) {
        try {
          const apiPath =
            result.entity_type === "cat"
              ? "cats"
              : result.entity_type === "person"
              ? "people"
              : "places";
          const data = await fetchApi<Record<string, unknown>>(
            `/api/${apiPath}/${result.entity_id}`
          );
          const coords = data.coordinates as { lat?: number; lng?: number } | undefined;
          if (coords?.lat && (!lat || !lng)) {
            lat = coords.lat;
            lng = coords.lng;
          }

          // Resolve linked place for person/cat
          if (result.entity_type !== "place") {
            const assocPlaces = data.associated_places as { place_id: string }[] | undefined;
            const placesArr = data.places as { place_id: string }[] | undefined;
            const plId =
              assocPlaces?.[0]?.place_id ||
              placesArr?.[0]?.place_id ||
              null;
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
          /* optional: entity location lookup failed, proceed without coords */
        }
      }

      if (mapRef.current && lat && lng) {
        setNavigatedLocation({ lat, lng, address: result.display_name });
        mapRef.current.setCenter({ lat, lng }); mapRef.current.setZoom(16);
      }

      // Open drawers
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
    [atlasPinsRef, mapRef, onPlaceSelect, onPersonSelect, onCatSelect]
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
          setNavigatedLocation({
            lat,
            lng,
            address: place.formatted_address || prediction.description,
          });
          if (mapRef.current) {
            mapRef.current.setCenter({ lat, lng });
            mapRef.current.setZoom(16);
          }
        }
      } catch (err) {
        console.error("Failed to get place details:", err);
      }
      setQuery("");
      setShowResults(false);
    },
    [mapRef]
  );

  const handlePoiSelect = useCallback(
    (result: TextSearchResult) => {
      const { lat, lng } = result.geometry.location;
      setNavigatedLocation({
        lat,
        lng,
        address: result.formatted_address,
      });
      if (mapRef.current) {
        mapRef.current.setCenter({ lat, lng });
        mapRef.current.setZoom(16);
      }
      setQuery("");
      setShowResults(false);
    },
    [mapRef]
  );

  const clearNavigatedLocation = useCallback(() => {
    setNavigatedLocation(null);
  }, []);

  return {
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
  };
}
