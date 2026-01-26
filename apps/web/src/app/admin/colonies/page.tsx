"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface Colony {
  colony_id: string;
  colony_name: string;
  status: string;
  notes: string | null;
  place_count: number;
  request_count: number;
  linked_community_cats: number;
  linked_owned_cats: number;
  linked_community_altered: number;
  observation_total_cats: number | null;
  total_cats_confidence: string | null;
  observation_fixed_cats: number | null;
  latest_observation_date: string | null;
  has_count_discrepancy: boolean;
  created_at: string;
}

interface Summary {
  total: number;
  active: number;
  with_discrepancy: number;
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: "#198754",
    monitored: "#0d6efd",
    resolved: "#6c757d",
    inactive: "#dc3545",
  };

  return (
    <span
      style={{
        display: "inline-block",
        padding: "0.125rem 0.5rem",
        borderRadius: "4px",
        fontSize: "0.75rem",
        fontWeight: 500,
        background: `${colors[status] || "#6c757d"}20`,
        color: colors[status] || "#6c757d",
      }}
    >
      {status}
    </span>
  );
}

function DiscrepancyBadge() {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "0.125rem 0.5rem",
        borderRadius: "4px",
        fontSize: "0.75rem",
        fontWeight: 500,
        background: "#ffc10720",
        color: "#856404",
      }}
    >
      Needs Review
    </span>
  );
}

