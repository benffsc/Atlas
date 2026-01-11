"use client";

import { useState, useEffect, useCallback } from "react";

interface Cat {
  cat_id: string;
  display_name: string;
  sex: string | null;
  altered_status: string | null;
  breed: string | null;
  microchip: string | null;
  quality_tier: string;
  quality_reason: string;
  has_microchip: boolean;
  owner_count: number;
  owner_names: string | null;
  primary_place_id: string | null;
  primary_place_label: string | null;
  place_kind: string | null;
  has_place: boolean;
  created_at: string;
}

interface CatsResponse {
  cats: Cat[];
  total: number;
  limit: number;
  offset: number;
}

export default function CatsPage() {
  const [data, setData] = useState<CatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [sex, setSex] = useState("");
  const [alteredStatus, setAlteredStatus] = useState("");
  const [hasPlace, setHasPlace] = useState("");
  const [page, setPage] = useState(0);
  const limit = 25;

  const fetchCats = useCallback(async () => {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (sex) params.set("sex", sex);
    if (alteredStatus) params.set("altered_status", alteredStatus);
    if (hasPlace) params.set("has_place", hasPlace);
    params.set("limit", String(limit));
    params.set("offset", String(page * limit));

    try {
      const response = await fetch(`/api/cats?${params.toString()}`);
      if (!response.ok) {
        throw new Error("Failed to fetch cats");
      }
      const result: CatsResponse = await response.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [search, sex, alteredStatus, hasPlace, page]);

  useEffect(() => {
    fetchCats();
  }, [fetchCats]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(0);
    fetchCats();
  };

  const totalPages = data ? Math.ceil(data.total / limit) : 0;

  return (
    <div>
      <h1 style={{ marginBottom: "1.5rem" }}>Cats</h1>

      <form onSubmit={handleSearch} className="filters">
        <input
          type="text"
          placeholder="Search by name, microchip..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: "250px" }}
        />
        <select value={sex} onChange={(e) => { setSex(e.target.value); setPage(0); }}>
          <option value="">All sexes</option>
          <option value="Male">Male</option>
          <option value="Female">Female</option>
        </select>
        <select value={alteredStatus} onChange={(e) => { setAlteredStatus(e.target.value); setPage(0); }}>
          <option value="">All altered status</option>
          <option value="Spayed">Spayed</option>
          <option value="Neutered">Neutered</option>
          <option value="Intact">Intact</option>
          <option value="Unknown">Unknown</option>
        </select>
        <select value={hasPlace} onChange={(e) => { setHasPlace(e.target.value); setPage(0); }}>
          <option value="">All locations</option>
          <option value="true">Has location</option>
          <option value="false">No location</option>
        </select>
        <button type="submit">Search</button>
      </form>

      {loading && <div className="loading">Loading cats...</div>}

      {error && <div className="empty" style={{ color: "red" }}>{error}</div>}

      {!loading && !error && data && (
        <>
          <p className="text-muted text-sm mb-4">
            Showing {data.offset + 1}-{Math.min(data.offset + data.cats.length, data.total)} of {data.total} cats
          </p>

          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Confidence</th>
                  <th>Sex</th>
                  <th>Altered</th>
                  <th>Breed</th>
                  <th>Microchip</th>
                  <th>Owners</th>
                  <th>Location</th>
                </tr>
              </thead>
              <tbody>
                {data.cats.map((cat) => (
                  <tr key={cat.cat_id} style={cat.quality_tier !== 'A' ? { opacity: 0.8 } : {}}>
                    <td>
                      <a href={`/cats/${cat.cat_id}`}>{cat.display_name}</a>
                    </td>
                    <td>
                      {cat.quality_tier === 'A' ? (
                        <span className="badge badge-primary" title="Has microchip">Verified</span>
                      ) : cat.quality_tier === 'B' ? (
                        <span className="badge" title={cat.quality_reason} style={{ background: '#ffc107', color: '#000' }}>Clinic ID</span>
                      ) : (
                        <span className="badge" title={cat.quality_reason} style={{ background: '#dc3545' }}>Unverified</span>
                      )}
                    </td>
                    <td>{cat.sex || "—"}</td>
                    <td>{cat.altered_status || "—"}</td>
                    <td>{cat.breed || "—"}</td>
                    <td className="text-sm">{cat.microchip || "—"}</td>
                    <td>
                      {cat.owner_count > 0 ? (
                        <span title={cat.owner_names || ""}>
                          {cat.owner_count} owner{cat.owner_count !== 1 ? "s" : ""}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td>
                      {cat.has_place ? (
                        <span className="badge badge-primary">
                          {cat.place_kind || "place"}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
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
