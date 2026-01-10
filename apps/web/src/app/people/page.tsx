"use client";

import { useState, useEffect, useCallback } from "react";

interface Person {
  person_id: string;
  display_name: string;
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
  const [page, setPage] = useState(0);
  const limit = 25;

  const fetchPeople = useCallback(async () => {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (search) params.set("q", search);
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
  }, [search, page]);

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
                  <th>Cats</th>
                  <th>Places</th>
                  <th>Primary Place</th>
                </tr>
              </thead>
              <tbody>
                {data.people.map((person) => (
                  <tr key={person.person_id}>
                    <td>
                      <a href={`/people/${person.person_id}`}>{person.display_name}</a>
                    </td>
                    <td>
                      {person.cat_count > 0 ? (
                        <span title={person.cat_names || ""}>
                          {person.cat_count} cat{person.cat_count !== 1 ? "s" : ""}
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
                    <td>{person.primary_place || <span className="text-muted">—</span>}</td>
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
