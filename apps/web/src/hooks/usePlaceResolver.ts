"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { fetchApi, postApi } from "@/lib/api-client";

// ── Types ──────────────────────────────────────────────────────────

export interface AtlasPlace {
  entity_type: string;
  entity_id: string;
  display_name: string;
  subtitle: string;
  match_strength: string;
}

export interface GooglePrediction {
  place_id: string;
  description: string;
  structured_formatting: {
    main_text: string;
    secondary_text: string;
  };
}

export interface ResolvedPlace {
  place_id: string;
  display_name: string;
  formatted_address: string | null;
  locality: string | null;
}

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  existingPlace?: {
    place_id: string;
    display_name: string;
    formatted_address: string;
    place_kind: string | null;
    cat_count: number;
    request_count: number;
  };
  canAddUnit: boolean;
  normalizedAddress: string;
}

export interface UsePlaceResolverOptions {
  debounceMs?: number;
  atlasLimit?: number;
  googleLimit?: number;
  autoCheckDuplicate?: boolean;
}

// ── Hook ───────────────────────────────────────────────────────────

export function usePlaceResolver(options: UsePlaceResolverOptions = {}) {
  const {
    debounceMs = 300,
    atlasLimit = 3,
    googleLimit = 4,
    autoCheckDuplicate = true,
  } = options;

  // Search state
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [atlasResults, setAtlasResults] = useState<AtlasPlace[]>([]);
  const [googleResults, setGoogleResults] = useState<GooglePrediction[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);

  // Selection state
  const [selectedPlace, setSelectedPlace] = useState<ResolvedPlace | null>(null);

  // Google place pending resolution
  const [pendingGoogle, setPendingGoogle] = useState<GooglePrediction | null>(null);
  const [checkingDuplicate, setCheckingDuplicate] = useState(false);
  const [duplicateCheck, setDuplicateCheck] = useState<DuplicateCheckResult | null>(null);

  // Creation state
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<NodeJS.Timeout>();

  // ── Debounced parallel search ──

  useEffect(() => {
    if (query.length < 3 || selectedPlace) {
      setAtlasResults([]);
      setGoogleResults([]);
      setShowDropdown(false);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      setShowDropdown(true);

      try {
        const [atlasResult, googleResult] = await Promise.allSettled([
          fetchApi<{ results?: AtlasPlace[]; suggestions?: AtlasPlace[] }>(
            `/api/search?q=${encodeURIComponent(query)}&type=place&limit=${atlasLimit}`
          ),
          fetchApi<{ predictions: GooglePrediction[] }>(
            `/api/places/autocomplete?input=${encodeURIComponent(query)}`
          ),
        ]);

        if (atlasResult.status === "fulfilled") {
          setAtlasResults(atlasResult.value.results || atlasResult.value.suggestions || []);
        } else {
          console.warn("Atlas search failed:", atlasResult.reason);
          setAtlasResults([]);
        }

        if (googleResult.status === "fulfilled") {
          setGoogleResults((googleResult.value.predictions || []).slice(0, googleLimit));
        } else {
          console.warn("Google Places search failed:", googleResult.reason);
          setGoogleResults([]);
        }
      } catch (err) {
        console.error("PlaceResolver search error:", err);
      } finally {
        setSearching(false);
      }
    }, debounceMs);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, selectedPlace, atlasLimit, googleLimit, debounceMs]);

  // ── Actions ──

  const selectAtlasPlace = useCallback((place: AtlasPlace) => {
    setSelectedPlace({
      place_id: place.entity_id,
      display_name: place.display_name,
      formatted_address: place.subtitle || null,
      locality: null,
    });
    setShowDropdown(false);
    setQuery("");
    setError(null);
  }, []);

  const selectGooglePlace = useCallback(async (prediction: GooglePrediction) => {
    setPendingGoogle(prediction);
    setShowDropdown(false);
    setError(null);

    if (!autoCheckDuplicate) {
      // Skip duplicate check — go straight to pending state for place type selection
      return;
    }

    setCheckingDuplicate(true);
    try {
      const result = await fetchApi<DuplicateCheckResult>(
        `/api/places/check-duplicate?address=${encodeURIComponent(prediction.description)}`
      );
      if (result.isDuplicate && result.existingPlace) {
        setDuplicateCheck(result);
        return; // Caller should show duplicate modal
      }
      // No duplicate found — caller should show place type modal
    } catch (err) {
      console.error("Duplicate check error:", err);
      // On error, proceed without blocking
    } finally {
      setCheckingDuplicate(false);
    }
  }, [autoCheckDuplicate]);

  const selectExistingDuplicate = useCallback(() => {
    if (duplicateCheck?.existingPlace) {
      setSelectedPlace({
        place_id: duplicateCheck.existingPlace.place_id,
        display_name: duplicateCheck.existingPlace.display_name,
        formatted_address: duplicateCheck.existingPlace.formatted_address,
        locality: null,
      });
      setDuplicateCheck(null);
      setPendingGoogle(null);
      setQuery("");
    }
  }, [duplicateCheck]);

  const createFromGoogle = useCallback(async (placeKind: string) => {
    if (!pendingGoogle) {
      setError("No location selected");
      return;
    }

    setCreating(true);
    setError(null);
    try {
      // Fetch full Google details
      const { place: googleDetails } = await fetchApi<{ place: Record<string, unknown> }>(
        `/api/places/details?place_id=${encodeURIComponent(pendingGoogle.place_id)}`
      );

      const geo = googleDetails.geometry as { location?: { lat: number; lng: number } } | undefined;

      // Create place via centralized endpoint
      const newPlace = await postApi<{ place_id: string; display_name: string }>(
        "/api/places",
        {
          display_name: pendingGoogle.structured_formatting.main_text,
          google_place_id: pendingGoogle.place_id,
          formatted_address: googleDetails.formatted_address,
          place_kind: placeKind,
          location: geo?.location
            ? { lat: geo.location.lat, lng: geo.location.lng }
            : null,
          address_components: googleDetails.address_components,
        }
      );

      setSelectedPlace({
        place_id: newPlace.place_id,
        display_name: newPlace.display_name,
        formatted_address: googleDetails.formatted_address as string,
        locality: null,
      });
      setPendingGoogle(null);
      setQuery("");
    } catch (err) {
      console.error("Failed to create place:", err);
      setError(err instanceof Error ? err.message : "Failed to create place");
    } finally {
      setCreating(false);
    }
  }, [pendingGoogle]);

  const createUnit = useCallback(async (parentPlaceId: string, unitIdentifier: string) => {
    if (!pendingGoogle || !duplicateCheck?.existingPlace) {
      setError("Missing place data for unit creation");
      return;
    }

    setCreating(true);
    setError(null);
    try {
      const { place: googleDetails } = await fetchApi<{ place: Record<string, unknown> }>(
        `/api/places/details?place_id=${encodeURIComponent(pendingGoogle.place_id)}`
      );

      const geo = googleDetails.geometry as { location?: { lat: number; lng: number } } | undefined;

      const newPlace = await postApi<{ place_id: string; display_name: string; formatted_address?: string }>(
        "/api/places",
        {
          display_name: `${duplicateCheck.existingPlace.display_name} ${unitIdentifier}`,
          formatted_address: `${duplicateCheck.existingPlace.formatted_address.replace(/, USA$/, "")} ${unitIdentifier}`,
          place_kind: "apartment_unit",
          parent_place_id: parentPlaceId,
          unit_identifier: unitIdentifier,
          location: geo?.location
            ? { lat: geo.location.lat, lng: geo.location.lng }
            : null,
        }
      );

      setSelectedPlace({
        place_id: newPlace.place_id,
        display_name: newPlace.display_name,
        formatted_address:
          newPlace.formatted_address ||
          `${duplicateCheck.existingPlace.formatted_address} ${unitIdentifier}`,
        locality: null,
      });
      setDuplicateCheck(null);
      setPendingGoogle(null);
      setQuery("");
    } catch (err) {
      console.error("Failed to create unit:", err);
      setError(err instanceof Error ? err.message : "Failed to create unit");
    } finally {
      setCreating(false);
    }
  }, [pendingGoogle, duplicateCheck]);

  const resolveDescription = useCallback(async (description: string, placeKind: string) => {
    setCreating(true);
    setError(null);
    try {
      const newPlace = await postApi<{ place_id: string; display_name: string }>(
        "/api/places",
        {
          display_name: description,
          place_kind: placeKind,
          location_type: "described",
          location_description: description,
        }
      );

      setSelectedPlace({
        place_id: newPlace.place_id,
        display_name: newPlace.display_name,
        formatted_address: null,
        locality: null,
      });
      setQuery("");
    } catch (err) {
      console.error("Failed to create described place:", err);
      setError(err instanceof Error ? err.message : "Failed to create place");
    } finally {
      setCreating(false);
    }
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedPlace(null);
    setQuery("");
    setError(null);
  }, []);

  const clearDuplicateCheck = useCallback(() => {
    setDuplicateCheck(null);
    setPendingGoogle(null);
  }, []);

  const setPlace = useCallback((place: ResolvedPlace | null) => {
    setSelectedPlace(place);
    if (place) {
      setQuery("");
    }
  }, []);

  return {
    // Search
    query,
    setQuery,
    searching,
    atlasResults,
    googleResults,
    showDropdown,
    setShowDropdown,

    // Selection
    selectedPlace,
    setPlace,
    clearSelection,

    // Actions
    selectAtlasPlace,
    selectGooglePlace,
    selectExistingDuplicate,
    createFromGoogle,
    createUnit,
    resolveDescription,

    // Duplicate detection
    duplicateCheck,
    checkingDuplicate,
    clearDuplicateCheck,

    // State
    pendingGoogle,
    creating,
    error,
    setError,
  };
}
