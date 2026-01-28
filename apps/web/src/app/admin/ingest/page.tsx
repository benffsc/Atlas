"use client";

import { useState, useEffect, useCallback } from "react";

interface ShelterLuvSyncStatus {
  sync_type: string;
  last_sync_at: string | null;
  last_record_time: string | null;
  last_batch_size: number | null;
  pending_processing: number;
  sync_health: string;
}

interface SourceConfig {
  value: string;
  label: string;
  tables: string[];
  accepts?: string[];
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
  data_date_min: string | null;
  data_date_max: string | null;
}

interface ProcessingResult {
  success: boolean;
  rows_total: number;
  rows_inserted: number;
  rows_updated: number;
  rows_skipped: number;
  post_processing?: Record<string, number>;
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
    expired: { bg: "#adb5bd", color: "#495057" },
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

  // Processing state
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [processResult, setProcessResult] = useState<ProcessingResult | null>(null);

  // ShelterLuv sync state
  const [shelterLuvStatus, setShelterLuvStatus] = useState<ShelterLuvSyncStatus[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Fetch sources and uploads
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [sourcesRes, uploadsRes, shelterLuvRes] = await Promise.all([
        fetch("/api/ingest/upload"),
        fetch("/api/ingest/uploads"),
        fetch("/api/admin/shelterluv-status"),
      ]);

      if (sourcesRes.ok) {
        const data = await sourcesRes.json();
        setSources(data.sources);
      }

      if (uploadsRes.ok) {
        const data = await uploadsRes.json();
        setUploads(data.uploads);
      }

      if (shelterLuvRes.ok) {
        const data = await shelterLuvRes.json();
        setShelterLuvStatus(data.status || []);
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
  const selectedSourceConfig = sources.find((s) => s.value === selectedSource);
  const availableTables = selectedSourceConfig?.tables || [];
  const acceptedFileTypes = selectedSourceConfig?.accepts?.join(",") || ".csv,.xlsx,.xls";

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

  // Handle file processing
  const handleProcess = async (uploadId: string) => {
    setProcessingId(uploadId);
    setProcessResult(null);

    try {
      const response = await fetch(`/api/ingest/process/${uploadId}`, {
        method: "POST",
      });

      const result = await response.json();

      if (!response.ok) {
        alert(result.error || "Processing failed");
        fetchData(); // Refresh list even on failure to show updated status
        return;
      }

      setProcessResult(result);
      fetchData(); // Refresh list
    } catch (err) {
      alert("Network error during processing");
      fetchData(); // Refresh list even on error
    } finally {
      setProcessingId(null);
    }
  };

  // Handle ShelterLuv sync
  const handleShelterLuvSync = async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      const response = await fetch("/api/cron/shelterluv-sync?incremental=true", {
        method: "POST",
      });
      const result = await response.json();

      if (!response.ok) {
        setSyncError(result.error || "Sync failed");
      } else {
        // Refresh status after sync
        fetchData();
      }
    } catch (err) {
      setSyncError("Network error during sync");
    } finally {
      setSyncing(false);
    }
  };

  // Auto-process after successful upload
  const handleUploadAndProcess = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploadError(null);
    setUploadSuccess(null);
    setProcessResult(null);

    if (!selectedFile || !selectedSource || !selectedTable) {
      setUploadError("Please select a file, source, and table");
      return;
    }

    setUploading(true);

