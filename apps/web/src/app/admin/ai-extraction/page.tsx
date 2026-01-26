"use client";

import { useState, useEffect, useCallback } from "react";

interface SourceProgress {
  total: number;
  classified?: number;
  pending?: number;
  with_notes?: number;
  progress_pct?: number;
  distribution?: Array<{ meaning: string; count: number }>;
}

interface AttributeByType {
  entity_type: string;
  count: string;
  unique_entities: string;
}

interface AttributeDetail {
  entity_type: string;
  attribute_key: string;
  count: string;
  avg_confidence: string;
}

interface RecentJob {
  source_system: string;
  entity_type: string;
  records_processed: number;
  attributes_extracted: number;
  cost_estimate_usd: number;
  model_used: string;
  completed_at: string;
}

interface ExtractionData {
  status: string;
  generated_at: string;
  summary: {
    total_backlog: number;
    total_classified: number;
    total_attributes: number;
    queue_pending: number;
    queue_processing: number;
  };
  sources: {
    google_maps: SourceProgress;
    requests: SourceProgress;
    clinic: SourceProgress;
    intake: SourceProgress;
  };
  attributes: {
    by_type: AttributeByType[];
    details: AttributeDetail[];
  };
  queue: {
    pending: number;
    processing: number;
    completed_24h: number;
    errors_24h: number;
  };
  recent_jobs: RecentJob[];
}

function ProgressBar({ value, max, color = "#3b82f6" }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <div style={{
        flex: 1,
        height: "8px",
        background: "#e5e7eb",
        borderRadius: "4px",
        overflow: "hidden"
      }}>
        <div style={{
          width: `${pct}%`,
          height: "100%",
          background: color,
          transition: "width 0.3s ease"
        }} />
      </div>
      <span style={{ fontSize: "12px", color: "#6b7280", minWidth: "45px" }}>{pct}%</span>
    </div>
  );
}

function StatCard({ label, value, subtitle }: { label: string; value: string | number; subtitle?: string }) {
  return (
    <div style={{
      background: "white",
      border: "1px solid #e5e7eb",
      borderRadius: "8px",
      padding: "16px"
    }}>
      <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "4px" }}>{label}</div>
      <div style={{ fontSize: "24px", fontWeight: 600 }}>{value.toLocaleString()}</div>
      {subtitle && <div style={{ fontSize: "11px", color: "#9ca3af" }}>{subtitle}</div>}
    </div>
  );
}

