"use client";

import { useState, useEffect, useCallback } from "react";

interface Place {
  place_id: string;
  display_name: string;
  formatted_address: string | null;
  place_kind: string | null;
  locality: string | null;
  postal_code: string | null;
  cat_count: number;
  person_count: number;
  has_cat_activity: boolean;
  created_at: string;
}

interface PlacesResponse {
  places: Place[];
  total: number;
  limit: number;
  offset: number;
}

export default function PlacesPage() {
  const [data, setData] = useState<PlacesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [placeKind, setPlaceKind] = useState("");
  const [hasCats, setHasCats] = useState("");
  const [page, setPage] = useState(0);
  const limit = 25;

  const fetchPlaces = useCallback(async () => {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (placeKind) params.set("place_kind", placeKind);
    if (hasCats) params.set("has_cats", hasCats);
    params.set("limit", String(limit));
    params.set("offset", String(page * limit));

    try {
      const response = await fetch(`/api/places?${params.toString()}`);
      if (!response.ok) {
        throw new Error("Failed to fetch places");
      }
      const result: PlacesResponse = await response.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [search, placeKind, hasCats, page]);

  useEffect(() => {
    fetchPlaces();
  }, [fetchPlaces]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(0);
    fetchPlaces();
  };

  const totalPages = data ? Math.ceil(data.total / limit) : 0;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <h1 style={{ margin: 0 }}>Places</h1>
        <a href="/places/new" className="btn btn-primary" style={{ textDecoration: "none" }}>
          + New Place
        </a>
      </div>

      <form onSubmit={handleSearch} className="filters">
        <input
          type="text"
          placeholder="Search by address, locality..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: "250px" }}
        />
        <select value={placeKind} onChange={(e) => { setPlaceKind(e.target.value); setPage(0); }}>
          <option value="">All types</option>
          <option value="residential_house">Residential House</option>
          <option value="apartment_unit">Apartment Unit</option>
          <option value="apartment_building">Apartment Building</option>
          <option value="business">Business</option>
          <option value="clinic">Clinic</option>
          <option value="outdoor_site">Outdoor Site</option>
          <option value="neighborhood">Neighborhood</option>
        </select>
        <select value={hasCats} onChange={(e) => { setHasCats(e.target.value); setPage(0); }}>
          <option value="">All places</option>
          <option value="true">Has cats</option>
          <option value="false">No cats</option>
        </select>
        <button type="submit">Search</button>
      </form>

      {loading && <div className="loading">Loading places...</div>}

      {error && <div className="empty" style={{ color: "red" }}>{error}</div>}

      {!loading && !error && data && (
        <>
          <p className="text-muted text-sm mb-4">
            Showing {data.offset + 1}-{Math.min(data.offset + data.places.length, data.total)} of {data.total} places
          </p>

          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Address</th>
                  <th>Type</th>
                  <th>Cats</th>
                  <th>People</th>
                </tr>
              </thead>
              <tbody>
                {data.places.map((place) => (
                  <tr key={place.place_id}>
                    <td>
                      <a href={`/places/${place.place_id}`}>{place.display_name}</a>
                    </td>
                    <td>
                      {place.formatted_address || <span className="text-muted">—</span>}
                      {place.locality && (
                        <div className="text-sm text-muted">{place.locality}</div>
                      )}
                    </td>
                    <td>
                      {place.place_kind ? (
                        <span className="badge badge-primary">{place.place_kind}</span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td>
                      {place.cat_count > 0 ? (
                        <span>{place.cat_count}</span>
                      ) : (
                        <span className="text-muted">0</span>
                      )}
                    </td>
                    <td>
                      {place.person_count > 0 ? (
                        <span>{place.person_count}</span>
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
