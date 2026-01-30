"use client";

import { useState, useEffect } from "react";
import { BackButton } from "@/components/BackButton";

interface SourceConfidence {
  source_system: string;
  confidence_score: number;
  description: string | null;
}

const coreSourceSystems = ["web_intake", "atlas_ui", "airtable", "clinichq"];

export default function SourceConfidencePage() {
  const [scores, setScores] = useState<SourceConfidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  // Form state for adding new source
  const [newSource, setNewSource] = useState("");
  const [newScore, setNewScore] = useState("0.5");
  const [newDescription, setNewDescription] = useState("");

  const fetchScores = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/source-confidence");
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setScores(data.scores || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchScores();
  }, []);

  const updateScore = async (
    source_system: string,
    confidence_score: number,
    description: string | null
  ) => {
    setSaving(source_system);
    try {
      const res = await fetch("/api/admin/source-confidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_system, confidence_score, description }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(`Error: ${err.error}`);
      } else {
        fetchScores();
      }
    } catch (err) {
      console.error("Update error:", err);
    } finally {
      setSaving(null);
    }
  };

  const deleteSource = async (source_system: string) => {
    if (!confirm(`Delete source "${source_system}"?`)) return;
    setSaving(source_system);
    try {
      const res = await fetch(
        `/api/admin/source-confidence?source_system=${encodeURIComponent(source_system)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const err = await res.json();
        alert(`Error: ${err.error}`);
      } else {
        fetchScores();
      }
    } catch (err) {
      console.error("Delete error:", err);
    } finally {
      setSaving(null);
    }
  };

  const addNewSource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSource.trim()) return;

    const confidence = parseFloat(newScore);
    if (isNaN(confidence) || confidence < 0 || confidence > 1) {
      alert("Score must be between 0 and 1");
      return;
    }

    await updateScore(newSource.trim(), confidence, newDescription || null);
    setNewSource("");
    setNewScore("0.5");
    setNewDescription("");
  };

  const getConfidenceColor = (score: number) => {
    if (score >= 0.8) return "#198754"; // green
    if (score >= 0.6) return "#0d6efd"; // blue
    if (score >= 0.4) return "#fd7e14"; // orange
    return "#dc3545"; // red
  };

  return (
    <div>
      <h1>Source Confidence Scores</h1>
      <p className="text-muted" style={{ marginBottom: "1.5rem" }}>
        Configure trust levels for different data sources. Higher scores mean
        data from that source is more trusted during identity resolution.
      </p>

      {/* How it works */}
      <div
        className="card"
        style={{
          marginBottom: "2rem",
          background: "#f0f9ff",
          border: "1px solid #bae6fd",
        }}
      >
        <h3 style={{ margin: "0 0 0.5rem 0", fontSize: "1rem" }}>
          How Identity Resolution Works
        </h3>
        <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.9rem" }}>
          <li>
            When a new submission comes in with a matching email/phone, we check
            the name similarity
          </li>
          <li>
            If names match well (&gt;50% similarity), we link to the existing
            person
          </li>
          <li>
            If names differ significantly, we check source confidence before
            linking
          </li>
          <li>
            Higher confidence sources (like web intake forms) create new person
            records when names differ
          </li>
          <li>
            Lower confidence sources (like old clinic data) flag potential
            duplicates for review
          </li>
        </ul>
      </div>

      {loading && <div className="loading">Loading...</div>}

      {error && (
        <div className="empty" style={{ color: "red" }}>
          {error}
        </div>
      )}

      {!loading && !error && (
        <>
          {/* Current scores table */}
          <table className="data-table">
            <thead>
              <tr>
                <th>Source System</th>
                <th style={{ textAlign: "center" }}>Confidence</th>
                <th>Description</th>
                <th style={{ width: "100px" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {scores.map((score) => {
                const isCore = coreSourceSystems.includes(score.source_system);
                return (
                  <tr key={score.source_system}>
                    <td>
                      <code
                        style={{
                          background: "#f3f4f6",
                          padding: "0.2rem 0.4rem",
                          borderRadius: "4px",
                        }}
                      >
                        {score.source_system}
                      </code>
                      {isCore && (
                        <span
                          style={{
                            marginLeft: "0.5rem",
                            fontSize: "0.7rem",
                            background: "#e0e7ff",
                            color: "#4338ca",
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
                        value={score.confidence_score}
                        onChange={(e) =>
                          updateScore(
                            score.source_system,
                            parseFloat(e.target.value),
                            score.description
                          )
                        }
                        disabled={saving === score.source_system}
                        style={{ width: "100px", verticalAlign: "middle" }}
                      />
                      <span
                        style={{
                          marginLeft: "0.5rem",
                          fontWeight: 600,
                          color: getConfidenceColor(score.confidence_score),
                        }}
                      >
                        {(score.confidence_score * 100).toFixed(0)}%
                      </span>
                    </td>
                    <td style={{ fontSize: "0.875rem", color: "#666" }}>
                      <input
                        type="text"
                        value={score.description || ""}
                        onChange={(e) =>
                          updateScore(
                            score.source_system,
                            score.confidence_score,
                            e.target.value || null
                          )
                        }
                        disabled={saving === score.source_system}
                        placeholder="Add description..."
                        style={{
                          width: "100%",
                          border: "1px solid #ddd",
                          borderRadius: "4px",
                          padding: "0.25rem 0.5rem",
                          fontSize: "0.875rem",
                        }}
                      />
                    </td>
                    <td>
                      {!isCore && (
                        <button
                          onClick={() => deleteSource(score.source_system)}
                          disabled={saving === score.source_system}
                          style={{
                            background: "#fee2e2",
                            color: "#dc2626",
                            border: "1px solid #fecaca",
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
          <div className="card" style={{ marginTop: "2rem" }}>
            <h3 style={{ margin: "0 0 1rem 0", fontSize: "1rem" }}>
              Add New Source
            </h3>
            <form
              onSubmit={addNewSource}
              style={{ display: "flex", gap: "1rem", alignItems: "flex-end", flexWrap: "wrap" }}
            >
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.75rem",
                    color: "#666",
                    marginBottom: "0.25rem",
                  }}
                >
                  Source System
                </label>
                <input
                  type="text"
                  value={newSource}
                  onChange={(e) => setNewSource(e.target.value)}
                  placeholder="e.g., manual_import"
                  style={{
                    border: "1px solid #ddd",
                    borderRadius: "4px",
                    padding: "0.5rem",
                    width: "180px",
                  }}
                />
              </div>
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.75rem",
                    color: "#666",
                    marginBottom: "0.25rem",
                  }}
                >
                  Confidence (0-1)
                </label>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={newScore}
                  onChange={(e) => setNewScore(e.target.value)}
                  style={{
                    border: "1px solid #ddd",
                    borderRadius: "4px",
                    padding: "0.5rem",
                    width: "80px",
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.75rem",
                    color: "#666",
                    marginBottom: "0.25rem",
                  }}
                >
                  Description
                </label>
                <input
                  type="text"
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Optional description"
                  style={{
                    border: "1px solid #ddd",
                    borderRadius: "4px",
                    padding: "0.5rem",
                    width: "100%",
                  }}
                />
              </div>
              <button
                type="submit"
                style={{
                  background: "#0d6efd",
                  color: "#fff",
                  border: "none",
                  borderRadius: "4px",
                  padding: "0.5rem 1rem",
                  cursor: "pointer",
                }}
              >
                Add Source
              </button>
            </form>
          </div>
        </>
      )}

      {/* Back link */}
      <div style={{ marginTop: "2rem" }}>
        <BackButton fallbackHref="/admin" />
      </div>
    </div>
  );
}
