"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { fetchApi } from "@/lib/api-client";
import { useUrlFilters } from "@/hooks/useUrlFilters";
import { formatPhone } from "@/lib/formatters";

interface Foster {
  person_id: string;
  display_name: string;
  role_status: string;
  email: string | null;
  phone: string | null;
  started_at: string | null;
  cats_fostered: number;
  vh_groups: string | null;
  has_agreement: boolean;
}

interface FosterAggregates {
  total_fosters: number;
  active_fosters: number;
  inactive_fosters: number;
  total_cats_fostered: number;
}

const FILTER_DEFAULTS = {
  status: "",
  search: "",
  sort: "display_name",
  view: "table",
  page: "1",
};

function StatCard({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div style={{
      padding: "0.75rem 1rem",
      background: "var(--card-bg, #fff)",
      border: "1px solid var(--border)",
      borderRadius: "8px",
      textAlign: "center",
      minWidth: "120px",
    }}>
      <div style={{ fontSize: "1.5rem", fontWeight: 700, color: color || "var(--text)" }}>{value}</div>
      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{label}</div>
    </div>
  );
}

function ContactInfo({ email, phone }: { email: string | null; phone: string | null }) {
  return (
    <div style={{ fontSize: "0.8rem" }}>
      {phone && (
        <a href={`tel:${phone}`} style={{ color: "var(--primary)", textDecoration: "none", marginRight: "0.5rem" }}>
          {formatPhone(phone)}
        </a>
      )}
      {email && (
        <a href={`mailto:${email}`} style={{ color: "var(--primary)", textDecoration: "none", fontSize: "0.75rem" }}>
          {email}
        </a>
      )}
      {!phone && !email && <span className="text-muted">No contact</span>}
    </div>
  );
}

