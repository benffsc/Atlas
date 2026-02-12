"use client";

import { useState, useRef } from "react";
import Link from "next/link";

// ============================================================================
// Types
// ============================================================================

interface ProcessingStats {
  total: number;
  sourceInserted: number;
  sourceSkipped: number;
  opsInserted: number;
  personsCreated: number;
  personsMatched: number;
  pseudoProfiles: number;
  catsCreated: number;
  catsMatched: number;
  placesCreated: number;
  placesMatched: number;
  errors: number;
}

interface ProcessResult {
  success: boolean;
  message: string;
  stats: ProcessingStats;
  dryRun: boolean;
  elapsedMs: number;
}

interface V2Stats {
  source: { clinichq_raw: number };
  ops: { appointments: number; clinic_accounts: number };
  sot: { people: number; cats: number; places: number };
  resolution: Record<string, number>;
}

// ============================================================================
// V2 Ingest Page
// ============================================================================

export default function V2IngestPage() {
  const [file, setFile] = useState<File | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<ProcessResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [v2Stats, setV2Stats] = useState<V2Stats | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load V2 stats on mount
  const loadV2Stats = async () => {
    setLoadingStats(true);
    try {
      const res = await fetch("/api/v2/stats");
      if (res.ok) {
        const data = await res.json();
        setV2Stats(data);
      }
    } catch (err) {
      console.error("Failed to load V2 stats:", err);
    } finally {
      setLoadingStats(false);
    }
  };

  // Handle file selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setResult(null);
      setError(null);
    }
  };

  // Handle file drop
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && (droppedFile.name.endsWith(".xlsx") || droppedFile.name.endsWith(".xls"))) {
      setFile(droppedFile);
      setResult(null);
      setError(null);
    } else {
      setError("Please drop an Excel file (.xlsx or .xls)");
    }
  };

  // Process file
  const handleProcess = async () => {
    if (!file) return;

    setProcessing(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("dryRun", String(dryRun));

      const res = await fetch("/api/v2/ingest/clinichq", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Processing failed");
      }

      setResult(data);

      // Reload stats after processing
      if (!dryRun) {
        await loadV2Stats();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Processing failed");
    } finally {
      setProcessing(false);
    }
  };

  // Reset state
  const handleReset = () => {
    setFile(null);
    setResult(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div style={{ padding: "2rem", maxWidth: "900px", margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: "2rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "0.5rem" }}>
          <Link href="/admin/data" style={{ color: "var(--muted)", fontSize: "0.875rem" }}>
            ← Back to Data Hub
          </Link>
        </div>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 600, margin: 0 }}>
          V2 Ingest Pipeline
        </h1>
        <p style={{ color: "var(--muted)", marginTop: "0.5rem" }}>
          Process ClinicHQ data through the 3-layer V2 architecture (Source → OPS → SOT)
        </p>
      </div>

      {/* V2 Stats Panel */}
      <div style={{
        background: "var(--card-bg, #f9fafb)",
        border: "1px solid var(--border, #e5e7eb)",
        borderRadius: "0.5rem",
        padding: "1rem",
        marginBottom: "1.5rem",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
          <h3 style={{ fontSize: "0.875rem", fontWeight: 600, margin: 0 }}>V2 Current State</h3>
          <button
            onClick={loadV2Stats}
            disabled={loadingStats}
            style={{
              fontSize: "0.75rem",
              padding: "0.25rem 0.5rem",
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: "0.25rem",
              cursor: loadingStats ? "wait" : "pointer",
            }}
          >
            {loadingStats ? "Loading..." : "Refresh"}
          </button>
        </div>

        {v2Stats ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem", fontSize: "0.875rem" }}>
            <div>
              <div style={{ color: "var(--muted)", fontSize: "0.75rem", marginBottom: "0.25rem" }}>SOURCE</div>
              <div>clinichq_raw: <strong>{v2Stats.source.clinichq_raw.toLocaleString()}</strong></div>
            </div>
            <div>
              <div style={{ color: "var(--muted)", fontSize: "0.75rem", marginBottom: "0.25rem" }}>OPS</div>
              <div>appointments: <strong>{v2Stats.ops.appointments.toLocaleString()}</strong></div>
              <div>clinic_accounts: <strong>{v2Stats.ops.clinic_accounts.toLocaleString()}</strong></div>
            </div>
            <div>
              <div style={{ color: "var(--muted)", fontSize: "0.75rem", marginBottom: "0.25rem" }}>SOT</div>
              <div>people: <strong>{v2Stats.sot.people.toLocaleString()}</strong></div>
              <div>cats: <strong>{v2Stats.sot.cats.toLocaleString()}</strong></div>
              <div>places: <strong>{v2Stats.sot.places.toLocaleString()}</strong></div>
            </div>
          </div>
        ) : (
          <p style={{ color: "var(--muted)", fontSize: "0.875rem", margin: 0 }}>
            Click Refresh to load V2 stats
          </p>
        )}

        {v2Stats?.resolution && Object.keys(v2Stats.resolution).length > 0 && (
          <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid var(--border)" }}>
            <div style={{ color: "var(--muted)", fontSize: "0.75rem", marginBottom: "0.5rem" }}>Resolution Status Distribution</div>
            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", fontSize: "0.875rem" }}>
              {Object.entries(v2Stats.resolution).map(([status, count]) => (
                <span key={status}>
                  {status}: <strong>{count.toLocaleString()}</strong>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Upload Area */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        style={{
          border: "2px dashed var(--border, #e5e7eb)",
          borderRadius: "0.5rem",
          padding: "2rem",
          textAlign: "center",
          marginBottom: "1.5rem",
          background: file ? "var(--success-bg, #f0fdf4)" : "var(--bg)",
          cursor: "pointer",
        }}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          onChange={handleFileChange}
          style={{ display: "none" }}
        />

        {file ? (
          <div>
            <div style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>📄</div>
            <div style={{ fontWeight: 500 }}>{file.name}</div>
            <div style={{ color: "var(--muted)", fontSize: "0.875rem" }}>
              {(file.size / 1024).toFixed(1)} KB
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleReset();
              }}
              style={{
                marginTop: "0.5rem",
                padding: "0.25rem 0.75rem",
                fontSize: "0.75rem",
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: "0.25rem",
                cursor: "pointer",
              }}
            >
              Remove
            </button>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>📤</div>
            <div style={{ fontWeight: 500 }}>Drop ClinicHQ XLSX file here</div>
            <div style={{ color: "var(--muted)", fontSize: "0.875rem" }}>
              or click to browse
            </div>
          </div>
        )}
      </div>

      {/* Options */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: "1rem",
        marginBottom: "1.5rem",
        padding: "1rem",
        background: "var(--card-bg, #f9fafb)",
        borderRadius: "0.5rem",
        border: "1px solid var(--border)",
      }}>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(e) => setDryRun(e.target.checked)}
          />
          <span style={{ fontSize: "0.875rem" }}>
            <strong>Dry Run</strong> - Parse and validate only, no database writes
          </span>
        </label>
      </div>

      {/* Process Button */}
      <button
        onClick={handleProcess}
        disabled={!file || processing}
        style={{
          width: "100%",
          padding: "0.75rem",
          fontSize: "1rem",
          fontWeight: 500,
          background: !file || processing ? "var(--muted)" : "var(--primary, #3b82f6)",
          color: "white",
          border: "none",
          borderRadius: "0.5rem",
          cursor: !file || processing ? "not-allowed" : "pointer",
          marginBottom: "1.5rem",
        }}
      >
        {processing ? "Processing..." : dryRun ? "Run Dry Run" : "Process to V2"}
      </button>

      {/* Error */}
      {error && (
        <div style={{
          padding: "1rem",
          background: "var(--error-bg, #fef2f2)",
          border: "1px solid var(--error-border, #fecaca)",
          borderRadius: "0.5rem",
          color: "var(--error, #dc2626)",
          marginBottom: "1.5rem",
        }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <div style={{
          padding: "1.5rem",
          background: result.success ? "var(--success-bg, #f0fdf4)" : "var(--warning-bg, #fffbeb)",
          border: `1px solid ${result.success ? "var(--success-border, #bbf7d0)" : "var(--warning-border, #fde68a)"}`,
          borderRadius: "0.5rem",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "1rem" }}>
            <div>
              <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>
                {result.dryRun ? "Dry Run Complete" : "Processing Complete"}
              </h3>
              <p style={{ margin: "0.25rem 0 0", color: "var(--muted)", fontSize: "0.875rem" }}>
                {result.message} ({(result.elapsedMs / 1000).toFixed(2)}s)
              </p>
            </div>
            <span style={{
              padding: "0.25rem 0.5rem",
              fontSize: "0.75rem",
              fontWeight: 500,
              background: result.dryRun ? "var(--warning, #f59e0b)" : "var(--success, #22c55e)",
              color: "white",
              borderRadius: "0.25rem",
            }}>
              {result.dryRun ? "DRY RUN" : "LIVE"}
            </span>
          </div>

          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "1rem",
            fontSize: "0.875rem",
          }}>
            {/* Layer 1: Source */}
            <div style={{ padding: "0.75rem", background: "white", borderRadius: "0.375rem" }}>
              <div style={{ fontWeight: 600, marginBottom: "0.5rem", color: "var(--primary)" }}>
                Layer 1: Source
              </div>
              <div>Total Rows: <strong>{result.stats.total}</strong></div>
              <div>New Records: <strong>{result.stats.sourceInserted}</strong></div>
              <div>Unchanged: <strong>{result.stats.sourceSkipped}</strong></div>
            </div>

            {/* Layer 2: OPS */}
            <div style={{ padding: "0.75rem", background: "white", borderRadius: "0.375rem" }}>
              <div style={{ fontWeight: 600, marginBottom: "0.5rem", color: "var(--warning)" }}>
                Layer 2: OPS
              </div>
              <div>Appointments: <strong>{result.stats.opsInserted}</strong></div>
              <div>Pseudo-Profiles: <strong>{result.stats.pseudoProfiles}</strong></div>
            </div>

            {/* Layer 3: SOT */}
            <div style={{ padding: "0.75rem", background: "white", borderRadius: "0.375rem" }}>
              <div style={{ fontWeight: 600, marginBottom: "0.5rem", color: "var(--success)" }}>
                Layer 3: SOT
              </div>
              <div>People Created: <strong>{result.stats.personsCreated}</strong></div>
              <div>People Matched: <strong>{result.stats.personsMatched}</strong></div>
              <div>Cats Created: <strong>{result.stats.catsCreated}</strong></div>
              <div>Cats Matched: <strong>{result.stats.catsMatched}</strong></div>
              <div>Places Created: <strong>{result.stats.placesCreated}</strong></div>
              <div>Places Matched: <strong>{result.stats.placesMatched}</strong></div>
            </div>
          </div>

          {result.stats.errors > 0 && (
            <div style={{
              marginTop: "1rem",
              padding: "0.75rem",
              background: "var(--error-bg, #fef2f2)",
              borderRadius: "0.375rem",
              color: "var(--error, #dc2626)",
            }}>
              <strong>Errors:</strong> {result.stats.errors} rows failed to process
            </div>
          )}
        </div>
      )}

      {/* Info Panel */}
      <div style={{
        marginTop: "2rem",
        padding: "1rem",
        background: "var(--card-bg, #f9fafb)",
        borderRadius: "0.5rem",
        border: "1px solid var(--border)",
        fontSize: "0.875rem",
        color: "var(--muted)",
      }}>
        <h4 style={{ margin: "0 0 0.5rem", fontWeight: 600, color: "var(--foreground)" }}>
          V2 3-Layer Architecture
        </h4>
        <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
          <li><strong>Layer 1 (Source):</strong> Raw JSON in source.clinichq_raw - immutable audit trail</li>
          <li><strong>Layer 2 (OPS):</strong> Operational data in ops.appointments - preserves messy owner data</li>
          <li><strong>Layer 3 (SOT):</strong> Clean canonical entities in sot.people, sot.cats, sot.places</li>
        </ul>
        <p style={{ margin: "0.75rem 0 0" }}>
          Non-person records (orgs, addresses, site names) are routed to ops.clinic_accounts instead of sot.people.
        </p>
      </div>
    </div>
  );
}
