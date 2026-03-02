"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { fetchApi, postApi } from "@/lib/api-client";

interface ClusterPlace {
  place_id: string;
  address: string;
  classification: string;
  colony_id: string | null;
}

interface Cluster {
  cluster_id: string;
  cluster_name: string | null;
  place_count: number;
  unique_classifications: string[];
  dominant_classification: string;
  consistency_score: number;
  recommended_action: string;
  recommended_classification: string | null;
  status: string;
  created_at: string;
  places: ClusterPlace[];
  suggestion_distribution: Record<string, number>;
}

interface Stats {
  total_pending: number;
  total_reviewed: number;
  total_merged: number;
  avg_consistency: number;
}

const CLASSIFICATION_LABELS: Record<string, string> = {
  individual_cats: "Individual Cats",
  small_colony: "Small Colony (3-10)",
  large_colony: "Large Colony (10+)",
  feeding_station: "Feeding Station",
  unknown: "Unknown",
};

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  merge_to_colony: { label: "Merge to Colony", color: "bg-blue-100 text-blue-800" },
  reconcile_classification: { label: "Reconcile", color: "bg-yellow-100 text-yellow-800" },
  needs_site_visit: { label: "Needs Site Visit", color: "bg-red-100 text-red-800" },
  leave_separate: { label: "Leave Separate", color: "bg-green-100 text-green-800" },
};