    try {
      // Upload
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("source_system", selectedSource);
      formData.append("source_table", selectedTable);

      const uploadResponse = await fetch("/api/ingest/upload", {
        method: "POST",
        body: formData,
      });

      const uploadResult = await uploadResponse.json();

      if (!uploadResponse.ok) {
        setUploadError(uploadResult.error || "Upload failed");
        return;
      }

      setUploadSuccess(`Uploaded: ${uploadResult.stored_filename}. Processing...`);

      // Process
      const processResponse = await fetch(`/api/ingest/process/${uploadResult.upload_id}`, {
        method: "POST",
      });

      const processResultData = await processResponse.json();

      if (!processResponse.ok) {
        setUploadError(`Upload succeeded but processing failed: ${processResultData.error}`);
        fetchData();
        return;
      }

      setProcessResult(processResultData);
      setUploadSuccess(
        `Processed ${processResultData.rows_total} rows: ` +
        `${processResultData.rows_inserted} new, ` +
        `${processResultData.rows_updated} updated, ` +
        `${processResultData.rows_skipped} skipped`
      );

      // Reset form
      setSelectedFile(null);
      const fileInput = document.getElementById("file-input") as HTMLInputElement;
      if (fileInput) fileInput.value = "";

      fetchData();
    } catch (err) {
      setUploadError("Network error");
      fetchData(); // Refresh list even on error
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

        <form onSubmit={handleUploadAndProcess}>
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
                Data File {selectedSource === "google_maps" ? "(KMZ or KML)" : "(CSV or XLSX)"}
              </label>
              <input
                id="file-input"
                type="file"
                accept={acceptedFileTypes}
                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
              />
            </div>

            {/* Submit */}
            <button type="submit" disabled={uploading || !selectedFile}>
              {uploading ? "Processing..." : "Upload & Process"}
            </button>
          </div>
        </form>

        {uploadError && (
          <div style={{ color: "#dc3545", marginTop: "1rem" }}>{uploadError}</div>
        )}

        {uploadSuccess && (
          <div style={{ color: "#28a745", marginTop: "1rem" }}>{uploadSuccess}</div>
        )}

        {processResult?.post_processing && Object.keys(processResult.post_processing).length > 0 && (
          <div style={{
            marginTop: "1rem",
            padding: "0.75rem",
            background: "var(--background-secondary, #e7f5ff)",
            borderRadius: "6px",
            border: "1px solid var(--border-color, #bee5eb)",
            color: "var(--text-primary, #0c5460)"
          }}>
            <strong style={{ color: "var(--text-primary, #0c5460)" }}>Post-processing results:</strong>
            <ul style={{ margin: "0.5rem 0 0 1rem", padding: 0, fontSize: "0.875rem", color: "var(--text-primary, #0c5460)" }}>
              {Object.entries(processResult.post_processing).map(([key, value]) => (
                <li key={key}>
                  {key.replace(/_/g, " ")}: {value}
                </li>
              ))}
            </ul>
          </div>
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
                <th>Data Dates</th>
                <th>Results</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {uploads.map((upload) => (
                <tr
                  key={upload.upload_id}
                  style={{
                    opacity: upload.status === "expired" ? 0.5 : 1,
                    background: upload.status === "expired" ? "var(--background-secondary)" : undefined,
                  }}
                >
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
                    {upload.data_date_min && upload.data_date_max ? (
                      upload.data_date_min === upload.data_date_max ? (
                        new Date(upload.data_date_min).toLocaleDateString()
                      ) : (
                        `${new Date(upload.data_date_min).toLocaleDateString()} - ${new Date(upload.data_date_max).toLocaleDateString()}`
                      )
                    ) : (
                      <span className="text-muted">—</span>
                    )}
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
                    ) : upload.status === "expired" ? (
                      <span className="text-muted">Re-upload required</span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td>
                    {upload.status === "pending" && (
                      <button
                        onClick={() => handleProcess(upload.upload_id)}
                        disabled={processingId === upload.upload_id}
                        style={{
                          padding: "0.25rem 0.5rem",
                          fontSize: "0.75rem",
                        }}
                      >
                        {processingId === upload.upload_id ? "Processing..." : "Process"}
                      </button>
                    )}
                    {upload.status === "failed" && (
                      <button
                        onClick={() => handleProcess(upload.upload_id)}
                        disabled={processingId === upload.upload_id}
                        style={{
                          padding: "0.25rem 0.5rem",
                          fontSize: "0.75rem",
                          background: "#ffc107",
                          color: "#000",
                        }}
                      >
                        Retry
                      </button>
                    )}
                    {upload.status === "expired" && (
                      <span className="text-muted" style={{ fontSize: "0.75rem" }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ShelterLuv API Status */}
      <div className="card" style={{ marginTop: "2rem", padding: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
          <h3 style={{ margin: 0, fontSize: "1rem" }}>ShelterLuv API Sync</h3>
          <button
            onClick={handleShelterLuvSync}
            disabled={syncing}
            style={{ padding: "0.25rem 0.75rem", fontSize: "0.875rem" }}
          >
            {syncing ? "Syncing..." : "Sync Now"}
          </button>
        </div>

        {syncError && (
          <div style={{ color: "#dc3545", marginBottom: "0.75rem", fontSize: "0.875rem" }}>
            {syncError}
          </div>
        )}

        {shelterLuvStatus.length > 0 ? (
          <div className="table-container">
            <table style={{ fontSize: "0.875rem" }}>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Last Sync</th>
                  <th>Records</th>
                  <th>Pending</th>
                  <th>Health</th>
                </tr>
              </thead>
              <tbody>
                {shelterLuvStatus.map((status) => (
                  <tr key={status.sync_type}>
                    <td style={{ textTransform: "capitalize" }}>{status.sync_type}</td>
                    <td>
                      {status.last_sync_at
                        ? new Date(status.last_sync_at).toLocaleString()
                        : "Never"}
                    </td>
                    <td>{status.last_batch_size ?? "—"}</td>
                    <td>
                      {status.pending_processing > 0 ? (
                        <span style={{ color: "#ffc107" }}>{status.pending_processing}</span>
                      ) : (
                        <span className="text-muted">0</span>
                      )}
                    </td>
                    <td>
                      <span
                        className="badge"
                        style={{
                          background:
                            status.sync_health === "recent"
                              ? "#28a745"
                              : status.sync_health === "stale"
                              ? "#ffc107"
                              : status.sync_health === "never"
                              ? "#6c757d"
                              : "#dc3545",
                          color: status.sync_health === "stale" ? "#000" : "#fff",
                        }}
                      >
                        {status.sync_health}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-muted" style={{ fontSize: "0.875rem" }}>
            No sync status available. Click &quot;Sync Now&quot; to start.
          </div>
        )}

        <div style={{ marginTop: "0.75rem", fontSize: "0.75rem" }} className="text-muted">
          Automatic sync runs daily at 6 AM UTC. Manual sync fetches incremental updates.
        </div>
      </div>

      <div className="card" style={{ marginTop: "2rem", padding: "1rem" }}>
        <h3 style={{ marginBottom: "0.5rem", fontSize: "1rem" }}>ClinicHQ Processing</h3>
        <p className="text-muted text-sm">
          When you upload ClinicHQ files, the system automatically processes them:
        </p>
        <div style={{ marginTop: "0.75rem" }}>
          <strong style={{ fontSize: "0.875rem" }}>Recommended upload order:</strong>
          <ol style={{ margin: "0.5rem 0 0 1rem", padding: 0, fontSize: "0.875rem" }}>
            <li><strong>cat_info.xlsx</strong> - Updates cat sex data (required for correct procedure types)</li>
            <li><strong>owner_info.xlsx</strong> - Links people to appointments, creates cat-person relationships</li>
            <li><strong>appointment_info.xlsx</strong> - Creates procedures, links cats to places</li>
          </ol>
        </div>
        <div style={{ marginTop: "0.75rem" }}>
          <strong style={{ fontSize: "0.875rem" }}>What happens automatically:</strong>
          <ul style={{ margin: "0.5rem 0 0 1rem", padding: 0, fontSize: "0.875rem" }}>
            <li>Spay/neuter procedures created based on <strong>service type</strong></li>
            <li>Procedures fixed based on cat sex (males → neuter, females → spay)</li>
            <li>Cats linked to places via person relationships</li>
            <li>Cat altered_status updated</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
