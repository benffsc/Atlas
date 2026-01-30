"use client";

import { useState, useEffect } from "react";
import { formatDateLocal } from "@/lib/formatters";

interface OrphanPlace {
  place_id: string;
  display_name: string | null;
  formatted_address: string | null;
  place_kind: string | null;
  locality: string | null;
  source_system: string | null;
  created_at: string;
  is_address_backed: boolean;
}

interface OrphanData {
  orphans: OrphanPlace[];
  total: number;
  by_source: Record<string, number>;
  by_kind: Record<string, number>;
}

export default function OrphanPlacesPage() {
  const [data, setData] = useState<OrphanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [deleteResult, setDeleteResult] = useState<{ deleted: number } | null>(null);
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const fetchData = async (offset = 0) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/orphan-places?limit=${pageSize}&offset=${offset}`);
      if (res.ok) {
        const result = await res.json();
        setData(result);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData(page * pageSize);
  }, [page]);

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (!data) return;
    if (selected.size === data.orphans.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(data.orphans.map(o => o.place_id)));
    }
  };

  const handleDelete = async () => {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} orphan place(s)? This cannot be undone.`)) return;

    setDeleting(true);
    setDeleteResult(null);
    try {
      const res = await fetch("/api/admin/orphan-places", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ place_ids: Array.from(selected) }),
      });
      const result = await res.json();
      if (res.ok) {
        setDeleteResult({ deleted: result.deleted });
        setSelected(new Set());
        // Refresh data
        fetchData(page * pageSize);
      }
    } catch {
      // ignore
    } finally {
      setDeleting(false);
    }
  };

  const kindBadgeColor: Record<string, string> = {
    address: "#3b82f6",
    intersection: "#8b5cf6",
    area: "#f59e0b",
    poi: "#10b981",
    unit: "#ec4899",
  };

  const sourceBadgeColor: Record<string, string> = {
    airtable: "#f59e0b",
    clinichq: "#10b981",
    web_intake: "#3b82f6",
    atlas_ui: "#8b5cf6",
    geocoding: "#6b7280",
  };

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ marginBottom: "0.25rem" }}>Orphan Places</h1>
        <p className="text-muted">
          Places with no linked requests, people, cats, intake submissions, or other data.
          Safe to delete for data hygiene.
        </p>
      </div>

      {/* Stats Row */}
      {data && (
        <div style={{ display: "flex", gap: "1rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
          <div className="card" style={{ padding: "1rem", minWidth: "120px", textAlign: "center" }}>
            <div style={{ fontSize: "2rem", fontWeight: 700 }}>{data.total}</div>
            <div className="text-muted text-sm">Total Orphans</div>
          </div>

          {Object.keys(data.by_source).length > 0 && (
            <div className="card" style={{ padding: "1rem", flex: 1 }}>
              <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: "0.5rem" }}>
                By Source
              </div>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                {Object.entries(data.by_source).map(([source, count]) => (
                  <span
                    key={source}
                    style={{
                      padding: "0.25rem 0.5rem",
                      borderRadius: "4px",
                      fontSize: "0.8rem",
                      fontWeight: 500,
                      background: sourceBadgeColor[source] ? `${sourceBadgeColor[source]}20` : "#f3f4f6",
                      color: sourceBadgeColor[source] || "#6b7280",
                    }}
                  >
                    {source}: {count}
                  </span>
                ))}
              </div>
            </div>
          )}

          {Object.keys(data.by_kind).length > 0 && (
            <div className="card" style={{ padding: "1rem", flex: 1 }}>
              <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: "0.5rem" }}>
                By Kind
              </div>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                {Object.entries(data.by_kind).map(([kind, count]) => (
                  <span
                    key={kind}
                    style={{
                      padding: "0.25rem 0.5rem",
                      borderRadius: "4px",
                      fontSize: "0.8rem",
                      fontWeight: 500,
                      background: kindBadgeColor[kind] ? `${kindBadgeColor[kind]}20` : "#f3f4f6",
                      color: kindBadgeColor[kind] || "#6b7280",
                    }}
                  >
                    {kind}: {count}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Bulk Actions */}
      {selected.size > 0 && (
        <div
          style={{
            padding: "0.75rem 1rem",
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: "8px",
            marginBottom: "1rem",
            display: "flex",
            alignItems: "center",
            gap: "1rem",
          }}
        >
          <span style={{ fontWeight: 500 }}>{selected.size} selected</span>
          <button
            onClick={handleDelete}
            disabled={deleting}
            style={{
              padding: "0.375rem 0.75rem",
              fontSize: "0.875rem",
              background: "#dc2626",
              color: "#fff",
              border: "none",
              borderRadius: "6px",
              cursor: deleting ? "wait" : "pointer",
              opacity: deleting ? 0.6 : 1,
            }}
          >
            {deleting ? "Deleting..." : "Delete Selected"}
          </button>
          <button
            onClick={() => setSelected(new Set())}
            style={{
              padding: "0.375rem 0.75rem",
              fontSize: "0.875rem",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            Clear
          </button>
        </div>
      )}

      {/* Delete result */}
      {deleteResult && (
        <div
          style={{
            padding: "0.75rem 1rem",
            background: "#ecfdf5",
            border: "1px solid #a7f3d0",
            borderRadius: "8px",
            marginBottom: "1rem",
            fontSize: "0.875rem",
            color: "#065f46",
          }}
        >
          Deleted {deleteResult.deleted} orphan place(s).
        </div>
      )}

      {/* Table */}
      {loading ? (
        <p className="text-muted" style={{ textAlign: "center", padding: "2rem 0" }}>
          Loading orphan places...
        </p>
      ) : !data || data.orphans.length === 0 ? (
        <div className="card" style={{ padding: "3rem", textAlign: "center" }}>
          <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>&#10003;</div>
          <h2 style={{ marginBottom: "0.25rem" }}>No orphan places found</h2>
          <p className="text-muted">All places have at least one linked record.</p>
        </div>
      ) : (
        <>
          <div className="card" style={{ overflow: "auto" }}>
            <table style={{ width: "100%", fontSize: "0.875rem", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid var(--border)" }}>
                  <th style={{ padding: "0.75rem 0.5rem", width: "40px" }}>
                    <input
                      type="checkbox"
                      checked={data.orphans.length > 0 && selected.size === data.orphans.length}
                      onChange={toggleAll}
                    />
                  </th>
                  <th style={{ padding: "0.75rem 0.5rem", textAlign: "left" }}>Place</th>
                  <th style={{ padding: "0.75rem 0.5rem", textAlign: "left" }}>City</th>
                  <th style={{ padding: "0.75rem 0.5rem", textAlign: "left" }}>Kind</th>
                  <th style={{ padding: "0.75rem 0.5rem", textAlign: "left" }}>Source</th>
                  <th style={{ padding: "0.75rem 0.5rem", textAlign: "left" }}>Created</th>
                </tr>
              </thead>
              <tbody>
                {data.orphans.map(place => (
                  <tr
                    key={place.place_id}
                    style={{
                      borderBottom: "1px solid var(--card-border)",
                      background: selected.has(place.place_id) ? "rgba(59, 130, 246, 0.05)" : undefined,
                    }}
                  >
                    <td style={{ padding: "0.5rem" }}>
                      <input
                        type="checkbox"
                        checked={selected.has(place.place_id)}
                        onChange={() => toggleSelect(place.place_id)}
                      />
                    </td>
                    <td style={{ padding: "0.5rem" }}>
                      <a href={`/places/${place.place_id}`} style={{ fontWeight: 500 }}>
                        {place.display_name || place.formatted_address || place.place_id.slice(0, 8)}
                      </a>
                      {place.formatted_address && place.display_name && (
                        <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                          {place.formatted_address}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "0.5rem" }} className="text-muted">
                      {place.locality || "—"}
                    </td>
                    <td style={{ padding: "0.5rem" }}>
                      {place.place_kind ? (
                        <span
                          style={{
                            padding: "0.125rem 0.375rem",
                            borderRadius: "4px",
                            fontSize: "0.75rem",
                            fontWeight: 500,
                            background: kindBadgeColor[place.place_kind] ? `${kindBadgeColor[place.place_kind]}20` : "#f3f4f6",
                            color: kindBadgeColor[place.place_kind] || "#6b7280",
                          }}
                        >
                          {place.place_kind}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td style={{ padding: "0.5rem" }}>
                      {place.source_system ? (
                        <span
                          style={{
                            padding: "0.125rem 0.375rem",
                            borderRadius: "4px",
                            fontSize: "0.75rem",
                            fontWeight: 500,
                            background: sourceBadgeColor[place.source_system] ? `${sourceBadgeColor[place.source_system]}20` : "#f3f4f6",
                            color: sourceBadgeColor[place.source_system] || "#6b7280",
                          }}
                        >
                          {place.source_system}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td style={{ padding: "0.5rem" }} className="text-muted">
                      {formatDateLocal(place.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {data.total > pageSize && (
            <div style={{ display: "flex", justifyContent: "center", gap: "0.5rem", marginTop: "1rem" }}>
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                style={{
                  padding: "0.375rem 0.75rem",
                  fontSize: "0.875rem",
                  background: "transparent",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  cursor: page === 0 ? "default" : "pointer",
                  opacity: page === 0 ? 0.5 : 1,
                }}
              >
                Previous
              </button>
              <span className="text-muted" style={{ padding: "0.375rem 0.5rem", fontSize: "0.875rem" }}>
                Page {page + 1} of {Math.ceil(data.total / pageSize)}
              </span>
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={(page + 1) * pageSize >= data.total}
                style={{
                  padding: "0.375rem 0.75rem",
                  fontSize: "0.875rem",
                  background: "transparent",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  cursor: (page + 1) * pageSize >= data.total ? "default" : "pointer",
                  opacity: (page + 1) * pageSize >= data.total ? 0.5 : 1,
                }}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
