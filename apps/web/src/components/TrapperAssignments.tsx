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
  is_ffsc_trapper: boolean;
}

interface PersonSearchResult {
  entity_id: string;
  display_name: string;
  subtitle: string;
}

type AssignMode = "official" | "search";

const NO_TRAPPER_REASON_LABELS: Record<string, string> = {
  client_trapping: "Client trapping",
  has_community_help: "Has community help",
  not_needed: "No trapper needed",
  no_capacity: "No capacity",
};

interface Props {
  requestId: string;
  compact?: boolean;
  onAssignmentChange?: () => void;
}

export function TrapperAssignments({ requestId, compact = false, onAssignmentChange }: Props) {
  const [trappers, setTrappers] = useState<TrapperAssignment[]>([]);
  const [history, setHistory] = useState<AssignmentHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [availableTrappers, setAvailableTrappers] = useState<AvailableTrapper[]>([]);
  const [selectedTrapperId, setSelectedTrapperId] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);
  const [assigning, setAssigning] = useState(false);
  // Mode: "official" shows only FFSC/Community trappers, "search" searches all people
  const [assignMode, setAssignMode] = useState<AssignMode>("official");
  // Person search for when searching all people
  const [personSearch, setPersonSearch] = useState("");
  const [personResults, setPersonResults] = useState<PersonSearchResult[]>([]);
  const [searchingPeople, setSearchingPeople] = useState(false);
  const [loadingTrappers, setLoadingTrappers] = useState(false);
  // SC_004: No trapper reason state
  const [noTrapperReason, setNoTrapperReason] = useState<string | null>(null);
  const [assignmentStatus, setAssignmentStatus] = useState<string>("pending");
  const [showReasonForm, setShowReasonForm] = useState(false);
  const [savingReason, setSavingReason] = useState(false);

  const fetchData = async () => {
    try {
      const response = await fetch(
        `/api/requests/${requestId}/trappers?history=true`
      );
      if (response.ok) {
        const data = await response.json();
        setTrappers(data.trappers || []);
        setHistory(data.history || []);
        setNoTrapperReason(data.no_trapper_reason || null);
        setAssignmentStatus(data.assignment_status || "pending");
      }
    } catch (err) {
      console.error("Failed to fetch trappers:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchAvailableTrappers = async () => {
    setLoadingTrappers(true);
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
    } finally {
      setLoadingTrappers(false);
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
      // If a no_trapper_reason was set, clear it when assigning a trapper
      if (noTrapperReason) {
        await fetch(`/api/requests/${requestId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ no_trapper_reason: null }),
        });
      }
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
        setAssignMode("official");
        setNoTrapperReason(null);
        fetchData();
        onAssignmentChange?.();
      }
    } catch (err) {
      console.error("Failed to assign trapper:", err);
    } finally {
      setAssigning(false);
    }
  };

  // SC_004: Set or clear no_trapper_reason via PATCH /api/requests/[id]
  const handleSetReason = async (reason: string) => {
    setSavingReason(true);
    try {
      const response = await fetch(`/api/requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ no_trapper_reason: reason }),
      });
      if (response.ok) {
        setNoTrapperReason(reason);
        if (reason === "client_trapping") {
          setAssignmentStatus("client_trapping");
        }
        setShowReasonForm(false);
        onAssignmentChange?.();
      }
    } catch (err) {
      console.error("Failed to set no_trapper_reason:", err);
    } finally {
      setSavingReason(false);
    }
  };

  const handleClearReason = async () => {
    setSavingReason(true);
    try {
      const response = await fetch(`/api/requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ no_trapper_reason: null }),
      });
      if (response.ok) {
        setNoTrapperReason(null);
        setAssignmentStatus(trappers.length > 0 ? "assigned" : "pending");
        onAssignmentChange?.();
      }
    } catch (err) {
      console.error("Failed to clear no_trapper_reason:", err);
    } finally {
      setSavingReason(false);
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

  // Group trappers by type for display
  const ffscTrappers = availableTrappers.filter(t => t.is_ffsc_trapper);
  const communityTrappers = availableTrappers.filter(t => !t.is_ffsc_trapper);

  // SC_004: No-trapper reason form
  const reasonForm = showReasonForm && (
    <div style={{
      padding: "1rem",
      background: "var(--card-bg, #f8f9fa)",
      borderRadius: "6px",
      marginBottom: "1rem",
      border: "1px solid var(--border)"
    }}>
      <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.875rem", fontWeight: 500 }}>
        Why is no trapper needed?
      </label>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {Object.entries(NO_TRAPPER_REASON_LABELS).map(([value, label]) => (
          <button
            key={value}
            onClick={() => handleSetReason(value)}
            disabled={savingReason}
            style={{
              padding: "0.5rem 0.75rem",
              borderRadius: "4px",
              border: "1px solid var(--border)",
              background: "var(--background)",
              color: "var(--foreground)",
              cursor: savingReason ? "not-allowed" : "pointer",
              textAlign: "left",
              fontSize: "0.875rem",
            }}
            onMouseOver={(e) => (e.currentTarget.style.background = "rgba(0,0,0,0.05)")}
            onMouseOut={(e) => (e.currentTarget.style.background = "var(--background)")}
          >
            {label}
          </button>
        ))}
      </div>
      <button
        onClick={() => setShowReasonForm(false)}
        className="btn btn-secondary btn-sm"
        style={{ marginTop: "0.75rem" }}
      >
        Cancel
      </button>
    </div>
  );

  // SC_004: Badge showing current no-trapper reason
  const reasonBadge = noTrapperReason && (
    <div style={{
      display: "inline-flex",
      alignItems: "center",
      gap: "0.5rem",
      padding: "0.4rem 0.75rem",
      background: noTrapperReason === "client_trapping" ? "rgba(139, 92, 246, 0.1)" : "rgba(107, 114, 128, 0.1)",
      border: `1px solid ${noTrapperReason === "client_trapping" ? "rgba(139, 92, 246, 0.3)" : "rgba(107, 114, 128, 0.3)"}`,
      borderRadius: "6px",
      fontSize: "0.85rem",
      color: noTrapperReason === "client_trapping" ? "#7c3aed" : "#4b5563",
    }}>
      <span style={{ fontWeight: 500 }}>
        {NO_TRAPPER_REASON_LABELS[noTrapperReason] || noTrapperReason}
      </span>
      <button
        onClick={handleClearReason}
        disabled={savingReason}
        title="Clear reason"
        style={{
          background: "none",
          border: "none",
          cursor: savingReason ? "not-allowed" : "pointer",
          padding: "0 0.15rem",
          fontSize: "1rem",
          lineHeight: 1,
          color: "inherit",
          opacity: 0.6,
        }}
        onMouseOver={(e) => (e.currentTarget.style.opacity = "1")}
        onMouseOut={(e) => (e.currentTarget.style.opacity = "0.6")}
      >
        &times;
      </button>
    </div>
  );

  // Add trapper form UI
  const addTrapperForm = showAddForm && (
    <div style={{
      padding: "1rem",
      background: "var(--card-bg, #f8f9fa)",
      borderRadius: "6px",
      marginBottom: "1rem",
      border: "1px solid var(--border)"
    }}>
      {/* Mode tabs */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        <button
          onClick={() => { setAssignMode("official"); setPersonSearch(""); setPersonResults([]); setSelectedTrapperId(""); }}
          style={{
            padding: "0.4rem 0.75rem",
            borderRadius: "4px",
            border: "1px solid var(--border)",
            background: assignMode === "official" ? "var(--accent, #0d6efd)" : "transparent",
            color: assignMode === "official" ? "#fff" : "var(--foreground)",
            cursor: "pointer",
            fontSize: "0.85rem",
            fontWeight: 500,
          }}
        >
          Official Trappers
        </button>
        <button
          onClick={() => { setAssignMode("search"); setSelectedTrapperId(""); }}
          style={{
            padding: "0.4rem 0.75rem",
            borderRadius: "4px",
            border: "1px solid var(--border)",
            background: assignMode === "search" ? "var(--accent, #0d6efd)" : "transparent",
            color: assignMode === "search" ? "#fff" : "var(--foreground)",
            cursor: "pointer",
            fontSize: "0.85rem",
            fontWeight: 500,
          }}
        >
          Search All People
        </button>
      </div>

      {/* Official trappers mode */}
      {assignMode === "official" && (
        <div style={{ marginBottom: "0.75rem" }}>
          {loadingTrappers ? (
            <div style={{ color: "#666", fontSize: "0.875rem" }}>Loading trappers...</div>
          ) : availableTrappers.length === 0 ? (
            <div style={{ color: "#666", fontSize: "0.875rem" }}>
              No official trappers found. Use &quot;Search All People&quot; to find someone.
            </div>
          ) : (
            <>
              <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.875rem", fontWeight: 500 }}>
                Select a Trapper
              </label>
              <select
                value={selectedTrapperId}
                onChange={(e) => { setSelectedTrapperId(e.target.value); }}
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
                {ffscTrappers.length > 0 && (
                  <optgroup label="FFSC Trappers">
                    {ffscTrappers.map((t) => (
                      <option key={t.person_id} value={t.person_id}>
                        {t.display_name} ({t.trapper_type?.replace(/_/g, " ") || "trapper"})
                      </option>
                    ))}
                  </optgroup>
                )}
                {communityTrappers.length > 0 && (
                  <optgroup label="Community Trappers">
                    {communityTrappers.map((t) => (
                      <option key={t.person_id} value={t.person_id}>
                        {t.display_name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <div style={{ fontSize: "0.75rem", color: "#666", marginTop: "0.25rem" }}>
                {ffscTrappers.length} FFSC, {communityTrappers.length} Community trappers available
              </div>
            </>
          )}
        </div>
      )}

      {/* Search all people mode */}
      {assignMode === "search" && (
        <div style={{ marginBottom: "0.75rem" }}>
          <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.875rem", fontWeight: 500 }}>
            Search for any person
          </label>
          <div style={{ fontSize: "0.75rem", color: "#666", marginBottom: "0.5rem" }}>
            Use this if a neighbor or non-trapper offered to help trap
          </div>
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
          {personSearch.length >= 2 && personResults.length === 0 && !searchingPeople && (
            <div style={{ fontSize: "0.8rem", color: "#666", marginTop: "0.5rem" }}>
              No people found matching &quot;{personSearch}&quot;
            </div>
          )}
        </div>
      )}

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
          onClick={() => { setShowAddForm(false); setSelectedTrapperId(""); setIsPrimary(false); setPersonSearch(""); setPersonResults([]); setAssignMode("official"); }}
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
        {reasonForm}
        {!showAddForm && !showReasonForm && (
          <div>
            {noTrapperReason ? (
              <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
                {reasonBadge}
                <button
                  onClick={() => setShowAddForm(true)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#0d6efd",
                    fontSize: "0.8rem",
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  + Add Trapper Instead
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
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
                <button
                  onClick={() => setShowReasonForm(true)}
                  className="btn btn-sm"
                  style={{
                    background: "transparent",
                    color: "var(--foreground)",
                    padding: "0.25rem 0.75rem",
                    borderRadius: "4px",
                    border: "1px solid var(--border)",
                    cursor: "pointer",
                    fontSize: "0.8rem"
                  }}
                >
                  No trapper needed
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  if (trappers.length === 0) {
    if (noTrapperReason) {
      return (
        <span style={{
          fontSize: "0.85rem",
          color: noTrapperReason === "client_trapping" ? "#7c3aed" : "#6b7280",
          fontWeight: 500,
        }}>
          {NO_TRAPPER_REASON_LABELS[noTrapperReason] || noTrapperReason}
        </span>
      );
    }
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