export default function ColoniesPage() {
  const [colonies, setColonies] = useState<Colony[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [showDiscrepancies, setShowDiscrepancies] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Create modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newColonyName, setNewColonyName] = useState("");
  const [newColonyNotes, setNewColonyNotes] = useState("");
  const [creating, setCreating] = useState(false);

  const fetchColonies = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (showDiscrepancies) params.set("hasDiscrepancy", "true");
      if (searchQuery) params.set("search", searchQuery);

      const response = await fetch(`/api/colonies?${params.toString()}`);
      if (!response.ok) throw new Error("Failed to fetch colonies");

      const data = await response.json();
      setColonies(data.colonies || []);
      setSummary(data.summary || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, showDiscrepancies, searchQuery]);

  useEffect(() => {
    fetchColonies();
  }, [fetchColonies]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newColonyName.trim()) return;

    setCreating(true);
    try {
      const response = await fetch("/api/colonies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          colony_name: newColonyName.trim(),
          notes: newColonyNotes.trim() || null,
          created_by: "staff", // TODO: Use actual user
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to create colony");
      }

      const data = await response.json();

      // Reset form and close modal
      setNewColonyName("");
      setNewColonyNotes("");
      setShowCreateModal(false);

      // Navigate to the new colony
      window.location.href = `/admin/colonies/${data.colony_id}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setCreating(false);
    }
  };

  if (error) {
    return (
      <div className="empty">
        <h2 style={{ color: "#dc3545" }}>Error</h2>
        <p>{error}</p>
        <button onClick={() => fetchColonies()}>Retry</button>
      </div>
    );
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1.5rem",
        }}
      >
        <div>
          <h1 style={{ margin: 0 }}>Verified Colonies</h1>
          <p className="text-muted text-sm" style={{ marginTop: "0.25rem" }}>
            Staff-verified colony data that overrides automatic clustering
          </p>
        </div>
        <button onClick={() => setShowCreateModal(true)}>+ Create Colony</button>
      </div>

      {/* Summary stats */}
      {summary && (
        <div
          style={{
            display: "flex",
            gap: "1.5rem",
            marginBottom: "1.5rem",
            padding: "1rem",
            background: "var(--card-bg)",
            borderRadius: "8px",
          }}
        >
          <div>
            <div className="text-muted text-sm">Total Colonies</div>
            <div style={{ fontSize: "1.5rem", fontWeight: 600 }}>
              {summary.total}
            </div>
          </div>
          <div>
            <div className="text-muted text-sm">Active</div>
            <div style={{ fontSize: "1.5rem", fontWeight: 600, color: "#198754" }}>
              {summary.active}
            </div>
          </div>
          <div>
            <div className="text-muted text-sm">Needs Review</div>
            <div style={{ fontSize: "1.5rem", fontWeight: 600, color: "#856404" }}>
              {summary.with_discrepancy}
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div
        style={{
          display: "flex",
          gap: "1rem",
          marginBottom: "1rem",
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <input
          type="text"
          placeholder="Search colonies..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ width: "200px" }}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="monitored">Monitored</option>
          <option value="resolved">Resolved</option>
          <option value="inactive">Inactive</option>
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input
            type="checkbox"
            checked={showDiscrepancies}
            onChange={(e) => setShowDiscrepancies(e.target.checked)}
          />
          Show only needing review
        </label>
      </div>

      {/* Colony list */}
      {loading ? (
        <div className="loading">Loading colonies...</div>
      ) : colonies.length === 0 ? (
        <div className="empty">
          <h3>No colonies found</h3>
          <p className="text-muted">
            Create a verified colony to link related places and track colony data.
          </p>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
            gap: "1rem",
          }}
        >
          {colonies.map((colony) => (
            <Link
              key={colony.colony_id}
              href={`/admin/colonies/${colony.colony_id}`}
              style={{
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <div
                style={{
                  padding: "1rem",
                  background: "var(--card-bg)",
                  borderRadius: "8px",
                  border: "1px solid var(--border)",
                  cursor: "pointer",
                  transition: "border-color 0.2s",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.borderColor = "var(--accent)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.borderColor = "var(--border)")
                }
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    marginBottom: "0.75rem",
                  }}
                >
                  <h3 style={{ margin: 0, fontSize: "1rem" }}>
                    {colony.colony_name}
                  </h3>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <StatusBadge status={colony.status} />
                    {colony.has_count_discrepancy && <DiscrepancyBadge />}
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "0.5rem",
                    fontSize: "0.875rem",
                  }}
                >
                  <div>
                    <span className="text-muted">Places:</span>{" "}
                    {colony.place_count}
                  </div>
                  <div>
                    <span className="text-muted">Requests:</span>{" "}
                    {colony.request_count}
                  </div>
                  <div>
                    <span className="text-muted">Community Cats:</span>{" "}
                    {colony.linked_community_cats}
                  </div>
                  <div>
                    <span className="text-muted">Altered:</span>{" "}
                    {colony.linked_community_altered}
                  </div>
                </div>

                {colony.observation_total_cats !== null && (
                  <div
                    style={{
                      marginTop: "0.75rem",
                      paddingTop: "0.75rem",
                      borderTop: "1px solid var(--border)",
                      fontSize: "0.875rem",
                    }}
                  >
                    <span className="text-muted">Staff Observation:</span>{" "}
                    {colony.observation_total_cats} cats
                    {colony.observation_fixed_cats !== null && (
                      <>, {colony.observation_fixed_cats} fixed</>
                    )}
                    {colony.latest_observation_date && (
                      <span className="text-muted">
                        {" "}
                        ({new Date(colony.latest_observation_date).toLocaleDateString()})
                      </span>
                    )}
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setShowCreateModal(false)}
        >
          <div
            style={{
              background: "var(--background)",
              borderRadius: "12px",
              padding: "1.5rem",
              maxWidth: "500px",
              width: "90%",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ margin: "0 0 1rem 0" }}>Create Colony</h2>
            <form onSubmit={handleCreate}>
              <div style={{ marginBottom: "1rem" }}>
                <label
                  style={{
                    display: "block",
                    marginBottom: "0.25rem",
                    fontWeight: 500,
                    fontSize: "0.875rem",
                  }}
                >
                  Colony Name *
                </label>
                <input
                  type="text"
                  value={newColonyName}
                  onChange={(e) => setNewColonyName(e.target.value)}
                  placeholder="e.g., Dagler/Hensley Colony - West Steele Lane"
                  style={{ width: "100%" }}
                  required
                  autoFocus
                />
              </div>

              <div style={{ marginBottom: "1.5rem" }}>
                <label
                  style={{
                    display: "block",
                    marginBottom: "0.25rem",
                    fontWeight: 500,
                    fontSize: "0.875rem",
                  }}
                >
                  Notes (optional)
                </label>
                <textarea
                  value={newColonyNotes}
                  onChange={(e) => setNewColonyNotes(e.target.value)}
                  placeholder="Any additional context about this colony..."
                  rows={3}
                  style={{ width: "100%", resize: "vertical" }}
                />
              </div>

              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button type="submit" disabled={creating || !newColonyName.trim()}>
                  {creating ? "Creating..." : "Create Colony"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  style={{
                    background: "transparent",
                    border: "1px solid var(--border)",
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
