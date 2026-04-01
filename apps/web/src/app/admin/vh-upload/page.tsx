"use client";

import { useState, useRef, useEffect, Suspense } from "react";
import { fetchApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { StatCard } from "@/components/ui/StatCard";
import { SkeletonStats, SkeletonTable } from "@/components/feedback/Skeleton";

// --- Types ---

interface VhStats {
  total_volunteers: number;
  active_volunteers: number;
  matched_volunteers: number;
  unmatched_volunteers: number;
  last_sync: string | null;
  trappers: number;
  fosters: number;
}

interface UploadResult {
  total: number;
  inserted: number;
  updated: number;
  matched: number;
  errors: number;
  errorDetails?: string[];
}

interface RecentUpload {
  upload_id: string;
  filename: string;
  status: string;
  records_found: number | null;
  records_processed: number | null;
  records_errors: number | null;
  created_at: string;
}

// --- Status styles (consistent with ClinicHQ Ingest page) ---

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  processed: { bg: "rgba(16, 185, 129, 0.1)", color: "#059669", label: "Processed" },
  completed: { bg: "rgba(16, 185, 129, 0.1)", color: "#059669", label: "Completed" },
  failed: { bg: "rgba(239, 68, 68, 0.1)", color: "#dc2626", label: "Failed" },
  processing: { bg: "rgba(59, 130, 246, 0.1)", color: "var(--primary, #2563eb)", label: "Processing" },
  pending: { bg: "rgba(107, 114, 128, 0.1)", color: "#6b7280", label: "Pending" },
  uploaded: { bg: "rgba(107, 114, 128, 0.1)", color: "#6b7280", label: "Uploaded" },
};

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] || STATUS_STYLES.pending;
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: "9999px",
      fontSize: "0.7rem",
      fontWeight: 600,
      background: style.bg,
      color: style.color,
    }}>
      {style.label}
    </span>
  );
}

// --- Processing Steps (consistent with ClinicHQ phase stepper) ---

const UPLOAD_STEPS = ["upload", "parse", "match", "done"] as const;
const UPLOAD_STEP_LABELS = ["Upload", "Parse Excel", "Match People", "Done"];

