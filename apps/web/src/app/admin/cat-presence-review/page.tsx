"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { fetchApi, postApi } from "@/lib/api-client";

interface PlaceNeedingReconciliation {
  place_id: string;
  formatted_address: string;
  display_name: string | null;
  colony_classification: string | null;
  authoritative_cat_count: number | null;
  total_cats: number;
  current_cats: number;
  uncertain_cats: number;
  likely_departed: number;
  unconfirmed_cats: number;
  altered_cats: number;
  most_recent_observation: string | null;
  has_count_mismatch: boolean;
  has_uncertain_cats: boolean;
  has_likely_departed: boolean;
  reconciliation_priority: number;
}

interface Stats {
  total_places: number;
  with_uncertain: number;
  with_mismatch: number;
  with_departed: number;
  total_unconfirmed_cats: number;
}

interface ClassificationDist {
  colony_classification: string;
  count: number;
}

const CLASSIFICATION_LABELS: Record<string, string> = {
  individual_cats: "Individual Cats",
  small_colony: "Small Colony",
  large_colony: "Large Colony",
  feeding_station: "Feeding Station",
  unknown: "Unknown",
};

export default function CatPresenceReviewPage() {
  const [places, setPlaces] = useState<PlaceNeedingReconciliation[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [classificationDist, setClassificationDist] = useState<ClassificationDist[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionInProgress, setActionInProgress] = useState(false);

  // Filters
  const [classificationFilter, setClassificationFilter] = useState("all");
  const [hasMismatchFilter, setHasMismatchFilter] = useState(false);
  const [hasUncertainFilter, setHasUncertainFilter] = useState(false);

  // Selection for bulk actions
  const [selectedPlaces, setSelectedPlaces] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (classificationFilter !== "all") {
        params.set("classification", classificationFilter);
      }
      if (hasMismatchFilter) {
        params.set("has_mismatch", "true");
      }
      if (hasUncertainFilter) {
        params.set("has_uncertain", "true");
      }

      const data = await fetchApi<{
        places: PlaceNeedingReconciliation[];
        stats: Stats;
        classification_distribution: ClassificationDist[];
      }>(`/api/admin/cat-presence-review?${params}`);

      setPlaces(data.places || []);
      setStats(data.stats || null);
      setClassificationDist(data.classification_distribution || []);
    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  }, [classificationFilter, hasMismatchFilter, hasUncertainFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleBulkMarkOldDeparted = async () => {
    const placeIds = Array.from(selectedPlaces);
    if (placeIds.length === 0) {
      alert("Please select at least one place");
      return;
    }

    if (!confirm(`Mark all cats >3 years old as departed for ${placeIds.length} place(s)?`)) {
      return;
    }

    setActionInProgress(true);
    try {
      const result = await postApi<{ updated_count: number }>("/api/admin/cat-presence-review", {
        action: "mark_all_old_departed",
        place_ids: placeIds,
      });

      alert(`Updated ${result.updated_count} cat(s) across ${placeIds.length} place(s)`);
      setSelectedPlaces(new Set());
      fetchData();
    } catch (error) {
      console.error("Error:", error);
      alert("Failed to perform action");
    } finally {
      setActionInProgress(false);
    }
  };

  const togglePlaceSelection = (placeId: string) => {
    const newSelection = new Set(selectedPlaces);
    if (newSelection.has(placeId)) {
      newSelection.delete(placeId);
    } else {
      newSelection.add(placeId);
    }
    setSelectedPlaces(newSelection);
  };

  const selectAll = () => {
    setSelectedPlaces(new Set(places.map((p) => p.place_id)));
  };

  const selectNone = () => {
    setSelectedPlaces(new Set());
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">
          Cat Presence Review
        </h1>
        <p className="text-gray-600 mt-1">
          Review places with historical cats that need presence reconciliation
        </p>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-5 gap-4 mb-6">
          <div className="bg-yellow-50 rounded-lg p-4">
            <div className="text-2xl font-bold text-yellow-700">
              {stats.total_places}
            </div>
            <div className="text-sm text-yellow-600">Places Needing Review</div>
          </div>
          <div className="bg-orange-50 rounded-lg p-4">
            <div className="text-2xl font-bold text-orange-700">
              {stats.with_uncertain}
            </div>
            <div className="text-sm text-orange-600">With Uncertain Cats</div>
          </div>
          <div className="bg-red-50 rounded-lg p-4">
            <div className="text-2xl font-bold text-red-700">
              {stats.with_mismatch}
            </div>
            <div className="text-sm text-red-600">Count Mismatches</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="text-2xl font-bold text-gray-700">
              {stats.with_departed}
            </div>
            <div className="text-sm text-gray-600">With Likely Departed</div>
          </div>
          <div className="bg-blue-50 rounded-lg p-4">
            <div className="text-2xl font-bold text-blue-700">
              {stats.total_unconfirmed_cats}
            </div>
            <div className="text-sm text-blue-600">Unconfirmed Cats</div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-4 mb-6 items-center">
        <div>
          <label className="block text-sm text-gray-600 mb-1">Classification</label>
          <select
            value={classificationFilter}
            onChange={(e) => setClassificationFilter(e.target.value)}
            className="px-3 py-2 border rounded-lg text-sm"
          >
            <option value="all">All Classifications</option>
            {classificationDist.map((c) => (
              <option key={c.colony_classification} value={c.colony_classification}>
                {CLASSIFICATION_LABELS[c.colony_classification] || c.colony_classification} ({c.count})
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={hasMismatchFilter}
              onChange={(e) => setHasMismatchFilter(e.target.checked)}
              className="rounded"
            />
            <span className="text-sm">Count Mismatch Only</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={hasUncertainFilter}
              onChange={(e) => setHasUncertainFilter(e.target.checked)}
              className="rounded"
            />
            <span className="text-sm">Has Uncertain Cats</span>
          </label>
        </div>
      </div>

      {/* Bulk Actions */}
      {places.length > 0 && (
        <div className="flex items-center gap-4 mb-4 p-3 bg-gray-50 rounded-lg">
          <span className="text-sm text-gray-600">
            {selectedPlaces.size} of {places.length} selected
          </span>
          <button
            onClick={selectAll}
            className="text-sm text-indigo-600 hover:underline"
          >
            Select All
          </button>
          <button
            onClick={selectNone}
            className="text-sm text-indigo-600 hover:underline"
          >
            Select None
          </button>
          <div className="flex-1" />
          <button
            onClick={handleBulkMarkOldDeparted}
            disabled={selectedPlaces.size === 0 || actionInProgress}
            className="px-4 py-2 bg-red-100 text-red-700 rounded-lg text-sm font-medium hover:bg-red-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Mark Old Cats as Departed
          </button>
        </div>
      )}

      {/* Places list */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading places...</div>
      ) : places.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          No places need reconciliation!
          <p className="mt-2 text-sm">
            All cat presence statuses are confirmed.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {places.map((place) => (
            <div
              key={place.place_id}
              className={`bg-white rounded-lg border shadow-sm overflow-hidden ${
                selectedPlaces.has(place.place_id)
                  ? "border-indigo-500 ring-2 ring-indigo-200"
                  : "border-gray-200"
              }`}
            >
              <div className="p-4">
                <div className="flex items-start gap-3">
                  {/* Checkbox */}
                  <input
                    type="checkbox"
                    checked={selectedPlaces.has(place.place_id)}
                    onChange={() => togglePlaceSelection(place.place_id)}
                    className="mt-1 rounded"
                  />

                  {/* Place info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link
                        href={`/places/${place.place_id}`}
                        className="font-medium text-indigo-600 hover:underline truncate"
                      >
                        {place.display_name || place.formatted_address}
                      </Link>
                      {place.colony_classification && (
                        <span className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-xs">
                          {CLASSIFICATION_LABELS[place.colony_classification] ||
                            place.colony_classification}
                        </span>
                      )}
                      {place.has_count_mismatch && (
                        <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded text-xs font-medium">
                          Count Mismatch
                        </span>
                      )}
                    </div>

                    {place.display_name && (
                      <div className="text-sm text-gray-500 truncate mt-0.5">
                        {place.formatted_address}
                      </div>
                    )}

                    {/* Cat counts */}
                    <div className="flex flex-wrap gap-4 mt-2 text-sm">
                      {place.authoritative_cat_count !== null && (
                        <span className="text-gray-600">
                          <strong>Authoritative:</strong> {place.authoritative_cat_count}
                        </span>
                      )}
                      <span className="text-green-700">
                        <strong>Current:</strong> {place.current_cats}
                      </span>
                      {place.uncertain_cats > 0 && (
                        <span className="text-orange-700">
                          <strong>Uncertain:</strong> {place.uncertain_cats}
                        </span>
                      )}
                      {place.likely_departed > 0 && (
                        <span className="text-red-700">
                          <strong>Departed:</strong> {place.likely_departed}
                        </span>
                      )}
                      <span className="text-blue-700">
                        <strong>Altered:</strong> {place.altered_cats}
                      </span>
                    </div>
                  </div>

                  {/* Action button */}
                  <Link
                    href={`/places/${place.place_id}`}
                    className="px-3 py-1.5 bg-indigo-600 text-white rounded text-sm hover:bg-indigo-700 whitespace-nowrap"
                  >
                    Review Cats
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
