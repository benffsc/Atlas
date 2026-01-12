"use client";

import { useState, useEffect, useCallback } from "react";

interface SourceConfig {
  value: string;
  label: string;
  tables: string[];
}

interface FileUpload {
  upload_id: string;
  original_filename: string;
  stored_filename: string;
  file_size_bytes: number;
  source_system: string;
  source_table: string;
  status: string;
  uploaded_at: string;
  processed_at: string | null;
  rows_total: number | null;
  rows_inserted: number | null;
  rows_updated: number | null;
  rows_skipped: number | null;
  error_message: string | null;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; color: string }> = {
    pending: { bg: "#ffc107", color: "#000" },
    processing: { bg: "#17a2b8", color: "#fff" },
    completed: { bg: "#28a745", color: "#fff" },
    failed: { bg: "#dc3545", color: "#fff" },
  };
  const style = colors[status] || { bg: "#6c757d", color: "#fff" };

  return (
    <span
      className="badge"
      style={{ background: style.bg, color: style.color }}
    >
      {status}
    </span>
  );
}

export default function IngestPage() {
  const [sources, setSources] = useState<SourceConfig[]>([]);
  const [uploads, setUploads] = useState<FileUpload[]>([]);
  const [loading, setLoading] = useState(true);

  // Upload form state
  const [selectedSource, setSelectedSource] = useState("");
  const [selectedTable, setSelectedTable] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);

  // Fetch sources and uploads
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [sourcesRes, uploadsRes] = await Promise.all([
        fetch("/api/ingest/upload"),
        fetch("/api/ingest/uploads"),
      ]);

      if (sourcesRes.ok) {
        const data = await sourcesRes.json();
        setSources(data.sources);
      }

      if (uploadsRes.ok) {
        const data = await uploadsRes.json();
        setUploads(data.uploads);
      }
    } catch (err) {
      console.error("Error fetching data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Get available tables for selected source
  const availableTables = sources.find((s) => s.value === selectedSource)?.tables || [];

  // Handle file upload
  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploadError(null);
    setUploadSuccess(null);

    if (!selectedFile || !selectedSource || !selectedTable) {
      setUploadError("Please select a file, source, and table");
      return;
    }

    setUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("source_system", selectedSource);
      formData.append("source_table", selectedTable);

      const response = await fetch("/api/ingest/upload", {
        method: "POST",
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        setUploadError(result.error || "Upload failed");
        return;
      }

      setUploadSuccess(`File uploaded successfully: ${result.stored_filename}`);
      setSelectedFile(null);

      // Reset file input
      const fileInput = document.getElementById("file-input") as HTMLInputElement;
      if (fileInput) fileInput.value = "";

      // Refresh uploads list
      fetchData();
    } catch (err) {
      setUploadError("Network error during upload");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <h1 style={{ marginBottom: "1.5rem" }}>Data Ingest</h1>

      {/* Upload Form */}
      <div
        className="card"
        style={{
          padding: "1.5rem",
          marginBottom: "2rem",
        }}
      >
        <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Upload File</h2>

        <form onSubmit={handleUpload}>
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "flex-end" }}>
            {/* Source Selection */}
            <div>
              <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.875rem" }}>
                Source System
              </label>
              <select
                value={selectedSource}
                onChange={(e) => {
                  setSelectedSource(e.target.value);
                  setSelectedTable("");
                }}
                style={{ minWidth: "150px" }}
              >
                <option value="">Select source...</option>
                {sources.map((source) => (
                  <option key={source.value} value={source.value}>
                    {source.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Table Selection */}
            <div>
              <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.875rem" }}>
                Data Type
              </label>
              <select
                value={selectedTable}
                onChange={(e) => setSelectedTable(e.target.value)}
                disabled={!selectedSource}
                style={{ minWidth: "180px" }}
              >
                <option value="">Select type...</option>
                {availableTables.map((table) => (
                  <option key={table} value={table}>
                    {table.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>

            {/* File Input */}
            <div>
              <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.875rem" }}>
                CSV File
              </label>
              <input
                id="file-input"
                type="file"
                accept=".csv"
                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
              />
            </div>

            {/* Submit */}
            <button type="submit" disabled={uploading || !selectedFile}>
              {uploading ? "Uploading..." : "Upload"}
            </button>
          </div>
        </form>

        {uploadError && (
          <div style={{ color: "#dc3545", marginTop: "1rem" }}>{uploadError}</div>
        )}

        {uploadSuccess && (
          <div style={{ color: "#28a745", marginTop: "1rem" }}>{uploadSuccess}</div>
        )}
      </div>

      {/* Uploads List */}
      <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Recent Uploads</h2>

      {loading ? (
        <div className="loading">Loading uploads...</div>
      ) : uploads.length === 0 ? (
        <div className="empty">No uploads yet</div>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>File</th>
                <th>Source</th>
                <th>Type</th>
                <th>Size</th>
                <th>Status</th>
                <th>Uploaded</th>
                <th>Results</th>
              </tr>
            </thead>
            <tbody>
              {uploads.map((upload) => (
                <tr key={upload.upload_id}>
                  <td>
                    <div style={{ fontSize: "0.875rem" }}>
                      {upload.original_filename}
                    </div>
                    <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                      {upload.stored_filename}
                    </div>
                  </td>
                  <td>{upload.source_system}</td>
                  <td>{upload.source_table}</td>
                  <td className="text-sm">{formatBytes(upload.file_size_bytes)}</td>
                  <td>
                    <StatusBadge status={upload.status} />
                  </td>
                  <td className="text-sm">
                    {new Date(upload.uploaded_at).toLocaleDateString()}
                  </td>
                  <td className="text-sm">
                    {upload.status === "completed" && upload.rows_total !== null ? (
                      <span>
                        {upload.rows_inserted} new, {upload.rows_updated || 0} updated
                        {upload.rows_skipped ? `, ${upload.rows_skipped} skipped` : ""}
                      </span>
                    ) : upload.status === "failed" ? (
                      <span className="text-muted" title={upload.error_message || ""}>
                        Failed
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card" style={{ marginTop: "2rem", padding: "1rem" }}>
        <h3 style={{ marginBottom: "0.5rem", fontSize: "1rem" }}>Processing</h3>
        <p className="text-muted text-sm">
          After uploading, files are stored and recorded but not yet processed.
          Run the appropriate ingest script to process pending uploads:
        </p>
        <pre style={{ marginTop: "0.5rem", padding: "0.5rem", background: "var(--background)", border: "1px solid var(--border)", borderRadius: "4px", fontSize: "0.75rem" }}>
          {`# Process ClinicHQ uploads
./scripts/ingest/clinichq_ingest.ts

# Process VolunteerHub uploads
./scripts/populate_volunteerhub_people.sh`}
        </pre>
      </div>
    </div>
  );
}
