"use client";

import { useState, useRef, useEffect, Suspense } from "react";
import { fetchApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { StatCard } from "@/components/ui/StatCard";
import { SkeletonStats } from "@/components/feedback/Skeleton";

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

function VhUploadContent() {
  const { addToast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [stats, setStats] = useState<VhStats | null>(null);
  const [recentUploads, setRecentUploads] = useState<RecentUpload[]>([]);
  const [loadingStats, setLoadingStats] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    setLoadingStats(true);
    try {
      // Get VH volunteer stats
      const data = await fetchApi<VhStats>("/api/admin/vh-stats");
      setStats(data);
    } catch {
      // Stats endpoint may not exist yet — that's OK
      setStats(null);
    }

    try {
      // Get recent VH uploads
      const uploads = await fetchApi<{ uploads: RecentUpload[] }>(
        "/api/ingest/uploads?source_system=volunteerhub&limit=5"
      );
      setRecentUploads(uploads.uploads || []);
    } catch {
      setRecentUploads([]);
    }
    setLoadingStats(false);
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    setResult(null);
    try {
      // Step 1: Upload the file
      const formData = new FormData();
      formData.append("file", file);
      formData.append("source_system", "volunteerhub");
      formData.append("source_table", "users");

      const uploadRes = await fetch("/api/ingest/upload", { method: "POST", body: formData });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok || !uploadData.data?.upload_id) {
        throw new Error(uploadData.error?.message || uploadData.message || "Upload failed");
      }
      const uploadId = uploadData.data.upload_id;
      addToast({ type: "info", message: `File uploaded — processing ${file.name}...` });

      // Step 2: Process the upload
      setUploading(false);
      setProcessing(true);
      const processRes = await fetch("/api/ingest/process-vh-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ upload_id: uploadId }),
      });
      const processData = await processRes.json();
      if (!processRes.ok) {
        throw new Error(processData.error?.message || processData.message || "Processing failed");
      }

      const r = processData.data || processData;
      setResult({ total: r.total, inserted: r.inserted, updated: r.updated, matched: r.matched || 0, errors: r.errors, errorDetails: r.errorDetails });
      addToast({ type: "success", message: `Done! ${r.total} volunteers: ${r.inserted} new, ${r.updated} updated` });
      fetchStats();
    } catch (err) {
      addToast({ type: "error", message: err instanceof Error ? err.message : "Upload failed" });
    } finally {
      setUploading(false);
      setProcessing(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const isWorking = uploading || processing;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ margin: 0 }}>VolunteerHub Upload</h1>
          <p style={{ margin: "0.25rem 0 0", color: "var(--muted)", fontSize: "0.85rem" }}>
            Manual sync when the VH API is unavailable — export from VH admin, upload here
          </p>
        </div>
      </div>

      {/* Stats */}
      {loadingStats ? (
        <SkeletonStats count={4} />
      ) : stats ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.75rem", marginBottom: "1.5rem" }}>
          <StatCard label="Total Volunteers" value={stats.total_volunteers} />
          <StatCard label="Active" value={stats.active_volunteers} valueColor="var(--success-text)" />
          <StatCard label="Matched to Atlas" value={stats.matched_volunteers} valueColor="var(--primary)" />
          <StatCard label="Unmatched" value={stats.unmatched_volunteers} valueColor={stats.unmatched_volunteers > 0 ? "var(--warning-text)" : "var(--muted)"} />
          {stats.last_sync && (
            <StatCard label="Last Sync" value={new Date(stats.last_sync).toLocaleDateString()} />
          )}
        </div>
      ) : null}

      {/* Upload Zone */}
      <div
        onClick={() => !isWorking && fileRef.current?.click()}
        style={{
          padding: "2.5rem 2rem",
          background: isWorking ? "var(--bg-secondary)" : "var(--card-bg)",
          border: `2px dashed ${isWorking ? "var(--muted)" : "var(--primary, #8b5cf6)"}`,
          borderRadius: "12px",
          textAlign: "center",
          cursor: isWorking ? "wait" : "pointer",
          transition: "all 0.15s ease",
          marginBottom: "1.5rem",
        }}
        onMouseEnter={(e) => {
          if (!isWorking) e.currentTarget.style.borderColor = "var(--primary)";
          if (!isWorking) e.currentTarget.style.background = "var(--section-bg)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = isWorking ? "var(--muted)" : "var(--primary, #8b5cf6)";
          e.currentTarget.style.background = isWorking ? "var(--bg-secondary)" : "var(--card-bg)";
        }}
      >
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
        <div style={{ fontSize: "2.5rem", marginBottom: "0.5rem", opacity: 0.5 }}>
          {uploading ? "..." : processing ? "..." : "^"}
        </div>
        <div style={{ fontSize: "1rem", fontWeight: 600, color: "var(--foreground)", marginBottom: "0.25rem" }}>
          {uploading ? "Uploading..." : processing ? "Processing volunteers..." : "Click to upload VolunteerHub export"}
        </div>
        <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
          {isWorking ? "This may take a minute for 1,300+ volunteers" : "Export \"ALL Users & Fields\" from VH admin as .xlsx"}
        </div>
      </div>

      {/* Result */}
      {result && (
        <div style={{
          padding: "1.25rem",
          background: result.errors > 0 ? "var(--warning-bg)" : "var(--success-bg)",
          border: `1px solid ${result.errors > 0 ? "var(--warning-border)" : "var(--success-border)"}`,
          borderRadius: "8px",
          marginBottom: "1.5rem",
        }}>
          <div style={{ fontWeight: 600, marginBottom: "0.5rem", fontSize: "0.95rem" }}>
            Import Complete
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "0.75rem", fontSize: "0.85rem" }}>
            <div><strong>{result.total}</strong> total processed</div>
            <div style={{ color: "var(--success-text)" }}><strong>{result.inserted}</strong> new volunteers</div>
            <div><strong>{result.updated}</strong> updated</div>
            <div><strong>{result.matched}</strong> matched to Atlas people</div>
            {result.errors > 0 && (
              <div style={{ color: "var(--danger-text)" }}><strong>{result.errors}</strong> errors</div>
            )}
          </div>
          {result.errorDetails && result.errorDetails.length > 0 && (
            <div style={{ marginTop: "0.75rem", fontSize: "0.75rem", color: "var(--danger-text)" }}>
              {result.errorDetails.map((e, i) => <div key={i}>{e}</div>)}
            </div>
          )}
        </div>
      )}

      {/* Instructions */}
      <div style={{
        padding: "1.25rem",
        background: "var(--card-bg)",
        border: "1px solid var(--border)",
        borderRadius: "8px",
      }}>
        <div style={{ fontWeight: 600, marginBottom: "0.75rem" }}>How to export from VolunteerHub</div>
        <ol style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.85rem", color: "var(--muted)", lineHeight: 1.8 }}>
          <li>Log into <a href="https://forgottenfelines.volunteerhub.com" target="_blank" rel="noopener" style={{ color: "var(--primary)" }}>forgottenfelines.volunteerhub.com</a></li>
          <li>Go to <strong>Reports</strong> → <strong>Users</strong></li>
          <li>Select <strong>ALL Users &amp; Fields</strong></li>
          <li>Click <strong>Export</strong> → choose <strong>.xlsx</strong></li>
          <li>Upload the file above</li>
        </ol>
        <div style={{ marginTop: "0.75rem", fontSize: "0.75rem", color: "var(--muted)", fontStyle: "italic" }}>
          This is a manual fallback for when the VH API is unavailable. When the API is working, volunteers sync automatically every morning.
        </div>
      </div>
    </div>
  );
}

export default function VhUploadPage() {
  return (
    <Suspense fallback={<SkeletonStats count={4} />}>
      <VhUploadContent />
    </Suspense>
  );
}