export default function ClassificationClustersPage() {
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("pending");
  const [expandedCluster, setExpandedCluster] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  const fetchClusters = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchApi<{ clusters: Cluster[]; stats: Stats | null }>(`/api/admin/classification-clusters?status=${statusFilter}`);
      setClusters(data.clusters || []);
      setStats(data.stats || null);
    } catch (error) {
      console.error("Failed to fetch clusters:", error);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchClusters();
  }, [fetchClusters]);

  const handleAction = async (
    clusterId: string,
    action: string,
    params: Record<string, string> = {}
  ) => {
    setActionInProgress(clusterId);
    try {
      await postApi("/api/admin/classification-clusters", {
        cluster_id: clusterId,
        action,
        ...params,
      });
      fetchClusters();
    } catch (error) {
      console.error("Action failed:", error);
      alert(`Error: ${error instanceof Error ? error.message : "Action failed"}`);
    } finally {
      setActionInProgress(null);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">
          Classification Clusters
        </h1>
        <p className="text-gray-600 mt-1">
          Review geographic clusters of places that may need classification
          reconciliation
        </p>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-yellow-50 rounded-lg p-4">
            <div className="text-2xl font-bold text-yellow-700">
              {stats.total_pending}
            </div>
            <div className="text-sm text-yellow-600">Pending Review</div>
          </div>
          <div className="bg-green-50 rounded-lg p-4">
            <div className="text-2xl font-bold text-green-700">
              {stats.total_reviewed}
            </div>
            <div className="text-sm text-green-600">Reviewed</div>
          </div>
          <div className="bg-blue-50 rounded-lg p-4">
            <div className="text-2xl font-bold text-blue-700">
              {stats.total_merged}
            </div>
            <div className="text-sm text-blue-600">Merged to Colonies</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="text-2xl font-bold text-gray-700">
              {stats.avg_consistency ? `${Math.round(stats.avg_consistency * 100)}%` : "N/A"}
            </div>
            <div className="text-sm text-gray-600">Avg Consistency</div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2 mb-6">
        {["pending", "reviewed", "merged", "dismissed"].map((status) => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              statusFilter === status
                ? "bg-indigo-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </button>
        ))}
      </div>

      {/* Clusters list */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading clusters...</div>
      ) : clusters.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          No {statusFilter} clusters found.
          {statusFilter === "pending" && (
            <p className="mt-2 text-sm">
              Run <code className="bg-gray-100 px-2 py-1 rounded">node scripts/jobs/detect_classification_clusters.mjs</code> to detect clusters.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {clusters.map((cluster) => (
            <div
              key={cluster.cluster_id}
              className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden"
            >
              {/* Header */}
              <div
                className="p-4 cursor-pointer hover:bg-gray-50"
                onClick={() =>
                  setExpandedCluster(
                    expandedCluster === cluster.cluster_id
                      ? null
                      : cluster.cluster_id
                  )
                }
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <span className="text-lg font-medium">
                        {cluster.place_count} places
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${
                          cluster.consistency_score >= 0.8
                            ? "bg-green-100 text-green-800"
                            : cluster.consistency_score >= 0.5
                            ? "bg-yellow-100 text-yellow-800"
                            : "bg-red-100 text-red-800"
                        }`}
                      >
                        {Math.round(cluster.consistency_score * 100)}% consistent
                      </span>
                      {cluster.recommended_action && (
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-medium ${
                            ACTION_LABELS[cluster.recommended_action]?.color ||
                            "bg-gray-100 text-gray-800"
                          }`}
                        >
                          {ACTION_LABELS[cluster.recommended_action]?.label ||
                            cluster.recommended_action}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-sm text-gray-600">
                      Classifications:{" "}
                      {cluster.unique_classifications
                        .map((c) => CLASSIFICATION_LABELS[c] || c)
                        .join(", ")}
                    </div>
                  </div>
                  <div className="text-gray-400">
                    {expandedCluster === cluster.cluster_id ? "▼" : "▶"}
                  </div>
                </div>
              </div>

              {/* Expanded details */}
              {expandedCluster === cluster.cluster_id && (
                <div className="border-t border-gray-200 p-4 bg-gray-50">
                  {/* Places table */}
                  <table className="w-full text-sm mb-4">
                    <thead>
                      <tr className="text-left text-gray-500">
                        <th className="pb-2">Address</th>
                        <th className="pb-2">Classification</th>
                        <th className="pb-2">Colony</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cluster.places?.map((place) => (
                        <tr key={place.place_id} className="border-t border-gray-200">
                          <td className="py-2">
                            <Link
                              href={`/places/${place.place_id}`}
                              className="text-indigo-600 hover:underline"
                            >
                              {place.address}
                            </Link>
                          </td>
                          <td className="py-2">
                            {CLASSIFICATION_LABELS[place.classification] ||
                              place.classification}
                          </td>
                          <td className="py-2">
                            {place.colony_id ? (
                              <Link
                                href={`/admin/colonies?id=${place.colony_id}`}
                                className="text-blue-600 hover:underline"
                              >
                                Linked
                              </Link>
                            ) : (
                              <span className="text-gray-400">None</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {/* Suggestion distribution */}
                  {cluster.suggestion_distribution &&
                    Object.keys(cluster.suggestion_distribution).length > 0 && (
                      <div className="mb-4">
                        <div className="text-xs text-gray-500 mb-1">
                          AI Suggestion Distribution:
                        </div>
                        <div className="flex gap-2">
                          {Object.entries(cluster.suggestion_distribution).map(
                            ([cls, count]) => (
                              <span
                                key={cls}
                                className="px-2 py-1 bg-white rounded border text-xs"
                              >
                                {CLASSIFICATION_LABELS[cls] || cls}: {count}
                              </span>
                            )
                          )}
                        </div>
                      </div>
                    )}

                  {/* Actions */}
                  {cluster.status === "pending" && (
                    <div className="flex gap-2 pt-2 border-t border-gray-200">
                      <button
                        onClick={() =>
                          handleAction(cluster.cluster_id, "reconcile", {
                            classification:
                              cluster.recommended_classification ||
                              cluster.dominant_classification,
                          })
                        }
                        disabled={actionInProgress === cluster.cluster_id}
                        className="px-3 py-1.5 bg-indigo-600 text-white rounded text-sm hover:bg-indigo-700 disabled:opacity-50"
                      >
                        Apply {CLASSIFICATION_LABELS[
                          cluster.recommended_classification ||
                            cluster.dominant_classification
                        ] || "Classification"} to All
                      </button>
                      <button
                        onClick={() =>
                          handleAction(
                            cluster.cluster_id,
                            "create_colony_and_merge"
                          )
                        }
                        disabled={actionInProgress === cluster.cluster_id}
                        className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
                      >
                        Create Colony & Merge
                      </button>
                      <button
                        onClick={() =>
                          handleAction(cluster.cluster_id, "dismiss", {
                            notes: "Reviewed, no action needed",
                          })
                        }
                        disabled={actionInProgress === cluster.cluster_id}
                        className="px-3 py-1.5 bg-gray-200 text-gray-700 rounded text-sm hover:bg-gray-300 disabled:opacity-50"
                      >
                        Dismiss
                      </button>
                    </div>
                  )}

                  {cluster.status !== "pending" && (
                    <div className="text-sm text-gray-500 pt-2 border-t border-gray-200">
                      Status: {cluster.status}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
