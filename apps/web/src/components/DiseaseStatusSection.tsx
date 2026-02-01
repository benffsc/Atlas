"use client";

import { useState, useEffect, useCallback } from "react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface DiseaseType {
  disease_key: string;
  display_label: string;
  short_code: string;
  color: string;
  description: string | null;
}

interface DiseaseStatus {
  status_id: string;
  disease_key: string;
  display_label: string;
  short_code: string;
  color: string;
  status: string;
  evidence_source: string;
  positive_cat_count: number;
  total_tested_count: number;
  first_positive_date: string | null;
  last_positive_date: string | null;
  notes: string | null;
  updated_at: string | null;
}

interface DiseaseStatusResponse {
  statuses: DiseaseStatus[];
  disease_types: DiseaseType[];
}

interface DiseaseStatusSectionProps {
  placeId: string;
  onStatusChange?: () => void;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const STATUS_BADGE_COLORS: Record<string, string> = {
  confirmed_active: "#dc2626",
  suspected: "#f59e0b",
  historical: "#6b7280",
  perpetual: "#991b1b",
  false_flag: "#9ca3af",
  cleared: "#16a34a",
};

const STATUS_LABELS: Record<string, string> = {
  confirmed_active: "Confirmed Active",
  suspected: "Suspected",
  historical: "Historical",
  perpetual: "Perpetual",
  false_flag: "False Flag",
  cleared: "Cleared",
};

const EVIDENCE_LABELS: Record<string, string> = {
  test_result: "Test Result",
  ai_extraction: "AI Extraction",
  google_maps: "Google Maps",
  manual: "Manual Entry",
  computed: "Computed",
};

type ActionKey = "confirm" | "dismiss" | "set_perpetual" | "clear" | "set_historical" | "suspect";

interface ActionDef {
  key: ActionKey;
  label: string;
  color: string;
}

const ACTIONS_BY_STATUS: Record<string, ActionDef[]> = {
  suspected: [
    { key: "confirm", label: "Confirm", color: "#dc2626" },
    { key: "dismiss", label: "Dismiss", color: "#6b7280" },
    { key: "set_historical", label: "Set Historical", color: "#6b7280" },
  ],
  confirmed_active: [
    { key: "set_perpetual", label: "Set Perpetual", color: "#991b1b" },
    { key: "dismiss", label: "Dismiss", color: "#6b7280" },
    { key: "set_historical", label: "Set Historical", color: "#6b7280" },
    { key: "clear", label: "Clear", color: "#16a34a" },
  ],
  perpetual: [
    { key: "clear", label: "Clear", color: "#16a34a" },
    { key: "set_historical", label: "Set Historical", color: "#6b7280" },
  ],
  historical: [
    { key: "confirm", label: "Confirm (re-activate)", color: "#dc2626" },
    { key: "dismiss", label: "Dismiss", color: "#6b7280" },
  ],
  cleared: [
    { key: "confirm", label: "Confirm (re-activate)", color: "#dc2626" },
    { key: "suspect", label: "Flag Suspected", color: "#f59e0b" },
  ],
  false_flag: [
    { key: "suspect", label: "Re-flag Suspected", color: "#f59e0b" },
    { key: "confirm", label: "Confirm Active", color: "#dc2626" },
  ],
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "N/A";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function DiseaseStatusSection({
  placeId,
  onStatusChange,
}: DiseaseStatusSectionProps) {
  const [data, setData] = useState<DiseaseStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  // Per-card override state: which card is showing the notes input
  const [activeOverride, setActiveOverride] = useState<{
    statusId: string;
    diseaseKey: string;
    action: ActionKey;
  } | null>(null);
  const [overrideNotes, setOverrideNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Add Disease Flag form
  const [showAddForm, setShowAddForm] = useState(false);
  const [addDiseaseKey, setAddDiseaseKey] = useState("");
  const [addNotes, setAddNotes] = useState("");
  const [addSaving, setAddSaving] = useState(false);

  /* ---- Fetch data ------------------------------------------------ */

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setUnavailable(false);

      const res = await fetch(`/api/places/${placeId}/disease-status`);

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        // If tables don't exist yet (MIG_814), show unavailable
        if (res.status === 500 || res.status === 404) {
          setUnavailable(true);
          return;
        }
        throw new Error(body.error || "Failed to fetch disease status");
      }

      const result: DiseaseStatusResponse = await res.json();
      setData(result);
    } catch (err) {
      // Catch network errors or table-not-found scenarios
      if (
        err instanceof Error &&
        (err.message.includes("relation") ||
          err.message.includes("does not exist") ||
          err.message.includes("Failed to fetch"))
      ) {
        setUnavailable(true);
      } else {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    } finally {
      setLoading(false);
    }
  }, [placeId]);

