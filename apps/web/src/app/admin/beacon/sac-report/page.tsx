"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { StatCard } from "@/components/ui/StatCard";
import { SkeletonStats, SkeletonTable } from "@/components/feedback/Skeleton";
import { fetchApi } from "@/lib/api-client";

interface SacData {
  total_intakes: number;
  total_cats: number;
  by_intake_type: Array<{ type: string; label: string; count: number; cats: number }>;
  by_outcome_type: Array<{ type: string; label: string; count: number }>;
  by_quarter: Array<{ year: number; quarter: number; intakes: number; cats: number }>;
  by_county: Array<{ county: string; count: number }>;
  available_years: number[];
}

export default function SacReportPage() {
  const [data, setData] = useState<SacData | null>(null);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState<string>("");
  const [quarter, setQuarter] = useState<string>("");
  const [exporting, setExporting] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (year) params.set("year", year);
      if (quarter) params.set("quarter", quarter);
      const result = await fetchApi<SacData>(
        `/api/admin/beacon/sac-report?${params.toString()}`
      );
      setData(result);
    } catch {
      // Silently handle
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [year, quarter]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (year) params.set("year", year);
      if (quarter) params.set("quarter", quarter);
      params.set("format", "csv");
      const res = await fetch(`/api/admin/beacon/sac-report?${params.toString()}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sac-report-${year || "all"}-Q${quarter || "all"}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ margin: "0 0 0.25rem" }}>SAC Report</h1>
          <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--muted)" }}>
            Shelter Animals Count reporting — grant-ready data export
          </p>
        </div>
        <Button
          variant="primary"
          icon="download"
          loading={exporting}
          onClick={handleExport}
        >
          Export CSV
        </Button>
      </div>

      {/* Filters */}
      <div style={{
        display: "flex",
        gap: "0.75rem",
        marginBottom: "1.5rem",
        padding: "0.75rem 1rem",
        background: "var(--surface-raised, var(--card-bg))",
        borderRadius: "8px",
        border: "1px solid var(--card-border)",
        alignItems: "center",
      }}>
        <label style={{ fontSize: "0.85rem", fontWeight: 600 }}>Filter:</label>
        <select
          value={year}
          onChange={(e) => setYear(e.target.value)}
          style={{
            padding: "0.4rem 0.75rem",
            borderRadius: "6px",
            border: "1px solid var(--card-border)",
            fontSize: "0.85rem",
            background: "var(--background)",
          }}
        >
          <option value="">All Years</option>
          {(data?.available_years || []).map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <select
          value={quarter}
          onChange={(e) => setQuarter(e.target.value)}
          style={{
            padding: "0.4rem 0.75rem",
            borderRadius: "6px",
            border: "1px solid var(--card-border)",
            fontSize: "0.85rem",
            background: "var(--background)",
          }}
        >
          <option value="">All Quarters</option>
          <option value="1">Q1 (Jan-Mar)</option>
          <option value="2">Q2 (Apr-Jun)</option>
          <option value="3">Q3 (Jul-Sep)</option>
          <option value="4">Q4 (Oct-Dec)</option>
        </select>
        {(year || quarter) && (
          <button
            onClick={() => { setYear(""); setQuarter(""); }}
            style={{
              padding: "0.4rem 0.75rem",
              borderRadius: "6px",
              border: "none",
              background: "transparent",
              color: "var(--primary, #3b82f6)",
              fontSize: "0.85rem",
              cursor: "pointer",
              fontWeight: 500,
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {loading ? (
        <SkeletonStats count={4} />
      ) : data ? (
        <>
          {/* Summary Stats */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.75rem", marginBottom: "2rem" }}>
            <StatCard label="Total Intakes" value={data.total_intakes} accentColor="var(--primary, #3b82f6)" />
            <StatCard label="Total Cats" value={data.total_cats} accentColor="#10b981" />
            <StatCard label="Counties" value={data.by_county.length} accentColor="#8b5cf6" />
            <StatCard label="Quarters Covered" value={data.by_quarter.length} accentColor="#f59e0b" />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem", marginBottom: "2rem" }}>
            {/* Intake Types */}
            <div>
              <h3 style={{ fontSize: "0.9rem", fontWeight: 700, margin: "0 0 0.75rem", color: "var(--text-secondary)" }}>
                SAC INTAKE TYPES
              </h3>
              <div style={{ background: "var(--surface-raised, var(--card-bg))", borderRadius: "8px", border: "1px solid var(--card-border)", overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "var(--bg-secondary, #f9fafb)" }}>
                      <th style={{ padding: "0.5rem 0.75rem", textAlign: "left", fontSize: "0.8rem", borderBottom: "1px solid var(--card-border)" }}>Type</th>
                      <th style={{ padding: "0.5rem 0.75rem", textAlign: "right", fontSize: "0.8rem", borderBottom: "1px solid var(--card-border)" }}>Count</th>
                      <th style={{ padding: "0.5rem 0.75rem", textAlign: "right", fontSize: "0.8rem", borderBottom: "1px solid var(--card-border)" }}>Cats</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.by_intake_type.map((row) => (
                      <tr key={row.type}>
                        <td style={{ padding: "0.5rem 0.75rem", fontSize: "0.85rem", borderBottom: "1px solid var(--card-border)" }}>
                          {row.label}
                        </td>
                        <td style={{ padding: "0.5rem 0.75rem", textAlign: "right", fontSize: "0.85rem", borderBottom: "1px solid var(--card-border)", fontWeight: 600 }}>
                          {row.count.toLocaleString()}
                        </td>
                        <td style={{ padding: "0.5rem 0.75rem", textAlign: "right", fontSize: "0.85rem", borderBottom: "1px solid var(--card-border)", color: "var(--muted)" }}>
                          {row.cats.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Outcome Types */}
            <div>
              <h3 style={{ fontSize: "0.9rem", fontWeight: 700, margin: "0 0 0.75rem", color: "var(--text-secondary)" }}>
                SAC OUTCOME TYPES
              </h3>
              <div style={{ background: "var(--surface-raised, var(--card-bg))", borderRadius: "8px", border: "1px solid var(--card-border)", overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "var(--bg-secondary, #f9fafb)" }}>
                      <th style={{ padding: "0.5rem 0.75rem", textAlign: "left", fontSize: "0.8rem", borderBottom: "1px solid var(--card-border)" }}>Outcome</th>
                      <th style={{ padding: "0.5rem 0.75rem", textAlign: "right", fontSize: "0.8rem", borderBottom: "1px solid var(--card-border)" }}>Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.by_outcome_type.map((row) => (
                      <tr key={row.type}>
                        <td style={{ padding: "0.5rem 0.75rem", fontSize: "0.85rem", borderBottom: "1px solid var(--card-border)" }}>
                          {row.label}
                        </td>
                        <td style={{ padding: "0.5rem 0.75rem", textAlign: "right", fontSize: "0.85rem", borderBottom: "1px solid var(--card-border)", fontWeight: 600 }}>
                          {row.count.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Quarterly Breakdown */}
          <h3 style={{ fontSize: "0.9rem", fontWeight: 700, margin: "0 0 0.75rem", color: "var(--text-secondary)" }}>
            QUARTERLY BREAKDOWN
          </h3>
          <div style={{ background: "var(--surface-raised, var(--card-bg))", borderRadius: "8px", border: "1px solid var(--card-border)", overflow: "hidden", marginBottom: "2rem" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--bg-secondary, #f9fafb)" }}>
                  <th style={{ padding: "0.5rem 0.75rem", textAlign: "left", fontSize: "0.8rem", borderBottom: "1px solid var(--card-border)" }}>Period</th>
                  <th style={{ padding: "0.5rem 0.75rem", textAlign: "right", fontSize: "0.8rem", borderBottom: "1px solid var(--card-border)" }}>Intakes</th>
                  <th style={{ padding: "0.5rem 0.75rem", textAlign: "right", fontSize: "0.8rem", borderBottom: "1px solid var(--card-border)" }}>Cats</th>
                </tr>
              </thead>
              <tbody>
                {data.by_quarter.map((row) => (
                  <tr key={`${row.year}-Q${row.quarter}`}>
                    <td style={{ padding: "0.5rem 0.75rem", fontSize: "0.85rem", borderBottom: "1px solid var(--card-border)", fontWeight: 500 }}>
                      {row.year} Q{row.quarter}
                    </td>
                    <td style={{ padding: "0.5rem 0.75rem", textAlign: "right", fontSize: "0.85rem", borderBottom: "1px solid var(--card-border)", fontWeight: 600 }}>
                      {row.intakes.toLocaleString()}
                    </td>
                    <td style={{ padding: "0.5rem 0.75rem", textAlign: "right", fontSize: "0.85rem", borderBottom: "1px solid var(--card-border)", color: "var(--muted)" }}>
                      {row.cats.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* County Breakdown */}
          <h3 style={{ fontSize: "0.9rem", fontWeight: 700, margin: "0 0 0.75rem", color: "var(--text-secondary)" }}>
            BY COUNTY
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.5rem" }}>
            {data.by_county.map((row) => (
              <StatCard
                key={row.county}
                label={row.county}
                value={row.count}
                accentColor={row.county === "Sonoma" ? "var(--primary, #3b82f6)" : undefined}
              />
            ))}
          </div>
        </>
      ) : (
        <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
          No SAC report data available
        </div>
      )}
    </div>
  );
}