export default function AIExtractionPage() {
  const [data, setData] = useState<ExtractionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/ai-extraction");
      if (!response.ok) throw new Error("Failed to fetch");
      const json = await response.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    if (autoRefresh) {
      const interval = setInterval(fetchData, 10000); // Refresh every 10s
      return () => clearInterval(interval);
    }
  }, [fetchData, autoRefresh]);

  if (loading && !data) {
    return (
      <div style={{ padding: "24px" }}>
        <h1 style={{ fontSize: "24px", fontWeight: 600, marginBottom: "24px" }}>AI Extraction Progress</h1>
        <p>Loading...</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div style={{ padding: "24px" }}>
        <h1 style={{ fontSize: "24px", fontWeight: 600, marginBottom: "24px" }}>AI Extraction Progress</h1>
        <p style={{ color: "#dc2626" }}>Error: {error}</p>
      </div>
    );
  }

  if (!data) return null;

  const meaningColors: Record<string, string> = {
    active_colony: "#16a34a",
    historical_colony: "#6b7280",
    volunteer: "#7c3aed",
    contact_info: "#3b82f6",
    watch_list: "#f59e0b",
    relocation_client: "#06b6d4",
    disease_risk: "#dc2626",
    felv_colony: "#be123c",
  };

  return (
    <div style={{ padding: "24px", maxWidth: "1400px", margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
        <h1 style={{ fontSize: "24px", fontWeight: 600 }}>AI Extraction Progress</h1>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "14px" }}>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            Auto-refresh (10s)
          </label>
          <button
            onClick={fetchData}
            style={{
              padding: "6px 12px",
              background: "#3b82f6",
              color: "white",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
              fontSize: "14px"
            }}
          >
            Refresh Now
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
        gap: "16px",
        marginBottom: "24px"
      }}>
        <StatCard label="Total Backlog" value={data.summary.total_backlog} subtitle="records to process" />
        <StatCard label="Classified" value={data.summary.total_classified} subtitle="Google Maps entries" />
        <StatCard label="Attributes" value={data.summary.total_attributes} subtitle="AI extracted" />
        <StatCard label="Queue Pending" value={data.summary.queue_pending} />
        <StatCard label="Processing" value={data.summary.queue_processing} />
      </div>

      {/* Google Maps Progress */}
      <div style={{
        background: "white",
        border: "1px solid #e5e7eb",
        borderRadius: "8px",
        padding: "20px",
        marginBottom: "24px"
      }}>
        <h2 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "16px" }}>
          Google Maps Classification
        </h2>
        <div style={{ marginBottom: "12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
            <span>{data.sources.google_maps.classified?.toLocaleString()} / {data.sources.google_maps.total.toLocaleString()}</span>
            <span style={{ color: "#6b7280" }}>{data.sources.google_maps.pending?.toLocaleString()} remaining</span>
          </div>
          <ProgressBar
            value={data.sources.google_maps.classified || 0}
            max={data.sources.google_maps.total}
            color="#16a34a"
          />
        </div>
        {data.sources.google_maps.distribution && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "12px" }}>
            {data.sources.google_maps.distribution.map((d) => (
              <span
                key={d.meaning}
                style={{
                  padding: "4px 10px",
                  borderRadius: "12px",
                  fontSize: "12px",
                  background: `${meaningColors[d.meaning] || "#6b7280"}20`,
                  color: meaningColors[d.meaning] || "#6b7280",
                  fontWeight: 500
                }}
              >
                {d.meaning}: {parseInt(String(d.count)).toLocaleString()}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Source Backlogs */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
        gap: "16px",
        marginBottom: "24px"
      }}>
        <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "16px" }}>
          <h3 style={{ fontSize: "14px", fontWeight: 600, marginBottom: "8px" }}>Request Notes</h3>
          <div style={{ fontSize: "24px", fontWeight: 600 }}>{data.sources.requests.with_notes?.toLocaleString()}</div>
          <div style={{ fontSize: "12px", color: "#6b7280" }}>of {data.sources.requests.total.toLocaleString()} total requests</div>
        </div>
        <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "16px" }}>
          <h3 style={{ fontSize: "14px", fontWeight: 600, marginBottom: "8px" }}>Clinic Appointments</h3>
          <div style={{ fontSize: "24px", fontWeight: 600 }}>{data.sources.clinic.with_notes?.toLocaleString()}</div>
          <div style={{ fontSize: "12px", color: "#6b7280" }}>of {data.sources.clinic.total.toLocaleString()} total</div>
        </div>
        <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "16px" }}>
          <h3 style={{ fontSize: "14px", fontWeight: 600, marginBottom: "8px" }}>Intake Submissions</h3>
          <div style={{ fontSize: "24px", fontWeight: 600 }}>{data.sources.intake.with_notes?.toLocaleString()}</div>
          <div style={{ fontSize: "12px", color: "#6b7280" }}>of {data.sources.intake.total.toLocaleString()} total</div>
        </div>
      </div>

      {/* Attributes by Entity Type */}
      <div style={{
        background: "white",
        border: "1px solid #e5e7eb",
        borderRadius: "8px",
        padding: "20px",
        marginBottom: "24px"
      }}>
        <h2 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "16px" }}>
          Extracted Attributes by Entity Type
        </h2>
        <div style={{ display: "flex", gap: "24px", flexWrap: "wrap" }}>
          {data.attributes.by_type.map((attr) => (
            <div key={attr.entity_type} style={{ minWidth: "120px" }}>
              <div style={{
                fontSize: "12px",
                color: "#6b7280",
                textTransform: "uppercase",
                marginBottom: "4px"
              }}>
                {attr.entity_type}
              </div>
              <div style={{ fontSize: "20px", fontWeight: 600 }}>
                {parseInt(attr.count).toLocaleString()}
              </div>
              <div style={{ fontSize: "11px", color: "#9ca3af" }}>
                {parseInt(attr.unique_entities).toLocaleString()} entities
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Queue Status */}
      <div style={{
        background: "white",
        border: "1px solid #e5e7eb",
        borderRadius: "8px",
        padding: "20px",
        marginBottom: "24px"
      }}>
        <h2 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "16px" }}>
          Extraction Queue (24h)
        </h2>
        <div style={{ display: "flex", gap: "32px" }}>
          <div>
            <div style={{ fontSize: "12px", color: "#6b7280" }}>Completed</div>
            <div style={{ fontSize: "20px", fontWeight: 600, color: "#16a34a" }}>
              {data.queue.completed_24h}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "12px", color: "#6b7280" }}>Errors</div>
            <div style={{ fontSize: "20px", fontWeight: 600, color: data.queue.errors_24h > 0 ? "#dc2626" : "#6b7280" }}>
              {data.queue.errors_24h}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "12px", color: "#6b7280" }}>Pending</div>
            <div style={{ fontSize: "20px", fontWeight: 600 }}>
              {data.queue.pending}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "12px", color: "#6b7280" }}>Processing</div>
            <div style={{ fontSize: "20px", fontWeight: 600, color: data.queue.processing > 0 ? "#3b82f6" : "#6b7280" }}>
              {data.queue.processing}
            </div>
          </div>
        </div>
      </div>

      {/* Recent Jobs */}
      {data.recent_jobs.length > 0 && (
        <div style={{
          background: "white",
          border: "1px solid #e5e7eb",
          borderRadius: "8px",
          padding: "20px"
        }}>
          <h2 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "16px" }}>
            Recent Extraction Jobs
          </h2>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                <th style={{ textAlign: "left", padding: "8px 12px", color: "#6b7280", fontWeight: 500 }}>Source</th>
                <th style={{ textAlign: "left", padding: "8px 12px", color: "#6b7280", fontWeight: 500 }}>Entity Type</th>
                <th style={{ textAlign: "right", padding: "8px 12px", color: "#6b7280", fontWeight: 500 }}>Records</th>
                <th style={{ textAlign: "right", padding: "8px 12px", color: "#6b7280", fontWeight: 500 }}>Attributes</th>
                <th style={{ textAlign: "right", padding: "8px 12px", color: "#6b7280", fontWeight: 500 }}>Cost</th>
                <th style={{ textAlign: "left", padding: "8px 12px", color: "#6b7280", fontWeight: 500 }}>Model</th>
                <th style={{ textAlign: "right", padding: "8px 12px", color: "#6b7280", fontWeight: 500 }}>Completed</th>
              </tr>
            </thead>
            <tbody>
              {data.recent_jobs.map((job, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={{ padding: "8px 12px" }}>{job.source_system}</td>
                  <td style={{ padding: "8px 12px" }}>{job.entity_type}</td>
                  <td style={{ padding: "8px 12px", textAlign: "right" }}>{job.records_processed}</td>
                  <td style={{ padding: "8px 12px", textAlign: "right" }}>{job.attributes_extracted}</td>
                  <td style={{ padding: "8px 12px", textAlign: "right" }}>${job.cost_estimate_usd?.toFixed(4)}</td>
                  <td style={{ padding: "8px 12px", fontSize: "11px" }}>{job.model_used}</td>
                  <td style={{ padding: "8px 12px", textAlign: "right", color: "#6b7280" }}>
                    {new Date(job.completed_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: "16px", fontSize: "12px", color: "#9ca3af", textAlign: "center" }}>
        Last updated: {new Date(data.generated_at).toLocaleString()}
      </div>
    </div>
  );
}
