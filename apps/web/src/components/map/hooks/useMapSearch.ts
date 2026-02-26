/**
 * useMapSearch - Search functionality for Atlas Map
 *
 * Handles:
 * - Local search filtering on loaded data
 * - Atlas API fuzzy search (debounced)
 * - Google Places autocomplete fallback
 * - Search result selection and navigation
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type {
  Place,
  GooglePin,
  Volunteer,
  AtlasSearchResult,
  PlacePrediction,
  NavigatedLocation,
  AtlasPin,
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
  mapRef: React.MutableRefObject<L.Map | null>;
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
  const [googleSuggestions, setGoogleSuggestions] = useState<PlacePrediction[]>(
    []
  );
  const [loading, setLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [navigatedLocation, setNavigatedLocation] =
    useState<NavigatedLocation | null>(null);

  // Local search - instant filtering on loaded data
  useEffect(() => {
    if (!query.trim()) {
      setLocalResults([]);
      setAtlasResults([]);
      setGoogleSuggestions([]);
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

  // Atlas API search (debounced)
  useEffect(() => {
    if (query.length < 3) {
      setAtlasResults([]);
      return;
    }

    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(query)}&limit=8&suggestions=true`
        );
        if (res.ok) {
          const data = await res.json();
          setAtlasResults(data.suggestions || []);
        }
      } catch (err) {
        console.error("Atlas search error:", err);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  // Google Places autocomplete (fallback when few Atlas results)
  useEffect(() => {
    if (query.length < 3) {
      setGoogleSuggestions([]);
      return;
    }

    const timer = setTimeout(async () => {
      if (atlasResults.length < 3) {
        try {
          const res = await fetch(
            `/api/places/autocomplete?input=${encodeURIComponent(query)}`
          );
          if (res.ok) {
            const data = await res.json();
            setGoogleSuggestions(data.predictions || []);
          }
        } catch (err) {
          console.error("Google Places error:", err);
        }
      } else {
        setGoogleSuggestions([]);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [query, atlasResults.length]);

  const handleLocalSelect = useCallback(
    (result: LocalSearchResult) => {
      const item = result.item as Place | GooglePin | Volunteer;
      if (mapRef.current && item.lat && item.lng) {
        mapRef.current.setView([item.lat, item.lng], 16, {
          animate: true,
          duration: 0.5,
        });
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
          const res = await fetch(`/api/${apiPath}/${result.entity_id}`);
          if (res.ok) {
            const data = await res.json();
            if (data.coordinates?.lat && (!lat || !lng)) {
              lat = data.coordinates.lat;
              lng = data.coordinates.lng;
            }

            // Resolve linked place for person/cat
            if (result.entity_type !== "place") {
              const plId =
                data.associated_places?.[0]?.place_id ||
                data.places?.[0]?.place_id ||
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
          }
        } catch {
          // Fall through
        }
      }

      if (mapRef.current && lat && lng) {
        setNavigatedLocation({ lat, lng, address: result.display_name });
        mapRef.current.setView([lat, lng], 16, { animate: true, duration: 0.5 });
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
        const res = await fetch(
          `/api/places/details?place_id=${prediction.place_id}`
        );
        if (res.ok) {
          const data = await res.json();
          const place = data.place;
          if (place?.geometry?.location) {
            const { lat, lng } = place.geometry.location;
            setNavigatedLocation({
              lat,
              lng,
              address: place.formatted_address || prediction.description,
            });
            if (mapRef.current) {
              mapRef.current.setView([lat, lng], 16, {
                animate: true,
                duration: 0.5,
              });
            }
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

  const clearNavigatedLocation = useCallback(() => {
    setNavigatedLocation(null);
  }, []);

  return {
    query,
    localResults,
    atlasResults,
    googleSuggestions,
    loading,
    showResults,
    navigatedLocation,
    setQuery,
    setShowResults,
    clearNavigatedLocation,
    handleLocalSelect,
    handleAtlasSelect,
    handleGoogleSelect,
  };
}