function UploadStepper({ phase }: { phase: "idle" | "uploading" | "processing" | "done" | "error" }) {
  const phaseMap: Record<string, number> = { idle: -1, uploading: 0, processing: 1, done: 3, error: -1 };
  const activeIdx = phaseMap[phase] ?? -1;
  const isError = phase === "error";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "4px", justifyContent: "center", margin: "1rem 0" }}>
      {UPLOAD_STEPS.map((step, idx) => {
        const isDone = idx <= activeIdx && phase === "done";
        const isCurrent = idx === activeIdx && phase !== "done";
        return (
          <div key={step} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "3px" }}>
              <div style={{
                width: "20px", height: "20px", borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "0.6rem", fontWeight: 700, color: "#fff",
                background: isError && isCurrent ? "#dc2626"
                  : isDone ? "#059669"
                  : isCurrent ? "var(--primary, #8b5cf6)"
                  : "var(--border, #d1d5db)",
                ...(isCurrent && !isError ? { boxShadow: "0 0 0 3px rgba(139, 92, 246, 0.2)" } : {}),
              }}>
                {isDone ? "\u2713" : isError && isCurrent ? "\u2717" : ""}
              </div>
              <div style={{
                fontSize: "0.6rem",
                color: isDone || isCurrent ? "var(--foreground)" : "var(--muted)",
                fontWeight: isCurrent ? 600 : 400,
                whiteSpace: "nowrap",
              }}>
                {UPLOAD_STEP_LABELS[idx]}
              </div>
            </div>
            {idx < UPLOAD_STEPS.length - 1 && (
              <div style={{
                width: "20px", height: "2px", marginBottom: "16px",
                background: idx < activeIdx || (phase === "done") ? "#059669" : "var(--border, #d1d5db)",
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// --- Health Banner (mirrors ClinicHQ pattern) ---

function VhHealthBanner({ stats }: { stats: VhStats | null }) {
  if (!stats) return null;

  const hoursSinceSync = stats.last_sync
    ? (Date.now() - new Date(stats.last_sync).getTime()) / (1000 * 60 * 60)
    : null;

  const isStale = hoursSinceSync === null || hoursSinceSync > 48;
  const isVeryStale = hoursSinceSync === null || hoursSinceSync > 168; // 7 days

  const bg = isVeryStale ? "rgba(239, 68, 68, 0.08)" : isStale ? "rgba(245, 158, 11, 0.08)" : "rgba(16, 185, 129, 0.08)";
  const borderColor = isVeryStale ? "rgba(239, 68, 68, 0.3)" : isStale ? "rgba(245, 158, 11, 0.3)" : "rgba(16, 185, 129, 0.3)";
  const icon = isVeryStale ? "\u2717" : isStale ? "\u26A0" : "\u2713";
  const text = hoursSinceSync === null
    ? "No VolunteerHub data synced yet"
    : isVeryStale
    ? `VH data is ${Math.round(hoursSinceSync / 24)} days old — API is down, upload a fresh export`
    : isStale
    ? `Last sync ${Math.round(hoursSinceSync)} hours ago — consider uploading a fresh export`
    : `VH data is current (synced ${Math.round(hoursSinceSync)} hours ago)`;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "8px",
      padding: "10px 16px", borderRadius: "8px",
      background: bg, border: `1px solid ${borderColor}`,
      marginBottom: "1.5rem", fontSize: "0.85rem",
    }}>
      <span style={{ fontSize: "1rem" }}>{icon}</span>
      <span>{text}</span>
    </div>
  );
}

// --- Page Content ---

function VhUploadContent() {
  const { addToast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<"idle" | "uploading" | "processing" | "done" | "error">("idle");
  const [result, setResult] = useState<UploadResult | null>(null);
  const [stats, setStats] = useState<VhStats | null>(null);
  const [recentUploads, setRecentUploads] = useState<RecentUpload[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const data = await fetchApi<VhStats>("/api/admin/vh-stats");
      setStats(data);
    } catch {
      setStats(null);
    }
    try {
      const uploads = await fetchApi<{ uploads: RecentUpload[] }>(
        "/api/ingest/uploads?source_system=volunteerhub&limit=5"
      );
      setRecentUploads(uploads.uploads || []);
    } catch {
      setRecentUploads([]);
    }
    setLoading(false);
  };

  const handleUpload = async (file: File) => {
    setPhase("uploading");
    setResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("source_system", "volunteerhub");
      formData.append("source_table", "users");

      const uploadRes = await fetch("/api/ingest/upload", { method: "POST", body: formData });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok || !uploadData.data?.upload_id) {
        throw new Error(uploadData.error?.message || uploadData.message || "Upload failed");
      }

      setPhase("processing");
      const processRes = await fetch("/api/ingest/process-vh-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ upload_id: uploadData.data.upload_id }),
      });
      const processData = await processRes.json();
      if (!processRes.ok) {
        throw new Error(processData.error?.message || processData.message || "Processing failed");
      }

      const r = processData.data || processData;
      setResult({ total: r.total, inserted: r.inserted, updated: r.updated, matched: r.matched || 0, errors: r.errors, errorDetails: r.errorDetails });
      setPhase("done");
      addToast({ type: "success", message: `Done! ${r.total} volunteers: ${r.inserted} new, ${r.updated} updated` });
      fetchData();
    } catch (err) {
      setPhase("error");
      addToast({ type: "error", message: err instanceof Error ? err.message : "Upload failed" });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const isWorking = phase === "uploading" || phase === "processing";

  return (
    <div>
      {/* Header — matches ClinicHQ Ingest Dashboard layout */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ margin: 0 }}>VolunteerHub Upload</h1>
          <p className="text-muted" style={{ margin: "4px 0 0" }}>
            Manual sync when VH API is unavailable — export from VH admin, upload here
          </p>
        </div>
        <button
          onClick={() => !isWorking && fileRef.current?.click()}
          disabled={isWorking}
          style={{
            padding: "10px 20px",
            background: isWorking ? "var(--muted)" : "#8b5cf6",
            color: "#fff",
            border: "none",
            borderRadius: "8px",
            fontSize: "0.9rem",
            fontWeight: 600,
            cursor: isWorking ? "not-allowed" : "pointer",
          }}
        >
          {isWorking ? "Processing..." : "Upload Export"}
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleUpload(file);
        }}
      />

      {/* Health banner */}
      <VhHealthBanner stats={stats} />

      {/* Summary stats — matches ClinicHQ stat cards pattern */}
      {loading ? (
        <SkeletonStats count={5} />
      ) : stats ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.75rem", marginBottom: "1.5rem" }}>
          <StatCard label="Total Volunteers" value={stats.total_volunteers} accentColor="#6b7280" />
          <StatCard label="Active" value={stats.active_volunteers} accentColor="#059669" />
          <StatCard label="Matched" value={stats.matched_volunteers} accentColor="#8b5cf6" />
          <StatCard label="Trappers" value={stats.trappers} accentColor="#3b82f6" />
          <StatCard label="Fosters" value={stats.fosters} accentColor="#ec4899" />
        </div>
      ) : null}

      {/* Upload zone — shows when idle or after completion */}
      {(phase === "idle" || phase === "done" || phase === "error") && !isWorking && (
        <div
          onClick={() => fileRef.current?.click()}
          style={{
            padding: "2rem",
            background: "var(--card-bg)",
            border: "2px dashed var(--border)",
            borderRadius: "12px",
            textAlign: "center",
            cursor: "pointer",
            marginBottom: "1.5rem",
            transition: "border-color 0.15s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#8b5cf6"; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; }}
        >
          <div style={{ fontSize: "1.5rem", marginBottom: "0.5rem", opacity: 0.4 }}>
            {phase === "done" ? "\u2713" : "\u2191"}
          </div>
          <div style={{ fontWeight: 600, color: "var(--foreground)", marginBottom: "0.25rem" }}>
            {phase === "done" ? "Upload another export" : "Click to upload VolunteerHub export"}
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
            Export &quot;ALL Users &amp; Fields&quot; from VH admin as .xlsx
          </div>
        </div>
      )}

      {/* Processing stepper — visible during upload/process */}
      {isWorking && (
        <div style={{
          padding: "2rem",
          background: "var(--card-bg)",
          border: "1px solid var(--border)",
          borderRadius: "12px",
          marginBottom: "1.5rem",
        }}>
          <UploadStepper phase={phase} />
          <div style={{ textAlign: "center", fontSize: "0.85rem", color: "var(--muted)" }}>
            {phase === "uploading" ? "Uploading file..." : "Processing 1,300+ volunteers — this may take a minute"}
          </div>
        </div>
      )}

      {/* Result — matches ClinicHQ success/error pattern */}
      {result && (
        <div style={{
          padding: "1.25rem",
          background: result.errors > 0 ? "rgba(245, 158, 11, 0.08)" : "rgba(16, 185, 129, 0.08)",
          border: `1px solid ${result.errors > 0 ? "rgba(245, 158, 11, 0.3)" : "rgba(16, 185, 129, 0.3)"}`,
          borderRadius: "8px",
          marginBottom: "1.5rem",
        }}>
          <div style={{ fontWeight: 600, marginBottom: "0.5rem" }}>
            {result.errors > 0 ? "\u26A0 Import Complete (with warnings)" : "\u2713 Import Complete"}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "0.5rem", fontSize: "0.85rem" }}>
            <div><strong>{result.total}</strong> total</div>
            <div style={{ color: "#059669" }}><strong>{result.inserted}</strong> new</div>
            <div><strong>{result.updated}</strong> updated</div>
            <div style={{ color: "#8b5cf6" }}><strong>{result.matched}</strong> matched</div>
            {result.errors > 0 && <div style={{ color: "#dc2626" }}><strong>{result.errors}</strong> errors</div>}
          </div>
          {result.errorDetails && result.errorDetails.length > 0 && (
            <div style={{ marginTop: "0.75rem", fontSize: "0.75rem", color: "#dc2626", background: "rgba(239,68,68,0.05)", padding: "8px", borderRadius: "4px" }}>
              {result.errorDetails.map((e, i) => <div key={i}>{e}</div>)}
            </div>
          )}
        </div>
      )}

      {/* Upload History — matches ClinicHQ batch history table */}
      {recentUploads.length > 0 && (
        <div style={{ marginBottom: "1.5rem" }}>
          <h3 style={{ marginBottom: "0.75rem" }}>Recent Uploads</h3>
          <div style={{ background: "var(--card-bg)", borderRadius: "8px", border: "1px solid var(--border)", overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--section-bg)" }}>
                  <th style={{ padding: "0.6rem 1rem", textAlign: "left", borderBottom: "1px solid var(--border)", fontSize: "0.8rem", fontWeight: 500 }}>File</th>
                  <th style={{ padding: "0.6rem 1rem", textAlign: "center", borderBottom: "1px solid var(--border)", fontSize: "0.8rem", fontWeight: 500 }}>Status</th>
                  <th style={{ padding: "0.6rem 1rem", textAlign: "right", borderBottom: "1px solid var(--border)", fontSize: "0.8rem", fontWeight: 500 }}>Records</th>
                  <th style={{ padding: "0.6rem 1rem", textAlign: "right", borderBottom: "1px solid var(--border)", fontSize: "0.8rem", fontWeight: 500 }}>Date</th>
                </tr>
              </thead>
              <tbody>
                {recentUploads.map((u) => (
                  <tr key={u.upload_id}>
                    <td style={{ padding: "0.6rem 1rem", borderBottom: "1px solid var(--border)", fontSize: "0.8rem" }}>
                      {u.filename || "VH Export"}
                    </td>
                    <td style={{ padding: "0.6rem 1rem", borderBottom: "1px solid var(--border)", textAlign: "center" }}>
                      <StatusBadge status={u.status} />
                    </td>
                    <td style={{ padding: "0.6rem 1rem", borderBottom: "1px solid var(--border)", textAlign: "right", fontSize: "0.8rem" }}>
                      {u.records_processed != null ? u.records_processed.toLocaleString() : "-"}
                      {u.records_errors != null && u.records_errors > 0 && (
                        <span style={{ color: "#dc2626", marginLeft: "4px" }}>({u.records_errors} err)</span>
                      )}
                    </td>
                    <td style={{ padding: "0.6rem 1rem", borderBottom: "1px solid var(--border)", textAlign: "right", fontSize: "0.8rem", color: "var(--muted)" }}>
                      {new Date(u.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Instructions — clean card */}
      <div style={{
        padding: "1.25rem",
        background: "var(--card-bg)",
        border: "1px solid var(--border)",
        borderRadius: "8px",
      }}>
        <div style={{ fontWeight: 600, marginBottom: "0.75rem" }}>How to export from VolunteerHub</div>
        <ol style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.85rem", color: "var(--muted)", lineHeight: 1.8 }}>
          <li>Log into <a href="https://forgottenfelines.volunteerhub.com" target="_blank" rel="noopener noreferrer" style={{ color: "#8b5cf6" }}>forgottenfelines.volunteerhub.com</a></li>
          <li>Go to <strong>Reports</strong> &rarr; <strong>Users</strong></li>
          <li>Select <strong>ALL Users &amp; Fields</strong></li>
          <li>Click <strong>Export</strong> &rarr; choose <strong>.xlsx</strong></li>
          <li>Upload the file using the button above</li>
        </ol>
        <div style={{ marginTop: "0.75rem", fontSize: "0.75rem", color: "var(--muted)", fontStyle: "italic" }}>
          This is a manual fallback. When the VH API is restored, volunteers sync automatically every morning.
        </div>
      </div>
    </div>
  );
}

export default function VhUploadPage() {
  return (
    <Suspense fallback={<div style={{ padding: "2rem" }}><SkeletonStats count={5} /><SkeletonTable rows={3} columns={4} /></div>}>
      <VhUploadContent />
    </Suspense>
  );
}
