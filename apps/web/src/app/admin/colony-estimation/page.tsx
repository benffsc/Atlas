"use client";

import { useState, useEffect, useCallback } from "react";
import { BackButton } from "@/components/BackButton";

interface SourceConfidence {
  source_type: string;
  base_confidence: number;
  is_firsthand_boost: number;
  supersession_tier: number;
  description: string | null;
}

interface CountPrecision {
  precision_type: string;
  default_number_confidence: number;
  description: string | null;
  examples: string[];
}

interface Stats {
  total_estimates: number;
  active_estimates: number;
  superseded_estimates: number;
  excluded_estimates: number;
}

type TabType = "sources" | "precision" | "supersession";

const TIER_LABELS: Record<number, { label: string; color: string; description: string }> = {
  3: { label: "Tier 3", color: "#10b981", description: "Verified/Firsthand (supersedes lower tiers)" },
  2: { label: "Tier 2", color: "#3b82f6", description: "Structured observations" },
  1: { label: "Tier 1", color: "#f59e0b", description: "Estimates/Guesses (can be superseded)" },
};

const CORE_SOURCE_TYPES = ["verified_cats", "trapper_report", "trapping_request", "intake_form", "post_clinic_survey"];
const CORE_PRECISION_TYPES = ["exact", "approximate", "range", "lower_bound"];

