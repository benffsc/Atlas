"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { formatDateLocal } from "@/lib/formatters";
import { useUrlFilters } from "@/hooks/useUrlFilters";
import { useIsMobile } from "@/hooks/useIsMobile";

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
  last_appointment_date: string | null;
  appointment_count: number;
}

interface CatsResponse {
  cats: Cat[];
  total: number;
  limit: number;
  offset: number;
}

const FILTER_DEFAULTS = {
  q: "",
  sex: "",
  altered: "",
  has_place: "",
  has_origin: "",
  partner_org: "",
  sort: "quality",
  page: "0",
};

function CatsPageContent() {
  const { filters, setFilter, setFilters, clearFilters, isDefault } = useUrlFilters(FILTER_DEFAULTS);
  const isMobile = useIsMobile();

  const [data, setData] = useState<CatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const limit = 25;

  const page = parseInt(filters.page, 10) || 0;

  const fetchCats = useCallback(async () => {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (filters.q) params.set("q", filters.q);
    if (filters.sex) params.set("sex", filters.sex);
    if (filters.altered) params.set("altered_status", filters.altered);
    if (filters.has_place) params.set("has_place", filters.has_place);
    if (filters.has_origin) params.set("has_origin", filters.has_origin);
    if (filters.partner_org) params.set("partner_org", filters.partner_org);
    if (filters.sort) params.set("sort", filters.sort);
    params.set("limit", String(limit));
    params.set("offset", String(page * limit));

    try {
      const response = await fetch(`/api/cats?${params.toString()}`);
      if (!response.ok) throw new Error("Failed to fetch cats");
      const result = await response.json();
      if (result.success) {
        setData({
          cats: result.data.cats || [],
          total: result.meta?.total || 0,
          limit: result.meta?.limit || limit,
          offset: result.meta?.offset || 0,
        });
      } else {
        throw new Error(result.error?.message || "Failed to fetch cats");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [filters.q, filters.sex, filters.altered, filters.has_place, filters.has_origin, filters.partner_org, filters.sort, page]);

  useEffect(() => {
    fetchCats();
  }, [fetchCats]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setFilter("page", "0");
  };

  const totalPages = data ? Math.ceil(data.total / limit) : 0;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <h1 style={{ margin: 0 }}>Cats</h1>
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
          placeholder="Search by name, microchip..."
          value={filters.q}
          onChange={(e) => setFilters({ q: e.target.value, page: "0" })}
          style={{ minWidth: "250px" }}
        />
        <select value={filters.sex} onChange={(e) => setFilters({ sex: e.target.value, page: "0" })}>
          <option value="">All sexes</option>
          <option value="Male">Male</option>
          <option value="Female">Female</option>
        </select>
        <select value={filters.altered} onChange={(e) => setFilters({ altered: e.target.value, page: "0" })}>
          <option value="">All altered status</option>
          <option value="Spayed">Spayed</option>
          <option value="Neutered">Neutered</option>
          <option value="Intact">Intact</option>
          <option value="Unknown">Unknown</option>
        </select>
        <select value={filters.has_place} onChange={(e) => setFilters({ has_place: e.target.value, page: "0" })}>
          <option value="">All locations</option>
          <option value="true">Has location</option>
          <option value="false">No location</option>
        </select>
        <select value={filters.has_origin} onChange={(e) => setFilters({ has_origin: e.target.value, page: "0" })}>
          <option value="">All origins</option>
          <option value="true">Origin known</option>
          <option value="false">Origin unknown</option>
        </select>
        <select value={filters.partner_org} onChange={(e) => setFilters({ partner_org: e.target.value, page: "0" })}>
          <option value="">All sources</option>
          <option value="SCAS">From SCAS</option>
          <option value="FFSC">FFSC linked</option>
          <option value="RPAS">From Rohnert Park</option>
          <option value="MH">From Marin Humane</option>
        </select>
        <select value={filters.sort} onChange={(e) => setFilters({ sort: e.target.value, page: "0" })}>
          <option value="quality">Sort: Data Quality</option>
          <option value="recent_appointment">Sort: Recent Appointment</option>
          <option value="name">Sort: Name</option>
          <option value="created">Sort: Newest First</option>
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

          {isMobile ? (
            /* Mobile card view */
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "0.75rem" }}>
              {data.cats.map((cat) => (
                <a
                  key={cat.cat_id}
                  href={`/cats/${cat.cat_id}`}
                  style={{
                    display: "block",
                    textDecoration: "none",
                    color: "inherit",
                    background: "var(--card-bg)",
                    border: "1px solid var(--border)",
                    borderRadius: "8px",
                    padding: "0.75rem",
                    opacity: cat.quality_tier !== "A" ? 0.85 : 1,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>{cat.display_name}</div>
                    {cat.quality_tier === "A" ? (
                      <span className="badge badge-primary" style={{ fontSize: "0.7em" }}>Verified</span>
                    ) : cat.quality_tier === "B" ? (
                      <span className="badge" style={{ fontSize: "0.7em", background: "#ffc107", color: "#000" }}>Clinic ID</span>
                    ) : (
                      <span className="badge" style={{ fontSize: "0.7em", background: "#dc3545" }}>Unverified</span>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem", fontSize: "0.85rem", color: "var(--text-muted)" }}>
                    <span>{cat.sex || "Unknown sex"} / {cat.altered_status || "Unknown"}</span>
                  </div>
                  <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.25rem", fontSize: "0.8rem", color: "var(--text-muted)" }}>
                    {cat.microchip && <span style={{ fontFamily: "monospace" }}>{cat.microchip.slice(0, 10)}...</span>}
                    {cat.last_appointment_date && <span>Last appointment: {formatDateLocal(cat.last_appointment_date)}</span>}
                    {cat.has_place && <span>{cat.place_kind || "Has location"}</span>}
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
                    <th>Confidence</th>
                    <th>Sex</th>
                    <th>Altered</th>
                    <th>Microchip</th>
                    <th>Last Appointment</th>
                    <th>Location</th>
                  </tr>
                </thead>
                <tbody>
                  {data.cats.map((cat) => (
                    <tr key={cat.cat_id} style={cat.quality_tier !== "A" ? { opacity: 0.8 } : {}}>
                      <td>
                        <a href={`/cats/${cat.cat_id}`}>{cat.display_name}</a>
                      </td>
                      <td>
                        {cat.quality_tier === "A" ? (
                          <span className="badge badge-primary" title="Has microchip">Verified</span>
                        ) : cat.quality_tier === "B" ? (
                          <span className="badge" title={cat.quality_reason} style={{ background: "#ffc107", color: "#000" }}>Clinic ID</span>
                        ) : (
                          <span className="badge" title={cat.quality_reason} style={{ background: "#dc3545" }}>Unverified</span>
                        )}
                      </td>
                      <td>{cat.sex || "\u2014"}</td>
                      <td>{cat.altered_status || "\u2014"}</td>
                      <td className="text-sm">{cat.microchip || "\u2014"}</td>
                      <td className="text-sm">
                        {cat.last_appointment_date ? (
                          <span title={`${cat.appointment_count} appointment${cat.appointment_count !== 1 ? "s" : ""}`}>
                            {formatDateLocal(cat.last_appointment_date)}
                          </span>
                        ) : (
                          <span className="text-muted">&mdash;</span>
                        )}
                      </td>
                      <td>
                        {cat.has_place ? (
                          <span className="badge badge-primary">{cat.place_kind || "place"}</span>
                        ) : (
                          <span className="text-muted">&mdash;</span>
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
    </div>
  );
}

export default function CatsPage() {
  return (
    <Suspense fallback={<div className="loading">Loading cats...</div>}>
      <CatsPageContent />
    </Suspense>
  );
}
