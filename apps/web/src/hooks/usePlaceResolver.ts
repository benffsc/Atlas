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
  metadata?: { place_kind?: string; cat_count?: number; person_count?: number };
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
  place_kind?: string | null;
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

  // Inline resolution state (replaces modal flow)
  const [resolving, setResolving] = useState(false);
  const [resolvingAddress, setResolvingAddress] = useState<string | null>(null);

  // Duplicate state (inline, not modal)
  const [duplicateInfo, setDuplicateInfo] = useState<DuplicateCheckResult | null>(null);
  const [pendingGoogleForUnit, setPendingGoogleForUnit] = useState<GooglePrediction | null>(null);

  // Creation state
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<NodeJS.Timeout>();
  const abortRef = useRef<AbortController>();
  const searchIdRef = useRef(0);

  // ── Debounced search with independent result streams (FFS-688) ──

  useEffect(() => {
    if (query.length < 3 || selectedPlace) {
      setAtlasResults([]);
      setGoogleResults([]);
      setShowDropdown(false);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      // Abort any in-flight requests from previous search
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const currentSearchId = ++searchIdRef.current;

      setSearching(true);
      setShowDropdown(true);

      // Fire Atlas and Google independently — show each as it arrives
      fetchApi<{ results?: AtlasPlace[]; suggestions?: AtlasPlace[] }>(
        `/api/search?q=${encodeURIComponent(query)}&type=place&limit=${atlasLimit}`,
        { signal: controller.signal }
      )
        .then((data) => {
          if (searchIdRef.current !== currentSearchId) return;
          setAtlasResults(data.results || data.suggestions || []);
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          console.warn("Atlas search failed:", err);
          setAtlasResults([]);
        });

      fetchApi<{ predictions: GooglePrediction[] }>(
        `/api/places/autocomplete?input=${encodeURIComponent(query)}`,
        { signal: controller.signal }
      )
        .then((data) => {
          if (searchIdRef.current !== currentSearchId) return;
          setGoogleResults((data.predictions || []).slice(0, googleLimit));
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          console.warn("Google Places search failed:", err);
          setGoogleResults([]);
        })
        .finally(() => {
          if (searchIdRef.current === currentSearchId) {
            setSearching(false);
          }
        });
    }, debounceMs);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, [query, selectedPlace, atlasLimit, googleLimit, debounceMs]);

  // ── Actions ──

  const selectAtlasPlace = useCallback((place: AtlasPlace) => {
    setSelectedPlace({
      place_id: place.entity_id,
      display_name: place.display_name,
      formatted_address: place.subtitle || null,
      locality: null,
      place_kind: place.metadata?.place_kind || null,
    });
    setShowDropdown(false);
    setQuery("");
    setError(null);
  }, []);

  /**
   * Select a Google Place and resolve it inline — no modal.
   * Runs duplicate check + Google details + place creation in parallel.
   * Returns the resolved place_kind (from existing place) or null (new place).
   */
  const selectGooglePlace = useCallback(async (prediction: GooglePrediction): Promise<string | null> => {
    setShowDropdown(false);
    setError(null);
    setResolving(true);
    setResolvingAddress(prediction.description);
    setDuplicateInfo(null);

    try {
      // Run duplicate check and Google details fetch in parallel
      const [dupResult, detailsResult] = await Promise.allSettled([
        autoCheckDuplicate
          ? fetchApi<DuplicateCheckResult>(
              `/api/places/check-duplicate?address=${encodeURIComponent(prediction.description)}`
            )
          : Promise.resolve(null),
        fetchApi<{ place: Record<string, unknown> }>(
          `/api/places/details?place_id=${encodeURIComponent(prediction.place_id)}`
        ),
      ]);

      // Check for duplicate
      const dupCheck = dupResult.status === "fulfilled" ? dupResult.value : null;
      if (dupCheck?.isDuplicate && dupCheck.existingPlace) {
        // Show inline duplicate info — let user decide
        setDuplicateInfo(dupCheck);
        setPendingGoogleForUnit(prediction);
        setResolving(false);
        setResolvingAddress(null);

        // Auto-select the existing place (staff can switch to "add unit" if needed)
        setSelectedPlace({
          place_id: dupCheck.existingPlace.place_id,
          display_name: dupCheck.existingPlace.display_name,
          formatted_address: dupCheck.existingPlace.formatted_address,
          locality: null,
          place_kind: dupCheck.existingPlace.place_kind,
        });
        setQuery("");
        return dupCheck.existingPlace.place_kind || null;
      }

      // No duplicate — create new place
      if (detailsResult.status === "rejected") {
        throw new Error("Failed to fetch address details from Google");
      }

      const googleDetails = detailsResult.value.place;
      const geo = googleDetails.geometry as { location?: { lat: number; lng: number } } | undefined;

      const newPlace = await postApi<{ place_id: string; display_name: string }>(
        "/api/places",
        {
          display_name: prediction.structured_formatting.main_text,
          google_place_id: prediction.place_id,
          formatted_address: googleDetails.formatted_address,
          place_kind: "unknown",
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
        place_kind: "unknown",
      });
      setQuery("");
      return null;
    } catch (err) {
      console.error("Failed to resolve place:", err);
      setError(err instanceof Error ? err.message : "Failed to create place");
      return null;
    } finally {
      setResolving(false);
      setResolvingAddress(null);
    }
  }, [autoCheckDuplicate]);

  /** Create a unit under the duplicate place */
  const createUnit = useCallback(async (parentPlaceId: string, unitIdentifier: string) => {
    if (!pendingGoogleForUnit || !duplicateInfo?.existingPlace) {
      setError("Missing place data for unit creation");
      return;
    }

    setCreating(true);
    setError(null);
    try {
      const { place: googleDetails } = await fetchApi<{ place: Record<string, unknown> }>(
        `/api/places/details?place_id=${encodeURIComponent(pendingGoogleForUnit.place_id)}`
      );

      const geo = googleDetails.geometry as { location?: { lat: number; lng: number } } | undefined;

      const newPlace = await postApi<{ place_id: string; display_name: string; formatted_address?: string }>(
        "/api/places",
        {
          display_name: `${duplicateInfo.existingPlace.display_name} ${unitIdentifier}`,
          formatted_address: `${duplicateInfo.existingPlace.formatted_address.replace(/, USA$/, "")} ${unitIdentifier}`,
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
          `${duplicateInfo.existingPlace.formatted_address} ${unitIdentifier}`,
        locality: null,
      });
      setDuplicateInfo(null);
      setPendingGoogleForUnit(null);
      setQuery("");
    } catch (err) {
      console.error("Failed to create unit:", err);
      setError(err instanceof Error ? err.message : "Failed to create unit");
    } finally {
      setCreating(false);
    }
  }, [pendingGoogleForUnit, duplicateInfo]);

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
    setDuplicateInfo(null);
    setPendingGoogleForUnit(null);
  }, []);

  const dismissDuplicate = useCallback(() => {
    setDuplicateInfo(null);
    setPendingGoogleForUnit(null);
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
    createUnit,
    resolveDescription,

    // Inline resolution state
    resolving,
    resolvingAddress,

    // Duplicate (inline)
    duplicateInfo,
    pendingGoogleForUnit,
    dismissDuplicate,

    // State
    creating,
    error,
    setError,
  };
}