export default function ColonyEstimationPage() {
  const [sources, setSources] = useState<SourceConfidence[]>([]);
  const [precision, setPrecision] = useState<CountPrecision[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>("sources");
  const [saving, setSaving] = useState<string | null>(null);

  // Form state for adding new items
  const [newSourceType, setNewSourceType] = useState("");
  const [newPrecisionType, setNewPrecisionType] = useState("");

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/colony-estimation");
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setSources(data.source_confidence || []);
      setPrecision(data.count_precision || []);
      setStats(data.stats || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const updateSource = async (source: Partial<SourceConfidence> & { source_type: string }) => {
    setSaving(source.source_type);
    try {
      const res = await fetch("/api/admin/colony-estimation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "source_confidence", ...source }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(`Error: ${err.error}`);
      } else {
        fetchData();
      }
    } catch (err) {
      console.error("Update error:", err);
    } finally {
      setSaving(null);
    }
  };

  const updatePrecision = async (prec: Partial<CountPrecision> & { precision_type: string }) => {
    setSaving(prec.precision_type);
    try {
      const res = await fetch("/api/admin/colony-estimation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "count_precision", ...prec }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(`Error: ${err.error}`);
      } else {
        fetchData();
      }
    } catch (err) {
      console.error("Update error:", err);
    } finally {
      setSaving(null);
    }
  };

  const deleteItem = async (type: "source_confidence" | "count_precision", key: string) => {
    if (!confirm(`Delete "${key}"?`)) return;
    setSaving(key);
    try {
      const res = await fetch(
        `/api/admin/colony-estimation?type=${type}&key=${encodeURIComponent(key)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const err = await res.json();
        alert(`Error: ${err.error}`);
      } else {
        fetchData();
      }
    } catch (err) {
      console.error("Delete error:", err);
    } finally {
      setSaving(null);
    }
  };

  const addNewSource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSourceType.trim()) return;
    await updateSource({
      source_type: newSourceType.trim().toLowerCase().replace(/\s+/g, "_"),
      base_confidence: 0.5,
      is_firsthand_boost: 0.05,
      supersession_tier: 1,
      description: null,
    });
    setNewSourceType("");
  };

  const addNewPrecision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPrecisionType.trim()) return;
    await updatePrecision({
      precision_type: newPrecisionType.trim().toLowerCase().replace(/\s+/g, "_"),
      default_number_confidence: 0.7,
      description: null,
      examples: [],
    });
    setNewPrecisionType("");
  };

  const getConfidenceColor = (score: number) => {
    if (score >= 0.8) return "#10b981";
    if (score >= 0.6) return "#3b82f6";
    if (score >= 0.4) return "#f59e0b";
    return "#ef4444";
  };

  // Group sources by tier for the supersession view
  const sourcesByTier = sources.reduce((acc, src) => {
    const tier = src.supersession_tier || 1;
    if (!acc[tier]) acc[tier] = [];
    acc[tier].push(src);
    return acc;
  }, {} as Record<number, SourceConfidence[]>);

  if (loading) {
    return <div className="loading">Loading colony estimation settings...</div>;
  }

  return (
    <div>
      <h1 style={{ marginBottom: "0.25rem" }}>Colony Estimation Settings</h1>
      <p className="text-muted" style={{ marginBottom: "1.5rem" }}>
        Configure how colony sizes are estimated from multiple data sources.
      </p>

      {error && (
        <div className="empty" style={{ color: "red", marginBottom: "1rem" }}>
          {error}
        </div>
      )}

      {/* Stats Overview */}
      {stats && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: "1rem",
            marginBottom: "2rem",
          }}
        >
          <StatCard label="Total Estimates" value={stats.total_estimates} />
          <StatCard label="Active" value={stats.active_estimates} color="#10b981" />
          <StatCard label="Superseded" value={stats.superseded_estimates} color="#6b7280" />
          <StatCard label="Excluded" value={stats.excluded_estimates} color="#ef4444" />
        </div>
      )}

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: "0.5rem",
          marginBottom: "1.5rem",
          borderBottom: "1px solid var(--border-color)",
          paddingBottom: "0.5rem",
        }}
      >
        <TabButton active={activeTab === "sources"} onClick={() => setActiveTab("sources")}>
          Source Confidence
        </TabButton>
        <TabButton active={activeTab === "supersession"} onClick={() => setActiveTab("supersession")}>
          Supersession Tiers
        </TabButton>
        <TabButton active={activeTab === "precision"} onClick={() => setActiveTab("precision")}>
          Count Precision
        </TabButton>
      </div>

      {/* Source Confidence Tab */}
      {activeTab === "sources" && (
        <div>
          <div
            className="card"
            style={{
              marginBottom: "1.5rem",
              background: "var(--info-bg)",
              border: "1px solid var(--info-border)",
            }}
          >
            <h3 style={{ margin: "0 0 0.5rem 0", fontSize: "0.9rem", color: "var(--info-text)" }}>
              How Source Confidence Works
            </h3>
            <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.85rem", color: "var(--info-text)" }}>
              <li><strong>Base Confidence:</strong> Trust level for WHO reported (trapper vs requester)</li>
              <li><strong>Firsthand Boost:</strong> Extra confidence if observer personally saw the cats</li>
              <li>Weighted average: Higher confidence sources have more influence on final estimate</li>
            </ul>
          </div>

          <table className="data-table">
            <thead>
              <tr>
                <th>Source Type</th>
                <th style={{ textAlign: "center", width: "150px" }}>Base Confidence</th>
                <th style={{ textAlign: "center", width: "120px" }}>Firsthand Boost</th>
                <th style={{ textAlign: "center", width: "100px" }}>Tier</th>
                <th>Description</th>
                <th style={{ width: "80px" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((src) => {
                const isCore = CORE_SOURCE_TYPES.includes(src.source_type);
                const tierInfo = TIER_LABELS[src.supersession_tier] || TIER_LABELS[1];
                return (
                  <tr key={src.source_type}>
                    <td>
                      <code style={{ background: "var(--section-bg)", padding: "0.2rem 0.4rem", borderRadius: "4px" }}>
                        {src.source_type}
                      </code>
                      {isCore && (
                        <span
                          style={{
                            marginLeft: "0.5rem",
                            fontSize: "0.65rem",
                            background: "var(--primary-bg)",
                            color: "var(--primary)",
                            padding: "0.1rem 0.3rem",
                            borderRadius: "3px",
                          }}
                        >
                          Core
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={src.base_confidence}
                        onChange={(e) =>
                          updateSource({ source_type: src.source_type, base_confidence: parseFloat(e.target.value) })
                        }
                        disabled={saving === src.source_type}
                        style={{ width: "80px", verticalAlign: "middle" }}
                      />
                      <span
                        style={{
                          marginLeft: "0.5rem",
                          fontWeight: 600,
                          color: getConfidenceColor(src.base_confidence),
                          fontSize: "0.85rem",
                        }}
                      >
                        {(src.base_confidence * 100).toFixed(0)}%
                      </span>
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <input
                        type="number"
                        min="0"
                        max="0.2"
                        step="0.01"
                        value={src.is_firsthand_boost}
                        onChange={(e) =>
                          updateSource({ source_type: src.source_type, is_firsthand_boost: parseFloat(e.target.value) })
                        }
                        disabled={saving === src.source_type}
                        style={{ width: "60px", textAlign: "center" }}
                      />
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <select
                        value={src.supersession_tier}
                        onChange={(e) =>
                          updateSource({ source_type: src.source_type, supersession_tier: parseInt(e.target.value) })
                        }
                        disabled={saving === src.source_type}
                        style={{
                          padding: "0.25rem",
                          borderRadius: "4px",
                          border: "1px solid var(--border-color)",
                          background: tierInfo.color + "20",
                          color: tierInfo.color,
                          fontWeight: 500,
                        }}
                      >
                        <option value={3}>Tier 3</option>
                        <option value={2}>Tier 2</option>
                        <option value={1}>Tier 1</option>
                      </select>
                    </td>
                    <td>
                      <input
                        type="text"
                        value={src.description || ""}
                        onChange={(e) =>
                          updateSource({ source_type: src.source_type, description: e.target.value || null })
                        }
                        disabled={saving === src.source_type}
                        placeholder="Add description..."
                        style={{
                          width: "100%",
                          border: "1px solid var(--border-color)",
                          borderRadius: "4px",
                          padding: "0.25rem 0.5rem",
                          fontSize: "0.85rem",
                        }}
                      />
                    </td>
                    <td>
                      {!isCore && (
                        <button
                          onClick={() => deleteItem("source_confidence", src.source_type)}
                          disabled={saving === src.source_type}
                          style={{
                            background: "var(--danger-bg)",
                            color: "var(--danger-text)",
                            border: "1px solid var(--danger-border)",
                            padding: "0.25rem 0.5rem",
                            borderRadius: "4px",
                            fontSize: "0.75rem",
                            cursor: "pointer",
                          }}
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Add new source form */}
          <form
            onSubmit={addNewSource}
            style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginTop: "1rem" }}
          >
            <input
              type="text"
              value={newSourceType}
              onChange={(e) => setNewSourceType(e.target.value)}
              placeholder="new_source_type"
              style={{
                border: "1px solid var(--border-color)",
                borderRadius: "4px",
                padding: "0.5rem",
                width: "200px",
              }}
            />
            <button
              type="submit"
              style={{
                background: "var(--primary)",
                color: "#fff",
                border: "none",
                borderRadius: "4px",
                padding: "0.5rem 1rem",
                cursor: "pointer",
              }}
            >
              Add Source Type
            </button>
          </form>
        </div>
      )}

      {/* Supersession Tiers Tab */}
      {activeTab === "supersession" && (
        <div>
          <div
            className="card"
            style={{
              marginBottom: "1.5rem",
              background: "var(--info-bg)",
              border: "1px solid var(--info-border)",
            }}
          >
            <h3 style={{ margin: "0 0 0.5rem 0", fontSize: "0.9rem", color: "var(--info-text)" }}>
              How Supersession Works
            </h3>
            <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.85rem", color: "var(--info-text)" }}>
              <li>Higher-tier firsthand observations automatically <strong>supersede</strong> lower-tier estimates</li>
              <li>Superseded estimates are preserved for history but excluded from aggregation</li>
              <li>Example: Trapper counts 7 cats (Tier 3) → supersedes requester&apos;s guess of 4 (Tier 1)</li>
              <li>This follows Bayesian updating principles from mark-resight studies</li>
            </ul>
          </div>

          {[3, 2, 1].map((tier) => {
            const tierInfo = TIER_LABELS[tier];
            const tierSources = sourcesByTier[tier] || [];
            return (
              <div
                key={tier}
                style={{
                  marginBottom: "1.5rem",
                  padding: "1rem",
                  background: tierInfo.color + "10",
                  border: `1px solid ${tierInfo.color}40`,
                  borderRadius: "8px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem" }}>
                  <span
                    style={{
                      background: tierInfo.color,
                      color: "#fff",
                      padding: "0.25rem 0.5rem",
                      borderRadius: "4px",
                      fontWeight: 600,
                      fontSize: "0.85rem",
                    }}
                  >
                    {tierInfo.label}
                  </span>
                  <span style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
                    {tierInfo.description}
                  </span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                  {tierSources.length === 0 ? (
                    <span style={{ color: "var(--text-muted)", fontSize: "0.85rem", fontStyle: "italic" }}>
                      No source types in this tier
                    </span>
                  ) : (
                    tierSources.map((src) => (
                      <span
                        key={src.source_type}
                        style={{
                          background: "var(--background)",
                          border: "1px solid var(--border-color)",
                          padding: "0.25rem 0.5rem",
                          borderRadius: "4px",
                          fontSize: "0.85rem",
                        }}
                      >
                        <code>{src.source_type}</code>
                        <span style={{ marginLeft: "0.5rem", color: getConfidenceColor(src.base_confidence) }}>
                          {(src.base_confidence * 100).toFixed(0)}%
                        </span>
                      </span>
                    ))
                  )}
                </div>
              </div>
            );
          })}

          <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginTop: "1rem" }}>
            To change a source type&apos;s tier, go to the Source Confidence tab and adjust the Tier dropdown.
          </p>
        </div>
      )}

      {/* Count Precision Tab */}
      {activeTab === "precision" && (
        <div>
          <div
            className="card"
            style={{
              marginBottom: "1.5rem",
              background: "var(--info-bg)",
              border: "1px solid var(--info-border)",
            }}
          >
            <h3 style={{ margin: "0 0 0.5rem 0", fontSize: "0.9rem", color: "var(--info-text)" }}>
              How Count Precision Works
            </h3>
            <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.85rem", color: "var(--info-text)" }}>
              <li><strong>Number Confidence:</strong> How precise is the count itself (separate from source confidence)</li>
              <li>&quot;I counted 7 cats&quot; (exact, 100%) vs &quot;about 15&quot; (approximate, 80%)</li>
              <li>Lower precision reduces the weight of that estimate in the weighted average</li>
            </ul>
          </div>

          <table className="data-table">
            <thead>
              <tr>
                <th>Precision Type</th>
                <th style={{ textAlign: "center", width: "180px" }}>Number Confidence</th>
                <th>Description</th>
                <th>Examples</th>
                <th style={{ width: "80px" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {precision.map((prec) => {
                const isCore = CORE_PRECISION_TYPES.includes(prec.precision_type);
                return (
                  <tr key={prec.precision_type}>
                    <td>
                      <code style={{ background: "var(--section-bg)", padding: "0.2rem 0.4rem", borderRadius: "4px" }}>
                        {prec.precision_type}
                      </code>
                      {isCore && (
                        <span
                          style={{
                            marginLeft: "0.5rem",
                            fontSize: "0.65rem",
                            background: "var(--primary-bg)",
                            color: "var(--primary)",
                            padding: "0.1rem 0.3rem",
                            borderRadius: "3px",
                          }}
                        >
                          Core
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={prec.default_number_confidence}
                        onChange={(e) =>
                          updatePrecision({
                            precision_type: prec.precision_type,
                            default_number_confidence: parseFloat(e.target.value),
                          })
                        }
                        disabled={saving === prec.precision_type}
                        style={{ width: "100px", verticalAlign: "middle" }}
                      />
                      <span
                        style={{
                          marginLeft: "0.5rem",
                          fontWeight: 600,
                          color: getConfidenceColor(prec.default_number_confidence),
                          fontSize: "0.85rem",
                        }}
                      >
                        {(prec.default_number_confidence * 100).toFixed(0)}%
                      </span>
                    </td>
                    <td>
                      <input
                        type="text"
                        value={prec.description || ""}
                        onChange={(e) =>
                          updatePrecision({
                            precision_type: prec.precision_type,
                            description: e.target.value || null,
                          })
                        }
                        disabled={saving === prec.precision_type}
                        placeholder="Add description..."
                        style={{
                          width: "100%",
                          border: "1px solid var(--border-color)",
                          borderRadius: "4px",
                          padding: "0.25rem 0.5rem",
                          fontSize: "0.85rem",
                        }}
                      />
                    </td>
                    <td style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                      {prec.examples?.slice(0, 2).join(", ") || "—"}
                    </td>
                    <td>
                      {!isCore && (
                        <button
                          onClick={() => deleteItem("count_precision", prec.precision_type)}
                          disabled={saving === prec.precision_type}
                          style={{
                            background: "var(--danger-bg)",
                            color: "var(--danger-text)",
                            border: "1px solid var(--danger-border)",
                            padding: "0.25rem 0.5rem",
                            borderRadius: "4px",
                            fontSize: "0.75rem",
                            cursor: "pointer",
                          }}
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Add new precision form */}
          <form
            onSubmit={addNewPrecision}
            style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginTop: "1rem" }}
          >
            <input
              type="text"
              value={newPrecisionType}
              onChange={(e) => setNewPrecisionType(e.target.value)}
              placeholder="new_precision_type"
              style={{
                border: "1px solid var(--border-color)",
                borderRadius: "4px",
                padding: "0.5rem",
                width: "200px",
              }}
            />
            <button
              type="submit"
              style={{
                background: "var(--primary)",
                color: "#fff",
                border: "none",
                borderRadius: "4px",
                padding: "0.5rem 1rem",
                cursor: "pointer",
              }}
            >
              Add Precision Type
            </button>
          </form>
        </div>
      )}

      {/* Back link */}
      <div style={{ marginTop: "2rem" }}>
        <BackButton fallbackHref="/admin" />
      </div>
    </div>
  );
}

// Helper components
function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div
      style={{
        background: "var(--section-bg)",
        border: "1px solid var(--border-color)",
        borderRadius: "8px",
        padding: "1rem",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: "1.5rem", fontWeight: 600, color: color || "var(--foreground)" }}>
        {value.toLocaleString()}
      </div>
      <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{label}</div>
    </div>
  );
}

function TabButton({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "0.5rem 1rem",
        border: "none",
        background: active ? "var(--primary)" : "transparent",
        color: active ? "#fff" : "var(--text-muted)",
        borderRadius: "4px",
        cursor: "pointer",
        fontWeight: active ? 600 : 400,
        fontSize: "0.9rem",
      }}
    >
      {children}
    </button>
  );
}