function FosterCard({ foster }: { foster: Foster }) {
  const isInactive = foster.role_status !== "active";

  return (
    <a
      href={`/fosters/${foster.person_id}`}
      style={{
        display: "block",
        padding: "1rem",
        background: "var(--card-bg, #fff)",
        border: "1px solid var(--border)",
        borderRadius: "8px",
        textDecoration: "none",
        color: "inherit",
        opacity: isInactive ? 0.6 : 1,
        transition: "box-shadow 0.15s",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
        <div style={{ fontWeight: 600 }}>{foster.display_name}</div>
        <span style={{
          padding: "0.125rem 0.5rem",
          borderRadius: "9999px",
          fontSize: "0.7rem",
          fontWeight: 600,
          background: foster.role_status === "active" ? "#dcfce7" : "#f3f4f6",
          color: foster.role_status === "active" ? "#166534" : "#6b7280",
        }}>
          {foster.role_status}
        </span>
      </div>
      <ContactInfo email={foster.email} phone={foster.phone} />
      <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem", fontSize: "0.8rem" }}>
        <span>{foster.cats_fostered} cats</span>
        {foster.vh_groups && (
          <span className="text-muted" style={{ fontSize: "0.75rem" }}>{foster.vh_groups}</span>
        )}
        {foster.has_agreement && (
          <span style={{ color: "#1e40af", fontSize: "0.75rem" }}>Agreement</span>
        )}
      </div>
    </a>
  );
}

function FosterRosterContent() {
  const { filters, setFilter, clearFilters, isDefault } = useUrlFilters(FILTER_DEFAULTS);

  const [fosters, setFosters] = useState<Foster[]>([]);
  const [aggregates, setAggregates] = useState<FosterAggregates | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const pageSize = 50;
  const currentPage = parseInt(filters.page, 10) || 1;
  const offset = (currentPage - 1) * pageSize;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(pageSize));
      params.set("offset", String(offset));
      if (filters.status) params.set("status", filters.status);
      if (filters.search) params.set("search", filters.search);
      if (filters.sort) params.set("sort", filters.sort);

      const data = await fetchApi<{
        fosters: Foster[];
        aggregates: FosterAggregates;
      }>(`/api/fosters?${params.toString()}`);

      setFosters(data.fosters || []);
      setAggregates(data.aggregates || null);
      setHasMore((data.fosters || []).length === pageSize);
    } catch (err) {
      console.error("Failed to fetch fosters:", err);
    } finally {
      setLoading(false);
    }
  }, [filters.status, filters.search, filters.sort, offset]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSearchChange = (value: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setFilter("search", value);
      setFilter("page", "1");
    }, 300);
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "1.5rem" }}>Foster Roster</h1>
          <p className="text-muted" style={{ margin: "0.25rem 0 0 0", fontSize: "0.875rem" }}>
            VolunteerHub-sourced foster parents. {aggregates ? `${aggregates.total_fosters} total.` : ""}
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            onClick={() => setFilter("view", filters.view === "table" ? "cards" : "table")}
            style={{
              padding: "0.375rem 0.75rem",
              fontSize: "0.875rem",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            {filters.view === "table" ? "Card View" : "Table View"}
          </button>
        </div>
      </div>

      {/* Stats */}
      {aggregates && (
        <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
          <StatCard label="Total Fosters" value={aggregates.total_fosters} />
          <StatCard label="Active" value={aggregates.active_fosters} color="#16a34a" />
          <StatCard label="Inactive" value={aggregates.inactive_fosters} color="#6b7280" />
          <StatCard label="Cats Fostered" value={aggregates.total_cats_fostered} color="#7c3aed" />
        </div>
      )}

      {/* Filters */}
      <div style={{
        display: "flex",
        gap: "0.75rem",
        alignItems: "center",
        marginBottom: "1rem",
        flexWrap: "wrap",
      }}>
        <input
          ref={searchRef}
          type="text"
          placeholder="Search by name or email..."
          defaultValue={filters.search}
          onChange={(e) => handleSearchChange(e.target.value)}
          style={{
            padding: "0.5rem 0.75rem",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            fontSize: "0.875rem",
            minWidth: "220px",
          }}
        />
        <select
          value={filters.status}
          onChange={(e) => { setFilter("status", e.target.value); setFilter("page", "1"); }}
          style={{
            padding: "0.5rem 0.75rem",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            fontSize: "0.875rem",
            background: "var(--card-bg, #fff)",
          }}
        >
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <select
          value={filters.sort}
          onChange={(e) => setFilter("sort", e.target.value)}
          style={{
            padding: "0.5rem 0.75rem",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            fontSize: "0.875rem",
            background: "var(--card-bg, #fff)",
          }}
        >
          <option value="display_name">Name</option>
          <option value="cats_fostered">Cats Fostered</option>
          <option value="started_at">Start Date</option>
        </select>
        {!isDefault && (
          <button
            onClick={() => { clearFilters(); if (searchRef.current) searchRef.current.value = ""; }}
            style={{
              padding: "0.375rem 0.75rem",
              fontSize: "0.8rem",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              cursor: "pointer",
              color: "var(--text-muted)",
            }}
          >
            Clear Filters
          </button>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <div className="loading" style={{ padding: "3rem", textAlign: "center" }}>Loading fosters...</div>
      ) : fosters.length === 0 ? (
        <div className="empty" style={{ padding: "3rem", textAlign: "center" }}>
          <p className="text-muted">No fosters found matching your filters.</p>
        </div>
      ) : filters.view === "cards" ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "0.75rem" }}>
          {fosters.map((f) => <FosterCard key={f.person_id} foster={f} />)}
        </div>
      ) : (
        <div className="card" style={{ overflow: "auto" }}>
          <table style={{ width: "100%", fontSize: "0.875rem", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "2px solid var(--border)" }}>
                <th style={{ padding: "0.75rem" }}>Name</th>
                <th style={{ padding: "0.75rem" }}>Contact</th>
                <th style={{ padding: "0.75rem" }}>Status</th>
                <th style={{ padding: "0.75rem" }}>Cats</th>
                <th style={{ padding: "0.75rem" }}>VH Groups</th>
                <th style={{ padding: "0.75rem" }}>Agreement</th>
              </tr>
            </thead>
            <tbody>
              {fosters.map((f) => {
                const isInactive = f.role_status !== "active";
                return (
                  <tr
                    key={f.person_id}
                    style={{
                      borderBottom: "1px solid var(--border)",
                      opacity: isInactive ? 0.6 : 1,
                      background: isInactive ? "#f9fafb" : undefined,
                    }}
                  >
                    <td style={{ padding: "0.75rem" }}>
                      <a href={`/fosters/${f.person_id}`} style={{ color: "var(--primary)", textDecoration: "none", fontWeight: 500 }}>
                        {f.display_name}
                      </a>
                    </td>
                    <td style={{ padding: "0.75rem" }}>
                      <ContactInfo email={f.email} phone={f.phone} />
                    </td>
                    <td style={{ padding: "0.75rem" }}>
                      <span style={{
                        display: "inline-block",
                        padding: "0.125rem 0.5rem",
                        borderRadius: "9999px",
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        background: f.role_status === "active" ? "#dcfce7" : "#f3f4f6",
                        color: f.role_status === "active" ? "#166534" : "#6b7280",
                      }}>
                        {f.role_status}
                      </span>
                    </td>
                    <td style={{ padding: "0.75rem", fontWeight: 500 }}>
                      {f.cats_fostered}
                    </td>
                    <td style={{ padding: "0.75rem" }}>
                      {f.vh_groups ? (
                        <span style={{ fontSize: "0.8rem" }}>{f.vh_groups}</span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td style={{ padding: "0.75rem" }}>
                      {f.has_agreement ? (
                        <span style={{
                          display: "inline-block",
                          padding: "0.125rem 0.5rem",
                          borderRadius: "4px",
                          fontSize: "0.75rem",
                          background: "#dbeafe",
                          color: "#1e40af",
                        }}>
                          On file
                        </span>
                      ) : (
                        <span className="text-muted" style={{ fontSize: "0.8rem" }}>None</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {(currentPage > 1 || hasMore) && (
        <div style={{ display: "flex", justifyContent: "center", gap: "0.5rem", marginTop: "1rem" }}>
          <button
            disabled={currentPage <= 1}
            onClick={() => setFilter("page", String(currentPage - 1))}
            style={{
              padding: "0.375rem 0.75rem",
              fontSize: "0.875rem",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              cursor: currentPage <= 1 ? "not-allowed" : "pointer",
              opacity: currentPage <= 1 ? 0.5 : 1,
            }}
          >
            Previous
          </button>
          <span style={{ padding: "0.375rem 0.75rem", fontSize: "0.875rem", color: "var(--text-muted)" }}>
            Page {currentPage}
          </span>
          <button
            disabled={!hasMore}
            onClick={() => setFilter("page", String(currentPage + 1))}
            style={{
              padding: "0.375rem 0.75rem",
              fontSize: "0.875rem",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              cursor: !hasMore ? "not-allowed" : "pointer",
              opacity: !hasMore ? 0.5 : 1,
            }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

export default function FostersPage() {
  return (
    <Suspense fallback={<div className="loading">Loading...</div>}>
      <FosterRosterContent />
    </Suspense>
  );
}
