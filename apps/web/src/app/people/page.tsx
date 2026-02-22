"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useUrlFilters } from "@/hooks/useUrlFilters";
import { useIsMobile } from "@/hooks/useIsMobile";

interface Person {
  person_id: string;
  display_name: string;
  account_type: string | null;
  is_canonical: boolean;
  surface_quality: string | null;
  quality_reason: string | null;
  has_email: boolean;
  has_phone: boolean;
  cat_count: number;
  place_count: number;
  cat_names: string | null;
  primary_place: string | null;
  created_at: string;
}

interface PeopleResponse {
  people: Person[];
  total: number;
  limit: number;
  offset: number;
}

const FILTER_DEFAULTS = {
  q: "",
  deep: "",
  page: "0",
};

function PeoplePageContent() {
  const { filters, setFilter, setFilters, clearFilters, isDefault } = useUrlFilters(FILTER_DEFAULTS);
  const isMobile = useIsMobile();

  const [data, setData] = useState<PeopleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const limit = 25;

  const page = parseInt(filters.page, 10) || 0;

  const fetchPeople = useCallback(async () => {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (filters.q) params.set("q", filters.q);
    if (filters.deep === "true") params.set("deep_search", "true");
    params.set("limit", String(limit));
    params.set("offset", String(page * limit));

    try {
      const response = await fetch(`/api/people?${params.toString()}`);
      if (!response.ok) throw new Error("Failed to fetch people");
      const result = await response.json();
      if (result.success) {
        setData({
          people: result.data.people || [],
          total: result.meta?.total || 0,
          limit: result.meta?.limit || limit,
          offset: result.meta?.offset || 0,
        });
      } else {
        throw new Error(result.error?.message || "Failed to fetch people");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [filters.q, filters.deep, page]);

  useEffect(() => {
    fetchPeople();
  }, [fetchPeople]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setFilter("page", "0");
  };

  const totalPages = data ? Math.ceil(data.total / limit) : 0;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <h1 style={{ margin: 0 }}>People</h1>
        {!isDefault && (
          <button
            onClick={clearFilters}
            style={{ fontSize: "0.875rem", background: "none", border: "1px solid var(--border)", borderRadius: "4px", padding: "0.25rem 0.75rem", cursor: "pointer" }}
          >
            Clear Filters
          </button>
        )}
      </div>

      <form onSubmit={handleSearch} className="filters">
        <input
          type="text"
          placeholder="Search by name..."
          value={filters.q}
          onChange={(e) => setFilters({ q: e.target.value, page: "0" })}
          style={{ minWidth: "250px" }}
        />
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem" }}>
          <input
            type="checkbox"
            checked={filters.deep === "true"}
            onChange={(e) => setFilters({ deep: e.target.checked ? "true" : "", page: "0" })}
          />
          Deep Search
          <span className="text-muted" style={{ fontSize: "0.75rem" }}>(includes all records)</span>
        </label>
        <button type="submit">Search</button>
      </form>

      {loading && <div className="loading">Loading people...</div>}

      {error && <div className="empty" style={{ color: "red" }}>{error}</div>}

      {!loading && !error && data && (
        <>
          <p className="text-muted text-sm mb-4">
            Showing {data.offset + 1}-{Math.min(data.offset + data.people.length, data.total)} of {data.total} people
          </p>

          {isMobile ? (
            /* Mobile card view */
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "0.75rem" }}>
              {data.people.map((person) => (
                <a
                  key={person.person_id}
                  href={`/people/${person.person_id}`}
                  style={{
                    display: "block",
                    textDecoration: "none",
                    color: "inherit",
                    background: "var(--card-bg)",
                    border: "1px solid var(--border)",
                    borderRadius: "8px",
                    padding: "0.75rem",
                    opacity: person.surface_quality === "Low" ? 0.7 : 1,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>{person.display_name}</div>
                    {person.surface_quality === "High" ? (
                      <span className="badge badge-primary" style={{ fontSize: "0.7em" }}>High</span>
                    ) : person.surface_quality === "Medium" ? (
                      <span className="badge" style={{ fontSize: "0.7em", background: "#ffc107", color: "#000" }}>Med</span>
                    ) : (
                      <span className="badge" style={{ fontSize: "0.7em", background: "#dc3545" }}>Low</span>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem", fontSize: "0.85rem", color: "var(--text-muted)" }}>
                    <span>
                      {person.has_email && "Email"}{person.has_email && person.has_phone && " / "}{person.has_phone && "Phone"}
                      {!person.has_email && !person.has_phone && "No contact"}
                    </span>
                    <span>{person.cat_count} cats</span>
                    <span>{person.place_count} places</span>
                  </div>
                  {person.primary_place && (
                    <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>{person.primary_place}</div>
                  )}
                </a>
              ))}
            </div>
          ) : (
            /* Desktop table view */
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Confidence</th>
                    <th>Contact</th>
                    <th>Cats</th>
                    <th>Places</th>
                  </tr>
                </thead>
                <tbody>
                  {data.people.map((person) => (
                    <tr key={person.person_id} style={person.surface_quality === "Low" ? { opacity: 0.7 } : {}}>
                      <td>
                        <a href={`/people/${person.person_id}`}>{person.display_name}</a>
                        {person.account_type && person.account_type !== "person" && (
                          <span className="badge" style={{ marginLeft: "0.5rem", fontSize: "0.7em", background: "#6c757d" }}>
                            {person.account_type}
                          </span>
                        )}
                        {person.is_canonical === false && (
                          <span
                            className="badge"
                            style={{ marginLeft: "0.5rem", fontSize: "0.7em", background: "#dc3545" }}
                            title="Non-canonical record (organization, placeholder, or garbage name)"
                          >
                            Non-canonical
                          </span>
                        )}
                      </td>
                      <td>
                        {person.surface_quality === "High" ? (
                          <span className="badge badge-primary" title={person.quality_reason || undefined}>High</span>
                        ) : person.surface_quality === "Medium" ? (
                          <span className="badge" title={person.quality_reason || undefined} style={{ background: "#ffc107", color: "#000" }}>Medium</span>
                        ) : (
                          <span className="badge" title={person.quality_reason || undefined} style={{ background: "#dc3545" }}>Low</span>
                        )}
                      </td>
                      <td>
                        {person.has_email && person.has_phone ? (
                          <span title="Has email and phone">Email / Phone</span>
                        ) : person.has_email ? (
                          <span title="Has email">Email</span>
                        ) : person.has_phone ? (
                          <span title="Has phone">Phone</span>
                        ) : (
                          <span className="text-muted">&mdash;</span>
                        )}
                      </td>
                      <td>
                        {person.cat_count > 0 ? (
                          <span title={person.cat_names || ""}>{person.cat_count}</span>
                        ) : (
                          <span className="text-muted">0</span>
                        )}
                      </td>
                      <td>
                        {person.place_count > 0 ? <span>{person.place_count}</span> : <span className="text-muted">0</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {totalPages > 1 && (
            <div className="pagination">
              <button
                onClick={() => setFilter("page", String(Math.max(0, page - 1)))}
                disabled={page === 0}
              >
                Previous
              </button>
              <span className="pagination-info">Page {page + 1} of {totalPages}</span>
              <button
                onClick={() => setFilter("page", String(Math.min(totalPages - 1, page + 1)))}
                disabled={page >= totalPages - 1}
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

export default function PeoplePage() {
  return (
    <Suspense fallback={<div className="loading">Loading people...</div>}>
      <PeoplePageContent />
    </Suspense>
  );
}
