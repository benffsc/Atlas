"use client";

import { useState, useEffect, useRef, useCallback } from "react";

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
        const [atlasRes, googleRes] = await Promise.all([
          fetch(`/api/search?q=${encodeURIComponent(query)}&type=place&limit=${atlasLimit}`),
          fetch(`/api/places/autocomplete?input=${encodeURIComponent(query)}`),
        ]);

        if (atlasRes.ok) {
          const data = await atlasRes.json();
          setAtlasResults(data.results || []);
        }
        if (googleRes.ok) {
          const data = await googleRes.json();
          setGoogleResults((data.predictions || []).slice(0, googleLimit));
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
      const response = await fetch(
        `/api/places/check-duplicate?address=${encodeURIComponent(prediction.description)}`
      );
      if (response.ok) {
        const result: DuplicateCheckResult = await response.json();
        if (result.isDuplicate && result.existingPlace) {
          setDuplicateCheck(result);
          return; // Caller should show duplicate modal
        }
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
      const detailsRes = await fetch(
        `/api/places/details?place_id=${encodeURIComponent(pendingGoogle.place_id)}`
      );
      if (!detailsRes.ok) {
        throw new Error("Failed to get place details");
      }
      const { place: googleDetails } = await detailsRes.json();

      // Create place via centralized endpoint
      const createRes = await fetch("/api/places", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: pendingGoogle.structured_formatting.main_text,
          google_place_id: pendingGoogle.place_id,
          formatted_address: googleDetails.formatted_address,
          place_kind: placeKind,
          location: googleDetails.geometry?.location
            ? {
                lat: googleDetails.geometry.location.lat,
                lng: googleDetails.geometry.location.lng,
              }
            : null,
          address_components: googleDetails.address_components,
        }),
      });

      if (!createRes.ok) {
        const errData = await createRes.json();
        throw new Error(errData.error || "Failed to create place");
      }

      const newPlace = await createRes.json();
      setSelectedPlace({
        place_id: newPlace.place_id,
        display_name: newPlace.display_name,
        formatted_address: googleDetails.formatted_address,
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
      const detailsRes = await fetch(
        `/api/places/details?place_id=${encodeURIComponent(pendingGoogle.place_id)}`
      );
      if (!detailsRes.ok) {
        throw new Error("Failed to get place details");
      }
      const { place: googleDetails } = await detailsRes.json();

      const createRes = await fetch("/api/places", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: `${duplicateCheck.existingPlace.display_name} ${unitIdentifier}`,
          formatted_address: `${duplicateCheck.existingPlace.formatted_address.replace(/, USA$/, "")} ${unitIdentifier}`,
          place_kind: "apartment_unit",
          parent_place_id: parentPlaceId,
          unit_identifier: unitIdentifier,
          location: googleDetails.geometry?.location
            ? {
                lat: googleDetails.geometry.location.lat,
                lng: googleDetails.geometry.location.lng,
              }
            : null,
        }),
      });

      if (!createRes.ok) {
        const errData = await createRes.json();
        throw new Error(errData.error || "Failed to create unit");
      }

      const newPlace = await createRes.json();
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
      const createRes = await fetch("/api/places", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: description,
          place_kind: placeKind,
          location_type: "described",
          location_description: description,
        }),
      });

      if (!createRes.ok) {
        const errData = await createRes.json();
        throw new Error(errData.error || "Failed to create place");
      }

      const newPlace = await createRes.json();
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
