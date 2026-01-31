"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { formatDateLocal } from "@/lib/formatters";
import { BackButton } from "@/components/BackButton";

interface PartnerOrgCat {
  cat_id: string;
  display_name: string;
  microchip: string | null;
  sex: string | null;
  altered_status: string | null;
  appointment_date: string;
  service_type: string | null;
  origin_address: string | null;
  origin_place_id: string | null;
  partner_org_id: string;
  partner_org_name: string;
  partner_org_short: string | null;
}

interface OrgSummary {
  org_id: string;
  org_name: string;
  org_name_short: string | null;
  cat_count: number;
  appointment_count: number;
  first_date: string | null;
  last_date: string | null;
}

interface ApiResponse {
  organizations: OrgSummary[];
  cats: PartnerOrgCat[];
  total: number;
  limit: number;
  offset: number;
}

export default function PartnerOrgCatsPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Filters
  const [selectedOrg, setSelectedOrg] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [alteredStatus, setAlteredStatus] = useState("");
  const [page, setPage] = useState(0);
  const limit = 50;

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (selectedOrg) params.set("org_id", selectedOrg);
    if (startDate) params.set("start_date", startDate);
    if (endDate) params.set("end_date", endDate);
    if (alteredStatus) params.set("altered_status", alteredStatus);
    params.set("limit", String(limit));
    params.set("offset", String(page * limit));

    try {
      const response = await fetch(`/api/admin/partner-org-cats?${params.toString()}`);
      if (!response.ok) {
        throw new Error("Failed to fetch data");
      }
      const result: ApiResponse = await response.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [selectedOrg, startDate, endDate, alteredStatus, page]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (selectedOrg) params.set("org_id", selectedOrg);
      if (startDate) params.set("start_date", startDate);
      if (endDate) params.set("end_date", endDate);
      if (alteredStatus) params.set("altered_status", alteredStatus);
      params.set("format", "csv");
      params.set("limit", "10000"); // Export up to 10k rows

      const response = await fetch(`/api/admin/partner-org-cats?${params.toString()}`);
      if (!response.ok) throw new Error("Export failed");

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `partner-org-cats-${new Date().toISOString().split("T")[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert("Export failed: " + (err instanceof Error ? err.message : "Unknown error"));
    } finally {
      setExporting(false);
    }
  };

  const resetFilters = () => {
    setSelectedOrg("");
    setStartDate("");
    setEndDate("");
    setAlteredStatus("");
    setPage(0);
  };

  const totalPages = data ? Math.ceil(data.total / limit) : 0;

  // Calculate totals
  const totalCats = data?.organizations.reduce((sum, org) => sum + Number(org.cat_count), 0) || 0;
  const totalAppointments = data?.organizations.reduce((sum, org) => sum + Number(org.appointment_count), 0) || 0;

  return (
    <div style={{ padding: "1.5rem", maxWidth: "80rem", margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>Partner Org Cats</h1>
          <p style={{ color: "var(--text-muted)", marginTop: "0.25rem" }}>
            View cats that came from partner organizations (SCAS, Rohnert Park, etc.)
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <Link
            href="/admin/partner-orgs"
            style={{ color: "var(--primary)", textDecoration: "none" }}
          >
            Manage Orgs
          </Link>
          <span style={{ color: "var(--text-muted)" }}>|</span>
          <BackButton fallbackHref="/admin" />
        </div>
      </div>

      {/* Summary Cards */}
      {data && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
          <div style={{ background: "var(--card-bg)", padding: "1rem", borderRadius: "8px", border: "1px solid var(--border)" }}>
            <div style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>Partner Orgs</div>
            <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{data.organizations.length}</div>
          </div>
          <div style={{ background: "var(--card-bg)", padding: "1rem", borderRadius: "8px", border: "1px solid var(--border)" }}>
            <div style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>Total Cats</div>
            <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#0d6efd" }}>{totalCats.toLocaleString()}</div>
          </div>
          <div style={{ background: "var(--card-bg)", padding: "1rem", borderRadius: "8px", border: "1px solid var(--border)" }}>
            <div style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>Total Appointments</div>
            <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#198754" }}>{totalAppointments.toLocaleString()}</div>
          </div>
          <div style={{ background: "var(--card-bg)", padding: "1rem", borderRadius: "8px", border: "1px solid var(--border)" }}>
            <div style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>Filtered Results</div>
            <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#6f42c1" }}>{data.total.toLocaleString()}</div>
          </div>
        </div>
      )}

      {/* Org Breakdown */}
      {data && data.organizations.length > 0 && (
        <div style={{ background: "var(--card-bg)", borderRadius: "8px", border: "1px solid var(--border)", marginBottom: "1.5rem", padding: "1rem" }}>
          <h2 style={{ fontWeight: 600, marginBottom: "0.75rem" }}>Cats by Organization</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "0.75rem" }}>
            {data.organizations.map(org => (
              <button
                key={org.org_id}
                onClick={() => {
                  setSelectedOrg(selectedOrg === org.org_id ? "" : org.org_id);
                  setPage(0);
                }}
                style={{
                  padding: "0.75rem",
                  borderRadius: "8px",
                  border: selectedOrg === org.org_id ? "2px solid var(--primary)" : "1px solid var(--border)",
                  background: selectedOrg === org.org_id ? "var(--primary-bg, #e8f0fe)" : "var(--card-bg)",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontWeight: 500 }}>
                  {org.org_name_short || org.org_name}
                </div>
                <div style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>
                  {org.cat_count} cats / {org.appointment_count} appts
                </div>
                {org.last_date && (
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    Last: {formatDateLocal(org.last_date)}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ background: "var(--card-bg)", borderRadius: "8px", border: "1px solid var(--border)", marginBottom: "1.5rem", padding: "1rem" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "flex-end" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.875rem", fontWeight: 500, color: "var(--text-muted)", marginBottom: "0.25rem" }}>
              Organization
            </label>
            <select
              value={selectedOrg}
              onChange={(e) => { setSelectedOrg(e.target.value); setPage(0); }}
              style={{ border: "1px solid var(--border)", borderRadius: "4px", padding: "0.5rem 0.75rem", minWidth: "200px" }}
            >
              <option value="">All Organizations</option>
              {data?.organizations.map(org => (
                <option key={org.org_id} value={org.org_id}>
                  {org.org_name_short || org.org_name} ({org.cat_count})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.875rem", fontWeight: 500, color: "var(--text-muted)", marginBottom: "0.25rem" }}>
              Start Date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => { setStartDate(e.target.value); setPage(0); }}
              style={{ border: "1px solid var(--border)", borderRadius: "4px", padding: "0.5rem 0.75rem" }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.875rem", fontWeight: 500, color: "var(--text-muted)", marginBottom: "0.25rem" }}>
              End Date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => { setEndDate(e.target.value); setPage(0); }}
              style={{ border: "1px solid var(--border)", borderRadius: "4px", padding: "0.5rem 0.75rem" }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.875rem", fontWeight: 500, color: "var(--text-muted)", marginBottom: "0.25rem" }}>
              Altered Status
            </label>
            <select
              value={alteredStatus}
              onChange={(e) => { setAlteredStatus(e.target.value); setPage(0); }}
              style={{ border: "1px solid var(--border)", borderRadius: "4px", padding: "0.5rem 0.75rem" }}
            >
              <option value="">All</option>
              <option value="Spayed">Spayed</option>
              <option value="Neutered">Neutered</option>
              <option value="Intact">Intact</option>
              <option value="Unknown">Unknown</option>
            </select>
          </div>

          <button
            onClick={resetFilters}
            style={{ padding: "0.5rem 1rem", border: "1px solid var(--border)", borderRadius: "4px", background: "var(--card-bg)", cursor: "pointer" }}
          >
            Reset
          </button>

          <button
            onClick={handleExport}
            disabled={exporting}
            style={{
              padding: "0.5rem 1rem",
              background: exporting ? "#6c757d" : "#198754",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: exporting ? "not-allowed" : "pointer",
              opacity: exporting ? 0.5 : 1,
            }}
          >
            {exporting ? "Exporting..." : "Export CSV"}
          </button>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#dc3545", padding: "1rem", borderRadius: "8px", marginBottom: "1.5rem" }}>
          {error}
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div style={{ textAlign: "center", padding: "2rem 0" }}>Loading...</div>
      )}

      {/* Cats Table */}
      {!loading && !error && data && (
        <>
          <p style={{ fontSize: "0.875rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
            Showing {data.offset + 1}-{Math.min(data.offset + data.cats.length, data.total)} of {data.total} results
          </p>

          <div style={{ background: "var(--card-bg)", borderRadius: "8px", border: "1px solid var(--border)", overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--table-header-bg, #f8f9fa)" }}>
                  <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontSize: "0.75rem", fontWeight: 500, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Cat
                  </th>
                  <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontSize: "0.75rem", fontWeight: 500, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Microchip
                  </th>
                  <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontSize: "0.75rem", fontWeight: 500, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Sex / Altered
                  </th>
                  <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontSize: "0.75rem", fontWeight: 500, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Appointment
                  </th>
                  <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontSize: "0.75rem", fontWeight: 500, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Origin Address
                  </th>
                  <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontSize: "0.75rem", fontWeight: 500, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Partner Org
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.cats.map((cat, idx) => (
                  <tr key={`${cat.cat_id}-${cat.appointment_date}-${idx}`} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "0.75rem 1rem" }}>
                      <Link
                        href={`/cats/${cat.cat_id}`}
                        style={{ color: "var(--primary)", textDecoration: "none", fontWeight: 500 }}
                      >
                        {cat.display_name}
                      </Link>
                    </td>
                    <td style={{ padding: "0.75rem 1rem", fontSize: "0.875rem", fontFamily: "monospace", color: "var(--text-muted)" }}>
                      {cat.microchip || <span style={{ color: "var(--text-muted)" }}>-</span>}
                    </td>
                    <td style={{ padding: "0.75rem 1rem", fontSize: "0.875rem" }}>
                      <div>{cat.sex || "-"}</div>
                      <div style={{ color: "var(--text-muted)" }}>{cat.altered_status || "-"}</div>
                    </td>
                    <td style={{ padding: "0.75rem 1rem", fontSize: "0.875rem" }}>
                      <div>{formatDateLocal(cat.appointment_date)}</div>
                      {cat.service_type && (
                        <div style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>{cat.service_type}</div>
                      )}
                    </td>
                    <td style={{ padding: "0.75rem 1rem", fontSize: "0.875rem" }}>
                      {cat.origin_address ? (
                        cat.origin_place_id ? (
                          <Link
                            href={`/places/${cat.origin_place_id}`}
                            style={{ color: "var(--primary)", textDecoration: "none" }}
                          >
                            {cat.origin_address}
                          </Link>
                        ) : (
                          cat.origin_address
                        )
                      ) : (
                        <span style={{ color: "var(--text-muted)" }}>Unknown</span>
                      )}
                    </td>
                    <td style={{ padding: "0.75rem 1rem" }}>
                      <span style={{
                        display: "inline-flex",
                        alignItems: "center",
                        padding: "0.125rem 0.625rem",
                        borderRadius: "9999px",
                        fontSize: "0.75rem",
                        fontWeight: 500,
                        background: "#f3e8ff",
                        color: "#6f42c1",
                      }}>
                        {cat.partner_org_short || cat.partner_org_name}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "1rem", marginTop: "1rem" }}>
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                style={{
                  padding: "0.5rem 1rem",
                  border: "1px solid var(--border)",
                  borderRadius: "4px",
                  background: "var(--card-bg)",
                  cursor: page === 0 ? "not-allowed" : "pointer",
                  opacity: page === 0 ? 0.5 : 1,
                }}
              >
                Previous
              </button>
              <span style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>
                Page {page + 1} of {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                style={{
                  padding: "0.5rem 1rem",
                  border: "1px solid var(--border)",
                  borderRadius: "4px",
                  background: "var(--card-bg)",
                  cursor: page >= totalPages - 1 ? "not-allowed" : "pointer",
                  opacity: page >= totalPages - 1 ? 0.5 : 1,
                }}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}

      {/* Empty State */}
      {!loading && !error && data && data.cats.length === 0 && (
        <div style={{ textAlign: "center", padding: "3rem 0", background: "var(--card-bg)", borderRadius: "8px", border: "1px solid var(--border)" }}>
          <p style={{ color: "var(--text-muted)" }}>No cats found matching your filters.</p>
          <button
            onClick={resetFilters}
            style={{ marginTop: "1rem", color: "var(--primary)", background: "none", border: "none", cursor: "pointer" }}
          >
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}
