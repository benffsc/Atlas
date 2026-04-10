"use client";

/**
 * Admin: Impact Reference Data — lets Pip update yearly alteration counts
 * via the app UI instead of asking a developer to run SQL.
 *
 * Shows the comparison between reference counts and DB counts,
 * with inline editing for reference values.
 *
 * Pattern: follows /admin/config page structure.
 */

import { useEffect, useState, useCallback } from "react";
import { fetchApi, postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";

interface ReferenceRow {
  year: number;
  count: number;
  source: string;
  notes: string | null;
  updated_at: string;
  db_count: number;
  donor_facing_count: number;
  alignment_status: string;
}

const STATUS_BADGE: Record<string, { label: string; bg: string; color: string }> = {
  aligned: { label: "Aligned", bg: "rgba(34,197,94,0.12)", color: "#15803d" },
  db_under: { label: "DB Under", bg: "rgba(245,158,11,0.12)", color: "#92400e" },
  db_over: { label: "DB Over", bg: "rgba(239,68,68,0.12)", color: "#b91c1c" },
  pre_system: { label: "Pre-system", bg: "rgba(156,163,175,0.12)", color: "#4b5563" },
};

export default function ImpactReferencePage() {
  const [rows, setRows] = useState<ReferenceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingYear, setEditingYear] = useState<number | null>(null);
  const [editCount, setEditCount] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [addingYear, setAddingYear] = useState(false);
  const [newYear, setNewYear] = useState("");
  const [newCount, setNewCount] = useState("");
  const { success: showSuccess, error: showError } = useToast();

  const fetchData = useCallback(async () => {
    try {
      const result = await fetchApi<{ rows: ReferenceRow[] }>("/api/admin/impact-reference");
      setRows(result.rows || []);
    } catch {
      setError("Failed to load reference data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function startEdit(row: ReferenceRow) {
    setEditingYear(row.year);
    setEditCount(String(row.count));
    setEditNotes(row.notes || "");
  }

  function cancelEdit() {
    setEditingYear(null);
    setEditCount("");
    setEditNotes("");
  }

  async function saveEdit(year: number) {
    const count = parseInt(editCount, 10);
    if (isNaN(count) || count < 0) {
      showError("Count must be a non-negative number");
      return;
    }
    setSaving(true);
    try {
      await postApi("/api/admin/impact-reference", {
        year,
        count,
        notes: editNotes || undefined,
      }, { method: "PUT" });
      showSuccess(`Updated ${year}`);
      setEditingYear(null);
      await fetchData();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function addYear() {
    const year = parseInt(newYear, 10);
    const count = parseInt(newCount, 10);
    if (isNaN(year) || year < 1980 || year > 2100) {
      showError("Year must be between 1980 and 2100");
      return;
    }
    if (isNaN(count) || count < 0) {
      showError("Count must be a non-negative number");
      return;
    }
    setSaving(true);
    try {
      await postApi("/api/admin/impact-reference", { year, count }, { method: "PUT" });
      showSuccess(`Added ${year}`);
      setAddingYear(false);
      setNewYear("");
      setNewCount("");
      await fetchData();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to add year");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)" }}>
        Loading reference data...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: "2rem", color: "var(--danger)" }}>
        {error}
      </div>
    );
  }

  const totalRef = rows.reduce((s, r) => s + r.count, 0);
  const totalDb = rows.reduce((s, r) => s + r.db_count, 0);
  const totalDonor = rows.reduce((s, r) => s + r.donor_facing_count, 0);

  return (
    <div style={{ maxWidth: "900px" }}>
      {/* Header */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 600 }}>Impact Reference Data</h1>
        <p style={{ margin: "0.25rem 0 0", color: "var(--text-muted)", fontSize: "0.875rem" }}>
          Yearly alteration counts for donor-facing impact numbers. Edit reference counts to match
          your records — the impact card uses the higher of reference or DB count per year.
        </p>
      </div>

      {/* Summary stats */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: "1rem",
        marginBottom: "1.5rem",
      }}>
        <div style={{
          padding: "0.75rem 1rem",
          border: "1px solid var(--card-border)",
          borderRadius: "8px",
          textAlign: "center",
        }}>
          <div style={{ fontSize: "1.25rem", fontWeight: 700 }}>{totalRef.toLocaleString()}</div>
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Reference total</div>
        </div>
        <div style={{
          padding: "0.75rem 1rem",
          border: "1px solid var(--card-border)",
          borderRadius: "8px",
          textAlign: "center",
        }}>
          <div style={{ fontSize: "1.25rem", fontWeight: 700 }}>{totalDb.toLocaleString()}</div>
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>DB provable</div>
        </div>
        <div style={{
          padding: "0.75rem 1rem",
          border: "1px solid var(--card-border)",
          borderRadius: "8px",
          textAlign: "center",
        }}>
          <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--primary)" }}>{totalDonor.toLocaleString()}</div>
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Donor-facing</div>
        </div>
      </div>

      {/* Add year button */}
      <div style={{ marginBottom: "1rem", display: "flex", justifyContent: "flex-end" }}>
        {addingYear ? (
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <input
              type="number"
              placeholder="Year"
              value={newYear}
              onChange={(e) => setNewYear(e.target.value)}
              style={{
                width: "80px",
                padding: "0.25rem 0.5rem",
                border: "1px solid var(--primary)",
                borderRadius: "4px",
                fontSize: "0.875rem",
                fontFamily: "monospace",
              }}
              autoFocus
            />
            <input
              type="number"
              placeholder="Count"
              value={newCount}
              onChange={(e) => setNewCount(e.target.value)}
              style={{
                width: "100px",
                padding: "0.25rem 0.5rem",
                border: "1px solid var(--primary)",
                borderRadius: "4px",
                fontSize: "0.875rem",
                fontFamily: "monospace",
              }}
            />
            <button
              onClick={addYear}
              disabled={saving}
              style={{
                padding: "0.25rem 0.75rem",
                background: "var(--primary)",
                color: "#fff",
                border: "none",
                borderRadius: "4px",
                fontSize: "0.8rem",
                cursor: saving ? "wait" : "pointer",
              }}
            >
              Add
            </button>
            <button
              onClick={() => { setAddingYear(false); setNewYear(""); setNewCount(""); }}
              style={{
                padding: "0.25rem 0.5rem",
                background: "transparent",
                border: "1px solid var(--card-border)",
                borderRadius: "4px",
                fontSize: "0.8rem",
                cursor: "pointer",
                color: "var(--text-muted)",
              }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setAddingYear(true)}
            style={{
              padding: "0.375rem 0.75rem",
              background: "transparent",
              border: "1px solid var(--card-border)",
              borderRadius: "6px",
              fontSize: "0.8rem",
              cursor: "pointer",
              color: "var(--text-secondary)",
            }}
          >
            + Add year
          </button>
        )}
      </div>

      {/* Table */}
      <div style={{
        border: "1px solid var(--card-border)",
        borderRadius: "8px",
        overflow: "hidden",
      }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
          <thead>
            <tr style={{ background: "var(--card-bg, #f9fafb)" }}>
              <th style={thStyle}>Year</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Reference</th>
              <th style={{ ...thStyle, textAlign: "right" }}>DB Count</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Donor-facing</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Notes</th>
              <th style={{ ...thStyle, width: "80px" }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isEditing = editingYear === row.year;
              const badge = STATUS_BADGE[row.alignment_status] || STATUS_BADGE.pre_system;

              return (
                <tr key={row.year} style={{ borderBottom: "1px solid var(--border-light, rgba(0,0,0,0.05))" }}>
                  <td style={tdStyle}>
                    <strong>{row.year}</strong>
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right", fontFamily: "monospace" }}>
                    {isEditing ? (
                      <input
                        type="number"
                        value={editCount}
                        onChange={(e) => setEditCount(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveEdit(row.year);
                          if (e.key === "Escape") cancelEdit();
                        }}
                        style={{
                          width: "80px",
                          padding: "0.2rem 0.4rem",
                          border: "1px solid var(--primary)",
                          borderRadius: "4px",
                          fontSize: "0.85rem",
                          fontFamily: "monospace",
                          textAlign: "right",
                        }}
                        autoFocus
                      />
                    ) : (
                      row.count.toLocaleString()
                    )}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right", fontFamily: "monospace", color: "var(--text-secondary)" }}>
                    {row.db_count.toLocaleString()}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right", fontFamily: "monospace", fontWeight: 600 }}>
                    {row.donor_facing_count.toLocaleString()}
                  </td>
                  <td style={tdStyle}>
                    <span style={{
                      display: "inline-block",
                      padding: "0.15rem 0.5rem",
                      borderRadius: "4px",
                      fontSize: "0.72rem",
                      fontWeight: 600,
                      background: badge.bg,
                      color: badge.color,
                    }}>
                      {badge.label}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, fontSize: "0.78rem", color: "var(--text-muted)", maxWidth: "200px" }}>
                    {isEditing ? (
                      <input
                        type="text"
                        value={editNotes}
                        onChange={(e) => setEditNotes(e.target.value)}
                        placeholder="Optional notes"
                        style={{
                          width: "100%",
                          padding: "0.2rem 0.4rem",
                          border: "1px solid var(--card-border)",
                          borderRadius: "4px",
                          fontSize: "0.78rem",
                        }}
                      />
                    ) : (
                      <span title={row.notes || ""}>{row.notes ? (row.notes.length > 30 ? row.notes.slice(0, 30) + "..." : row.notes) : "—"}</span>
                    )}
                  </td>
                  <td style={tdStyle}>
                    {isEditing ? (
                      <div style={{ display: "flex", gap: "0.25rem" }}>
                        <button
                          onClick={() => saveEdit(row.year)}
                          disabled={saving}
                          style={{
                            padding: "0.2rem 0.5rem",
                            background: "var(--primary)",
                            color: "#fff",
                            border: "none",
                            borderRadius: "4px",
                            fontSize: "0.75rem",
                            cursor: saving ? "wait" : "pointer",
                          }}
                        >
                          Save
                        </button>
                        <button
                          onClick={cancelEdit}
                          style={{
                            padding: "0.2rem 0.5rem",
                            background: "transparent",
                            border: "1px solid var(--card-border)",
                            borderRadius: "4px",
                            fontSize: "0.75rem",
                            cursor: "pointer",
                            color: "var(--text-muted)",
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => startEdit(row)}
                        style={{
                          padding: "0.2rem 0.5rem",
                          background: "transparent",
                          border: "1px solid var(--card-border)",
                          borderRadius: "4px",
                          fontSize: "0.75rem",
                          cursor: "pointer",
                          color: "var(--text-muted)",
                        }}
                      >
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p style={{ marginTop: "1rem", fontSize: "0.75rem", color: "var(--text-muted)", fontStyle: "italic" }}>
        The impact card shows MAX(reference, DB) per year so donor-facing numbers never decrease.
        Changes take effect after the next cache refresh (~1 hour).
      </p>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "0.6rem 0.75rem",
  fontWeight: 600,
  fontSize: "0.72rem",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "var(--text-muted)",
  borderBottom: "1px solid var(--card-border)",
};

const tdStyle: React.CSSProperties = {
  padding: "0.5rem 0.75rem",
};
