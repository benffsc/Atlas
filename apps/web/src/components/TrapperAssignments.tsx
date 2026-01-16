"use client";

import { useState, useEffect } from "react";
import { TrapperBadge } from "./TrapperBadge";

interface TrapperAssignment {
  assignment_id: string;
  trapper_person_id: string;
  trapper_name: string;
  trapper_type: string;
  is_ffsc_trapper: boolean;
  is_primary: boolean;
  assigned_at: string;
  assignment_reason: string | null;
}

interface AssignmentHistory {
  trapper_person_id: string;
  trapper_name: string;
  is_primary: boolean;
  assigned_at: string;
  unassigned_at: string | null;
  assignment_reason: string | null;
  unassignment_reason: string | null;
  status: string;
}

interface AvailableTrapper {
  person_id: string;
  display_name: string;
  trapper_type: string;
}

interface PersonSearchResult {
  entity_id: string;
  display_name: string;
  subtitle: string;
}

interface Props {
  requestId: string;
  compact?: boolean;
}

export function TrapperAssignments({ requestId, compact = false }: Props) {
  const [trappers, setTrappers] = useState<TrapperAssignment[]>([]);
  const [history, setHistory] = useState<AssignmentHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [availableTrappers, setAvailableTrappers] = useState<AvailableTrapper[]>([]);
  const [selectedTrapperId, setSelectedTrapperId] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);
  const [assigning, setAssigning] = useState(false);
  // Person search for when no trappers are in the system
  const [personSearch, setPersonSearch] = useState("");
  const [personResults, setPersonResults] = useState<PersonSearchResult[]>([]);
  const [searchingPeople, setSearchingPeople] = useState(false);

  const fetchData = async () => {
    try {
      const response = await fetch(
        `/api/requests/${requestId}/trappers?history=true`
      );
      if (response.ok) {
        const data = await response.json();
        setTrappers(data.trappers || []);
        setHistory(data.history || []);
      }
    } catch (err) {
      console.error("Failed to fetch trappers:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchAvailableTrappers = async () => {
    try {
      // Fetch all trappers (no active filter - show everyone with a trapper role)
      const response = await fetch("/api/trappers?limit=200&sort=display_name");
      if (response.ok) {
        const data = await response.json();
        // Filter out already assigned trappers
        const assignedIds = new Set(trappers.map(t => t.trapper_person_id));
        setAvailableTrappers(
          (data.trappers || []).filter((t: AvailableTrapper) => !assignedIds.has(t.person_id))
        );
      }
    } catch (err) {
      console.error("Failed to fetch available trappers:", err);
    }
  };

  // Search for any person (when no official trappers exist or need to find someone specific)
  const searchPeople = async (query: string) => {
    if (query.length < 2) {
      setPersonResults([]);
      return;
    }
    setSearchingPeople(true);
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(query)}&type=person&limit=10`);
      if (response.ok) {
        const data = await response.json();
        // Filter out already assigned trappers
        const assignedIds = new Set(trappers.map(t => t.trapper_person_id));
        setPersonResults(
          (data.results || []).filter((p: PersonSearchResult) => !assignedIds.has(p.entity_id))
        );
      }
    } catch (err) {
      console.error("Failed to search people:", err);
    } finally {
      setSearchingPeople(false);
    }
  };

  const handleAssign = async () => {
    if (!selectedTrapperId) return;
    setAssigning(true);
    try {
      const response = await fetch(`/api/requests/${requestId}/trappers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trapper_person_id: selectedTrapperId,
          is_primary: isPrimary,
          reason: "manual_assignment",
        }),
      });
      if (response.ok) {
        setShowAddForm(false);
        setSelectedTrapperId("");
        setIsPrimary(false);
        setPersonSearch("");
        setPersonResults([]);
        fetchData();
      }
    } catch (err) {
      console.error("Failed to assign trapper:", err);
    } finally {
      setAssigning(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [requestId]);

  useEffect(() => {
    if (showAddForm) {
      fetchAvailableTrappers();
    }
  }, [showAddForm, trappers]);

  if (loading) {
    return <span className="text-muted">Loading...</span>;
  }

  // Add trapper form UI
  const addTrapperForm = showAddForm && (
    <div style={{
      padding: "1rem",
      background: "var(--card-bg, #f8f9fa)",
      borderRadius: "6px",
      marginBottom: "1rem",
      border: "1px solid var(--border)"
    }}>
      {/* Show dropdown if official trappers exist */}
      {availableTrappers.length > 0 && (
        <div style={{ marginBottom: "0.75rem" }}>
          <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.875rem" }}>
            Select Trapper
          </label>
          <select
            value={selectedTrapperId}
            onChange={(e) => { setSelectedTrapperId(e.target.value); setPersonSearch(""); setPersonResults([]); }}
            style={{
              width: "100%",
              padding: "0.5rem",
              borderRadius: "4px",
              border: "1px solid var(--border)",
              background: "var(--background)",
              color: "var(--foreground)",
            }}
          >
            <option value="">Choose a trapper...</option>
            {availableTrappers.map((t) => (
              <option key={t.person_id} value={t.person_id}>
                {t.display_name} ({t.trapper_type || "trapper"})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Person search - always show, but with different label based on whether we have official trappers */}
      <div style={{ marginBottom: "0.75rem" }}>
        <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.875rem" }}>
          {availableTrappers.length > 0 ? "Or search for any person:" : "Search for a person to assign:"}
        </label>
        <input
          type="text"
          value={personSearch}
          onChange={(e) => {
            setPersonSearch(e.target.value);
            setSelectedTrapperId("");
            searchPeople(e.target.value);
          }}
          placeholder="Type a name to search..."
          style={{
            width: "100%",
            padding: "0.5rem",
            borderRadius: "4px",
            border: "1px solid var(--border)",
            background: "var(--background)",
            color: "var(--foreground)",
          }}
        />
        {searchingPeople && (
          <div style={{ fontSize: "0.8rem", color: "#666", marginTop: "0.25rem" }}>Searching...</div>
        )}
        {personResults.length > 0 && (
          <div style={{
            marginTop: "0.5rem",
            border: "1px solid var(--border)",
            borderRadius: "4px",
            maxHeight: "200px",
            overflow: "auto"
          }}>
            {personResults.map((p) => (
              <div
                key={p.entity_id}
                onClick={() => {
                  setSelectedTrapperId(p.entity_id);
                  setPersonSearch(p.display_name);
                  setPersonResults([]);
                }}
                style={{
                  padding: "0.5rem",
                  cursor: "pointer",
                  borderBottom: "1px solid var(--border)",
                  background: selectedTrapperId === p.entity_id ? "rgba(13, 110, 253, 0.1)" : "transparent",
                }}
                onMouseOver={(e) => (e.currentTarget.style.background = "rgba(0,0,0,0.05)")}
                onMouseOut={(e) => (e.currentTarget.style.background = selectedTrapperId === p.entity_id ? "rgba(13, 110, 253, 0.1)" : "transparent")}
              >
                <div style={{ fontWeight: 500 }}>{p.display_name}</div>
                {p.subtitle && <div style={{ fontSize: "0.8rem", color: "#666" }}>{p.subtitle}</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ marginBottom: "0.75rem" }}>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={isPrimary}
            onChange={(e) => setIsPrimary(e.target.checked)}
          />
          <span style={{ fontSize: "0.875rem" }}>Make primary (lead) trapper</span>
        </label>
      </div>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button
          onClick={handleAssign}
          disabled={!selectedTrapperId || assigning}
          className="btn btn-primary btn-sm"
        >
          {assigning ? "Assigning..." : "Assign"}
        </button>
        <button
          onClick={() => { setShowAddForm(false); setSelectedTrapperId(""); setIsPrimary(false); setPersonSearch(""); setPersonResults([]); }}
          className="btn btn-secondary btn-sm"
        >
          Cancel
        </button>
      </div>
    </div>
  );

  if (trappers.length === 0 && !compact) {
    return (
      <div>
        {addTrapperForm}
        {!showAddForm && (
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <span className="text-muted">No trappers assigned</span>
            <button
              onClick={() => setShowAddForm(true)}
              className="btn btn-sm"
              style={{
                background: "var(--accent)",
                color: "#fff",
                padding: "0.25rem 0.75rem",
                borderRadius: "4px",
                border: "none",
                cursor: "pointer",
                fontSize: "0.8rem"
              }}
            >
              + Add Trapper
            </button>
          </div>
        )}
      </div>
    );
  }

  if (trappers.length === 0) {
    return <span className="text-muted">No trappers assigned</span>;
  }

  // Compact mode: just show names inline
  if (compact) {
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
        {trappers.map((t, i) => (
          <span key={t.assignment_id}>
            <a href={`/trappers/${t.trapper_person_id}`} style={{ fontWeight: t.is_primary ? 600 : 400 }}>
              {t.trapper_name}
            </a>
            {t.is_primary && (
              <span style={{ fontSize: "0.7rem", color: "#0d6efd", marginLeft: "0.25rem" }}>
                (lead)
              </span>
            )}
            {i < trappers.length - 1 && ", "}
          </span>
        ))}
        {trappers.length > 1 && (
          <span className="text-muted text-sm" style={{ marginLeft: "0.25rem" }}>
            ({trappers.length} trappers)
          </span>
        )}
      </div>
    );
  }

  // Full mode: show cards with details
  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {trappers.map((t) => (
          <div
            key={t.assignment_id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              padding: "0.75rem",
              background: t.is_primary ? "rgba(13, 110, 253, 0.05)" : "#f8f9fa",
              borderRadius: "6px",
              border: t.is_primary ? "1px solid rgba(13, 110, 253, 0.2)" : "1px solid transparent",
            }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <a
                  href={`/trappers/${t.trapper_person_id}`}
                  style={{ fontWeight: 600, fontSize: "0.95rem" }}
                >
                  {t.trapper_name}
                </a>
                <TrapperBadge trapperType={t.trapper_type} size="sm" />
                {t.is_primary && (
                  <span
                    style={{
                      fontSize: "0.65rem",
                      padding: "0.15rem 0.4rem",
                      background: "#0d6efd",
                      color: "#fff",
                      borderRadius: "3px",
                      fontWeight: 600,
                    }}
                  >
                    LEAD
                  </span>
                )}
              </div>
              <div className="text-muted text-sm" style={{ marginTop: "0.25rem" }}>
                Assigned {new Date(t.assigned_at).toLocaleDateString()}
                {t.assignment_reason && t.assignment_reason !== "airtable_sync" && (
                  <span> - {t.assignment_reason}</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Add trapper button and form */}
      {addTrapperForm}
      {!showAddForm && (
        <button
          onClick={() => setShowAddForm(true)}
          style={{
            marginTop: "0.75rem",
            background: "var(--accent, #0d6efd)",
            color: "#fff",
            padding: "0.35rem 0.85rem",
            borderRadius: "4px",
            border: "none",
            cursor: "pointer",
            fontSize: "0.8rem",
            fontWeight: 500,
          }}
        >
          + Add Trapper
        </button>
      )}

      {/* History toggle */}
      {history.length > trappers.length && (
        <div style={{ marginTop: "1rem" }}>
          <button
            onClick={() => setShowHistory(!showHistory)}
            style={{
              background: "transparent",
              border: "none",
              color: "#0d6efd",
              fontSize: "0.8rem",
              cursor: "pointer",
              padding: 0,
            }}
          >
            {showHistory ? "Hide history" : `Show assignment history (${history.length} total)`}
          </button>

          {showHistory && (
            <div style={{ marginTop: "0.75rem" }}>
              <table className="data-table" style={{ fontSize: "0.8rem" }}>
                <thead>
                  <tr>
                    <th>Trapper</th>
                    <th>Assigned</th>
                    <th>Unassigned</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h, i) => (
                    <tr key={`${h.trapper_person_id}-${h.assigned_at}-${i}`}>
                      <td>
                        <a href={`/trappers/${h.trapper_person_id}`}>{h.trapper_name}</a>
                        {h.is_primary && " (lead)"}
                      </td>
                      <td>{new Date(h.assigned_at).toLocaleDateString()}</td>
                      <td>
                        {h.unassigned_at
                          ? new Date(h.unassigned_at).toLocaleDateString()
                          : "—"}
                      </td>
                      <td>
                        <span
                          style={{
                            color: h.status === "active" ? "#198754" : "#6c757d",
                          }}
                        >
                          {h.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
