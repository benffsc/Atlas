"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface DataEngineStats {
  total_decisions: number;
  auto_matched: number;
  new_entities: number;
  reviews_pending: number;
  total_staged: number;
  remaining: number;
}

interface BatchResult {
  processed: number;
  auto_matched: number;
  new_entities: number;
  reviews_created: number;
  household_members: number;
  rejected: number;
  errors: number;
  duration_ms: number;
}

interface BatchResponse {
  success: boolean;
  result: BatchResult;
  stats: DataEngineStats;
  message?: string;
  error?: string;
}

export function DataEngineControls() {
  const [stats, setStats] = useState<DataEngineStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [runUntilComplete, setRunUntilComplete] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [totalProcessed, setTotalProcessed] = useState(0);
  const [source, setSource] = useState<string>("clinichq");
  const abortRef = useRef(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/data-engine/process");
      if (res.ok) {
        const data = await res.json();
        setStats(data.stats);
      }
    } catch (err) {
      console.error("Failed to fetch stats:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log]);

  const addLog = (message: string, type?: "success" | "error" | "info") => {
    const timestamp = new Date().toLocaleTimeString();
    const prefix = type === "success" ? "[OK]" : type === "error" ? "[ERROR]" : "";
    setLog((prev) => [...prev.slice(-100), `[${timestamp}] ${prefix} ${message}`]);
  };

  const runBatch = async (): Promise<BatchResponse | null> => {
    try {
      const res = await fetch("/api/admin/data-engine/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 50, source }),
      });
      if (res.ok) {
        return await res.json();
      } else {
        const errorData = await res.json().catch(() => ({}));
        addLog(`HTTP ${res.status}: ${errorData.error || "Unknown error"}`, "error");
        return null;
      }
    } catch (err) {
      addLog(`Network error: ${err instanceof Error ? err.message : "Unknown"}`, "error");
      return null;
    }
  };

  const runForDuration = async (durationMs: number) => {
    if (running) return;

    setRunning(true);
    abortRef.current = false;
    setLog([]);
    setTotalProcessed(0);

    const endTime = Date.now() + durationMs;
    let batchCount = 0;
    let processed = 0;
    let totalMatched = 0;
    let totalNew = 0;
    let totalReviews = 0;

    addLog(`Starting Data Engine processing for ${Math.round(durationMs / 1000)} seconds (source: ${source})...`);

    while (Date.now() < endTime && !abortRef.current) {
      batchCount++;
      const response = await runBatch();

      if (response?.success && response.result) {
        const r = response.result;
        processed += r.processed;
        totalMatched += r.auto_matched;
        totalNew += r.new_entities;
        totalReviews += r.reviews_created;
        setTotalProcessed(processed);

        if (r.processed > 0) {
          addLog(
            `Batch ${batchCount}: ${r.processed} processed (${r.auto_matched} matched, ${r.new_entities} new, ${r.reviews_created} review) - ${response.stats.remaining} remaining`,
            "success"
          );
        } else {
          addLog(`Batch ${batchCount}: No records to process`);
          break;
        }

        setStats(response.stats);

        // Small delay between batches to avoid overwhelming the server
        await new Promise((r) => setTimeout(r, 500));
      } else {
        // Error occurred, wait before retry
        await new Promise((r) => setTimeout(r, 3000));
      }
    }

    addLog(
      `Completed! ${processed} records in ${batchCount} batches (${totalMatched} matched, ${totalNew} new, ${totalReviews} review)`,
      "success"
    );
    setRunning(false);
    await fetchStats();
  };

  const runUntilDone = async () => {
    if (running) return;

    setRunning(true);
    setRunUntilComplete(true);
    abortRef.current = false;
    setLog([]);
    setTotalProcessed(0);

    let batchCount = 0;
    let processed = 0;
    let consecutiveEmpty = 0;

    addLog(`Starting continuous processing until complete (source: ${source})...`);

    while (!abortRef.current) {
      batchCount++;
      const response = await runBatch();

      if (response?.success && response.result) {
        const r = response.result;
        processed += r.processed;
        setTotalProcessed(processed);

        if (r.processed > 0) {
          consecutiveEmpty = 0;

          if (batchCount % 10 === 0) {
            addLog(
              `Progress: ${processed} processed, ${response.stats.remaining} remaining`,
              "info"
            );
          }
        } else {
          consecutiveEmpty++;
          if (consecutiveEmpty >= 3) {
            addLog("No more records to process!");
            break;
          }
        }

        setStats(response.stats);

        // Check if done
        if (response.stats.remaining === 0) {
          addLog("All records processed!", "success");
          break;
        }

        // Small delay between batches
        await new Promise((r) => setTimeout(r, 500));
      } else {
        addLog("Retrying after error...");
        await new Promise((r) => setTimeout(r, 5000));
      }
    }

    if (abortRef.current) {
      addLog("Stopped by user.");
    }

    addLog(`Completed! Processed ${processed} records in ${batchCount} batches.`, "success");
    setRunning(false);
    setRunUntilComplete(false);
    await fetchStats();
  };

  const stopRunning = () => {
    abortRef.current = true;
    addLog("Stopping...");
  };

  if (loading) {
    return <p className="text-muted">Loading Data Engine stats...</p>;
  }

  const remaining = stats?.remaining || 0;
  const total = stats?.total_staged || 0;
  const processed = stats?.total_decisions || 0;
  const progress = total > 0 ? Math.round((processed / total) * 100) : 0;

  return (
    <div>
      {/* Stats */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: "1rem",
          marginBottom: "1.5rem",
        }}
      >
        <div
          style={{
            textAlign: "center",
            padding: "1rem",
            background: "#d4edda",
            borderRadius: "8px",
          }}
        >
          <div style={{ fontSize: "1.75rem", fontWeight: "bold", color: "#155724" }}>
            {stats?.total_decisions?.toLocaleString() || 0}
          </div>
          <div style={{ fontSize: "0.875rem", color: "#155724" }}>Processed</div>
        </div>
        <div
          style={{
            textAlign: "center",
            padding: "1rem",
            background: "#fff3cd",
            borderRadius: "8px",
          }}
        >
          <div style={{ fontSize: "1.75rem", fontWeight: "bold", color: "#856404" }}>
            {remaining.toLocaleString()}
          </div>
          <div style={{ fontSize: "0.875rem", color: "#856404" }}>Remaining</div>
        </div>
        <div
          style={{
            textAlign: "center",
            padding: "1rem",
            background: "#cce5ff",
            borderRadius: "8px",
          }}
        >
          <div style={{ fontSize: "1.75rem", fontWeight: "bold", color: "#004085" }}>
            {stats?.auto_matched?.toLocaleString() || 0}
          </div>
          <div style={{ fontSize: "0.875rem", color: "#004085" }}>Auto-Matched</div>
        </div>
        <div
          style={{
            textAlign: "center",
            padding: "1rem",
            background: "#e2e3e5",
            borderRadius: "8px",
          }}
        >
          <div style={{ fontSize: "1.75rem", fontWeight: "bold", color: "#383d41" }}>
            {progress}%
          </div>
          <div style={{ fontSize: "0.875rem", color: "#383d41" }}>Complete</div>
        </div>
      </div>

      {/* Additional stats row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "1rem",
          marginBottom: "1.5rem",
        }}
      >
        <div
          style={{
            textAlign: "center",
            padding: "0.75rem",
            background: "#d1ecf1",
            borderRadius: "8px",
          }}
        >
          <div style={{ fontSize: "1.25rem", fontWeight: "bold", color: "#0c5460" }}>
            {stats?.new_entities?.toLocaleString() || 0}
          </div>
          <div style={{ fontSize: "0.75rem", color: "#0c5460" }}>New Entities</div>
        </div>
        <div
          style={{
            textAlign: "center",
            padding: "0.75rem",
            background: "#f8d7da",
            borderRadius: "8px",
          }}
        >
          <div style={{ fontSize: "1.25rem", fontWeight: "bold", color: "#721c24" }}>
            {stats?.reviews_pending?.toLocaleString() || 0}
          </div>
          <div style={{ fontSize: "0.75rem", color: "#721c24" }}>Needs Review</div>
        </div>
        <div
          style={{
            textAlign: "center",
            padding: "0.75rem",
            background: "#e9ecef",
            borderRadius: "8px",
          }}
        >
          <div style={{ fontSize: "1.25rem", fontWeight: "bold", color: "#495057" }}>
            {total.toLocaleString()}
          </div>
          <div style={{ fontSize: "0.75rem", color: "#495057" }}>Total Staged</div>
        </div>
      </div>

      {/* Progress bar */}
      <div
        style={{
          width: "100%",
          height: "8px",
          background: "#e9ecef",
          borderRadius: "4px",
          marginBottom: "1.5rem",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${progress}%`,
            height: "100%",
            background: "#198754",
            transition: "width 0.3s",
          }}
        />
      </div>

      {/* Source selector and controls */}
      <div
        style={{
          display: "flex",
          gap: "1rem",
          alignItems: "center",
          marginBottom: "1rem",
          flexWrap: "wrap",
        }}
      >
        <select
          value={source}
          onChange={(e) => setSource(e.target.value)}
          disabled={running}
          style={{
            padding: "0.75rem 1rem",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            background: "var(--background)",
            cursor: running ? "not-allowed" : "pointer",
          }}
        >
          <option value="clinichq">ClinicHQ</option>
          <option value="airtable">Airtable</option>
          <option value="web_intake">Web Intake</option>
        </select>

        {!running ? (
          <>
            <button
              onClick={() => runForDuration(60000)}
              disabled={remaining === 0}
              style={{
                padding: "0.75rem 1.5rem",
                background: "#0d6efd",
                color: "white",
                border: "none",
                borderRadius: "6px",
                cursor: remaining === 0 ? "not-allowed" : "pointer",
                opacity: remaining === 0 ? 0.5 : 1,
              }}
            >
              Run 1 Minute
            </button>
            <button
              onClick={() => runForDuration(300000)}
              disabled={remaining === 0}
              style={{
                padding: "0.75rem 1.5rem",
                background: "#6610f2",
                color: "white",
                border: "none",
                borderRadius: "6px",
                cursor: remaining === 0 ? "not-allowed" : "pointer",
                opacity: remaining === 0 ? 0.5 : 1,
              }}
            >
              Run 5 Minutes
            </button>
            <button
              onClick={runUntilDone}
              disabled={remaining === 0}
              style={{
                padding: "0.75rem 1.5rem",
                background: "#198754",
                color: "white",
                border: "none",
                borderRadius: "6px",
                cursor: remaining === 0 ? "not-allowed" : "pointer",
                opacity: remaining === 0 ? 0.5 : 1,
              }}
            >
              Run Until Complete
            </button>
          </>
        ) : (
          <button
            onClick={stopRunning}
            style={{
              padding: "0.75rem 1.5rem",
              background: "#dc3545",
              color: "white",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            Stop
          </button>
        )}

        <button
          onClick={fetchStats}
          disabled={running}
          style={{
            padding: "0.75rem 1rem",
            background: "transparent",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            cursor: running ? "not-allowed" : "pointer",
          }}
        >
          Refresh
        </button>
      </div>

      {/* Running indicator */}
      {running && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.75rem 1rem",
            background: "#cfe2ff",
            borderRadius: "6px",
            marginBottom: "1rem",
          }}
        >
          <div
            style={{
              width: "12px",
              height: "12px",
              borderRadius: "50%",
              background: "#0d6efd",
              animation: "pulse 1s infinite",
            }}
          />
          <span style={{ color: "#084298" }}>
            {runUntilComplete ? "Running until complete..." : "Processing..."}
            {totalProcessed > 0 && ` (${totalProcessed.toLocaleString()} processed)`}
          </span>
        </div>
      )}

      {/* Log output */}
      {log.length > 0 && (
        <div
          style={{
            background: "#1e1e1e",
            color: "#d4d4d4",
            padding: "1rem",
            borderRadius: "6px",
            fontFamily: "monospace",
            fontSize: "0.8rem",
            maxHeight: "300px",
            overflow: "auto",
          }}
        >
          {log.map((line, i) => (
            <div
              key={i}
              style={{
                color: line.includes("[ERROR]")
                  ? "#f14c4c"
                  : line.includes("[OK]")
                  ? "#4ec9b0"
                  : line.includes("matched")
                  ? "#6a9955"
                  : line.includes("review")
                  ? "#dcdcaa"
                  : "#d4d4d4",
              }}
            >
              {line}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      )}

      <style jsx>{`
        @keyframes pulse {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }
      `}</style>
    </div>
  );
}
