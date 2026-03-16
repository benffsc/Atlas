"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useUrlFilters } from "@/hooks/useUrlFilters";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useEntityDetail } from "@/hooks/useEntityDetail";
import { fetchApiWithMeta, ApiError } from "@/lib/api-client";
import { formatPlaceKind } from "@/lib/display-labels";
import { formatRelativeTime } from "@/lib/formatters";
import { PlaceRiskBadges } from "@/components/badges";
import type { DiseaseFlag } from "@/components/badges/PlaceRiskBadges";
import type { PlaceDetail } from "@/hooks/useEntityDetail";
import EntityPreview from "@/components/search/EntityPreview";
import { ListDetailLayout } from "@/components/layouts/ListDetailLayout";
import { PlacePreviewContent } from "@/components/preview/PlacePreviewContent";

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
  last_appointment_date: string | null;
  active_request_count: number;
  watch_list?: boolean;
  disease_flags?: DiseaseFlag[];
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
  mobile_home_space: "#795548",
};

const FILTER_DEFAULTS = {
  q: "",
  kind: "",
  has_cats: "",
  disease_risk: "",
  watch_list: "",
  page: "0",
  selected: "",
};

function PlacesPageContent() {
  const { filters, setFilter, setFilters, clearFilters, isDefault } = useUrlFilters(FILTER_DEFAULTS);
  const isMobile = useIsMobile();

  const [data, setData] = useState<PlacesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const limit = 25;

  const page = parseInt(filters.page, 10) || 0;

  // Panel preview
  const { detail: selectedDetail, loading: detailLoading } = useEntityDetail(
    filters.selected ? "place" : null,
    filters.selected || null,
  );

  const fetchPlaces = useCallback(async () => {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (filters.q) params.set("q", filters.q);
    if (filters.kind) params.set("place_kind", filters.kind);
    if (filters.has_cats) params.set("has_cats", filters.has_cats);
    if (filters.disease_risk) params.set("disease_risk", filters.disease_risk);
    if (filters.watch_list) params.set("watch_list", filters.watch_list);
    params.set("limit", String(limit));
    params.set("offset", String(page * limit));

    try {
      const result = await fetchApiWithMeta<{ places: Place[] }>(`/api/places?${params.toString()}`);
      setData({
        places: result.data.places || [],
        total: result.meta?.total || 0,
        limit: result.meta?.limit || limit,
        offset: result.meta?.offset || 0,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [filters.q, filters.kind, filters.has_cats, filters.disease_risk, filters.watch_list, page]);

  useEffect(() => {
    fetchPlaces();
  }, [fetchPlaces]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setFilter("page", "0");
  };

  const handleRowClick = (placeId: string) => {
    setFilter("selected", filters.selected === placeId ? "" : placeId);
  };

  const totalPages = data ? Math.ceil(data.total / limit) : 0;

  const panelContent = filters.selected && selectedDetail && !detailLoading ? (
    <PlacePreviewContent
      place={selectedDetail as PlaceDetail}
      onClose={() => setFilter("selected", "")}
    />
  ) : filters.selected && detailLoading ? (
    <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>Loading...</div>
  ) : null;

  return (
    <ListDetailLayout
      isDetailOpen={!!filters.selected}
      detailPanel={panelContent}
      onDetailClose={() => setFilter("selected", "")}
    >
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
        <select value={filters.disease_risk} onChange={(e) => setFilters({ disease_risk: e.target.value, page: "0" })}>
          <option value="">All risk levels</option>
          <option value="felv">FeLV risk</option>
          <option value="fiv">FIV risk</option>
        </select>
        <select value={filters.watch_list} onChange={(e) => setFilters({ watch_list: e.target.value, page: "0" })}>
          <option value="">All watch status</option>
          <option value="true">On watch list</option>
          <option value="false">Not on watch list</option>
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
                        {formatPlaceKind(place.place_kind)}
                      </span>
                    )}
                  </div>
                  {(place.disease_flags?.length || place.watch_list || place.active_request_count > 0) ? (
                    <div style={{ marginTop: "4px" }}>
                      <PlaceRiskBadges
                        diseaseFlags={place.disease_flags}
                        watchList={place.watch_list}
                        activeRequestCount={place.active_request_count}
                      />
                    </div>
                  ) : null}
                  {place.formatted_address && (
                    <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                      {place.formatted_address}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem", fontSize: "0.85rem", color: "var(--text-muted)", flexWrap: "wrap" }}>
                    <span>{place.cat_count} cats</span>
                    <span>{place.person_count} people</span>
                    {place.locality && <span>{place.locality}</span>}
                    {place.last_appointment_date && (
                      <span>Last: {formatRelativeTime(place.last_appointment_date)}</span>
                    )}
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
                    <th>Last Active</th>
                  </tr>
                </thead>
                <tbody>
                  {data.places.map((place) => (
                    <tr
                      key={place.place_id}
                      style={{
                        cursor: "pointer",
                        background: filters.selected === place.place_id ? "var(--section-bg, #f9fafb)" : undefined,
                      }}
                      onClick={() => handleRowClick(place.place_id)}
                    >
                      <td>
                        <EntityPreview entityType="place" entityId={place.place_id}>
                          <a href={`/places/${place.place_id}`} onClick={(e) => e.stopPropagation()}>{place.display_name}</a>
                        </EntityPreview>
                        {(place.disease_flags?.length || place.watch_list) ? (
                          <div style={{ marginTop: "2px" }}>
                            <PlaceRiskBadges
                              diseaseFlags={place.disease_flags}
                              watchList={place.watch_list}
                            />
                          </div>
                        ) : null}
                      </td>
                      <td>
                        {place.formatted_address || <span className="text-muted">&mdash;</span>}
                        {place.locality && <div className="text-sm text-muted">{place.locality}</div>}
                      </td>
                      <td>
                        {place.place_kind ? (
                          <span className="badge" style={{ background: KIND_COLORS[place.place_kind] || "#6c757d" }}>
                            {formatPlaceKind(place.place_kind)}
                          </span>
                        ) : (
                          <span className="text-muted">&mdash;</span>
                        )}
                      </td>
                      <td>{place.cat_count > 0 ? <span>{place.cat_count}</span> : <span className="text-muted">0</span>}</td>
                      <td>{place.person_count > 0 ? <span>{place.person_count}</span> : <span className="text-muted">0</span>}</td>
                      <td>
                        {place.last_appointment_date ? (
                          <span title={place.last_appointment_date}>
                            {formatRelativeTime(place.last_appointment_date)}
                          </span>
                        ) : (
                          <span className="text-muted">&mdash;</span>
                        )}
                        {place.active_request_count > 0 && (
                          <span className="badge" style={{ marginLeft: "0.5rem", fontSize: "0.65em", background: "var(--warning-bg)", color: "var(--warning-text)" }}>
                            {place.active_request_count} req
                          </span>
                        )}
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
    </ListDetailLayout>
  );
}

export default function PlacesPage() {
  return (
    <Suspense fallback={<div className="loading">Loading places...</div>}>
      <PlacesPageContent />
    </Suspense>
  );
}
