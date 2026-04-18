"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchApi } from "@/lib/api-client";
import { SkeletonList } from "@/components/feedback/Skeleton";
import { EmptyList, EmptySearchResults, ErrorState } from "@/components/feedback/EmptyState";
import { LogObservationModal } from "@/components/modals";
import { StatCard } from "@/components/ui/StatCard";

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
  if (daysAgo >= 14) return "var(--priority-urgent)";   // Red - urgent
  if (daysAgo >= 7) return "var(--priority-high)";      // Orange - needs attention
  if (daysAgo >= 3) return "var(--status-on-hold)";     // Yellow - due soon
  return "var(--healthy-text)";                          // Green - recent
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
            valueColor={data.stats.sites_needing_observation > 0 ? "var(--priority-high)" : "var(--healthy-text)"}
          />
          <StatCard label="Total Observations" value={data.stats.total_observations} valueColor="var(--primary)" />
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
              border: "1px solid var(--border)",
              borderRadius: "4px 0 0 4px",
              background: viewMode === "sites" ? "var(--primary)" : "var(--background)",
              color: viewMode === "sites" ? "#fff" : "var(--text-primary)",
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
              border: "1px solid var(--border)",
              borderLeft: "none",
              borderRadius: "0 4px 4px 0",
              background: viewMode === "recent" ? "var(--primary)" : "var(--background)",
              color: viewMode === "recent" ? "#fff" : "var(--text-primary)",
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
              border: "1px solid var(--border)",
              borderRadius: "4px",
              fontSize: "1rem",
            }}
          />
        )}
      </div>

      {/* Loading */}
      {loading && <SkeletonList items={5} />}

      {/* Error */}
      {error && <ErrorState title="Failed to load observations" description={error} />}

      {/* Content */}
      {!loading && !error && data && (
        <>
          {viewMode === "sites" ? (
            <>
              {sortedSites.length === 0 ? (
                searchTerm
                  ? <EmptySearchResults query={searchTerm} onClear={() => setSearchTerm("")} />
                  : <EmptyList entityName="site assignments" />
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
                          background: needsObservation ? "var(--warning-bg)" : "var(--background)",
                          border: `1px solid ${needsObservation ? "var(--warning-border)" : "var(--border)"}`,
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
                              color: "var(--muted)",
                              fontSize: "0.85rem",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {site.full_address}
                          </div>
                          <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem", fontSize: "0.8rem" }}>
                            <span style={{ color: "var(--muted)" }}>
                              Last: <strong style={{ color: urgencyColor }}>{formatDate(site.last_observation_date)}</strong>
                            </span>
                            {site.total_cats_from_clinic > 0 && (
                              <span style={{ color: "var(--status-scheduled)" }}>
                                {site.total_cats_from_clinic} altered
                              </span>
                            )}
                            {site.latest_cats_seen !== null && (
                              <span style={{ color: "var(--primary)" }}>
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
                              background: "var(--info-bg)",
                              color: "var(--info-text)",
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
                            background: "var(--healthy-text)",
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
                <EmptyList entityName="observations" />
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
                        background: "var(--background)",
                        border: "1px solid var(--border)",
                        borderRadius: "8px",
                      }}
                    >
                      {/* Date */}
                      <div
                        style={{
                          background: "var(--section-bg)",
                          padding: "0.5rem",
                          borderRadius: "4px",
                          textAlign: "center",
                          minWidth: "60px",
                        }}
                      >
                        <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
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
                              background: "var(--info-bg)",
                              color: "var(--info-text)",
                              padding: "0.125rem 0.5rem",
                              borderRadius: "999px",
                              fontSize: "0.8rem",
                            }}
                          >
                            {obs.total_cats_observed} seen
                          </span>
                          <span
                            style={{
                              background: obs.eartip_count_observed > 0 ? "var(--healthy-bg)" : "var(--bg-secondary)",
                              color: obs.eartip_count_observed > 0 ? "var(--healthy-text)" : "var(--text-secondary)",
                              padding: "0.125rem 0.5rem",
                              borderRadius: "999px",
                              fontSize: "0.8rem",
                            }}
                          >
                            {obs.eartip_count_observed} tipped
                          </span>
                          {obs.total_cats_observed > 0 && (
                            <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                              ({Math.round((obs.eartip_count_observed / obs.total_cats_observed) * 100)}% altered)
                            </span>
                          )}
                        </div>
                        {obs.notes && (
                          <div style={{ marginTop: "0.5rem", color: "var(--muted)", fontSize: "0.9rem", fontStyle: "italic" }}>
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
          background: "var(--info-bg)",
          borderRadius: "8px",
          border: "1px solid var(--info-border)",
        }}
      >
        <h3 style={{ margin: "0 0 0.5rem", fontSize: "1rem", color: "var(--info-text)" }}>
          Why Log Observations?
        </h3>
        <p style={{ margin: 0, fontSize: "0.9rem", color: "var(--info-text)" }}>
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
