"use client";

import { useState, useEffect } from "react";

interface Household {
  household_id: string;
  primary_place_id: string;
  place_address: string | null;
  household_name: string | null;
  household_type: string | null;
  member_count: number;
  created_at: string;
  source_system: string | null;
}

interface HouseholdMember {
  membership_id: string;
  person_id: string;
  display_name: string | null;
  role: string | null;
  confidence: number;
  inferred_from: string | null;
}

interface HouseholdDetail {
  household: Household;
  members: HouseholdMember[];
}

export default function HouseholdsPage() {
  const [households, setHouseholds] = useState<Household[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedHousehold, setSelectedHousehold] = useState<HouseholdDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const limit = 25;

  const fetchHouseholds = async (newOffset: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/data-engine/households?limit=${limit}&offset=${newOffset}`);
      if (!res.ok) throw new Error("Failed to fetch households");
      const data = await res.json();
      setHouseholds(data.households || []);
      setTotal(data.pagination?.total || 0);
      setOffset(newOffset);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHouseholds(0);
  }, []);

  const loadHouseholdDetail = async (householdId: string) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/admin/data-engine/households?household_id=${householdId}`);
      if (!res.ok) throw new Error("Failed to fetch household");
      const data = await res.json();
      setSelectedHousehold(data);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to load household");
    } finally {
      setDetailLoading(false);
    }
  };

  if (error) {
    return (
      <div>
        <h1>Households</h1>
        <div className="card" style={{ padding: "1rem", background: "#fef2f2", border: "1px solid #ef4444" }}>
          <strong>Error:</strong> {error}
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "2rem" }}>
        <div>
          <h1 style={{ marginBottom: "0.25rem" }}>Households</h1>
          <p className="text-muted">
            Multiple people at the same address sharing identifiers
          </p>
        </div>
        <a
          href="/admin/data-engine"
          className="btn btn-secondary"
          style={{ padding: "0.5rem 1rem", fontSize: "0.875rem" }}
        >
          Back to Data Engine
        </a>
      </div>

      {/* Stats */}
      <div className="card" style={{ padding: "1rem", marginBottom: "1.5rem", display: "flex", gap: "2rem" }}>
        <div>
          <span className="text-muted">Total Households:</span>{" "}
          <strong>{total}</strong>
        </div>
        <div className="text-muted text-sm" style={{ marginLeft: "auto" }}>
          Households help the Data Engine avoid false merges when people share phones
        </div>
      </div>

      {/* Two Column Layout */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
        {/* List */}
        <div>
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>
            Household List
          </h2>

          {loading ? (
            <p className="text-muted">Loading...</p>
          ) : (
            <>
              <div style={{ display: "grid", gap: "0.5rem" }}>
                {households.map((h) => (
                  <button
                    key={h.household_id}
                    onClick={() => loadHouseholdDetail(h.household_id)}
                    className="card"
                    style={{
                      padding: "0.75rem",
                      textAlign: "left",
                      border: selectedHousehold?.household.household_id === h.household_id
                        ? "2px solid var(--primary)"
                        : "1px solid var(--card-border)",
                      cursor: "pointer",
                      background: "var(--card-bg)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <div style={{ fontWeight: 500 }}>
                          {h.household_name || h.place_address || "Unknown Address"}
                        </div>
                        <div className="text-muted text-sm">
                          {h.member_count} member{h.member_count !== 1 ? "s" : ""}
                          {h.household_type && ` - ${h.household_type}`}
                        </div>
                      </div>
                      {h.source_system && (
                        <span
                          style={{
                            padding: "0.125rem 0.375rem",
                            borderRadius: "4px",
                            background: "#f3f4f6",
                            fontSize: "0.75rem",
                          }}
                        >
                          {h.source_system}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>

              {/* Pagination */}
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "1rem", fontSize: "0.875rem" }}>
                <button
                  onClick={() => fetchHouseholds(Math.max(0, offset - limit))}
                  disabled={offset === 0}
                  className="btn btn-secondary"
                  style={{ padding: "0.375rem 0.75rem" }}
                >
                  Previous
                </button>
                <span className="text-muted">
                  {offset + 1} - {Math.min(offset + limit, total)} of {total}
                </span>
                <button
                  onClick={() => fetchHouseholds(offset + limit)}
                  disabled={offset + limit >= total}
                  className="btn btn-secondary"
                  style={{ padding: "0.375rem 0.75rem" }}
                >
                  Next
                </button>
              </div>
            </>
          )}
        </div>

        {/* Detail */}
        <div>
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>
            Household Detail
          </h2>

          {detailLoading ? (
            <p className="text-muted">Loading...</p>
          ) : selectedHousehold ? (
            <div className="card" style={{ padding: "1.25rem" }}>
              <div style={{ marginBottom: "1rem" }}>
                <h3 style={{ margin: 0, fontSize: "1.125rem" }}>
                  {selectedHousehold.household.household_name || "Household"}
                </h3>
                <div className="text-muted" style={{ marginTop: "0.25rem" }}>
                  {selectedHousehold.household.place_address || "No address"}
                </div>
                {selectedHousehold.household.primary_place_id && (
                  <a
                    href={`/places/${selectedHousehold.household.primary_place_id}`}
                    style={{ fontSize: "0.875rem" }}
                  >
                    View Place
                  </a>
                )}
              </div>

              <div style={{ marginBottom: "1rem" }}>
                <div className="text-muted text-sm" style={{ marginBottom: "0.5rem" }}>
                  Type: {selectedHousehold.household.household_type || "unknown"}
                </div>
                <div className="text-muted text-sm">
                  Created: {new Date(selectedHousehold.household.created_at).toLocaleDateString()}
                </div>
              </div>

              <h4 style={{ margin: "1rem 0 0.5rem 0", fontSize: "0.875rem", fontWeight: 600 }}>
                Members ({selectedHousehold.members.length})
              </h4>
              <div style={{ display: "grid", gap: "0.5rem" }}>
                {selectedHousehold.members.map((m) => (
                  <div
                    key={m.membership_id}
                    style={{
                      padding: "0.75rem",
                      background: "var(--card-border)",
                      borderRadius: "8px",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <a href={`/people/${m.person_id}`} style={{ fontWeight: 500 }}>
                          {m.display_name || "Unknown"}
                        </a>
                        {m.role && (
                          <span
                            style={{
                              marginLeft: "0.5rem",
                              padding: "0.125rem 0.375rem",
                              borderRadius: "4px",
                              background: "#eff6ff",
                              color: "#2563eb",
                              fontSize: "0.75rem",
                            }}
                          >
                            {m.role}
                          </span>
                        )}
                      </div>
                      <span className="text-muted text-sm">
                        {(m.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                    {m.inferred_from && (
                      <div className="text-muted text-sm" style={{ marginTop: "0.25rem" }}>
                        Inferred from: {m.inferred_from}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="card" style={{ padding: "2rem", textAlign: "center" }}>
              <p className="text-muted">Select a household to view details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
