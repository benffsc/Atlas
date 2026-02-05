"use client";

import { useState, useEffect, useCallback } from "react";

interface ReviewRecord {
  person_id: string;
  display_name: string;
  data_quality: string;
  data_source: string;
  is_canonical: boolean;
  created_at: string;
  identifier_count: number;
  identifiers: string | null;
  cat_count: number;
  place_count: number;
  appointment_count: number;
}

interface ReviewResponse {
  records: ReviewRecord[];
  total: number;
  limit: number;
  offset: number;
}

const SOURCE_COLORS: Record<string, string> = {
  web_app: "#6366f1",
  clinichq: "#10b981",
  airtable: "#f59e0b",
  shelterluv: "#ec4899",
  volunteerhub: "#8b5cf6",
  atlas_ui: "#3b82f6",
};

export default function DataQualityReviewPage() {
  const [data, setData] = useState<ReviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<string>("");
  const [page, setPage] = useState(0);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState<Record<string, string>>({});
  const limit = 50;

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(page * limit),
      });
      if (sourceFilter) params.set("source", sourceFilter);
      const response = await fetch(`/api/admin/data-quality/review?${params}`);
      if (!response.ok) throw new Error("Failed to fetch");
      const result = await response.json();
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [sourceFilter, page]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleAction = async (
    personId: string,
    action: "promote" | "garbage" | "merge"
  ) => {
    setActionLoading(personId);
    try {
      const body: Record<string, string> = { person_id: personId, action };
      if (action === "merge" && mergeTarget[personId]) {
        body.merge_target_id = mergeTarget[personId];
      }
      const response = await fetch("/api/admin/data-quality/review", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed");
      }
      // Remove from list
      if (data) {
        setData({
          ...data,
          records: data.records.filter((r) => r.person_id !== personId),
          total: data.total - 1,
        });
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActionLoading(null);
    }
  };

  const totalPages = data ? Math.ceil(data.total / limit) : 0;

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1.5rem",
        }}
      >
        <div>
          <h1 style={{ marginBottom: "0.25rem" }}>Data Quality Review</h1>
          <p className="text-muted">
            {data ? `${data.total} records` : "Loading..."} needing review
          </p>
        </div>
        <a
          href="/admin/data-quality"
          style={{
            padding: "0.5rem 1rem",
            background: "var(--card-bg)",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            textDecoration: "none",
            color: "var(--foreground)",
            fontSize: "0.875rem",
          }}
        >
          Back to Dashboard
        </a>
      </div>

      {/* Filters */}
      <div
        className="card"
        style={{
          padding: "1rem",
          marginBottom: "1rem",
          display: "flex",
          gap: "1rem",
          alignItems: "center",
        }}
      >
        <label style={{ fontSize: "0.875rem", fontWeight: 500 }}>
          Source:
        </label>
        <select
          value={sourceFilter}
          onChange={(e) => {
            setSourceFilter(e.target.value);
            setPage(0);
          }}
          style={{
            padding: "0.375rem 0.75rem",
            border: "1px solid var(--border)",
            borderRadius: "4px",
            background: "var(--card-bg)",
            color: "var(--foreground)",
            fontSize: "0.875rem",
          }}
        >
          <option value="">All Sources</option>
          <option value="web_app">web_app</option>
          <option value="clinichq">clinichq</option>
          <option value="airtable">airtable</option>
          <option value="shelterluv">shelterluv</option>
          <option value="volunteerhub">volunteerhub</option>
        </select>
        <span className="text-muted" style={{ fontSize: "0.8rem" }}>
          Page {page + 1} of {totalPages || 1}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem" }}>
          <button
            onClick={() => setPage(Math.max(0, page - 1))}
            disabled={page === 0}
            style={{
              padding: "0.375rem 0.75rem",
              border: "1px solid var(--border)",
              borderRadius: "4px",
              background: "var(--card-bg)",
              cursor: page === 0 ? "not-allowed" : "pointer",
              opacity: page === 0 ? 0.5 : 1,
            }}
          >
            Prev
          </button>
          <button
            onClick={() => setPage(page + 1)}
            disabled={page + 1 >= totalPages}
            style={{
              padding: "0.375rem 0.75rem",
              border: "1px solid var(--border)",
              borderRadius: "4px",
              background: "var(--card-bg)",
              cursor: page + 1 >= totalPages ? "not-allowed" : "pointer",
              opacity: page + 1 >= totalPages ? 0.5 : 1,
            }}
          >
            Next
          </button>
        </div>
      </div>

      {error && (
        <div
          className="card"
          style={{
            padding: "1rem",
            background: "#fef2f2",
            border: "1px solid #ef4444",
            marginBottom: "1rem",
          }}
        >
          Error: {error}
        </div>
      )}

      {loading && <p className="text-muted">Loading...</p>}

      {!loading && data && data.records.length === 0 && (
        <div
          className="card"
          style={{
            padding: "2rem",
            textAlign: "center",
          }}
        >
          <p style={{ fontSize: "1.125rem", fontWeight: 500 }}>
            No records needing review
          </p>
          <p className="text-muted">All data quality issues have been resolved.</p>
        </div>
      )}

      {/* Records */}
      {!loading &&
        data &&
        data.records.map((record) => (
          <div
            key={record.person_id}
            className="card"
            style={{
              padding: "1rem",
              marginBottom: "0.75rem",
              opacity: actionLoading === record.person_id ? 0.5 : 1,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
              }}
            >
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    marginBottom: "0.25rem",
                  }}
                >
                  <a
                    href={`/people/${record.person_id}`}
                    style={{ fontWeight: 600, fontSize: "1rem" }}
                  >
                    {record.display_name || "(no name)"}
                  </a>
                  <span
                    style={{
                      fontSize: "0.7rem",
                      padding: "0.125rem 0.5rem",
                      borderRadius: "12px",
                      background:
                        SOURCE_COLORS[record.data_source] || "#6b7280",
                      color: "white",
                      fontWeight: 500,
                    }}
                  >
                    {record.data_source}
                  </span>
                </div>
                <div
                  className="text-muted"
                  style={{ fontSize: "0.8rem", marginBottom: "0.25rem" }}
                >
                  {record.identifiers || "No identifiers"} |{" "}
                  {record.cat_count} cats | {record.place_count} places |{" "}
                  {record.appointment_count} appointments
                </div>
                <div
                  className="text-muted"
                  style={{ fontSize: "0.75rem" }}
                >
                  Created: {new Date(record.created_at).toLocaleDateString()} |
                  ID: {record.person_id.slice(0, 8)}...
                </div>
              </div>

              {/* Actions */}
              <div
                style={{
                  display: "flex",
                  gap: "0.5rem",
                  alignItems: "center",
                  flexShrink: 0,
                }}
              >
                <button
                  onClick={() => handleAction(record.person_id, "promote")}
                  disabled={actionLoading === record.person_id}
                  title="Mark as normal quality (real person)"
                  style={{
                    padding: "0.375rem 0.75rem",
                    background: "#ecfdf5",
                    border: "1px solid #10b981",
                    color: "#059669",
                    borderRadius: "4px",
                    fontSize: "0.8rem",
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  Promote
                </button>
                <button
                  onClick={() => handleAction(record.person_id, "garbage")}
                  disabled={actionLoading === record.person_id}
                  title="Mark as garbage data (hides from all surfaces)"
                  style={{
                    padding: "0.375rem 0.75rem",
                    background: "#fef2f2",
                    border: "1px solid #ef4444",
                    color: "#dc2626",
                    borderRadius: "4px",
                    fontSize: "0.8rem",
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  Garbage
                </button>
                <div style={{ display: "flex", gap: "0.25rem" }}>
                  <input
                    type="text"
                    placeholder="Target ID..."
                    value={mergeTarget[record.person_id] || ""}
                    onChange={(e) =>
                      setMergeTarget({
                        ...mergeTarget,
                        [record.person_id]: e.target.value,
                      })
                    }
                    style={{
                      width: "100px",
                      padding: "0.375rem",
                      border: "1px solid var(--border)",
                      borderRadius: "4px",
                      fontSize: "0.75rem",
                    }}
                  />
                  <button
                    onClick={() => handleAction(record.person_id, "merge")}
                    disabled={
                      actionLoading === record.person_id ||
                      !mergeTarget[record.person_id]
                    }
                    title="Merge into target person"
                    style={{
                      padding: "0.375rem 0.75rem",
                      background: "#eff6ff",
                      border: "1px solid #3b82f6",
                      color: "#2563eb",
                      borderRadius: "4px",
                      fontSize: "0.8rem",
                      fontWeight: 500,
                      cursor:
                        !mergeTarget[record.person_id]
                          ? "not-allowed"
                          : "pointer",
                      opacity: !mergeTarget[record.person_id] ? 0.5 : 1,
                    }}
                  >
                    Merge
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
    </div>
  );
}
