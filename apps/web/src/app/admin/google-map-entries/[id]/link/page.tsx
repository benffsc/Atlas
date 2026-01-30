"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { BackButton } from "@/components/BackButton";

interface PlaceUnit {
  place_id: string;
  unit_identifier: string;
  cat_count: number;
}

interface NearbyPlace {
  place_id: string;
  formatted_address: string;
  display_name: string | null;
  distance_m: number;
  cat_count: number;
  person_count: number;
  is_multi_unit: boolean;
  place_kind: string;
  units?: PlaceUnit[];
}

interface EntryData {
  entry: {
    id: string;
    name: string;
    lat: number;
    lng: number;
    linked_place_id: string | null;
    requires_unit_selection: boolean;
    suggested_parent_place_id: string | null;
  };
  nearby_places: NearbyPlace[];
  ai_suggestion: {
    place_id: string;
    address: string;
    confidence: string;
    is_same_as_nearby_place: boolean;
  } | null;
}

export default function LinkGoogleMapEntryPage() {
  const params = useParams();
  const router = useRouter();
  const entryId = params.id as string;

  const [data, setData] = useState<EntryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [expandedBuilding, setExpandedBuilding] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/google-map-entries/${entryId}/nearby-places`);
      if (!response.ok) {
        throw new Error("Failed to fetch entry data");
      }
      const result = await response.json();
      setData(result);

      // Auto-select if AI suggestion exists
      if (result.ai_suggestion?.is_same_as_nearby_place) {
        setSelectedPlaceId(result.ai_suggestion.place_id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [entryId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleLink = async () => {
    const placeToLink = selectedUnitId || selectedPlaceId;
    if (!placeToLink) {
      alert("Please select a place to link to");
      return;
    }

    setLinking(true);
    try {
      const response = await fetch(`/api/google-map-entries/${entryId}/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ place_id: placeToLink }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to link entry");
      }

      // Success - redirect back to map
      router.push("/map");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to link entry");
    } finally {
      setLinking(false);
    }
  };

  const handleSkip = () => {
    router.push("/map");
  };

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse">Loading entry data...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-8">
        <div className="text-red-600">Error: {error || "Failed to load"}</div>
        <div className="mt-4">
          <BackButton fallbackHref="/map" />
        </div>
      </div>
    );
  }

  if (data.entry.linked_place_id) {
    return (
      <div className="p-8">
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <p className="text-green-800">This entry is already linked to a place.</p>
        </div>
        <div className="mt-4">
          <BackButton fallbackHref="/map" />
        </div>
      </div>
    );
  }

  const selectedPlace = data.nearby_places.find(p => p.place_id === selectedPlaceId);
  const showUnitSelection = selectedPlace?.is_multi_unit && selectedPlace?.units && selectedPlace.units.length > 0;

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8">
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <BackButton fallbackHref="/map" />
        </div>

        <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
          <h1 className="text-xl font-semibold mb-4">Link Historical Entry</h1>

          <div className="bg-gray-50 rounded-lg p-4 mb-6">
            <div className="font-medium text-gray-900">{data.entry.name || "Unnamed Entry"}</div>
            <div className="text-sm text-gray-500 mt-1">
              Coordinates: {data.entry.lat.toFixed(6)}, {data.entry.lng.toFixed(6)}
            </div>
          </div>

          {data.ai_suggestion && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
              <div className="text-sm font-medium text-blue-800 mb-1">
                AI Suggestion ({data.ai_suggestion.confidence} confidence)
              </div>
              <div className="text-sm text-blue-700">{data.ai_suggestion.address}</div>
            </div>
          )}

          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Select nearby place to link:
            </label>

            {data.nearby_places.length === 0 ? (
              <div className="text-gray-500 text-sm">No nearby places found within 500m</div>
            ) : (
              <div className="space-y-2">
                {data.nearby_places.map((place) => (
                  <div key={place.place_id}>
                    <label
                      className={`flex items-start p-3 border rounded-lg cursor-pointer transition-colors ${
                        selectedPlaceId === place.place_id
                          ? "border-blue-500 bg-blue-50"
                          : "border-gray-200 hover:border-gray-300"
                      }`}
                    >
                      <input
                        type="radio"
                        name="place"
                        value={place.place_id}
                        checked={selectedPlaceId === place.place_id}
                        onChange={() => {
                          setSelectedPlaceId(place.place_id);
                          setSelectedUnitId(null);
                          if (place.is_multi_unit) {
                            setExpandedBuilding(place.place_id);
                          }
                        }}
                        className="mt-1 mr-3"
                      />
                      <div className="flex-1">
                        <div className="font-medium text-gray-900 text-sm">
                          {place.formatted_address}
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                          <span>{Math.round(place.distance_m)}m away</span>
                          {place.cat_count > 0 && <span>🐱 {place.cat_count}</span>}
                          {place.person_count > 0 && <span>👤 {place.person_count}</span>}
                          {place.is_multi_unit && (
                            <span className="text-orange-600">🏢 Multi-unit</span>
                          )}
                        </div>
                      </div>
                    </label>

                    {/* Unit selection for multi-unit buildings */}
                    {selectedPlaceId === place.place_id && place.is_multi_unit && place.units && place.units.length > 0 && (
                      <div className="ml-8 mt-2 border-l-2 border-blue-200 pl-4 py-2">
                        <div className="text-sm font-medium text-gray-700 mb-2">
                          Select specific unit:
                        </div>
                        <div className="space-y-1">
                          {place.units.map((unit) => (
                            <label
                              key={unit.place_id}
                              className={`flex items-center p-2 border rounded cursor-pointer text-sm ${
                                selectedUnitId === unit.place_id
                                  ? "border-blue-500 bg-blue-50"
                                  : "border-gray-100 hover:border-gray-200"
                              }`}
                            >
                              <input
                                type="radio"
                                name="unit"
                                value={unit.place_id}
                                checked={selectedUnitId === unit.place_id}
                                onChange={() => setSelectedUnitId(unit.place_id)}
                                className="mr-2"
                              />
                              <span>{unit.unit_identifier}</span>
                              {unit.cat_count > 0 && (
                                <span className="ml-2 text-gray-400">🐱 {unit.cat_count}</span>
                              )}
                            </label>
                          ))}
                        </div>
                        <div className="text-xs text-gray-400 mt-2">
                          Or link to the building itself (no unit selected)
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleLink}
              disabled={!selectedPlaceId || linking}
              className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors ${
                selectedPlaceId && !linking
                  ? "bg-blue-600 text-white hover:bg-blue-700"
                  : "bg-gray-100 text-gray-400 cursor-not-allowed"
              }`}
            >
              {linking ? "Linking..." : "Link Entry"}
            </button>
            <button
              onClick={handleSkip}
              disabled={linking}
              className="py-2 px-4 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Skip
            </button>
          </div>
        </div>

        <div className="text-xs text-gray-400 text-center">
          Entry ID: {entryId}
        </div>
      </div>
    </div>
  );
}
