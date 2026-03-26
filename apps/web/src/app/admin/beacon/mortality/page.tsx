"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { DataQualityBadge } from "@/components/badges";
import { fetchApi, postApi } from "@/lib/api-client";
import { ConfirmDialog } from "@/components/feedback/ConfirmDialog";

interface MortalityEvent {
  mortality_event_id: string;
  cat_id: string | null;
  cat_name: string | null;
  place_id: string | null;
  place_name: string | null;
  death_date: string | null;
  death_cause: string;
  death_age_category: string;
  source_system: string;
  notes: string | null;
  created_at: string;
}

interface Stats {
  total_events: number;
  by_cause: Record<string, number>;
  by_age_category: Record<string, number>;
  with_cat_id: number;
  unique_places: number;
}

const causeColors: Record<string, string> = {
  vehicle: "#ef4444",
  predator: "#f97316",
  disease: "#8b5cf6",
  euthanasia: "#6b7280",
  injury: "#dc2626",
  starvation: "#ca8a04",
  weather: "#0ea5e9",
  natural: "#10b981",
  unknown: "#94a3b8",
  other: "#6b7280",
};

const causeOptions = [
  "vehicle",
  "predator",
  "disease",
  "euthanasia",
  "injury",
  "starvation",
  "weather",
  "natural",
  "unknown",
  "other",
];

const ageOptions = ["kitten", "juvenile", "adult", "senior", "unknown"];

