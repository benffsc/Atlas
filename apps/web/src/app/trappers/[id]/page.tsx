"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { TrapperBadge } from "@/components/TrapperBadge";
import { TrapperStatsCard } from "@/components/TrapperStatsCard";
import { BackButton } from "@/components/BackButton";

interface TrapperStats {
  person_id: string;
  display_name: string;
  trapper_type: string;
  is_ffsc_trapper: boolean;
  active_assignments: number;
  completed_assignments: number;
  total_site_visits: number;
  assessment_visits: number;
  first_visit_success_rate_pct: number | null;
  cats_from_visits: number;
  manual_catches: number;
  total_cats_caught: number;
  total_clinic_cats: number;
  unique_clinic_days: number;
  avg_cats_per_day: number;
  spayed_count: number;
  neutered_count: number;
  total_altered: number;
  felv_tested_count: number;
  felv_positive_count: number;
  felv_positive_rate_pct: number | null;
  first_clinic_date: string | null;
  last_clinic_date: string | null;
  first_activity_date: string | null;
  last_activity_date: string | null;
}

interface ManualCatch {
  catch_id: string;
  cat_id: string | null;
  microchip: string | null;
  catch_date: string;
  catch_location: string | null;
  notes: string | null;
  cat_name: string | null;
  created_at: string;
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="detail-section">
      <h2>{title}</h2>
      {children}
    </div>
  );
}

