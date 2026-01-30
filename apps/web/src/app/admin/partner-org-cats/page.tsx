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
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold">Partner Org Cats</h1>
          <p className="text-gray-600">
            View cats that came from partner organizations (SCAS, Rohnert Park, etc.)
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/admin/partner-orgs"
            className="text-blue-600 hover:text-blue-800"
          >
            Manage Orgs
          </Link>
          <span className="text-gray-400">|</span>
          <BackButton fallbackHref="/admin" />
        </div>
      </div>

      {/* Summary Cards */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-500">Partner Orgs</div>
            <div className="text-2xl font-bold">{data.organizations.length}</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-500">Total Cats</div>
            <div className="text-2xl font-bold text-blue-600">{totalCats.toLocaleString()}</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-500">Total Appointments</div>
            <div className="text-2xl font-bold text-green-600">{totalAppointments.toLocaleString()}</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-500">Filtered Results</div>
            <div className="text-2xl font-bold text-purple-600">{data.total.toLocaleString()}</div>
          </div>
        </div>
      )}

      {/* Org Breakdown */}
      {data && data.organizations.length > 0 && (
        <div className="bg-white rounded-lg shadow mb-6 p-4">
          <h2 className="font-semibold mb-3">Cats by Organization</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {data.organizations.map(org => (
              <button
                key={org.org_id}
                onClick={() => {
                  setSelectedOrg(selectedOrg === org.org_id ? "" : org.org_id);
                  setPage(0);
                }}
                className={`p-3 rounded-lg border text-left transition-colors ${
                  selectedOrg === org.org_id
                    ? "border-blue-500 bg-blue-50"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <div className="font-medium">
                  {org.org_name_short || org.org_name}
                </div>
                <div className="text-sm text-gray-500">
                  {org.cat_count} cats / {org.appointment_count} appts
                </div>
                {org.last_date && (
                  <div className="text-xs text-gray-400">
                    Last: {formatDateLocal(org.last_date)}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-lg shadow mb-6 p-4">
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Organization
            </label>
            <select
              value={selectedOrg}
              onChange={(e) => { setSelectedOrg(e.target.value); setPage(0); }}
              className="border rounded px-3 py-2 min-w-[200px]"
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
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Start Date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => { setStartDate(e.target.value); setPage(0); }}
              className="border rounded px-3 py-2"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              End Date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => { setEndDate(e.target.value); setPage(0); }}
              className="border rounded px-3 py-2"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Altered Status
            </label>
            <select
              value={alteredStatus}
              onChange={(e) => { setAlteredStatus(e.target.value); setPage(0); }}
              className="border rounded px-3 py-2"
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
            className="px-4 py-2 border rounded hover:bg-gray-50"
          >
            Reset
          </button>

          <button
            onClick={handleExport}
            disabled={exporting}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
          >
            {exporting ? "Exporting..." : "Export CSV"}
          </button>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg mb-6">
          {error}
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="text-center py-8">Loading...</div>
      )}

      {/* Cats Table */}
      {!loading && !error && data && (
        <>
          <p className="text-sm text-gray-500 mb-2">
            Showing {data.offset + 1}-{Math.min(data.offset + data.cats.length, data.total)} of {data.total} results
          </p>

          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Cat
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Microchip
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Sex / Altered
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Appointment
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Origin Address
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Partner Org
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {data.cats.map((cat, idx) => (
                  <tr key={`${cat.cat_id}-${cat.appointment_date}-${idx}`} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/cats/${cat.cat_id}`}
                        className="text-blue-600 hover:text-blue-800 font-medium"
                      >
                        {cat.display_name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-sm font-mono text-gray-600">
                      {cat.microchip || <span className="text-gray-400">-</span>}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <div>{cat.sex || "-"}</div>
                      <div className="text-gray-500">{cat.altered_status || "-"}</div>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <div>{formatDateLocal(cat.appointment_date)}</div>
                      {cat.service_type && (
                        <div className="text-gray-500 text-xs">{cat.service_type}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {cat.origin_address ? (
                        cat.origin_place_id ? (
                          <Link
                            href={`/places/${cat.origin_place_id}`}
                            className="text-blue-600 hover:text-blue-800"
                          >
                            {cat.origin_address}
                          </Link>
                        ) : (
                          cat.origin_address
                        )
                      ) : (
                        <span className="text-gray-400">Unknown</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
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
            <div className="flex justify-center items-center gap-4 mt-4">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-4 py-2 border rounded hover:bg-gray-50 disabled:opacity-50"
              >
                Previous
              </button>
              <span className="text-sm text-gray-600">
                Page {page + 1} of {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="px-4 py-2 border rounded hover:bg-gray-50 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}

      {/* Empty State */}
      {!loading && !error && data && data.cats.length === 0 && (
        <div className="text-center py-12 bg-white rounded-lg shadow">
          <p className="text-gray-500">No cats found matching your filters.</p>
          <button
            onClick={resetFilters}
            className="mt-4 text-blue-600 hover:text-blue-800"
          >
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}