  useEffect(() => {
    if (placeId) {
      fetchData();
    }
  }, [placeId, fetchData]);

  /* ---- Override action ------------------------------------------- */

  const handleOverride = async () => {
    if (!activeOverride) return;
    setSaving(true);

    try {
      const res = await fetch(`/api/places/${placeId}/disease-status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          disease_key: activeOverride.diseaseKey,
          action: activeOverride.action,
          notes: overrideNotes || null,
          staff_id: "staff",
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to update disease status");
      }

      // Reset override UI
      setActiveOverride(null);
      setOverrideNotes("");

      // Refetch and notify parent
      await fetchData();
      onStatusChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save override");
    } finally {
      setSaving(false);
    }
  };

  /* ---- Add Disease Flag ------------------------------------------ */

  const handleAddDiseaseFlag = async () => {
    if (!addDiseaseKey) return;
    setAddSaving(true);

    try {
      const res = await fetch(`/api/places/${placeId}/disease-status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          disease_key: addDiseaseKey,
          action: "suspect",
          notes: addNotes || null,
          staff_id: "staff",
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to add disease flag");
      }

      // Reset form
      setShowAddForm(false);
      setAddDiseaseKey("");
      setAddNotes("");

      // Refetch and notify parent
      await fetchData();
      onStatusChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add disease flag");
    } finally {
      setAddSaving(false);
    }
  };

  /* ---- Render: Loading ------------------------------------------ */

