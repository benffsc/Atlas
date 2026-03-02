"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchApi } from "@/lib/api-client";
import { LogObservationModal } from "@/components/modals";

interface TrapperSite {
  place_id: string;
  place_name: string;
  full_address: string;
  request_id: string;
  request_status: string;
  request_notes: string | null;
  assigned_at: string;
  last_observation_date: string | null;
  observation_count: number;
  total_cats_from_clinic: number;
  latest_cats_seen: number | null;
  latest_eartips_seen: number | null;
}

interface RecentObservation {
  estimate_id: string;
  place_id: string;
  place_name: string;
  full_address: string;
  total_cats_observed: number;
  eartip_count_observed: number;
  observation_date: string;
  notes: string | null;
}

interface ObservationsData {
  sites: TrapperSite[];
  recent_observations: RecentObservation[];
  stats: {
    total_sites: number;
    sites_needing_observation: number;
    total_observations: number;
  };
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getDaysAgo(dateStr: string | null): number {
  if (!dateStr) return 999;
  const date = new Date(dateStr);
  const now = new Date();
  return Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
}

function getUrgencyColor(daysAgo: number): string {
  if (daysAgo >= 14) return "#dc3545"; // Red - urgent
  if (daysAgo >= 7) return "#fd7e14"; // Orange - needs attention
  if (daysAgo >= 3) return "#ffc107"; // Yellow - due soon
  return "#28a745"; // Green - recent
}

function StatCard({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div
      style={{
        background: "#f8f9fa",
        borderRadius: "8px",
        padding: "1rem",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: "1.75rem", fontWeight: "bold", color: color || "inherit" }}>
        {value}
      </div>
      <div style={{ fontSize: "0.8rem", color: "#666" }}>{label}</div>
    </div>
  );
}

export default function TrapperObservationsPage() {
  const [data, setData] = useState<ObservationsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [selectedSite, setSelectedSite] = useState<TrapperSite | null>(null);
  const [viewMode, setViewMode] = useState<"sites" | "recent">("sites");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchApi<ObservationsData>("/api/trappers/observations");
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const openObservationModal = (site: TrapperSite) => {
    setSelectedSite(site);
    setShowModal(true);
  };

  const handleObservationSuccess = () => {
    fetchData();
  };

  // Filter sites by search term
  const filteredSites = data?.sites.filter(
    (site) =>
      site.place_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      site.full_address.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  // Sort sites: needs observation first (oldest observation date first)
  const sortedSites = [...filteredSites].sort((a, b) => {
    const daysA = getDaysAgo(a.last_observation_date);
    const daysB = getDaysAgo(b.last_observation_date);
    return daysB - daysA; // More days ago = higher priority
  });

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <h1 style={{ margin: 0 }}>Site Observations</h1>
      </div>

      {/* Stats */}
      {data && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: "1rem",
            marginBottom: "1.5rem",
          }}
        >
          <StatCard label="Active Sites" value={data.stats.total_sites} />
          <StatCard
            label="Need Observation"
            value={data.stats.sites_needing_observation}
            color={data.stats.sites_needing_observation > 0 ? "#fd7e14" : "#28a745"}
          />
          <StatCard label="Total Observations" value={data.stats.total_observations} color="#0d6efd" />
        </div>
      )}

      {/* View Toggle & Search */}
      <div
        style={{
          display: "flex",
          gap: "1rem",
          marginBottom: "1rem",
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", gap: "0.25rem" }}>
          <button
            onClick={() => setViewMode("sites")}
            style={{
              padding: "0.5rem 1rem",
              border: "1px solid #ddd",
              borderRadius: "4px 0 0 4px",
              background: viewMode === "sites" ? "#0d6efd" : "#fff",
              color: viewMode === "sites" ? "#fff" : "#333",
              cursor: "pointer",
              fontWeight: 500,
            }}
          >
            My Sites
          </button>
          <button
            onClick={() => setViewMode("recent")}
            style={{
              padding: "0.5rem 1rem",
              border: "1px solid #ddd",
              borderLeft: "none",
              borderRadius: "0 4px 4px 0",
              background: viewMode === "recent" ? "#0d6efd" : "#fff",
              color: viewMode === "recent" ? "#fff" : "#333",
              cursor: "pointer",
              fontWeight: 500,
            }}
          >
            Recent Observations
          </button>
        </div>

        {viewMode === "sites" && (
          <input
            type="text"
            placeholder="Search sites..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              flex: 1,
              minWidth: "200px",
              padding: "0.5rem 1rem",
              border: "1px solid #ddd",
              borderRadius: "4px",
              fontSize: "1rem",
            }}
          />
        )}
      </div>

      {/* Loading */}
      {loading && <div className="loading">Loading observation data...</div>}

      {/* Error */}
      {error && <div className="empty" style={{ color: "red" }}>{error}</div>}

      {/* Content */}
      {!loading && !error && data && (
        <>
          {viewMode === "sites" ? (
            <>
              {sortedSites.length === 0 ? (
                <div className="empty">
                  {searchTerm
                    ? "No sites match your search."
                    : "No active site assignments found."}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  {sortedSites.map((site) => {
                    const daysAgo = getDaysAgo(site.last_observation_date);
                    const urgencyColor = getUrgencyColor(daysAgo);
                    const needsObservation = daysAgo >= 7;

                    return (
                      <div
                        key={site.place_id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "1rem",
                          padding: "1rem",
                          background: needsObservation ? "#fff8e6" : "#fff",
                          border: `1px solid ${needsObservation ? "#ffe0b2" : "#ddd"}`,
                          borderRadius: "8px",
                          borderLeft: `4px solid ${urgencyColor}`,
                        }}
                      >
                        {/* Site Info */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontWeight: 600,
                              fontSize: "1rem",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            <a
                              href={`/places/${site.place_id}`}
                              style={{ color: "inherit", textDecoration: "none" }}
                            >
                              {site.place_name}
                            </a>
                          </div>
                          <div
                            style={{
                              color: "#666",
                              fontSize: "0.85rem",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {site.full_address}
                          </div>
                          <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem", fontSize: "0.8rem" }}>
                            <span style={{ color: "#666" }}>
                              Last: <strong style={{ color: urgencyColor }}>{formatDate(site.last_observation_date)}</strong>
                            </span>
                            {site.total_cats_from_clinic > 0 && (
                              <span style={{ color: "#198754" }}>
                                {site.total_cats_from_clinic} altered
                              </span>
                            )}
                            {site.latest_cats_seen !== null && (
                              <span style={{ color: "#0d6efd" }}>
                                {site.latest_cats_seen} seen, {site.latest_eartips_seen} tipped
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Request badge */}
                        <div style={{ textAlign: "center" }}>
                          <a
                            href={`/requests/${site.request_id}`}
                            style={{
                              display: "inline-block",
                              padding: "0.25rem 0.5rem",
                              background: "#e3f2fd",
                              color: "#1565c0",
                              borderRadius: "4px",
                              fontSize: "0.75rem",
                              textDecoration: "none",
                            }}
                          >
                            {site.request_status}
                          </a>
                        </div>

                        {/* Quick Log Button */}
                        <button
                          onClick={() => openObservationModal(site)}
                          style={{
                            padding: "0.75rem 1.25rem",
                            background: "#28a745",
                            color: "#fff",
                            border: "none",
                            borderRadius: "6px",
                            cursor: "pointer",
                            fontWeight: 600,
                            whiteSpace: "nowrap",
                            display: "flex",
                            alignItems: "center",
                            gap: "0.5rem",
                          }}
                        >
                          <span style={{ fontSize: "1.1rem" }}>+</span>
                          Log Visit
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            /* Recent Observations View */
            <>
              {data.recent_observations.length === 0 ? (
                <div className="empty">No observations recorded yet.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {data.recent_observations.map((obs) => (
                    <div
                      key={obs.estimate_id}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "1rem",
                        padding: "1rem",
                        background: "#fff",
                        border: "1px solid #ddd",
                        borderRadius: "8px",
                      }}
                    >
                      {/* Date */}
                      <div
                        style={{
                          background: "#f8f9fa",
                          padding: "0.5rem",
                          borderRadius: "4px",
                          textAlign: "center",
                          minWidth: "60px",
                        }}
                      >
                        <div style={{ fontSize: "0.75rem", color: "#666" }}>
                          {formatDate(obs.observation_date)}
                        </div>
                      </div>

                      {/* Content */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 500 }}>
                          <a
                            href={`/places/${obs.place_id}`}
                            style={{ color: "inherit", textDecoration: "none" }}
                          >
                            {obs.place_name}
                          </a>
                        </div>
                        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.25rem" }}>
                          <span
                            style={{
                              background: "#e3f2fd",
                              color: "#1565c0",
                              padding: "0.125rem 0.5rem",
                              borderRadius: "999px",
                              fontSize: "0.8rem",
                            }}
                          >
                            {obs.total_cats_observed} seen
                          </span>
                          <span
                            style={{
                              background: obs.eartip_count_observed > 0 ? "#e8f5e9" : "#f5f5f5",
                              color: obs.eartip_count_observed > 0 ? "#2e7d32" : "#757575",
                              padding: "0.125rem 0.5rem",
                              borderRadius: "999px",
                              fontSize: "0.8rem",
                            }}
                          >
                            {obs.eartip_count_observed} tipped
                          </span>
                          {obs.total_cats_observed > 0 && (
                            <span style={{ fontSize: "0.8rem", color: "#666" }}>
                              ({Math.round((obs.eartip_count_observed / obs.total_cats_observed) * 100)}% altered)
                            </span>
                          )}
                        </div>
                        {obs.notes && (
                          <div style={{ marginTop: "0.5rem", color: "#666", fontSize: "0.9rem", fontStyle: "italic" }}>
                            &ldquo;{obs.notes}&rdquo;
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Help Section */}
      <div
        style={{
          marginTop: "2rem",
          padding: "1rem",
          background: "#e3f2fd",
          borderRadius: "8px",
          border: "1px solid #90caf9",
        }}
      >
        <h3 style={{ margin: "0 0 0.5rem", fontSize: "1rem", color: "#1565c0" }}>
          Why Log Observations?
        </h3>
        <p style={{ margin: 0, fontSize: "0.9rem", color: "#1976d2" }}>
          Site observations enable the <strong>Chapman mark-resight estimator</strong> to calculate colony population size.
          When you visit a site, note how many cats you see and how many have ear tips (indicating they&apos;ve been fixed).
          Regular observations improve population estimates and help track TNR progress.
        </p>
      </div>

      {/* Observation Modal */}
      {selectedSite && (
        <LogObservationModal
          isOpen={showModal}
          onClose={() => {
            setShowModal(false);
            setSelectedSite(null);
          }}
          placeId={selectedSite.place_id}
          placeName={selectedSite.place_name}
          onSuccess={handleObservationSuccess}
        />
      )}
    </div>
  );
}