export default function TrapperDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [stats, setStats] = useState<TrapperStats | null>(null);
  const [manualCatches, setManualCatches] = useState<ManualCatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add catch form state
  const [showAddCatch, setShowAddCatch] = useState(false);
  const [newMicrochip, setNewMicrochip] = useState("");
  const [newCatchDate, setNewCatchDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [newNotes, setNewNotes] = useState("");
  const [addingCatch, setAddingCatch] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const response = await fetch(`/api/people/${id}/trapper-stats`);
      if (response.status === 404) {
        setError("Not a trapper or trapper not found");
        return;
      }
      if (!response.ok) {
        throw new Error("Failed to fetch trapper stats");
      }
      const data = await response.json();
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }, [id]);

  const fetchManualCatches = useCallback(async () => {
    try {
      const response = await fetch(`/api/people/${id}/trapper-cats`);
      if (response.ok) {
        const data = await response.json();
        setManualCatches(data.catches || []);
      }
    } catch (err) {
      console.error("Failed to fetch manual catches:", err);
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;

    const loadData = async () => {
      setLoading(true);
      setError(null);
      await Promise.all([fetchStats(), fetchManualCatches()]);
      setLoading(false);
    };

    loadData();
  }, [id, fetchStats, fetchManualCatches]);

  const handleAddCatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMicrochip.trim()) {
      setAddError("Microchip is required");
      return;
    }

    setAddingCatch(true);
    setAddError(null);

    try {
      const response = await fetch(`/api/people/${id}/trapper-cats`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          microchip: newMicrochip.trim(),
          catch_date: newCatchDate,
          notes: newNotes.trim() || null,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setAddError(result.error || "Failed to add catch");
        return;
      }

      // Refresh data
      await Promise.all([fetchStats(), fetchManualCatches()]);

      // Reset form
      setNewMicrochip("");
      setNewNotes("");
      setShowAddCatch(false);
    } catch (err) {
      setAddError("Network error");
    } finally {
      setAddingCatch(false);
    }
  };

  if (loading) {
    return <div className="loading">Loading trapper details...</div>;
  }

  if (error) {
    return (
      <div>
        <BackButton fallbackHref="/trappers" />
        <div className="empty" style={{ marginTop: "2rem" }}>
          <h2 style={{ color: "#dc3545" }}>{error}</h2>
          <p className="text-muted" style={{ marginTop: "0.5rem" }}>
            Person ID: <code>{id}</code>
          </p>
          <a href={`/people/${id}`} style={{ marginTop: "1rem" }}>
            View as person record instead
          </a>
        </div>
      </div>
    );
  }

  if (!stats) {
    return <div className="empty">Trapper not found</div>;
  }

  return (
    <div>
      <BackButton fallbackHref="/trappers" />

      {/* Header */}
      <div className="detail-header" style={{ marginTop: "1rem" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            flexWrap: "wrap",
          }}
        >
          <h1 style={{ margin: 0 }}>{stats.display_name}</h1>
          <TrapperBadge trapperType={stats.trapper_type} />
        </div>
        <p className="text-muted text-sm" style={{ marginTop: "0.25rem" }}>
          <a href={`/people/${id}`}>View person record</a>
        </p>
      </div>

      {/* Statistics */}
      <Section title="Statistics">
        <TrapperStatsCard personId={id} />
      </Section>

      {/* Manual Catches */}
      <Section title="Manual Catches">
        <p className="text-muted text-sm" style={{ marginBottom: "1rem" }}>
          Track cats caught outside of formal FFR requests by entering their
          microchip numbers.
        </p>

        {!showAddCatch ? (
          <button
            onClick={() => setShowAddCatch(true)}
            style={{ marginBottom: "1rem" }}
          >
            + Add Manual Catch
          </button>
        ) : (
          <form
            onSubmit={handleAddCatch}
            style={{
              padding: "1rem",
              background: "#f8f9fa",
              borderRadius: "8px",
              marginBottom: "1rem",
            }}
          >
            {addError && (
              <div
                style={{
                  color: "#dc3545",
                  marginBottom: "0.75rem",
                  padding: "0.5rem",
                  background: "#f8d7da",
                  borderRadius: "4px",
                  fontSize: "0.875rem",
                }}
              >
                {addError}
              </div>
            )}

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "1rem",
                marginBottom: "1rem",
              }}
            >
              <div>
                <label
                  style={{
                    display: "block",
                    marginBottom: "0.25rem",
                    fontWeight: 500,
                    fontSize: "0.875rem",
                  }}
                >
                  Microchip *
                </label>
                <input
                  type="text"
                  value={newMicrochip}
                  onChange={(e) => setNewMicrochip(e.target.value)}
                  placeholder="900000001234567"
                  style={{ width: "100%" }}
                  required
                />
              </div>
              <div>
                <label
                  style={{
                    display: "block",
                    marginBottom: "0.25rem",
                    fontWeight: 500,
                    fontSize: "0.875rem",
                  }}
                >
                  Catch Date
                </label>
                <input
                  type="date"
                  value={newCatchDate}
                  onChange={(e) => setNewCatchDate(e.target.value)}
                  style={{ width: "100%" }}
                />
              </div>
            </div>

            <div style={{ marginBottom: "1rem" }}>
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
              <input
                type="text"
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                placeholder="Where caught, circumstances, etc."
                style={{ width: "100%" }}
              />
            </div>

            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button type="submit" disabled={addingCatch}>
                {addingCatch ? "Adding..." : "Add Catch"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAddCatch(false);
                  setAddError(null);
                }}
                disabled={addingCatch}
                style={{
                  background: "transparent",
                  border: "1px solid var(--border)",
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {manualCatches.length > 0 ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Cat</th>
                <th>Microchip</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {manualCatches.map((c) => (
                <tr key={c.catch_id}>
                  <td>{new Date(c.catch_date).toLocaleDateString()}</td>
                  <td>
                    {c.cat_id ? (
                      <a href={`/cats/${c.cat_id}`}>{c.cat_name || "Unknown"}</a>
                    ) : (
                      <span className="text-muted">Not linked</span>
                    )}
                  </td>
                  <td>
                    <code style={{ fontSize: "0.8rem" }}>{c.microchip}</code>
                  </td>
                  <td className="text-muted">{c.notes || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-muted">No manual catches recorded.</p>
        )}
      </Section>
    </div>
  );
}