  if (loading) {
    return (
      <div
        style={{
          padding: "1.5rem",
          background: "#ffffff",
          borderRadius: "8px",
          border: "1px solid #e5e7eb",
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            color: "#6b7280",
            fontSize: "0.875rem",
          }}
        >
          <span
            style={{
              display: "inline-block",
              width: "16px",
              height: "16px",
              border: "2px solid #d1d5db",
              borderTopColor: "#3b82f6",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
            }}
          />
          Loading disease status...
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  /* ---- Render: Unavailable (tables don't exist) ------------------ */

  if (unavailable) {
    return (
      <div
        style={{
          padding: "1rem 1.25rem",
          background: "#f9fafb",
          borderRadius: "8px",
          border: "1px solid #e5e7eb",
          color: "#9ca3af",
          fontSize: "0.875rem",
        }}
      >
        Disease tracking not yet available
      </div>
    );
  }

  /* ---- Render: Error --------------------------------------------- */

  if (error) {
    return (
      <div
        style={{
          padding: "1rem 1.25rem",
          background: "#fef2f2",
          borderRadius: "8px",
          border: "1px solid #fecaca",
          color: "#dc2626",
          fontSize: "0.875rem",
        }}
      >
        {error}
      </div>
    );
  }

  if (!data) return null;

  const { statuses, disease_types } = data;

  // Disease types not already flagged (for the Add form)
  const flaggedKeys = new Set(statuses.map((s) => s.disease_key));
  const availableTypes = disease_types.filter((dt) => !flaggedKeys.has(dt.disease_key));

  /* ---- Render: Main ---------------------------------------------- */

  return (
    <div
      style={{
        background: "#ffffff",
        borderRadius: "8px",
        border: "1px solid #e5e7eb",
        boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "0.75rem 1rem",
          borderBottom: "1px solid #e5e7eb",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "#f9fafb",
        }}
      >
        <h3 style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 600, color: "#374151" }}>
          Disease Status
        </h3>
        {statuses.length === 0 && !showAddForm && availableTypes.length > 0 && (
          <button
            onClick={() => setShowAddForm(true)}
            style={{
              fontSize: "0.75rem",
              padding: "0.25rem 0.625rem",
              background: "#3b82f6",
              color: "#ffffff",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontWeight: 500,
            }}
          >
            + Add Disease Flag
          </button>
        )}
      </div>

      {/* Status Cards */}
      <div style={{ padding: "0.75rem" }}>
        {statuses.length === 0 && !showAddForm && (
          <div style={{ color: "#9ca3af", fontSize: "0.875rem", padding: "0.5rem 0.25rem" }}>
            No disease flags for this location.
          </div>
        )}

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.625rem",
          }}
        >
          {statuses.map((status) => {
            const badgeColor = STATUS_BADGE_COLORS[status.status] || "#6b7280";
            const isFalseFlag = status.status === "false_flag";
            const actions = ACTIONS_BY_STATUS[status.status] || [];
            const isOverriding =
              activeOverride?.statusId === status.status_id &&
              activeOverride?.diseaseKey === status.disease_key;

            return (
              <div
                key={status.status_id}
                style={{
                  background: "#ffffff",
                  border: "1px solid #e5e7eb",
                  borderLeft: `4px solid ${status.color}`,
                  borderRadius: "8px",
                  padding: "0.75rem 1rem",
                }}
              >
                {/* Top row: badge + name + status */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.625rem",
                    flexWrap: "wrap",
                  }}
                >
                  {/* Short code circle */}
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: "24px",
                      height: "24px",
                      borderRadius: "50%",
                      background: status.color,
                      color: "#ffffff",
                      fontSize: "0.6875rem",
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {(status.short_code || status.disease_key.charAt(0)).toUpperCase()}
                  </span>

                  {/* Disease name */}
                  <span
                    style={{
                      fontWeight: 600,
                      fontSize: "0.875rem",
                      color: "#374151",
                      textDecoration: isFalseFlag ? "line-through" : "none",
                    }}
                  >
                    {status.display_label}
                  </span>

                  {/* Status badge */}
                  <span
                    style={{
                      display: "inline-block",
                      padding: "0.125rem 0.5rem",
                      fontSize: "0.6875rem",
                      fontWeight: 600,
                      borderRadius: "9999px",
                      background: badgeColor + "18",
                      color: badgeColor,
                      textTransform: "uppercase",
                      textDecoration: isFalseFlag ? "line-through" : "none",
                      letterSpacing: "0.02em",
                    }}
                  >
                    {STATUS_LABELS[status.status] || status.status}
                  </span>

                  {/* Evidence source */}
                  <span
                    style={{
                      fontSize: "0.6875rem",
                      color: "#9ca3af",
                      marginLeft: "auto",
                    }}
                  >
                    {EVIDENCE_LABELS[status.evidence_source] || status.evidence_source}
                  </span>
                </div>

                {/* Stats row */}
                <div
                  style={{
                    display: "flex",
                    gap: "1rem",
                    marginTop: "0.5rem",
                    fontSize: "0.8125rem",
                    color: "#6b7280",
                    flexWrap: "wrap",
                  }}
                >
                  {(status.positive_cat_count > 0 || status.total_tested_count > 0) && (
                    <span>
                      <strong style={{ color: "#374151" }}>{status.positive_cat_count}</strong>{" "}
                      cat{status.positive_cat_count !== 1 ? "s" : ""} positive
                      {status.total_tested_count > 0 && (
                        <>
                          {" / "}
                          <strong style={{ color: "#374151" }}>{status.total_tested_count}</strong>{" "}
                          tested
                        </>
                      )}
                    </span>
                  )}
                  {status.first_positive_date && (
                    <span>
                      First: {formatDate(status.first_positive_date)}
                    </span>
                  )}
                  {status.last_positive_date && (
                    <span>
                      Last: {formatDate(status.last_positive_date)}
                    </span>
                  )}
                </div>

                {/* Override actions row */}
                {actions.length > 0 && !isOverriding && (
                  <div
                    style={{
                      display: "flex",
                      gap: "0.375rem",
                      marginTop: "0.625rem",
                      flexWrap: "wrap",
                    }}
                  >
                    {actions.map((action) => (
                      <button
                        key={action.key}
                        onClick={() => {
                          setActiveOverride({
                            statusId: status.status_id,
                            diseaseKey: status.disease_key,
                            action: action.key,
                          });
                          setOverrideNotes("");
                        }}
                        style={{
                          fontSize: "0.6875rem",
                          padding: "0.25rem 0.5rem",
                          background: "transparent",
                          border: `1px solid ${action.color}40`,
                          color: action.color,
                          borderRadius: "4px",
                          cursor: "pointer",
                          fontWeight: 500,
                        }}
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                )}

                {/* Override notes input (shown when an action is selected) */}
                {isOverriding && (
                  <div style={{ marginTop: "0.625rem" }}>
                    <input
                      type="text"
                      placeholder="Notes (optional)"
                      value={overrideNotes}
                      onChange={(e) => setOverrideNotes(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "0.375rem 0.5rem",
                        fontSize: "0.8125rem",
                        border: "1px solid #d1d5db",
                        borderRadius: "4px",
                        marginBottom: "0.375rem",
                        boxSizing: "border-box",
                      }}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleOverride();
                        if (e.key === "Escape") {
                          setActiveOverride(null);
                          setOverrideNotes("");
                        }
                      }}
                    />
                    <div style={{ display: "flex", gap: "0.375rem" }}>
                      <button
                        onClick={handleOverride}
                        disabled={saving}
                        style={{
                          fontSize: "0.6875rem",
                          padding: "0.25rem 0.625rem",
                          background:
                            ACTIONS_BY_STATUS[status.status]?.find(
                              (a) => a.key === activeOverride.action
                            )?.color || "#3b82f6",
                          color: "#ffffff",
                          border: "none",
                          borderRadius: "4px",
                          cursor: saving ? "not-allowed" : "pointer",
                          fontWeight: 500,
                          opacity: saving ? 0.6 : 1,
                        }}
                      >
                        {saving
                          ? "Saving..."
                          : ACTIONS_BY_STATUS[status.status]?.find(
                              (a) => a.key === activeOverride.action
                            )?.label || "Apply"}
                      </button>
                      <button
                        onClick={() => {
                          setActiveOverride(null);
                          setOverrideNotes("");
                        }}
                        disabled={saving}
                        style={{
                          fontSize: "0.6875rem",
                          padding: "0.25rem 0.625rem",
                          background: "transparent",
                          border: "1px solid #d1d5db",
                          borderRadius: "4px",
                          cursor: "pointer",
                          color: "#6b7280",
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Add Disease Flag button (below cards, when cards exist) */}
        {statuses.length > 0 && !showAddForm && availableTypes.length > 0 && (
          <div style={{ marginTop: "0.75rem" }}>
            <button
              onClick={() => setShowAddForm(true)}
              style={{
                fontSize: "0.8125rem",
                padding: "0.375rem 0.75rem",
                background: "#3b82f6",
                color: "#ffffff",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                fontWeight: 500,
              }}
            >
              + Add Disease Flag
            </button>
          </div>
        )}

        {/* Add Disease Flag form */}
        {showAddForm && (
          <div
            style={{
              marginTop: "0.75rem",
              padding: "0.75rem",
              background: "#f9fafb",
              borderRadius: "6px",
              border: "1px solid #e5e7eb",
            }}
          >
            <div style={{ marginBottom: "0.625rem" }}>
              <label
                style={{
                  display: "block",
                  fontSize: "0.75rem",
                  fontWeight: 500,
                  marginBottom: "0.25rem",
                  color: "#374151",
                }}
              >
                Disease Type
              </label>
              <select
                value={addDiseaseKey}
                onChange={(e) => setAddDiseaseKey(e.target.value)}
                style={{
                  width: "100%",
                  padding: "0.375rem 0.5rem",
                  fontSize: "0.875rem",
                  border: "1px solid #d1d5db",
                  borderRadius: "4px",
                  background: "#ffffff",
                }}
              >
                <option value="">Select a disease...</option>
                {availableTypes.map((dt) => (
                  <option key={dt.disease_key} value={dt.disease_key}>
                    {dt.display_label}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: "0.625rem" }}>
              <label
                style={{
                  display: "block",
                  fontSize: "0.75rem",
                  fontWeight: 500,
                  marginBottom: "0.25rem",
                  color: "#374151",
                }}
              >
                Notes
              </label>
              <textarea
                value={addNotes}
                onChange={(e) => setAddNotes(e.target.value)}
                placeholder="Any observations or context..."
                rows={2}
                style={{
                  width: "100%",
                  padding: "0.375rem 0.5rem",
                  fontSize: "0.8125rem",
                  border: "1px solid #d1d5db",
                  borderRadius: "4px",
                  resize: "vertical",
                  boxSizing: "border-box",
                  fontFamily: "inherit",
                }}
              />
            </div>

            <div style={{ fontSize: "0.75rem", color: "#9ca3af", marginBottom: "0.5rem" }}>
              Initial status: <strong style={{ color: "#f59e0b" }}>Suspected</strong>
            </div>

            <div style={{ display: "flex", gap: "0.375rem", justifyContent: "flex-end" }}>
              <button
                onClick={() => {
                  setShowAddForm(false);
                  setAddDiseaseKey("");
                  setAddNotes("");
                }}
                style={{
                  fontSize: "0.8125rem",
                  padding: "0.375rem 0.75rem",
                  background: "transparent",
                  border: "1px solid #d1d5db",
                  borderRadius: "4px",
                  cursor: "pointer",
                  color: "#6b7280",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleAddDiseaseFlag}
                disabled={!addDiseaseKey || addSaving}
                style={{
                  fontSize: "0.8125rem",
                  padding: "0.375rem 0.75rem",
                  background: addDiseaseKey ? "#3b82f6" : "#d1d5db",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "4px",
                  cursor: addDiseaseKey ? "pointer" : "not-allowed",
                  fontWeight: 500,
                  opacity: addSaving ? 0.6 : 1,
                }}
              >
                {addSaving ? "Adding..." : "Add Flag"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
