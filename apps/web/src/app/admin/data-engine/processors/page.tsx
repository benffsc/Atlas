"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchApi, postApi } from "@/lib/api-client";

interface Processor {
  processor_id: string;
  processor_name: string;
  source_system: string;
  source_table: string;
  entity_type: string;
  processor_function: string;
  is_active: boolean;
  priority: number;
}

interface PendingCount {
  source_system: string;
  source_table: string;
  pending: number;
}

interface ProcessResult {
  processed: number;
  success: number;
  errors: number;
}

export default function ProcessorsPage() {
  const [processors, setProcessors] = useState<Processor[]>([]);
  const [pendingCounts, setPendingCounts] = useState<PendingCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ key: string; result: ProcessResult } | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const data = await fetchApi<{ processors: Processor[]; pending_by_source: PendingCount[] }>("/api/admin/data-engine/process");
      setProcessors(data.processors || []);
      setPendingCounts(data.pending_by_source || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const processSource = async (sourceSystem: string, sourceTable: string) => {
    const key = `${sourceSystem}/${sourceTable}`;
    setProcessing(key);
    setLastResult(null);

    try {
      const data = await postApi<{ result: ProcessResult }>("/api/admin/data-engine/process", {
        source_system: sourceSystem,
        source_table: sourceTable,
        limit: 100,
      });

      setLastResult({ key, result: data.result });
      // Refresh pending counts
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Processing failed");
    } finally {
      setProcessing(null);
    }
  };

  const processAll = async () => {
    setProcessing("all");
    setLastResult(null);

    try {
      const data = await postApi<{ result: ProcessResult }>("/api/admin/data-engine/process", { limit: 500 });

      setLastResult({ key: "all", result: data.result });
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Processing failed");
    } finally {
      setProcessing(null);
    }
  };

  if (loading) {
    return (
      <div>
        <h1>Data Engine Processors</h1>
        <p className="text-muted">Loading...</p>
      </div>
    );
  }

  const totalPending = pendingCounts.reduce((sum, p) => sum + p.pending, 0);

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "2rem" }}>
        <div>
          <h1 style={{ marginBottom: "0.25rem" }}>Data Engine Processors</h1>
          <p className="text-muted">
            Unified processing pipeline for all data sources
          </p>
        </div>
        <a
          href="/admin/data-engine"
          style={{ fontSize: "0.875rem" }}
        >
          Back to Data Engine
        </a>
      </div>

      {/* Error Display */}
      {error && (
        <div
          className="card"
          style={{
            padding: "1rem",
            marginBottom: "1.5rem",
            background: "#fef2f2",
            border: "1px solid #ef4444",
          }}
        >
          <strong>Error:</strong> {error}
          <button
            onClick={() => setError(null)}
            style={{ marginLeft: "1rem", padding: "0.25rem 0.5rem" }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Success Message */}
      {lastResult && (
        <div
          className="card"
          style={{
            padding: "1rem",
            marginBottom: "1.5rem",
            background: "#ecfdf5",
            border: "1px solid #10b981",
          }}
        >
          <strong>Processed {lastResult.key}:</strong>{" "}
          {lastResult.result.processed} records ({lastResult.result.success} success, {lastResult.result.errors} errors)
        </div>
      )}

      {/* Summary Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "1rem", marginBottom: "2rem" }}>
        <div className="card" style={{ padding: "1rem" }}>
          <div className="text-muted text-sm">Total Pending</div>
          <div style={{ fontSize: "1.75rem", fontWeight: 700, color: totalPending > 0 ? "#f59e0b" : "#10b981" }}>
            {totalPending.toLocaleString()}
          </div>
          <div className="text-muted text-sm">records to process</div>
        </div>
        <div className="card" style={{ padding: "1rem" }}>
          <div className="text-muted text-sm">Active Processors</div>
          <div style={{ fontSize: "1.75rem", fontWeight: 700 }}>
            {processors.filter(p => p.is_active).length}
          </div>
          <div className="text-muted text-sm">of {processors.length} total</div>
        </div>
        <div className="card" style={{ padding: "1rem" }}>
          <div className="text-muted text-sm">Data Sources</div>
          <div style={{ fontSize: "1.75rem", fontWeight: 700 }}>
            {new Set(processors.map(p => p.source_system)).size}
          </div>
          <div className="text-muted text-sm">integrated</div>
        </div>
        <div className="card" style={{ padding: "1rem", display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <button
            onClick={processAll}
            disabled={processing !== null || totalPending === 0}
            style={{
              padding: "0.75rem 1rem",
              background: totalPending > 0 ? "#3b82f6" : "#9ca3af",
              color: "white",
              border: "none",
              borderRadius: "6px",
              cursor: totalPending > 0 && !processing ? "pointer" : "not-allowed",
              fontWeight: 500,
            }}
          >
            {processing === "all" ? "Processing..." : `Process All (${totalPending})`}
          </button>
        </div>
      </div>

      {/* Pending by Source */}
      {pendingCounts.length > 0 && (
        <section className="card" style={{ padding: "1.25rem", marginBottom: "1.5rem" }}>
          <h2 style={{ margin: "0 0 1rem 0", fontSize: "1.125rem" }}>
            Pending Records by Source
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: "0.75rem" }}>
            {pendingCounts.map((item) => {
              const key = `${item.source_system}/${item.source_table}`;
              return (
                <div
                  key={key}
                  className="card"
                  style={{
                    padding: "0.75rem",
                    background: "var(--section-bg)",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 500, fontSize: "0.875rem" }}>
                      {item.source_system}
                    </div>
                    <div className="text-muted text-sm">
                      {item.source_table} ({item.pending.toLocaleString()} pending)
                    </div>
                  </div>
                  <button
                    onClick={() => processSource(item.source_system, item.source_table)}
                    disabled={processing !== null}
                    style={{
                      padding: "0.375rem 0.75rem",
                      background: "#3b82f6",
                      color: "white",
                      border: "none",
                      borderRadius: "4px",
                      fontSize: "0.75rem",
                      cursor: processing ? "not-allowed" : "pointer",
                    }}
                  >
                    {processing === key ? "..." : "Process"}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Registered Processors */}
      <section className="card" style={{ padding: "1.25rem" }}>
        <h2 style={{ margin: "0 0 1rem 0", fontSize: "1.125rem" }}>
          Registered Processors
        </h2>
        <table style={{ width: "100%", fontSize: "0.875rem" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--card-border)" }}>
              <th style={{ textAlign: "left", padding: "0.5rem 0" }}>Processor</th>
              <th style={{ textAlign: "left", padding: "0.5rem 0" }}>Source</th>
              <th style={{ textAlign: "left", padding: "0.5rem 0" }}>Entity Type</th>
              <th style={{ textAlign: "left", padding: "0.5rem 0" }}>Function</th>
              <th style={{ textAlign: "center", padding: "0.5rem 0" }}>Priority</th>
              <th style={{ textAlign: "center", padding: "0.5rem 0" }}>Active</th>
            </tr>
          </thead>
          <tbody>
            {processors.map((processor) => (
              <tr key={processor.processor_id} style={{ borderBottom: "1px solid var(--card-border)" }}>
                <td style={{ padding: "0.5rem 0" }}>
                  <code style={{ fontSize: "0.8rem", background: "var(--card-border)", padding: "0.125rem 0.25rem", borderRadius: "4px" }}>
                    {processor.processor_name}
                  </code>
                </td>
                <td style={{ padding: "0.5rem 0" }}>
                  <span style={{ fontWeight: 500 }}>{processor.source_system}</span>
                  <span className="text-muted"> / {processor.source_table}</span>
                </td>
                <td style={{ padding: "0.5rem 0" }}>
                  <EntityTypeBadge type={processor.entity_type} />
                </td>
                <td style={{ padding: "0.5rem 0" }}>
                  <code className="text-muted" style={{ fontSize: "0.75rem" }}>
                    {processor.processor_function}()
                  </code>
                </td>
                <td style={{ textAlign: "center", padding: "0.5rem 0" }}>
                  {processor.priority}
                </td>
                <td style={{ textAlign: "center", padding: "0.5rem 0" }}>
                  <span style={{ color: processor.is_active ? "#10b981" : "#ef4444" }}>
                    {processor.is_active ? "Yes" : "No"}
                  </span>
                </td>
              </tr>
            ))}
            {processors.length === 0 && (
              <tr>
                <td colSpan={6} className="text-muted" style={{ padding: "1rem 0", textAlign: "center" }}>
                  No processors registered. Run MIG_467 to set up the processor registry.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {/* How It Works */}
      <section className="card" style={{ padding: "1.25rem", marginTop: "1.5rem" }}>
        <h2 style={{ margin: "0 0 1rem 0", fontSize: "1.125rem" }}>
          How the Unified Data Engine Works
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "1rem", fontSize: "0.875rem" }}>
          <div>
            <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>1. Ingest</div>
            <p className="text-muted" style={{ margin: 0 }}>
              Data is staged in staged_records from any source
            </p>
          </div>
          <div>
            <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>2. Dispatch</div>
            <p className="text-muted" style={{ margin: 0 }}>
              Processor is selected based on source_system + source_table
            </p>
          </div>
          <div>
            <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>3. Process</div>
            <p className="text-muted" style={{ margin: 0 }}>
              Processor extracts entities, resolves identity, assigns roles
            </p>
          </div>
          <div>
            <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>4. Create</div>
            <p className="text-muted" style={{ margin: 0 }}>
              People, cats, places, and relationships are created in SOT
            </p>
          </div>
          <div>
            <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>5. Track</div>
            <p className="text-muted" style={{ margin: 0 }}>
              Decision is logged, staged record marked processed
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function EntityTypeBadge({ type }: { type: string }) {
  const colors: Record<string, { bg: string; text: string }> = {
    person: { bg: "#eff6ff", text: "#2563eb" },
    cat: { bg: "#fef3c7", text: "#d97706" },
    place: { bg: "#ecfdf5", text: "#059669" },
    relationship: { bg: "#f3e8ff", text: "#7c3aed" },
    appointment: { bg: "#fce7f3", text: "#db2777" },
  };

  const style = colors[type] || { bg: "#f3f4f6", text: "#6b7280" };

  return (
    <span
      style={{
        padding: "0.125rem 0.5rem",
        borderRadius: "4px",
        background: style.bg,
        color: style.text,
        fontSize: "0.75rem",
        fontWeight: 500,
      }}
    >
      {type}
    </span>
  );
}
