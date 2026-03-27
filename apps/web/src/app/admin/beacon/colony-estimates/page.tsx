"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { DataQualityBadge } from "@/components/badges";
import { ConfirmDialog } from "@/components/feedback/ConfirmDialog";
import { fetchApi, postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";

interface ColonyEstimate {
  estimate_id: string;
  place_id: string;
  place_name: string;
  place_address: string;
  total_cats: number | null;
  eartip_count_observed: number | null;
  altered_count: number | null;
  source_type: string;
  source_system: string;
  observation_date: string;
  notes: string | null;
  created_at: string;
}

interface Stats {
  total_estimates: number;
  by_source_type: Record<string, number>;
  places_with_estimates: number;
  avg_colony_size: number;
}

const sourceTypeColors: Record<string, string> = {
  post_clinic_survey: "#10b981",
  trapper_site_visit: "#3b82f6",
  intake_form: "#8b5cf6",
  internal_notes_parse: "#f59e0b",
  intake_situation_parse: "#f97316",
  legacy_mymaps: "#6b7280",
  verified_cats: "#059669",
};

export default function ColonyEstimatesPage() {
  const { addToast } = useToast();
  const [estimates, setEstimates] = useState<ColonyEstimate[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [editingEstimate, setEditingEstimate] = useState<ColonyEstimate | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pendingConfirm, setPendingConfirm] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);

  useEffect(() => {
    loadData();
  }, [sourceFilter]);

  const loadData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (sourceFilter !== "all") params.set("source_type", sourceFilter);
      params.set("limit", "200");

      const [estimatesData, statsData] = await Promise.all([
        fetchApi<{ estimates: ColonyEstimate[] }>(`/api/admin/beacon/colony-estimates?${params}`),
        fetchApi<Stats>("/api/admin/beacon/colony-estimates/stats"),
      ]);

      setEstimates(estimatesData.estimates || []);
      setStats(statsData);
    } catch (err) {
      console.error("Failed to load data:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (est: ColonyEstimate) => {
    setEditingEstimate({ ...est });
  };

  const handleSave = async () => {
    if (!editingEstimate) return;
    setSaving(true);
    try {
      await postApi("/api/admin/beacon/colony-estimates", {
        estimate_id: editingEstimate.estimate_id,
        total_cats: editingEstimate.total_cats,
        eartip_count_observed: editingEstimate.eartip_count_observed,
        altered_count: editingEstimate.altered_count,
        notes: editingEstimate.notes,
      }, { method: "PATCH" });

      setEditingEstimate(null);
      loadData();
    } catch (err) {
      addToast({ type: "error", message: "Error saving changes" });
    } finally {
      setSaving(false);
    }
  };

  function handleDelete(estimateId: string) {
    setPendingConfirm({
      title: "Delete estimate",
      message: "Delete this colony estimate? This cannot be undone.",
      onConfirm: async () => {
        setPendingConfirm(null);
        try {
          await postApi(`/api/admin/beacon/colony-estimates?id=${estimateId}`, {}, { method: "DELETE" });
          loadData();
        } catch (err) {
          addToast({ type: "error", message: "Error deleting estimate" });
        }
      },
    });
  }

  function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    setPendingConfirm({
      title: "Bulk delete",
      message: `Delete ${selectedIds.size} selected estimates? This cannot be undone.`,
      onConfirm: async () => {
        setPendingConfirm(null);
        let deleted = 0;
        for (const id of selectedIds) {
          try {
            await postApi(`/api/admin/beacon/colony-estimates?id=${id}`, {}, { method: "DELETE" });
            deleted++;
          } catch {
            /* skip failed */
          }
        }
        setSelectedIds(new Set());
        loadData();
        addToast({ type: "success", message: `Deleted ${deleted} of ${selectedIds.size} estimates` });
      },
    });
  }

  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredEstimates.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredEstimates.map((e) => e.estimate_id)));
    }
  };

  const filteredEstimates = estimates.filter((e) => {
    if (!filter) return true;
    const search = filter.toLowerCase();
    return (
      e.place_name?.toLowerCase().includes(search) ||
      e.place_address?.toLowerCase().includes(search) ||
      e.notes?.toLowerCase().includes(search)
    );
  });

  return (
    <div style={{ maxWidth: "1400px", margin: "0 auto", padding: "0 1rem" }}>
      {/* Breadcrumb */}
      <div style={{ marginBottom: "1rem" }}>
        <Link href="/admin" style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>
          Admin
        </Link>
        <span style={{ margin: "0 0.5rem", color: "var(--text-muted)" }}>/</span>
        <span style={{ fontSize: "0.875rem" }}>Beacon</span>
        <span style={{ margin: "0 0.5rem", color: "var(--text-muted)" }}>/</span>
        <span style={{ fontSize: "0.875rem" }}>Colony Estimates</span>
      </div>

      {/* Header */}
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ marginBottom: "0.25rem" }}>Colony Estimates</h1>
        <p className="text-muted">
          Review and manage colony size estimates from all sources. Fix incorrect data, merge
          duplicates, and ensure Beacon analytics accuracy.
        </p>
      </div>

      {/* Stats Summary */}
      {stats && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "1rem",
            marginBottom: "1.5rem",
          }}
        >
          <div className="card" style={{ padding: "1rem", textAlign: "center" }}>
            <div style={{ fontSize: "2rem", fontWeight: 700 }}>{stats.total_estimates}</div>
            <div className="text-muted text-sm">Total Estimates</div>
          </div>
          <div className="card" style={{ padding: "1rem", textAlign: "center" }}>
            <div style={{ fontSize: "2rem", fontWeight: 700 }}>{stats.places_with_estimates}</div>
            <div className="text-muted text-sm">Places Covered</div>
          </div>
          <div className="card" style={{ padding: "1rem", textAlign: "center" }}>
            <div style={{ fontSize: "2rem", fontWeight: 700 }}>
              {stats.avg_colony_size?.toFixed(1) || "—"}
            </div>
            <div className="text-muted text-sm">Avg Colony Size</div>
          </div>
        </div>
      )}

      {/* Source Type Breakdown */}
      {stats && (
        <div className="card" style={{ padding: "1rem", marginBottom: "1.5rem" }}>
          <h3 style={{ margin: "0 0 0.75rem 0", fontSize: "0.95rem" }}>By Source Type</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
            {Object.entries(stats.by_source_type || {}).map(([type, count]) => (
              <button
                key={type}
                onClick={() => setSourceFilter(sourceFilter === type ? "all" : type)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  padding: "0.5rem 0.75rem",
                  border: sourceFilter === type ? "2px solid #3b82f6" : "1px solid var(--card-border)",
                  borderRadius: "6px",
                  background: sourceFilter === type ? "#eff6ff" : "transparent",
                  cursor: "pointer",
                  fontSize: "0.875rem",
                }}
              >
                <span
                  style={{
                    width: "10px",
                    height: "10px",
                    borderRadius: "50%",
                    background: sourceTypeColors[type] || "#6b7280",
                  }}
                />
                <span>{type.replace(/_/g, " ")}</span>
                <strong>{count}</strong>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Search and Bulk Actions */}
      <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem", alignItems: "center" }}>
        <input
          type="text"
          placeholder="Search by place name, address, or notes..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{
            flex: 1,
            padding: "0.75rem",
            border: "1px solid var(--card-border)",
            borderRadius: "6px",
            fontSize: "0.95rem",
          }}
        />
        {selectedIds.size > 0 && (
          <button
            onClick={handleBulkDelete}
            style={{
              padding: "0.75rem 1rem",
              background: "#ef4444",
              color: "white",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
              fontSize: "0.875rem",
              fontWeight: 500,
            }}
          >
            Delete {selectedIds.size} Selected
          </button>
        )}
      </div>

      {/* Results */}
      {loading ? (
        <div className="card" style={{ padding: "2rem", textAlign: "center" }}>
          Loading estimates...
        </div>
      ) : (
        <div className="card">
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--card-border)" }}>
                <th style={{ padding: "0.75rem", textAlign: "center", width: "40px" }}>
                  <input
                    type="checkbox"
                    checked={selectedIds.size === filteredEstimates.length && filteredEstimates.length > 0}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th style={{ padding: "0.75rem", textAlign: "left", fontWeight: 600 }}>Place</th>
                <th style={{ padding: "0.75rem", textAlign: "center", fontWeight: 600 }}>Total</th>
                <th style={{ padding: "0.75rem", textAlign: "center", fontWeight: 600 }}>Eartips</th>
                <th style={{ padding: "0.75rem", textAlign: "left", fontWeight: 600 }}>Source</th>
                <th style={{ padding: "0.75rem", textAlign: "left", fontWeight: 600 }}>Date</th>
                <th style={{ padding: "0.75rem", textAlign: "left", fontWeight: 600 }}>Notes</th>
                <th style={{ padding: "0.75rem", textAlign: "center", fontWeight: 600 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredEstimates.map((est) => (
                <tr
                  key={est.estimate_id}
                  style={{
                    borderBottom: "1px solid var(--card-border)",
                    background: selectedIds.has(est.estimate_id) ? "#eff6ff" : undefined,
                  }}
                >
                  <td style={{ padding: "0.75rem", textAlign: "center" }}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(est.estimate_id)}
                      onChange={() => toggleSelect(est.estimate_id)}
                    />
                  </td>
                  <td style={{ padding: "0.75rem" }}>
                    <Link
                      href={`/places/${est.place_id}`}
                      style={{ fontWeight: 500, color: "var(--primary, #3b82f6)" }}
                    >
                      {est.place_name || "Unnamed"}
                    </Link>
                    <div className="text-muted text-sm">{est.place_address}</div>
                  </td>
                  <td style={{ padding: "0.75rem", textAlign: "center", fontWeight: 600 }}>
                    {est.total_cats ?? "—"}
                  </td>
                  <td style={{ padding: "0.75rem", textAlign: "center" }}>
                    {est.eartip_count_observed ?? "—"}
                  </td>
                  <td style={{ padding: "0.75rem" }}>
                    <DataQualityBadge
                      source={est.source_type}
                      confidence={est.source_type?.includes("parse") ? "medium" : "high"}
                      needsReview={est.source_type?.includes("parse")}
                    />
                  </td>
                  <td style={{ padding: "0.75rem", fontSize: "0.875rem" }}>
                    {est.observation_date
                      ? new Date(est.observation_date).toLocaleDateString()
                      : "—"}
                  </td>
                  <td
                    style={{
                      padding: "0.75rem",
                      fontSize: "0.875rem",
                      maxWidth: "200px",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={est.notes || ""}
                  >
                    {est.notes ? est.notes.slice(0, 50) + (est.notes.length > 50 ? "..." : "") : "—"}
                  </td>
                  <td style={{ padding: "0.75rem", textAlign: "center" }}>
                    <button
                      onClick={() => handleEdit(est)}
                      style={{
                        padding: "0.25rem 0.5rem",
                        fontSize: "0.75rem",
                        border: "1px solid var(--card-border)",
                        borderRadius: "4px",
                        background: "transparent",
                        cursor: "pointer",
                        marginRight: "0.25rem",
                      }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(est.estimate_id)}
                      style={{
                        padding: "0.25rem 0.5rem",
                        fontSize: "0.75rem",
                        border: "1px solid #ef4444",
                        borderRadius: "4px",
                        background: "transparent",
                        color: "#ef4444",
                        cursor: "pointer",
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {filteredEstimates.length === 0 && (
            <div style={{ padding: "2rem", textAlign: "center" }} className="text-muted">
              No estimates found
            </div>
          )}
        </div>
      )}

      {/* Edit Modal */}
      {editingEstimate && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setEditingEstimate(null)}
        >
          <div
            className="card"
            style={{ padding: "1.5rem", width: "500px", maxWidth: "90vw" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ margin: "0 0 1rem 0", fontSize: "1.25rem" }}>Edit Colony Estimate</h2>

            <div style={{ marginBottom: "1rem" }}>
              <div className="text-muted text-sm" style={{ marginBottom: "0.25rem" }}>
                Place
              </div>
              <div style={{ fontWeight: 500 }}>{editingEstimate.place_name}</div>
              <div className="text-muted text-sm">{editingEstimate.place_address}</div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
              <div>
                <label className="text-sm" style={{ display: "block", marginBottom: "0.25rem" }}>
                  Total Cats
                </label>
                <input
                  type="number"
                  value={editingEstimate.total_cats ?? ""}
                  onChange={(e) =>
                    setEditingEstimate({
                      ...editingEstimate,
                      total_cats: e.target.value ? parseInt(e.target.value) : null,
                    })
                  }
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    border: "1px solid var(--card-border)",
                    borderRadius: "4px",
                  }}
                />
              </div>
              <div>
                <label className="text-sm" style={{ display: "block", marginBottom: "0.25rem" }}>
                  Eartips Observed
                </label>
                <input
                  type="number"
                  value={editingEstimate.eartip_count_observed ?? ""}
                  onChange={(e) =>
                    setEditingEstimate({
                      ...editingEstimate,
                      eartip_count_observed: e.target.value ? parseInt(e.target.value) : null,
                    })
                  }
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    border: "1px solid var(--card-border)",
                    borderRadius: "4px",
                  }}
                />
              </div>
              <div>
                <label className="text-sm" style={{ display: "block", marginBottom: "0.25rem" }}>
                  Altered Count
                </label>
                <input
                  type="number"
                  value={editingEstimate.altered_count ?? ""}
                  onChange={(e) =>
                    setEditingEstimate({
                      ...editingEstimate,
                      altered_count: e.target.value ? parseInt(e.target.value) : null,
                    })
                  }
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    border: "1px solid var(--card-border)",
                    borderRadius: "4px",
                  }}
                />
              </div>
            </div>

            <div style={{ marginBottom: "1.5rem" }}>
              <label className="text-sm" style={{ display: "block", marginBottom: "0.25rem" }}>
                Notes
              </label>
              <textarea
                value={editingEstimate.notes ?? ""}
                onChange={(e) => setEditingEstimate({ ...editingEstimate, notes: e.target.value })}
                rows={3}
                style={{
                  width: "100%",
                  padding: "0.5rem",
                  border: "1px solid var(--card-border)",
                  borderRadius: "4px",
                  resize: "vertical",
                }}
              />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem" }}>
              <button
                onClick={() => setEditingEstimate(null)}
                style={{
                  padding: "0.5rem 1rem",
                  border: "1px solid var(--card-border)",
                  borderRadius: "6px",
                  background: "transparent",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{
                  padding: "0.5rem 1rem",
                  border: "none",
                  borderRadius: "6px",
                  background: "var(--primary, #3b82f6)",
                  color: "white",
                  cursor: saving ? "not-allowed" : "pointer",
                  opacity: saving ? 0.6 : 1,
                }}
              >
                {saving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Data Quality Tips */}
      <div className="card" style={{ padding: "1rem", marginTop: "1.5rem" }}>
        <h3 style={{ margin: "0 0 0.5rem 0", fontSize: "0.95rem" }}>Data Quality Tips</h3>
        <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.875rem" }} className="text-muted">
          <li>
            <strong>internal_notes_parse</strong> and <strong>intake_situation_parse</strong> are
            AI-extracted - verify accuracy before using for predictions
          </li>
          <li>
            <strong>verified_cats</strong> and <strong>post_clinic_survey</strong> are highest
            confidence sources
          </li>
          <li>
            <strong>legacy_mymaps</strong> data is historical (2001-2019) - coordinates may be
            approximate
          </li>
          <li>Delete duplicates or merge when same place has conflicting estimates</li>
        </ul>
      </div>

      <ConfirmDialog
        open={!!pendingConfirm}
        title={pendingConfirm?.title ?? ""}
        message={pendingConfirm?.message ?? ""}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={pendingConfirm?.onConfirm ?? (() => {})}
        onCancel={() => setPendingConfirm(null)}
      />
    </div>
  );
}
