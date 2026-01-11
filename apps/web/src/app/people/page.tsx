"use client";

import { useState, useEffect, useCallback } from "react";

interface Person {
  person_id: string;
  display_name: string;
  account_type: string | null;
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

export default function PeoplePage() {
  const [data, setData] = useState<PeopleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [includeLow, setIncludeLow] = useState(false);
  const [includeNonPerson, setIncludeNonPerson] = useState(false);
  const [page, setPage] = useState(0);
  const limit = 25;

  const fetchPeople = useCallback(async () => {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (includeLow) params.set("include_low", "true");
    if (includeNonPerson) params.set("include_non_person", "true");
    params.set("limit", String(limit));
    params.set("offset", String(page * limit));

    try {
      const response = await fetch(`/api/people?${params.toString()}`);
      if (!response.ok) {
        throw new Error("Failed to fetch people");
      }
      const result: PeopleResponse = await response.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [search, includeLow, includeNonPerson, page]);

  useEffect(() => {
    fetchPeople();
  }, [fetchPeople]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(0);
    fetchPeople();
  };

  const totalPages = data ? Math.ceil(data.total / limit) : 0;

  return (
    <div>
      <h1 style={{ marginBottom: "1.5rem" }}>People</h1>

      <form onSubmit={handleSearch} className="filters">
        <input
          type="text"
          placeholder="Search by name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: "250px" }}
        />
        <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.875rem" }}>
          <input
            type="checkbox"
            checked={includeLow}
            onChange={(e) => { setIncludeLow(e.target.checked); setPage(0); }}
          />
          Include low-confidence
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.875rem" }}>
          <input
            type="checkbox"
            checked={includeNonPerson}
            onChange={(e) => { setIncludeNonPerson(e.target.checked); setPage(0); }}
          />
          Include organizations
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
                  <tr key={person.person_id} style={person.surface_quality === 'Low' ? { opacity: 0.7 } : {}}>
                    <td>
                      <a href={`/people/${person.person_id}`}>{person.display_name}</a>
                      {person.account_type && person.account_type !== 'person' && (
                        <span
                          className="badge"
                          style={{ marginLeft: "0.5rem", fontSize: "0.7em", background: "#6c757d" }}
                        >
                          {person.account_type}
                        </span>
                      )}
                    </td>
                    <td>
                      {person.surface_quality === 'High' ? (
                        <span className="badge badge-primary" title={person.quality_reason || undefined}>High</span>
                      ) : person.surface_quality === 'Medium' ? (
                        <span className="badge" title={person.quality_reason || undefined} style={{ background: '#ffc107', color: '#000' }}>Medium</span>
                      ) : (
                        <span className="badge" title={person.quality_reason || undefined} style={{ background: '#dc3545' }}>Low</span>
                      )}
                    </td>
                    <td>
                      {person.has_email && person.has_phone ? (
                        <span title="Has email and phone">📧📱</span>
                      ) : person.has_email ? (
                        <span title="Has email">📧</span>
                      ) : person.has_phone ? (
                        <span title="Has phone">📱</span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td>
                      {person.cat_count > 0 ? (
                        <span title={person.cat_names || ""}>
                          {person.cat_count}
                        </span>
                      ) : (
                        <span className="text-muted">0</span>
                      )}
                    </td>
                    <td>
                      {person.place_count > 0 ? (
                        <span>{person.place_count}</span>
                      ) : (
                        <span className="text-muted">0</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="pagination">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
              >
                Previous
              </button>
              <span className="pagination-info">
                Page {page + 1} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
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
