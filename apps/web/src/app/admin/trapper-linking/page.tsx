"use client";

import { useState, useEffect, useCallback } from "react";
import { formatPhone } from "@/lib/formatters";

interface PendingTrapperLink {
  pending_id: string;
  airtable_record_id: string;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  trapper_type: string | null;
  failure_reason: string | null;
  candidate_person_ids: string[] | null;
  candidate_scores: { person_id: string; score: number; reason: string }[] | null;
  status: string;
  created_at: string;
  candidate_details: { person_id: string; display_name: string }[] | null;
}

interface PersonSearchResult {
  person_id: string;
  display_name: string;
  emails: string | null;
  phones: string | null;
  addresses: { formatted_address: string }[] | null;
}

interface TrapperLinkingResponse {
  pending: PendingTrapperLink[];
  counts: {
    pending: number;
    linked: number;
    created: number;
    dismissed: number;
  };
  note?: string;
}

export default function TrapperLinkingPage() {
  const [data, setData] = useState<TrapperLinkingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("pending");
  const [resolving, setResolving] = useState<string | null>(null);

  const fetchPending = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/trapper-linking?status=${status}`);
      const result = await response.json();
      setData(result);
    } catch (error) {
      console.error("Failed to fetch pending trapper links:", error);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    fetchPending();
  }, [fetchPending]);

  const handleResolve = async (pendingId: string, personId: string | null, action: string, notes?: string) => {
    setResolving(pendingId);
    try {
      const response = await fetch("/api/admin/trapper-linking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pending_id: pendingId, person_id: personId, action, notes }),
      });

      if (response.ok) {
        fetchPending();
      } else {
        const error = await response.json();
        alert(`Error: ${error.error}`);
      }
    } catch (error) {
      console.error("Failed to resolve:", error);
    } finally {
      setResolving(null);
    }
  };

  const formatFailureReason = (reason: string | null) => {
    switch (reason) {
      case "no_identifiers":
        return "No email or phone";
      case "identity_resolution_failed":
        return "Identity matching failed";
      case "phone_conflict":
        return "Phone linked to multiple people";
      case "low_confidence":
        return "Low match confidence";
      default:
        return reason || "Unknown";
    }
  };

  const formatTrapperType = (type: string | null) => {
    switch (type) {
      case "ffsc_trapper":
        return "FFSC Trapper";
      case "community_trapper":
        return "Community Trapper";
      case "coordinator":
        return "Coordinator";
      case "head_trapper":
        return "Head Trapper";
      default:
        return type || "Unknown";
    }
  };

  return (
    <div>
      <h1 style={{ marginBottom: "0.5rem" }}>Trapper Linking Queue</h1>
      <p className="text-muted" style={{ marginBottom: "1.5rem" }}>
        Trappers from Airtable that couldn&apos;t be automatically linked to Atlas people.
        Link them manually to existing people or create new person records.
      </p>

      {data?.note && (
        <div style={{
          padding: "1rem",
          background: "#fff3cd",
          border: "1px solid #ffc107",
          borderRadius: "6px",
          marginBottom: "1.5rem"
        }}>
          {data.note}
        </div>
      )}

      {/* Status tabs */}
      <div style={{ display: "flex", gap: "1rem", marginBottom: "1.5rem" }}>
        {[
          { key: "pending", label: "Pending", count: data?.counts.pending },
          { key: "linked", label: "Linked", count: data?.counts.linked },
          { key: "created", label: "Created", count: data?.counts.created },
          { key: "dismissed", label: "Dismissed", count: data?.counts.dismissed },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setStatus(tab.key)}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "6px",
              border: "1px solid var(--border)",
              background: status === tab.key ? "var(--accent, #0d6efd)" : "transparent",
              color: status === tab.key ? "#fff" : "var(--foreground)",
              cursor: "pointer",
            }}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span style={{
                marginLeft: "0.5rem",
                background: status === tab.key ? "rgba(255,255,255,0.2)" : "var(--bg-muted)",
                padding: "0.15rem 0.4rem",
                borderRadius: "4px",
                fontSize: "0.8rem",
              }}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading && <div className="loading">Loading...</div>}

      {!loading && data?.pending.length === 0 && (
        <div className="empty" style={{ padding: "3rem", textAlign: "center" }}>
          {status === "pending"
            ? "No pending trappers to link. All trappers have been resolved."
            : `No ${status} records.`}
        </div>
      )}

      {!loading && data?.pending.map((pending) => (
        <TrapperLinkCard
          key={pending.pending_id}
          pending={pending}
          onResolve={handleResolve}
          resolving={resolving === pending.pending_id}
          isPending={status === "pending"}
          formatFailureReason={formatFailureReason}
          formatTrapperType={formatTrapperType}
        />
      ))}
    </div>
  );
}

function TrapperLinkCard({
  pending,
  onResolve,
  resolving,
  isPending,
  formatFailureReason,
  formatTrapperType,
}: {
  pending: PendingTrapperLink;
  onResolve: (pendingId: string, personId: string | null, action: string, notes?: string) => void;
  resolving: boolean;
  isPending: boolean;
  formatFailureReason: (reason: string | null) => string;
  formatTrapperType: (type: string | null) => string;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<PersonSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState<PersonSearchResult | null>(null);
  const [showSearch, setShowSearch] = useState(false);

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    try {
      const response = await fetch(`/api/people/search?q=${encodeURIComponent(query)}&limit=10`);
      const data = await response.json();
      setSearchResults(data.people || []);
    } catch (error) {
      console.error("Search failed:", error);
    } finally {
      setSearching(false);
    }
  };

  const handleSelectPerson = (person: PersonSearchResult) => {
    setSelectedPerson(person);
    setSearchQuery("");
    setSearchResults([]);
    setShowSearch(false);
  };

  const handleLinkToPerson = (personId: string) => {
    onResolve(pending.pending_id, personId, "link");
  };

  return (
    <div className="card" style={{ padding: "1.5rem", marginBottom: "1rem" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
        <div>
          <span style={{
            fontSize: "0.75rem",
            padding: "0.2rem 0.5rem",
            background: "#dc3545",
            color: "#fff",
            borderRadius: "4px",
            marginRight: "0.5rem",
          }}>
            {formatFailureReason(pending.failure_reason)}
          </span>
          <span style={{
            fontSize: "0.75rem",
            padding: "0.2rem 0.5rem",
            background: "#6c757d",
            color: "#fff",
            borderRadius: "4px",
          }}>
            {formatTrapperType(pending.trapper_type)}
          </span>
        </div>
        <span className="text-muted text-sm">
          {new Date(pending.created_at).toLocaleDateString()}
        </span>
      </div>

      {/* Trapper Info */}
      <div style={{ marginBottom: "1rem" }}>
        <div style={{ fontWeight: 600, fontSize: "1.25rem", marginBottom: "0.5rem" }}>
          {pending.display_name || "Unknown Name"}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.5rem" }}>
          {pending.email && (
            <div className="text-sm">
              <span className="text-muted">Email:</span> {pending.email}
            </div>
          )}
          {pending.phone && (
            <div className="text-sm">
              <span className="text-muted">Phone:</span> {formatPhone(pending.phone)}
            </div>
          )}
          {pending.address && (
            <div className="text-sm">
              <span className="text-muted">Address:</span> {pending.address}
            </div>
          )}
        </div>
        <div className="text-muted text-sm" style={{ marginTop: "0.5rem" }}>
          Airtable: {pending.airtable_record_id}
        </div>
      </div>

      {/* Candidate Suggestions */}
      {pending.candidate_details && pending.candidate_details.length > 0 && (
        <div style={{ marginBottom: "1rem", padding: "1rem", background: "var(--card-border)", borderRadius: "8px" }}>
          <div style={{ fontWeight: 600, marginBottom: "0.5rem", fontSize: "0.875rem" }}>
            Possible Matches:
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            {pending.candidate_details.map((candidate) => (
              <button
                key={candidate.person_id}
                onClick={() => isPending && handleLinkToPerson(candidate.person_id)}
                disabled={resolving || !isPending}
                style={{
                  padding: "0.375rem 0.75rem",
                  borderRadius: "4px",
                  border: "1px solid #0d6efd",
                  background: "#e7f1ff",
                  color: "#0d6efd",
                  cursor: isPending ? "pointer" : "default",
                  fontSize: "0.875rem",
                }}
              >
                {candidate.display_name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      {isPending && (
        <div style={{ borderTop: "1px solid var(--card-border)", paddingTop: "1rem" }}>
          {/* Search for person */}
          {!showSearch && !selectedPerson && (
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button
                onClick={() => setShowSearch(true)}
                disabled={resolving}
                style={{
                  padding: "0.5rem 1rem",
                  background: "#0d6efd",
                  color: "#fff",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                Search for Person
              </button>
              <button
                onClick={() => onResolve(pending.pending_id, null, "dismiss")}
                disabled={resolving}
                style={{
                  padding: "0.5rem 1rem",
                  background: "#6c757d",
                  color: "#fff",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                Dismiss (Invalid)
              </button>
            </div>
          )}

          {/* Search interface */}
          {showSearch && (
            <div style={{ marginBottom: "1rem" }}>
              <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => handleSearch(e.target.value)}
                  placeholder="Search by name, email, or phone..."
                  style={{
                    flex: 1,
                    padding: "0.5rem",
                    borderRadius: "4px",
                    border: "1px solid var(--border)",
                  }}
                />
                <button
                  onClick={() => {
                    setShowSearch(false);
                    setSearchQuery("");
                    setSearchResults([]);
                  }}
                  style={{
                    padding: "0.5rem 1rem",
                    background: "transparent",
                    border: "1px solid var(--border)",
                    borderRadius: "4px",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
              </div>

              {searching && <div className="text-muted text-sm">Searching...</div>}

              {searchResults.length > 0 && (
                <div style={{
                  border: "1px solid var(--border)",
                  borderRadius: "4px",
                  maxHeight: "200px",
                  overflow: "auto",
                }}>
                  {searchResults.map((person) => (
                    <div
                      key={person.person_id}
                      onClick={() => handleSelectPerson(person)}
                      style={{
                        padding: "0.75rem",
                        borderBottom: "1px solid var(--card-border)",
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ fontWeight: 500 }}>{person.display_name}</div>
                      <div className="text-muted text-sm">
                        {person.emails && <span style={{ marginRight: "1rem" }}>{person.emails}</span>}
                        {person.phones && <span>{formatPhone(person.phones)}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {searchQuery.length >= 2 && searchResults.length === 0 && !searching && (
                <div className="text-muted text-sm">No people found. You may need to create a new person.</div>
              )}
            </div>
          )}

          {/* Selected person confirmation */}
          {selectedPerson && (
            <div style={{
              padding: "1rem",
              background: "rgba(25, 135, 84, 0.1)",
              border: "1px solid rgba(25, 135, 84, 0.3)",
              borderRadius: "8px",
              marginBottom: "1rem",
            }}>
              <div style={{ fontWeight: 600, marginBottom: "0.5rem" }}>
                Link to: {selectedPerson.display_name}
              </div>
              <div className="text-muted text-sm" style={{ marginBottom: "0.75rem" }}>
                {selectedPerson.emails && <span style={{ marginRight: "1rem" }}>{selectedPerson.emails}</span>}
                {selectedPerson.phones && <span>{formatPhone(selectedPerson.phones)}</span>}
              </div>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button
                  onClick={() => handleLinkToPerson(selectedPerson.person_id)}
                  disabled={resolving}
                  style={{
                    padding: "0.5rem 1rem",
                    background: "#198754",
                    color: "#fff",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                  }}
                >
                  {resolving ? "Linking..." : "Confirm Link"}
                </button>
                <button
                  onClick={() => setSelectedPerson(null)}
                  disabled={resolving}
                  style={{
                    padding: "0.5rem 1rem",
                    background: "transparent",
                    border: "1px solid var(--border)",
                    borderRadius: "4px",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
