"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface GeocodingStats {
  geocoded: string;
  pending: string;
  failed: string;
  ready_to_process: string;
  active_requests_pending: string;
}

interface GeocodingResult {
  place_id: string;
  address: string;
  status: "success" | "failed" | "error";
  googleAddress?: string;
  error?: string;
}

interface BatchResponse {
  message: string;
  processed: number;
  success: number;
  failed: number;
  results: GeocodingResult[];
  stats: GeocodingStats;
}

export function GeocodingControls() {
  const [stats, setStats] = useState<GeocodingStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [runUntilComplete, setRunUntilComplete] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [totalProcessed, setTotalProcessed] = useState(0);
  const [totalMerged, setTotalMerged] = useState(0);
  const abortRef = useRef(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/places/geocode-queue");
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

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLog((prev) => [...prev.slice(-100), `[${timestamp}] ${message}`]);
  };

  const runBatch = async (): Promise<BatchResponse | null> => {
    try {
      const res = await fetch("/api/places/geocode-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 20 }),
      });
      if (res.ok) {
        return await res.json();
      } else {
        addLog(`Error: HTTP ${res.status}`);
        return null;
      }
    } catch (err) {
      addLog(`Error: ${err instanceof Error ? err.message : "Network error"}`);
      return null;
    }
  };

  const runForDuration = async (durationMs: number) => {
    if (running) return;

    setRunning(true);
    abortRef.current = false;
    setLog([]);
    setTotalProcessed(0);
    setTotalMerged(0);

    const endTime = Date.now() + durationMs;
    let batchCount = 0;
    let processed = 0;
    let merged = 0;

    addLog(`Starting geocoding for ${Math.round(durationMs / 1000)} seconds...`);

    while (Date.now() < endTime && !abortRef.current) {
      batchCount++;
      const result = await runBatch();

      if (result) {
        processed += result.processed;
        setTotalProcessed(processed);

        // Count merged places (those that succeeded and potentially merged)
        const mergedInBatch = result.results.filter(r =>
          r.status === "success" && r.googleAddress
        ).length;

        if (result.processed > 0) {
          addLog(`Batch ${batchCount}: ${result.success} success, ${result.failed} failed (${result.stats.pending} remaining)`);
        } else {
          addLog(`Batch ${batchCount}: No places to process`);
          break;
        }

        setStats(result.stats);

        // Small delay between batches
        await new Promise(r => setTimeout(r, 200));
      } else {
        // Error occurred, wait a bit longer before retry
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    addLog(`Completed! Processed ${processed} places in ${batchCount} batches.`);
    setRunning(false);

    // Refresh stats
    await fetchStats();
  };

  const runUntilDone = async () => {
    if (running) return;

    setRunning(true);
    setRunUntilComplete(true);
    abortRef.current = false;
    setLog([]);
    setTotalProcessed(0);
    setTotalMerged(0);

    let batchCount = 0;
    let processed = 0;
    let consecutiveEmpty = 0;

    addLog("Starting continuous geocoding until complete...");

    while (!abortRef.current) {
      batchCount++;
      const result = await runBatch();

      if (result) {
        processed += result.processed;
        setTotalProcessed(processed);

        if (result.processed > 0) {
          consecutiveEmpty = 0;

          if (batchCount % 10 === 0) {
            addLog(`Progress: ${processed} processed, ${result.stats.pending} remaining`);
          }
        } else {
          consecutiveEmpty++;
          if (consecutiveEmpty >= 3) {
            addLog("No more places to geocode!");
            break;
          }
        }

        setStats(result.stats);

        // Check if done
        if (parseInt(result.stats.pending) === 0) {
          addLog("All places geocoded!");
          break;
        }

        // Small delay between batches
        await new Promise(r => setTimeout(r, 100));
      } else {
        // Error occurred, wait before retry
        addLog("Retrying after error...");
        await new Promise(r => setTimeout(r, 3000));
      }
    }

    if (abortRef.current) {
      addLog("Stopped by user.");
    }

    addLog(`Completed! Processed ${processed} places in ${batchCount} batches.`);
    setRunning(false);
    setRunUntilComplete(false);

    // Refresh stats
    await fetchStats();
  };

  const stopRunning = () => {
    abortRef.current = true;
    addLog("Stopping...");
  };

  if (loading) {
    return <p className="text-muted">Loading geocoding stats...</p>;
  }

  const pending = parseInt(stats?.pending || "0");
  const geocoded = parseInt(stats?.geocoded || "0");
  const total = pending + geocoded;
  const progress = total > 0 ? Math.round((geocoded / total) * 100) : 0;

  return (
    <div>
      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem", marginBottom: "1.5rem" }}>
        <div style={{ textAlign: "center", padding: "1rem", background: "#d4edda", borderRadius: "8px" }}>
          <div style={{ fontSize: "1.75rem", fontWeight: "bold", color: "#155724" }}>
            {stats?.geocoded || 0}
          </div>
          <div style={{ fontSize: "0.875rem", color: "#155724" }}>Geocoded</div>
        </div>
        <div style={{ textAlign: "center", padding: "1rem", background: "#fff3cd", borderRadius: "8px" }}>
          <div style={{ fontSize: "1.75rem", fontWeight: "bold", color: "#856404" }}>
            {stats?.pending || 0}
          </div>
          <div style={{ fontSize: "0.875rem", color: "#856404" }}>Pending</div>
        </div>
        <div style={{ textAlign: "center", padding: "1rem", background: "#f8d7da", borderRadius: "8px" }}>
          <div style={{ fontSize: "1.75rem", fontWeight: "bold", color: "#721c24" }}>
            {stats?.failed || 0}
          </div>
          <div style={{ fontSize: "0.875rem", color: "#721c24" }}>Failed</div>
        </div>
        <div style={{ textAlign: "center", padding: "1rem", background: "#e2e3e5", borderRadius: "8px" }}>
          <div style={{ fontSize: "1.75rem", fontWeight: "bold", color: "#383d41" }}>
            {progress}%
          </div>
          <div style={{ fontSize: "0.875rem", color: "#383d41" }}>Complete</div>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{
        width: "100%",
        height: "8px",
        background: "#e9ecef",
        borderRadius: "4px",
        marginBottom: "1.5rem",
        overflow: "hidden"
      }}>
        <div style={{
          width: `${progress}%`,
          height: "100%",
          background: "#198754",
          transition: "width 0.3s"
        }} />
      </div>

      {/* Controls */}
      <div style={{ display: "flex", gap: "1rem", alignItems: "center", marginBottom: "1rem" }}>
        {!running ? (
          <>
            <button
              onClick={() => runForDuration(60000)}
              disabled={pending === 0}
              style={{
                padding: "0.75rem 1.5rem",
                background: "#0d6efd",
                color: "white",
                border: "none",
                borderRadius: "6px",
                cursor: pending === 0 ? "not-allowed" : "pointer",
                opacity: pending === 0 ? 0.5 : 1
              }}
            >
              Run for 1 Minute
            </button>
            <button
              onClick={() => runForDuration(300000)}
              disabled={pending === 0}
              style={{
                padding: "0.75rem 1.5rem",
                background: "#6610f2",
                color: "white",
                border: "none",
                borderRadius: "6px",
                cursor: pending === 0 ? "not-allowed" : "pointer",
                opacity: pending === 0 ? 0.5 : 1
              }}
            >
              Run for 5 Minutes
            </button>
            <button
              onClick={runUntilDone}
              disabled={pending === 0}
              style={{
                padding: "0.75rem 1.5rem",
                background: "#198754",
                color: "white",
                border: "none",
                borderRadius: "6px",
                cursor: pending === 0 ? "not-allowed" : "pointer",
                opacity: pending === 0 ? 0.5 : 1
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
              cursor: "pointer"
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
            cursor: running ? "not-allowed" : "pointer"
          }}
        >
          Refresh Stats
        </button>
      </div>

      {/* Running indicator */}
      {running && (
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          padding: "0.75rem 1rem",
          background: "#cfe2ff",
          borderRadius: "6px",
          marginBottom: "1rem"
        }}>
          <div style={{
            width: "12px",
            height: "12px",
            borderRadius: "50%",
            background: "#0d6efd",
            animation: "pulse 1s infinite"
          }} />
          <span style={{ color: "#084298" }}>
            {runUntilComplete ? "Running until complete..." : "Processing..."}
            {totalProcessed > 0 && ` (${totalProcessed} processed)`}
          </span>
        </div>
      )}

      {/* Log output */}
      {log.length > 0 && (
        <div style={{
          background: "#1e1e1e",
          color: "#d4d4d4",
          padding: "1rem",
          borderRadius: "6px",
          fontFamily: "monospace",
          fontSize: "0.8rem",
          maxHeight: "300px",
          overflow: "auto"
        }}>
          {log.map((line, i) => (
            <div key={i} style={{
              color: line.includes("Error") ? "#f14c4c" :
                     line.includes("Completed") ? "#4ec9b0" :
                     line.includes("success") ? "#6a9955" : "#d4d4d4"
            }}>
              {line}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      )}

      <style jsx>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}
