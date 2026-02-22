"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useUrlFilters } from "@/hooks/useUrlFilters";
import { useIsMobile } from "@/hooks/useIsMobile";

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

const KIND_COLORS: Record<string, string> = {
  residential_house: "#198754",
  apartment_unit: "#0d6efd",
  apartment_building: "#6610f2",
  business: "#fd7e14",
  clinic: "#dc3545",
  outdoor_site: "#20c997",
  neighborhood: "#6c757d",
};

const FILTER_DEFAULTS = {
  q: "",
  kind: "",
  has_cats: "",
  page: "0",
};

function PlacesPageContent() {
  const { filters, setFilter, setFilters, clearFilters, isDefault } = useUrlFilters(FILTER_DEFAULTS);
  const isMobile = useIsMobile();

  const [data, setData] = useState<PlacesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const limit = 25;

  const page = parseInt(filters.page, 10) || 0;

  const fetchPlaces = useCallback(async () => {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (filters.q) params.set("q", filters.q);
    if (filters.kind) params.set("place_kind", filters.kind);
    if (filters.has_cats) params.set("has_cats", filters.has_cats);
    params.set("limit", String(limit));
    params.set("offset", String(page * limit));

    try {
      const response = await fetch(`/api/places?${params.toString()}`);
      if (!response.ok) throw new Error("Failed to fetch places");
      const result = await response.json();
      if (result.success) {
        setData({
          places: result.data.places || [],
          total: result.meta?.total || 0,
          limit: result.meta?.limit || limit,
          offset: result.meta?.offset || 0,
        });
      } else {
        throw new Error(result.error?.message || "Failed to fetch places");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [filters.q, filters.kind, filters.has_cats, page]);

  useEffect(() => {
    fetchPlaces();
  }, [fetchPlaces]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setFilter("page", "0");
  };

  const totalPages = data ? Math.ceil(data.total / limit) : 0;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <h1 style={{ margin: 0 }}>Places</h1>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {!isDefault && (
            <button
              onClick={clearFilters}
              style={{ fontSize: "0.875rem", background: "none", border: "1px solid var(--border)", borderRadius: "4px", padding: "0.25rem 0.75rem", cursor: "pointer" }}
            >
              Clear Filters
            </button>
          )}
          <a href="/places/new" className="btn btn-primary" style={{ textDecoration: "none" }}>
            + New Place
          </a>
        </div>
      </div>

      <form onSubmit={handleSearch} className="filters">
        <input
          type="text"
          placeholder="Search by address, locality..."
          value={filters.q}
          onChange={(e) => setFilters({ q: e.target.value, page: "0" })}
          style={{ minWidth: "250px" }}
        />
        <select value={filters.kind} onChange={(e) => setFilters({ kind: e.target.value, page: "0" })}>
          <option value="">All types</option>
          <option value="residential_house">Residential House</option>
          <option value="apartment_unit">Apartment Unit</option>
          <option value="apartment_building">Apartment Building</option>
          <option value="business">Business</option>
          <option value="clinic">Clinic</option>
          <option value="outdoor_site">Outdoor Site</option>
          <option value="neighborhood">Neighborhood</option>
        </select>
        <select value={filters.has_cats} onChange={(e) => setFilters({ has_cats: e.target.value, page: "0" })}>
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

          {isMobile ? (
            /* Mobile card view */
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "0.75rem" }}>
              {data.places.map((place) => (
                <a
                  key={place.place_id}
                  href={`/places/${place.place_id}`}
                  style={{
                    display: "block",
                    textDecoration: "none",
                    color: "inherit",
                    background: "var(--card-bg)",
                    border: "1px solid var(--border)",
                    borderRadius: "8px",
                    padding: "0.75rem",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ fontWeight: 600, fontSize: "0.95rem", flex: 1, minWidth: 0 }}>
                      {place.display_name}
                    </div>
                    {place.place_kind && (
                      <span
                        className="badge"
                        style={{
                          fontSize: "0.7em",
                          background: KIND_COLORS[place.place_kind] || "#6c757d",
                          flexShrink: 0,
                          marginLeft: "0.5rem",
                        }}
                      >
                        {place.place_kind.replace(/_/g, " ")}
                      </span>
                    )}
                  </div>
                  {place.formatted_address && (
                    <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                      {place.formatted_address}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem", fontSize: "0.85rem", color: "var(--text-muted)" }}>
                    <span>{place.cat_count} cats</span>
                    <span>{place.person_count} people</span>
                    {place.locality && <span>{place.locality}</span>}
                  </div>
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
                        {place.formatted_address || <span className="text-muted">&mdash;</span>}
                        {place.locality && <div className="text-sm text-muted">{place.locality}</div>}
                      </td>
                      <td>
                        {place.place_kind ? (
                          <span className="badge" style={{ background: KIND_COLORS[place.place_kind] || "#6c757d" }}>
                            {place.place_kind.replace(/_/g, " ")}
                          </span>
                        ) : (
                          <span className="text-muted">&mdash;</span>
                        )}
                      </td>
                      <td>{place.cat_count > 0 ? <span>{place.cat_count}</span> : <span className="text-muted">0</span>}</td>
                      <td>{place.person_count > 0 ? <span>{place.person_count}</span> : <span className="text-muted">0</span>}</td>
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

export default function PlacesPage() {
  return (
    <Suspense fallback={<div className="loading">Loading places...</div>}>
      <PlacesPageContent />
    </Suspense>
  );
}