export default function MortalityPage() {
  const [events, setEvents] = useState<MortalityEvent[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [causeFilter, setCauseFilter] = useState<string>("all");

  // Edit modal state
  const [editEvent, setEditEvent] = useState<MortalityEvent | null>(null);
  const [editForm, setEditForm] = useState({
    death_cause: "",
    death_age_category: "",
    death_date: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);

  // Multi-select state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Confirm dialog state
  const [pendingConfirm, setPendingConfirm] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [eventsData, statsData] = await Promise.all([
        fetchApi<{ events: MortalityEvent[] }>("/api/admin/beacon/mortality"),
        fetchApi<Stats>("/api/admin/beacon/mortality/stats"),
      ]);

      setEvents(eventsData.events || []);
      setStats(statsData);
    } catch (err) {
      console.error("Failed to load data:", err);
    } finally {
      setLoading(false);
    }
  };

  const openEditModal = (evt: MortalityEvent) => {
    setEditEvent(evt);
    setEditForm({
      death_cause: evt.death_cause || "",
      death_age_category: evt.death_age_category || "",
      death_date: evt.death_date || "",
      notes: evt.notes || "",
    });
  };

  const closeEditModal = () => {
    setEditEvent(null);
  };

  const handleSave = async () => {
    if (!editEvent) return;
    setSaving(true);
    try {
      await postApi("/api/admin/beacon/mortality", {
        mortality_event_id: editEvent.mortality_event_id,
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

  function handleDelete(eventId: string) {
    setPendingConfirm({
      title: "Delete mortality event",
      message: "Delete this mortality event? This cannot be undone.",
      onConfirm: async () => {
        setPendingConfirm(null);
        try {
          await postApi(`/api/admin/beacon/mortality?id=${eventId}`, {}, { method: "DELETE" });
          await loadData();
        } catch (err) {
          alert("Error deleting");
        }
      },
    });
  }

  function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    setPendingConfirm({
      title: "Bulk delete",
      message: `Delete ${selectedIds.size} mortality events? This cannot be undone.`,
      onConfirm: async () => {
        setPendingConfirm(null);
        setBulkDeleting(true);
        try {
          const promises = Array.from(selectedIds).map((id) =>
            postApi(`/api/admin/beacon/mortality?id=${id}`, {}, { method: "DELETE" })
          );
          await Promise.all(promises);
          setSelectedIds(new Set());
          await loadData();
        } catch (err) {
          alert("Error during bulk delete");
        } finally {
          setBulkDeleting(false);
        }
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
    if (selectedIds.size === filteredEvents.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredEvents.map((e) => e.mortality_event_id)));
    }
  };

  const filteredEvents = events.filter((e) => {
    if (causeFilter === "all") return true;
    return e.death_cause === causeFilter;
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
        <span style={{ fontSize: "0.875rem" }}>Mortality Events</span>
      </div>

      {/* Header */}
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ marginBottom: "0.25rem" }}>Mortality Events</h1>
        <p className="text-muted">
          Death events extracted from notes and reported by staff. Used for Beacon survival rate
          calculations and population modeling.
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
            <div style={{ fontSize: "2rem", fontWeight: 700 }}>{stats.total_events}</div>
            <div className="text-muted text-sm">Total Events</div>
          </div>
          <div className="card" style={{ padding: "1rem", textAlign: "center" }}>
            <div style={{ fontSize: "2rem", fontWeight: 700 }}>{stats.with_cat_id}</div>
            <div className="text-muted text-sm">With Cat ID</div>
          </div>
          <div className="card" style={{ padding: "1rem", textAlign: "center" }}>
            <div style={{ fontSize: "2rem", fontWeight: 700 }}>{stats.unique_places}</div>
            <div className="text-muted text-sm">Unique Places</div>
          </div>
        </div>
      )}

      {/* Cause Breakdown */}
      {stats && (
        <div className="card" style={{ padding: "1rem", marginBottom: "1.5rem" }}>
          <h3 style={{ margin: "0 0 0.75rem 0", fontSize: "0.95rem" }}>By Death Cause</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            {Object.entries(stats.by_cause || {}).map(([cause, count]) => (
              <button
                key={cause}
                onClick={() => setCauseFilter(causeFilter === cause ? "all" : cause)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.4rem",
                  padding: "0.4rem 0.6rem",
                  border: causeFilter === cause ? "2px solid #3b82f6" : "1px solid var(--card-border)",
                  borderRadius: "6px",
                  background: causeFilter === cause ? "#eff6ff" : "transparent",
                  cursor: "pointer",
                  fontSize: "0.8rem",
                }}
              >
                <span
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    background: causeColors[cause] || "#6b7280",
                  }}
                />
                <span style={{ textTransform: "capitalize" }}>{cause}</span>
                <strong>{count}</strong>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Age Category Breakdown */}
      {stats && (
        <div className="card" style={{ padding: "1rem", marginBottom: "1.5rem" }}>
          <h3 style={{ margin: "0 0 0.75rem 0", fontSize: "0.95rem" }}>By Age Category</h3>
          <div style={{ display: "flex", gap: "1rem" }}>
            {Object.entries(stats.by_age_category || {}).map(([cat, count]) => (
              <div key={cat} style={{ textAlign: "center" }}>
                <div style={{ fontWeight: 600, fontSize: "1.25rem" }}>{count}</div>
                <div className="text-muted text-sm" style={{ textTransform: "capitalize" }}>
                  {cat}
                </div>
              </div>
            ))}
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
              {bulkDeleting ? "Deleting..." : "Delete Selected"}
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
                    checked={selectedIds.size === filteredEvents.length && filteredEvents.length > 0}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th style={{ padding: "0.75rem", textAlign: "left", fontWeight: 600 }}>Cat</th>
                <th style={{ padding: "0.75rem", textAlign: "left", fontWeight: 600 }}>Place</th>
                <th style={{ padding: "0.75rem", textAlign: "center", fontWeight: 600 }}>Cause</th>
                <th style={{ padding: "0.75rem", textAlign: "center", fontWeight: 600 }}>Age</th>
                <th style={{ padding: "0.75rem", textAlign: "left", fontWeight: 600 }}>Date</th>
                <th style={{ padding: "0.75rem", textAlign: "left", fontWeight: 600 }}>Notes</th>
                <th style={{ padding: "0.75rem", textAlign: "center", fontWeight: 600 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredEvents.map((evt) => (
                <tr
                  key={evt.mortality_event_id}
                  style={{
                    borderBottom: "1px solid var(--card-border)",
                    background: selectedIds.has(evt.mortality_event_id) ? "#fef3c7" : undefined,
                  }}
                >
                  <td style={{ padding: "0.75rem", textAlign: "center" }}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(evt.mortality_event_id)}
                      onChange={() => toggleSelect(evt.mortality_event_id)}
                    />
                  </td>
                  <td style={{ padding: "0.75rem" }}>
                    {evt.cat_id ? (
                      <Link
                        href={`/cats/${evt.cat_id}`}
                        style={{ fontWeight: 500, color: "var(--primary, #3b82f6)" }}
                      >
                        {evt.cat_name || "Unknown"}
                      </Link>
                    ) : (
                      <span className="text-muted">No cat linked</span>
                    )}
                  </td>
                  <td style={{ padding: "0.75rem", fontSize: "0.875rem" }}>
                    {evt.place_id ? (
                      <Link href={`/places/${evt.place_id}`}>{evt.place_name || "Unknown"}</Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td style={{ padding: "0.75rem", textAlign: "center" }}>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.25rem",
                        padding: "0.25rem 0.5rem",
                        background: `${causeColors[evt.death_cause] || "#6b7280"}20`,
                        color: causeColors[evt.death_cause] || "#6b7280",
                        borderRadius: "4px",
                        fontSize: "0.75rem",
                        fontWeight: 500,
                        textTransform: "capitalize",
                      }}
                    >
                      {evt.death_cause}
                    </span>
                  </td>
                  <td
                    style={{
                      padding: "0.75rem",
                      textAlign: "center",
                      fontSize: "0.875rem",
                      textTransform: "capitalize",
                    }}
                  >
                    {evt.death_age_category || "—"}
                  </td>
                  <td style={{ padding: "0.75rem", fontSize: "0.875rem" }}>
                    {evt.death_date ? new Date(evt.death_date).toLocaleDateString() : "—"}
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
                    title={evt.notes || ""}
                  >
                    {evt.notes ? evt.notes.slice(0, 50) + (evt.notes.length > 50 ? "..." : "") : "—"}
                  </td>
                  <td style={{ padding: "0.75rem", textAlign: "center" }}>
                    <button
                      onClick={() => openEditModal(evt)}
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
                      onClick={() => handleDelete(evt.mortality_event_id)}
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

          {filteredEvents.length === 0 && (
            <div style={{ padding: "2rem", textAlign: "center" }} className="text-muted">
              No mortality events found
            </div>
          )}
        </div>
      )}

      {/* Info */}
      <div className="card" style={{ padding: "1rem", marginTop: "1.5rem" }}>
        <h3 style={{ margin: "0 0 0.5rem 0", fontSize: "0.95rem" }}>Beacon Impact</h3>
        <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.875rem" }} className="text-muted">
          <li>
            <strong>Survival rates</strong> calculated from mortality data by age category (Vortex model)
          </li>
          <li>
            <strong>Vehicle deaths</strong> highest category - used for roadway risk assessment
          </li>
          <li>
            <strong>Predator deaths</strong> indicate coyote/wildlife pressure in area
          </li>
          <li>Events without cat_id are place-level observations (e.g., "found dead cat at colony")</li>
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

      {/* Edit Modal */}
      {editEvent && (
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
              maxWidth: "450px",
              padding: "1.5rem",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ margin: "0 0 1rem 0" }}>Edit Mortality Event</h2>
            <p className="text-muted" style={{ marginBottom: "1rem" }}>
              {editEvent.cat_name || "Unknown Cat"} - {editEvent.place_name || "Unknown Place"}
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>
                  Cause of Death
                </label>
                <select
                  value={editForm.death_cause}
                  onChange={(e) => setEditForm({ ...editForm, death_cause: e.target.value })}
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    border: "1px solid var(--card-border)",
                    borderRadius: "6px",
                    fontSize: "0.875rem",
                    textTransform: "capitalize",
                  }}
                >
                  {causeOptions.map((cause) => (
                    <option key={cause} value={cause} style={{ textTransform: "capitalize" }}>
                      {cause}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>
                  Age Category
                </label>
                <select
                  value={editForm.death_age_category}
                  onChange={(e) => setEditForm({ ...editForm, death_age_category: e.target.value })}
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    border: "1px solid var(--card-border)",
                    borderRadius: "6px",
                    fontSize: "0.875rem",
                    textTransform: "capitalize",
                  }}
                >
                  {ageOptions.map((age) => (
                    <option key={age} value={age} style={{ textTransform: "capitalize" }}>
                      {age}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>
                  Death Date
                </label>
                <input
                  type="date"
                  value={editForm.death_date}
                  onChange={(e) => setEditForm({ ...editForm, death_date: e.target.value })}
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    border: "1px solid var(--card-border)",
                    borderRadius: "6px",
                    fontSize: "0.875rem",
                  }}
                />
              </div>

              <div>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>
                  Notes
                </label>
                <textarea
                  value={editForm.notes}
                  onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                  rows={3}
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    border: "1px solid var(--card-border)",
                    borderRadius: "6px",
                    fontSize: "0.875rem",
                    resize: "vertical",
                  }}
                />
              </div>
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
                  background: "var(--primary, #3b82f6)",
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
