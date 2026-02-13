"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";

// ============================================================================
// Types
// ============================================================================

type FileType = "cat_info" | "owner_info" | "appointment_info";

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
  files?: {
    cat_info: number;
    owner_info: number;
    appointment_info: number;
  };
}

interface ProcessResult {
  success: boolean;
  message: string;
  stats: ProcessingStats;
  dryRun: boolean;
  elapsedMs: number;
}

interface ProgressUpdate {
  phase: string;
  current: number;
  total: number;
  message: string;
  stats?: Partial<ProcessingStats>;
}

interface V2Stats {
  source: { clinichq_raw: number };
  ops: { appointments: number; clinic_accounts: number };
  sot: { people: number; cats: number; places: number };
  resolution: Record<string, number>;
}

const FILE_TYPES: { key: FileType; label: string; description: string }[] = [
  { key: "cat_info", label: "Microchips & Cat Info", description: "Cat details, sex, microchips" },
  { key: "owner_info", label: "Microchips & Owner", description: "Owner contact info" },
  { key: "appointment_info", label: "Microchips & Appt Info", description: "Appointment procedures" },
];

// ============================================================================
// V2 Ingest Page - 3-File Upload
// ============================================================================

export default function V2IngestPage() {
  const [files, setFiles] = useState<Record<FileType, File | null>>({
    cat_info: null,
    owner_info: null,
    appointment_info: null,
  });
  const [dryRun, setDryRun] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<ProcessResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [v2Stats, setV2Stats] = useState<V2Stats | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [progress, setProgress] = useState<ProgressUpdate | null>(null);

  const fileInputRefs = useRef<Record<FileType, HTMLInputElement | null>>({
    cat_info: null,
    owner_info: null,
    appointment_info: null,
  });

  // Load V2 stats on mount
  useEffect(() => {
    loadV2Stats();
  }, []);

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
  const handleFileChange = (fileType: FileType, file: File | null) => {
    setFiles((prev) => ({ ...prev, [fileType]: file }));
    setResult(null);
    setError(null);
  };

  // Handle file drop
  const handleDrop = (fileType: FileType, e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && (droppedFile.name.endsWith(".xlsx") || droppedFile.name.endsWith(".xls"))) {
      handleFileChange(fileType, droppedFile);
    } else {
      setError("Please drop an Excel file (.xlsx or .xls)");
    }
  };

  const filesUploaded = Object.values(files).filter(Boolean).length;
  const isComplete = filesUploaded === 3;

  // Process all files with streaming progress
  const handleProcess = async () => {
    if (!isComplete) return;

    setProcessing(true);
    setError(null);
    setResult(null);
    setProgress({ phase: "uploading", current: 0, total: 100, message: "Uploading files..." });

    try {
      const formData = new FormData();
      formData.append("cat_info", files.cat_info!);
      formData.append("owner_info", files.owner_info!);
      formData.append("appointment_info", files.appointment_info!);
      formData.append("dryRun", String(dryRun));
      formData.append("stream", "true"); // Enable streaming

      const res = await fetch("/api/v2/ingest/clinichq", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Processing failed");
      }

      // Handle SSE stream
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE messages
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || ""; // Keep incomplete message in buffer

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.type === "progress") {
                setProgress({
                  phase: data.phase,
                  current: data.current,
                  total: data.total,
                  message: data.message,
                  stats: data.stats,
                });
              } else if (data.type === "complete") {
                setResult(data);
                setProgress(null);
                // Reload stats after processing
                if (!dryRun) {
                  await loadV2Stats();
                }
              } else if (data.type === "error") {
                throw new Error(data.error);
              }
            } catch (parseErr) {
              console.error("Failed to parse SSE message:", parseErr);
            }
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Processing failed");
      setProgress(null);
    } finally {
      setProcessing(false);
    }
  };

  // Reset state
  const handleReset = () => {
    setFiles({ cat_info: null, owner_info: null, appointment_info: null });
    setResult(null);
    setError(null);
    setProgress(null);
    FILE_TYPES.forEach((ft) => {
      if (fileInputRefs.current[ft.key]) {
        fileInputRefs.current[ft.key]!.value = "";
      }
    });
  };

  return (
    <div style={{ padding: "2rem", maxWidth: "1000px", margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 600, margin: 0 }}>
          Upload ClinicHQ Data
        </h1>
        <p style={{ color: "var(--muted)", marginTop: "0.5rem" }}>
          Upload 3 ClinicHQ Excel exports to process through the data pipeline
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
          <h3 style={{ fontSize: "0.875rem", fontWeight: 600, margin: 0 }}>Database Status</h3>
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
            Loading V2 stats...
          </p>
        )}

        {v2Stats?.resolution && Object.keys(v2Stats.resolution).length > 0 && (
          <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid var(--border)" }}>
            <div style={{ color: "var(--muted)", fontSize: "0.75rem", marginBottom: "0.5rem" }}>Resolution Status Distribution</div>
            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", fontSize: "0.875rem" }}>
              {Object.entries(v2Stats.resolution).map(([status, count]) => (
                <span key={status}>
                  {status}: <strong>{(count as number).toLocaleString()}</strong>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 3-File Upload Area */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: "1rem",
        marginBottom: "1.5rem",
      }}>
        {FILE_TYPES.map((ft) => (
          <div
            key={ft.key}
            onDrop={(e) => handleDrop(ft.key, e)}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileInputRefs.current[ft.key]?.click()}
            style={{
              border: files[ft.key] ? "2px solid var(--success, #22c55e)" : "2px dashed var(--border, #e5e7eb)",
              borderRadius: "0.5rem",
              padding: "1.5rem 1rem",
              textAlign: "center",
              background: files[ft.key] ? "var(--success-bg, #f0fdf4)" : "var(--bg)",
              cursor: "pointer",
              transition: "all 0.2s",
            }}
          >
            <input
              ref={(el) => { fileInputRefs.current[ft.key] = el; }}
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => handleFileChange(ft.key, e.target.files?.[0] || null)}
              style={{ display: "none" }}
            />

            <div style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>
              {files[ft.key] ? "✓" : "📄"}
            </div>
            <div style={{ fontWeight: 500, fontSize: "0.875rem", marginBottom: "0.25rem" }}>
              {ft.label}
            </div>
            <div style={{ color: "var(--muted)", fontSize: "0.75rem" }}>
              {files[ft.key] ? files[ft.key]!.name : ft.description}
            </div>
            {files[ft.key] && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleFileChange(ft.key, null);
                  if (fileInputRefs.current[ft.key]) {
                    fileInputRefs.current[ft.key]!.value = "";
                  }
                }}
                style={{
                  marginTop: "0.5rem",
                  padding: "0.125rem 0.5rem",
                  fontSize: "0.65rem",
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: "0.25rem",
                  cursor: "pointer",
                }}
              >
                Remove
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Upload Status */}
      <div style={{
        marginBottom: "1rem",
        fontSize: "0.875rem",
        color: isComplete ? "var(--success, #22c55e)" : "var(--muted)",
      }}>
        {filesUploaded}/3 files selected
        {!isComplete && (
          <span style={{ marginLeft: "0.5rem" }}>
            — Missing: {FILE_TYPES.filter((ft) => !files[ft.key]).map((ft) => ft.label).join(", ")}
          </span>
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
      <div style={{ display: "flex", gap: "1rem", marginBottom: "1.5rem" }}>
        <button
          onClick={handleProcess}
          disabled={!isComplete || processing}
          style={{
            flex: 1,
            padding: "0.75rem",
            fontSize: "1rem",
            fontWeight: 500,
            background: !isComplete || processing ? "var(--muted)" : "var(--primary, #3b82f6)",
            color: "white",
            border: "none",
            borderRadius: "0.5rem",
            cursor: !isComplete || processing ? "not-allowed" : "pointer",
          }}
        >
          {processing ? "Processing..." : dryRun ? "Run Dry Run" : "Process to V2"}
        </button>
        <button
          onClick={handleReset}
          disabled={processing}
          style={{
            padding: "0.75rem 1.5rem",
            fontSize: "1rem",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: "0.5rem",
            cursor: processing ? "not-allowed" : "pointer",
          }}
        >
          Reset
        </button>
      </div>

      {/* Progress Bar */}
      {progress && (
        <div style={{
          marginBottom: "1.5rem",
          padding: "1rem",
          background: "var(--card-bg, #f9fafb)",
          border: "1px solid var(--border)",
          borderRadius: "0.5rem",
        }}>
          <div style={{ marginBottom: "0.5rem", fontSize: "0.875rem", fontWeight: 500 }}>
            {progress.message}
          </div>

          {/* Progress bar */}
          <div style={{
            height: "8px",
            background: "var(--border)",
            borderRadius: "4px",
            overflow: "hidden",
            marginBottom: "0.5rem",
          }}>
            <div
              style={{
                height: "100%",
                width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%`,
                background: "var(--primary, #3b82f6)",
                borderRadius: "4px",
                transition: "width 0.3s ease",
              }}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--muted)" }}>
            <span>{progress.current.toLocaleString()} / {progress.total.toLocaleString()}</span>
            <span>{Math.round((progress.current / progress.total) * 100)}%</span>
          </div>

          {/* Live stats during processing */}
          {progress.stats && (
            <div style={{
              marginTop: "0.75rem",
              paddingTop: "0.75rem",
              borderTop: "1px solid var(--border)",
              display: "flex",
              gap: "1.5rem",
              fontSize: "0.75rem",
              color: "var(--muted)",
            }}>
              <span>People: <strong>{progress.stats.personsCreated || 0}</strong></span>
              <span>Cats: <strong>{progress.stats.catsCreated || 0}</strong></span>
              <span>Places: <strong>{progress.stats.placesCreated || 0}</strong></span>
              <span>Pseudo: <strong>{progress.stats.pseudoProfiles || 0}</strong></span>
              {(progress.stats.errors || 0) > 0 && (
                <span style={{ color: "var(--error, #dc2626)" }}>Errors: <strong>{progress.stats.errors}</strong></span>
              )}
            </div>
          )}
        </div>
      )}

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

          {/* File counts */}
          {result.stats.files && (
            <div style={{
              marginBottom: "1rem",
              padding: "0.75rem",
              background: "white",
              borderRadius: "0.375rem",
              fontSize: "0.875rem",
            }}>
              <div style={{ fontWeight: 600, marginBottom: "0.5rem" }}>Input Files</div>
              <div style={{ display: "flex", gap: "1.5rem" }}>
                <span>Cat Info: <strong>{result.stats.files.cat_info}</strong> rows</span>
                <span>Owner Info: <strong>{result.stats.files.owner_info}</strong> rows</span>
                <span>Appt Info: <strong>{result.stats.files.appointment_info}</strong> rows</span>
              </div>
            </div>
          )}

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
              <div>Merged Records: <strong>{result.stats.total}</strong></div>
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
