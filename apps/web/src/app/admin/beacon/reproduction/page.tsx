"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { DataQualityBadge, AIParsedBadge } from "@/components/badges";
import { fetchApi, postApi } from "@/lib/api-client";

interface ReproductionRecord {
  vitals_id: string;
  cat_id: string;
  cat_name: string;
  place_name: string | null;
  is_pregnant: boolean;
  is_lactating: boolean;
  is_in_heat: boolean;
  recorded_at: string;
  source_system: string;
  appointment_date: string | null;
}

interface Stats {
  total_records: number;
  pregnant_count: number;
  lactating_count: number;
  in_heat_count: number;
  unique_cats: number;
}

export default function ReproductionPage() {
  const [records, setRecords] = useState<ReproductionRecord[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "pregnant" | "lactating" | "in_heat">("all");

  // Edit modal state
  const [editRecord, setEditRecord] = useState<ReproductionRecord | null>(null);
  const [editForm, setEditForm] = useState({
    is_pregnant: false,
    is_lactating: false,
    is_in_heat: false,
  });
  const [saving, setSaving] = useState(false);

  // Multi-select state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [recordsData, statsData] = await Promise.all([
        fetchApi<{ records: ReproductionRecord[] }>("/api/admin/beacon/reproduction"),
        fetchApi<Stats>("/api/admin/beacon/reproduction/stats"),
      ]);

      setRecords(recordsData.records || []);
      setStats(statsData);
    } catch (err) {
      console.error("Failed to load data:", err);
    } finally {
      setLoading(false);
    }
  };

  const openEditModal = (rec: ReproductionRecord) => {
    setEditRecord(rec);
    setEditForm({
      is_pregnant: rec.is_pregnant,
      is_lactating: rec.is_lactating,
      is_in_heat: rec.is_in_heat,
    });
  };

  const closeEditModal = () => {
    setEditRecord(null);
  };

  const handleSave = async () => {
    if (!editRecord) return;
    setSaving(true);
    try {
      await postApi("/api/admin/beacon/reproduction", {
        vitals_id: editRecord.vitals_id,
        ...editForm,
      }, { method: "PATCH" });
      await loadData();
      closeEditModal();
    } catch (err) {
      alert("Error saving changes");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (vitalsId: string) => {
    if (!confirm("Remove reproduction indicators from this record? This clears pregnant/lactating/in-heat flags.")) return;
    try {
      await postApi(`/api/admin/beacon/reproduction?id=${vitalsId}`, {}, { method: "DELETE" });
      await loadData();
    } catch (err) {
      alert("Error deleting");
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Remove reproduction indicators from ${selectedIds.size} records?`)) return;
    setBulkDeleting(true);
    try {
      const promises = Array.from(selectedIds).map((id) =>
        postApi(`/api/admin/beacon/reproduction?id=${id}`, {}, { method: "DELETE" })
      );
      await Promise.all(promises);
      setSelectedIds(new Set());
      await loadData();
    } catch (err) {
      alert("Error during bulk delete");
    } finally {
      setBulkDeleting(false);
    }
  };

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
    if (selectedIds.size === filteredRecords.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredRecords.map((r) => r.vitals_id)));
    }
  };

  const filteredRecords = records.filter((r) => {
    if (filter === "all") return true;
    if (filter === "pregnant") return r.is_pregnant;
    if (filter === "lactating") return r.is_lactating;
    if (filter === "in_heat") return r.is_in_heat;
    return true;
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
        <span style={{ fontSize: "0.875rem" }}>Reproduction Data</span>
      </div>

      {/* Header */}
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ marginBottom: "0.25rem" }}>Reproduction Data</h1>
        <p className="text-muted">
          Pregnant, lactating, and in-heat indicators extracted from clinic notes. Critical for
          Beacon's birth rate estimation and kitten surge prediction.
        </p>
      </div>

      {/* Stats */}
      {stats && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: "1rem",
            marginBottom: "1.5rem",
          }}
        >
          <div className="card" style={{ padding: "1rem", textAlign: "center" }}>
            <div style={{ fontSize: "2rem", fontWeight: 700 }}>{stats.total_records}</div>
            <div className="text-muted text-sm">Total Records</div>
          </div>
          <div
            className="card"
            style={{
              padding: "1rem",
              textAlign: "center",
              cursor: "pointer",
              border: filter === "pregnant" ? "2px solid #ec4899" : undefined,
            }}
            onClick={() => setFilter(filter === "pregnant" ? "all" : "pregnant")}
          >
            <div style={{ fontSize: "2rem", fontWeight: 700, color: "#ec4899" }}>
              {stats.pregnant_count}
            </div>
            <div className="text-muted text-sm">Pregnant</div>
          </div>
          <div
            className="card"
            style={{
              padding: "1rem",
              textAlign: "center",
              cursor: "pointer",
              border: filter === "lactating" ? "2px solid #8b5cf6" : undefined,
            }}
            onClick={() => setFilter(filter === "lactating" ? "all" : "lactating")}
          >
            <div style={{ fontSize: "2rem", fontWeight: 700, color: "#8b5cf6" }}>
              {stats.lactating_count}
            </div>
            <div className="text-muted text-sm">Lactating</div>
          </div>
          <div
            className="card"
            style={{
              padding: "1rem",
              textAlign: "center",
              cursor: "pointer",
              border: filter === "in_heat" ? "2px solid #f97316" : undefined,
            }}
            onClick={() => setFilter(filter === "in_heat" ? "all" : "in_heat")}
          >
            <div style={{ fontSize: "2rem", fontWeight: 700, color: "#f97316" }}>
              {stats.in_heat_count}
            </div>
            <div className="text-muted text-sm">In Heat</div>
          </div>
          <div className="card" style={{ padding: "1rem", textAlign: "center" }}>
            <div style={{ fontSize: "2rem", fontWeight: 700 }}>{stats.unique_cats}</div>
            <div className="text-muted text-sm">Unique Cats</div>
          </div>
        </div>
      )}

      {/* Bulk Actions */}
      {selectedIds.size > 0 && (
        <div
          style={{
            padding: "0.75rem 1rem",
            background: "#fef3c7",
            borderRadius: "8px",
            marginBottom: "1rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span style={{ fontWeight: 500 }}>{selectedIds.size} selected</span>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              onClick={() => setSelectedIds(new Set())}
              style={{
                padding: "0.4rem 0.75rem",
                border: "1px solid #d97706",
                borderRadius: "6px",
                background: "transparent",
                cursor: "pointer",
                fontSize: "0.875rem",
              }}
            >
              Clear Selection
            </button>
            <button
              onClick={handleBulkDelete}
              disabled={bulkDeleting}
              style={{
                padding: "0.4rem 0.75rem",
                border: "none",
                borderRadius: "6px",
                background: "#dc2626",
                color: "white",
                cursor: bulkDeleting ? "not-allowed" : "pointer",
                fontSize: "0.875rem",
              }}
            >
              {bulkDeleting ? "Removing..." : "Remove Indicators"}
            </button>
          </div>
        </div>
      )}

      {/* Results */}
      {loading ? (
        <div className="card" style={{ padding: "2rem", textAlign: "center" }}>Loading...</div>
      ) : (
        <div className="card">
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--card-border)" }}>
                <th style={{ padding: "0.75rem", textAlign: "center", width: "40px" }}>
                  <input
                    type="checkbox"
                    checked={selectedIds.size === filteredRecords.length && filteredRecords.length > 0}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th style={{ padding: "0.75rem", textAlign: "left", fontWeight: 600 }}>Cat</th>
                <th style={{ padding: "0.75rem", textAlign: "left", fontWeight: 600 }}>Place</th>
                <th style={{ padding: "0.75rem", textAlign: "center", fontWeight: 600 }}>Status</th>
                <th style={{ padding: "0.75rem", textAlign: "left", fontWeight: 600 }}>Date</th>
                <th style={{ padding: "0.75rem", textAlign: "left", fontWeight: 600 }}>Source</th>
                <th style={{ padding: "0.75rem", textAlign: "center", fontWeight: 600 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecords.map((rec) => (
                <tr
                  key={rec.vitals_id}
                  style={{
                    borderBottom: "1px solid var(--card-border)",
                    background: selectedIds.has(rec.vitals_id) ? "#fef3c7" : undefined,
                  }}
                >
                  <td style={{ padding: "0.75rem", textAlign: "center" }}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(rec.vitals_id)}
                      onChange={() => toggleSelect(rec.vitals_id)}
                    />
                  </td>
                  <td style={{ padding: "0.75rem" }}>
                    <Link
                      href={`/cats/${rec.cat_id}`}
                      style={{ fontWeight: 500, color: "#3b82f6" }}
                    >
                      {rec.cat_name || "Unknown"}
                    </Link>
                  </td>
                  <td style={{ padding: "0.75rem", fontSize: "0.875rem" }}>
                    {rec.place_name || "—"}
                  </td>
                  <td style={{ padding: "0.75rem", textAlign: "center" }}>
                    <div style={{ display: "flex", gap: "0.25rem", justifyContent: "center" }}>
                      {rec.is_pregnant && (
                        <span
                          style={{
                            padding: "0.2rem 0.5rem",
                            background: "#fdf2f8",
                            color: "#ec4899",
                            borderRadius: "4px",
                            fontSize: "0.75rem",
                            fontWeight: 500,
                          }}
                        >
                          Pregnant
                        </span>
                      )}
                      {rec.is_lactating && (
                        <span
                          style={{
                            padding: "0.2rem 0.5rem",
                            background: "#f5f3ff",
                            color: "#8b5cf6",
                            borderRadius: "4px",
                            fontSize: "0.75rem",
                            fontWeight: 500,
                          }}
                        >
                          Lactating
                        </span>
                      )}
                      {rec.is_in_heat && (
                        <span
                          style={{
                            padding: "0.2rem 0.5rem",
                            background: "#fff7ed",
                            color: "#f97316",
                            borderRadius: "4px",
                            fontSize: "0.75rem",
                            fontWeight: 500,
                          }}
                        >
                          In Heat
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: "0.75rem", fontSize: "0.875rem" }}>
                    {rec.recorded_at
                      ? new Date(rec.recorded_at).toLocaleDateString()
                      : "—"}
                  </td>
                  <td style={{ padding: "0.75rem", fontSize: "0.875rem" }}>
                    <DataQualityBadge
                      source={rec.source_system}
                      confidence={rec.source_system === "note_parser" ? "medium" : "high"}
                      needsReview={rec.source_system === "note_parser"}
                    />
                  </td>
                  <td style={{ padding: "0.75rem", textAlign: "center" }}>
                    <button
                      onClick={() => openEditModal(rec)}
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
                      onClick={() => handleDelete(rec.vitals_id)}
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
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {filteredRecords.length === 0 && (
            <div style={{ padding: "2rem", textAlign: "center" }} className="text-muted">
              No reproduction records found
            </div>
          )}
        </div>
      )}

      {/* Info */}
      <div className="card" style={{ padding: "1rem", marginTop: "1.5rem" }}>
        <h3 style={{ margin: "0 0 0.5rem 0", fontSize: "0.95rem" }}>Beacon Impact</h3>
        <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.875rem" }} className="text-muted">
          <li>
            <strong>Pregnant females</strong> indicate ~2 month birth window - helps predict kitten surge
          </li>
          <li>
            <strong>Lactating females</strong> indicate recent birth (0-8 weeks prior) - used for birth rate estimation
          </li>
          <li>
            <strong>In heat indicators</strong> signal active breeding - urgency for TNR
          </li>
          <li>
            Data extracted from spay appointment notes using pattern matching
          </li>
        </ul>
      </div>

      {/* Edit Modal */}
      {editRecord && (
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
          onClick={closeEditModal}
        >
          <div
            className="card"
            style={{
              width: "100%",
              maxWidth: "400px",
              padding: "1.5rem",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ margin: "0 0 1rem 0" }}>Edit Reproduction Data</h2>
            <p className="text-muted" style={{ marginBottom: "1rem" }}>
              {editRecord.cat_name || "Unknown Cat"} - {editRecord.recorded_at ? new Date(editRecord.recorded_at).toLocaleDateString() : "No date"}
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={editForm.is_pregnant}
                  onChange={(e) => setEditForm({ ...editForm, is_pregnant: e.target.checked })}
                />
                <span
                  style={{
                    padding: "0.25rem 0.5rem",
                    background: editForm.is_pregnant ? "#fdf2f8" : "var(--background)",
                    color: editForm.is_pregnant ? "#ec4899" : "var(--text-muted)",
                    borderRadius: "4px",
                    fontWeight: 500,
                  }}
                >
                  Pregnant
                </span>
              </label>

              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={editForm.is_lactating}
                  onChange={(e) => setEditForm({ ...editForm, is_lactating: e.target.checked })}
                />
                <span
                  style={{
                    padding: "0.25rem 0.5rem",
                    background: editForm.is_lactating ? "#f5f3ff" : "var(--background)",
                    color: editForm.is_lactating ? "#8b5cf6" : "var(--text-muted)",
                    borderRadius: "4px",
                    fontWeight: 500,
                  }}
                >
                  Lactating
                </span>
              </label>

              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={editForm.is_in_heat}
                  onChange={(e) => setEditForm({ ...editForm, is_in_heat: e.target.checked })}
                />
                <span
                  style={{
                    padding: "0.25rem 0.5rem",
                    background: editForm.is_in_heat ? "#fff7ed" : "var(--background)",
                    color: editForm.is_in_heat ? "#f97316" : "var(--text-muted)",
                    borderRadius: "4px",
                    fontWeight: 500,
                  }}
                >
                  In Heat
                </span>
              </label>
            </div>

            <div style={{ display: "flex", gap: "0.5rem", marginTop: "1.5rem", justifyContent: "flex-end" }}>
              <button
                onClick={closeEditModal}
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
                  background: "#3b82f6",
                  color: "white",
                  cursor: saving ? "not-allowed" : "pointer",
                }}
              >
                {saving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
