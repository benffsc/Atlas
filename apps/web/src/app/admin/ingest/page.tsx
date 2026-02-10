"use client";

import React, { useState, useEffect, useCallback } from "react";

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
  post_processing_results: Record<string, unknown> | null;
}

interface ProcessingResult {
  success: boolean;
  rows_total: number;
  rows_inserted: number;
  rows_updated: number;
  rows_skipped: number;
  post_processing?: Record<string, unknown>;
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
    pending: { bg: "var(--warning-bg, #ffc107)", color: "var(--foreground, #000)" },
    processing: { bg: "var(--info-bg, #17a2b8)", color: "#fff" },
    completed: { bg: "var(--success-text, #28a745)", color: "#fff" },
    failed: { bg: "var(--danger-text, #dc3545)", color: "#fff" },
    expired: { bg: "var(--muted, #adb5bd)", color: "var(--foreground, #495057)" },
  };
  const style = colors[status] || { bg: "var(--muted, #6c757d)", color: "#fff" };

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

  // Upload management state
  const [expandedUploadId, setExpandedUploadId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);

  // Progress polling state
  const [pollingUploadId, setPollingUploadId] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [processingProgress, setProcessingProgress] = useState<Record<string, unknown> | null>(null);

  // ShelterLuv sync state
  const [shelterLuvStatus, setShelterLuvStatus] = useState<ShelterLuvSyncStatus[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  // MIG_971: ClinicHQ batch upload state
  const [clinichqBatchId, setClinichqBatchId] = useState<string | null>(null);
  const [batchStatus, setBatchStatus] = useState<{
    status: string;
    files_uploaded: number;
    has_cat_info: boolean;
    has_owner_info: boolean;
    has_appointment_info: boolean;
    is_complete: boolean;
    missing_files: string[];
  } | null>(null);
  const [batchProcessing, setBatchProcessing] = useState(false);
  const [batchResult, setBatchResult] = useState<Record<string, unknown> | null>(null);

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

  // Poll for processing progress when an upload is being processed
  useEffect(() => {
    if (!pollingUploadId) return;

    const poll = async () => {
      try {
        const res = await fetch('/api/ingest/uploads');
        if (!res.ok) return;
        const data = await res.json();
        const upload = (data.uploads as FileUpload[]).find(u => u.upload_id === pollingUploadId);
        if (!upload) return;

        if (upload.post_processing_results) {
          setProcessingProgress(upload.post_processing_results);
        }

        if (upload.status === 'completed' || upload.status === 'failed') {
          setUploads(data.uploads);
          if (upload.status === 'completed') {
            setUploadSuccess(
              `Processed ${upload.rows_total} rows: ` +
              `${upload.rows_inserted} new, ` +
              `${upload.rows_updated || 0} updated, ` +
              `${upload.rows_skipped || 0} skipped`
            );
            if (upload.post_processing_results) {
              const ppResults = Object.fromEntries(
                Object.entries(upload.post_processing_results).filter(([k]) => !k.startsWith('_'))
              );
              setProcessResult({
                success: true,
                rows_total: upload.rows_total || 0,
                rows_inserted: upload.rows_inserted || 0,
                rows_updated: upload.rows_updated || 0,
                rows_skipped: upload.rows_skipped || 0,
                post_processing: ppResults,
              });
            }
          } else {
            setUploadError(`Processing failed: ${upload.error_message || 'Unknown error'}`);
          }
          setPollingUploadId(null);
          setProcessingProgress(null);
          setElapsedSeconds(0);
          return; // Don't schedule another poll
        }
      } catch (err) {
        console.error('Polling error:', err);
      }
    };

    // Poll immediately, then every 2 seconds
    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, [pollingUploadId]);

  // Elapsed time counter during processing
  useEffect(() => {
    if (!pollingUploadId) return;
    setElapsedSeconds(0);
    const timer = setInterval(() => setElapsedSeconds(s => s + 1), 1000);
    return () => clearInterval(timer);
  }, [pollingUploadId]);

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
    setProcessResult(null);
    setUploadError(null);
    setProcessingProgress(null);

    // Fire-and-forget: kick off processing
    fetch(`/api/ingest/process/${uploadId}`, { method: "POST" }).catch(() => {});

    // Start polling for progress
    setPollingUploadId(uploadId);
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

  // Handle upload deletion (soft-delete)
  const handleDelete = async (uploadId: string) => {
    if (!confirm("Remove this upload from the list? (Data is preserved)")) return;
    setDeletingId(uploadId);
    try {
      const response = await fetch(`/api/ingest/uploads/${uploadId}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) {
        setUploadError(result.error || "Failed to delete");
        return;
      }
      fetchData();
    } catch {
      setUploadError("Network error");
    } finally {
      setDeletingId(null);
    }
  };

  // Handle stuck upload reset
  const handleReset = async (uploadId: string) => {
    if (!confirm("Reset this stuck upload to 'failed'? You can then retry or delete it.")) return;
    setResettingId(uploadId);
    try {
      const response = await fetch(`/api/ingest/uploads/${uploadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset" }),
      });
      const result = await response.json();
      if (!response.ok) {
        setUploadError(result.error || "Failed to reset");
        return;
      }
      fetchData();
    } catch {
      setUploadError("Network error");
    } finally {
      setResettingId(null);
    }
  };

  const isStuck = (upload: FileUpload) => {
    if (upload.status !== "processing") return false;
    const startedAt = upload.processed_at
      ? new Date(upload.processed_at).getTime()
      : new Date(upload.uploaded_at).getTime();
    return Date.now() - startedAt > 5 * 60 * 1000; // 5 minutes
  };

  // MIG_971: Fetch batch status
  const fetchBatchStatus = useCallback(async (batchId: string) => {
    try {
      const res = await fetch(`/api/ingest/batch/${batchId}`);
      if (res.ok) {
        const data = await res.json();
        setBatchStatus(data);
      }
    } catch (err) {
      console.error("Error fetching batch status:", err);
    }
  }, []);

  // MIG_971: Handle batch processing
  const handleProcessBatch = async () => {
    if (!clinichqBatchId || !batchStatus?.is_complete) return;

    setBatchProcessing(true);
    setBatchResult(null);
    setUploadError(null);

    try {
      const res = await fetch(`/api/ingest/batch/${clinichqBatchId}/process`, {
        method: "POST",
      });
      const result = await res.json();

      if (!res.ok) {
        setUploadError(result.error || "Batch processing failed");
      } else {
        setBatchResult(result);
        setUploadSuccess(
          result.success
            ? "All 3 ClinicHQ files processed successfully!"
            : "Batch processing completed with some errors"
        );
        // Refresh uploads list
        fetchData();
        // Refresh batch status
        fetchBatchStatus(clinichqBatchId);
      }
    } catch (err) {
      setUploadError("Network error during batch processing");
    } finally {
      setBatchProcessing(false);
    }
  };

  // MIG_971: Start new batch
  const handleStartNewBatch = () => {
    setClinichqBatchId(null);
    setBatchStatus(null);
    setBatchResult(null);
  };

  // Filter uploads by status
  const filteredUploads = statusFilter === "all"
    ? uploads
    : uploads.filter((u) => u.status === statusFilter);

  // Auto-process after successful upload
  // MIG_971: For ClinicHQ, track batch_id and don't auto-process
  const handleUploadAndProcess = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploadError(null);
    setUploadSuccess(null);
    setProcessResult(null);
    setProcessingProgress(null);

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

      // MIG_971: Include batch_id for ClinicHQ uploads
      if (selectedSource === "clinichq" && clinichqBatchId) {
        formData.append("batch_id", clinichqBatchId);
      }

      const uploadResponse = await fetch("/api/ingest/upload", {
        method: "POST",
        body: formData,
      });

      const uploadResult = await uploadResponse.json();

      if (!uploadResponse.ok) {
        setUploadError(uploadResult.error || "Upload failed");
        return;
      }

      // Reset form
      setSelectedFile(null);
      const fileInput = document.getElementById("file-input") as HTMLInputElement;
      if (fileInput) fileInput.value = "";

      // MIG_971: For ClinicHQ, track batch and don't auto-process
      if (selectedSource === "clinichq" && uploadResult.batch_id) {
        setClinichqBatchId(uploadResult.batch_id);
        fetchBatchStatus(uploadResult.batch_id);
        setUploadSuccess(
          `Uploaded: ${uploadResult.original_filename}. ` +
          `Check the ClinicHQ Batch Upload section below to process.`
        );
        fetchData();
        return;
      }

      // For non-ClinicHQ: Fire-and-forget, kick off processing
      fetch(`/api/ingest/process/${uploadResult.upload_id}`, { method: "POST" }).catch(() => {});

      // Start polling for progress
      setPollingUploadId(uploadResult.upload_id);
      setUploadSuccess(`Uploaded: ${uploadResult.original_filename}. Processing...`);
    } catch {
      setUploadError("Network error during upload");
      fetchData();
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
          <div style={{ color: "var(--danger-text, #dc3545)", marginTop: "1rem" }}>{uploadError}</div>
        )}

        {uploadSuccess && (
          <div style={{ color: "var(--success-text, #28a745)", marginTop: "1rem" }}>{uploadSuccess}</div>
        )}

        {processResult?.post_processing && Object.keys(processResult.post_processing).length > 0 && (
          <div style={{
            marginTop: "1rem",
            padding: "0.75rem",
            background: "var(--bg-secondary, #e7f5ff)",
            borderRadius: "6px",
            border: "1px solid var(--border-default, #bee5eb)",
            color: "var(--text-primary)"
          }}>
            <strong style={{ color: "var(--text-primary)" }}>Post-processing results:</strong>
            <ul style={{ margin: "0.5rem 0 0 1rem", padding: 0, fontSize: "0.875rem", color: "var(--text-primary)" }}>
              {Object.entries(processResult.post_processing).map(([key, value]) => (
                <li key={key}>
                  {key.replace(/_/g, " ")}: {String(value)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Uploads List */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h2 style={{ margin: 0, fontSize: "1.25rem" }}>Recent Uploads</h2>
        <div style={{ display: "flex", gap: "0.25rem" }}>
          {["all", "completed", "failed", "processing", "pending"].map((filter) => (
            <button
              key={filter}
              onClick={() => setStatusFilter(filter)}
              style={{
                padding: "0.25rem 0.75rem",
                fontSize: "0.75rem",
                background: statusFilter === filter
                  ? "var(--primary, #0d6efd)"
                  : "var(--bg-secondary, #e9ecef)",
                color: statusFilter === filter ? "var(--primary-foreground, #fff)" : "var(--text-primary)",
                border: statusFilter === filter ? "none" : "1px solid var(--border-default, #e5e7eb)",
                borderRadius: "4px",
                cursor: "pointer",
                textTransform: "capitalize",
              }}
            >
              {filter}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="loading">Loading uploads...</div>
      ) : uploads.length === 0 ? (
        <div className="empty">No uploads yet</div>
      ) : filteredUploads.length === 0 ? (
        <div className="empty">No {statusFilter} uploads</div>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th style={{ width: "2rem" }}></th>
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
              {filteredUploads.map((upload) => {
                const hasDetail =
                  (upload.status === "completed" && upload.post_processing_results &&
                    Object.keys(upload.post_processing_results).length > 0) ||
                  (upload.status === "failed" && upload.error_message);
                const isExpanded = expandedUploadId === upload.upload_id;

                return (
                  <React.Fragment key={upload.upload_id}>
                    <tr
                      style={{
                        opacity: upload.status === "expired" ? 0.5 : 1,
                        background: upload.status === "expired" ? "var(--bg-secondary)" : undefined,
                        cursor: hasDetail ? "pointer" : undefined,
                      }}
                      onClick={() => {
                        if (hasDetail) {
                          setExpandedUploadId(isExpanded ? null : upload.upload_id);
                        }
                      }}
                    >
                      <td style={{ textAlign: "center", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                        {hasDetail ? (isExpanded ? "\u25BC" : "\u25B6") : ""}
                      </td>
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
                        {isStuck(upload) && (
                          <span style={{ fontSize: "0.65rem", color: "var(--danger-text, #dc3545)", marginLeft: "0.25rem" }}>stuck</span>
                        )}
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
                        <div style={{ display: "flex", gap: "0.25rem", alignItems: "center" }} onClick={(e) => e.stopPropagation()}>
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
                                background: "var(--warning-bg, #ffc107)",
                                color: "var(--foreground, #000)",
                              }}
                            >
                              Retry
                            </button>
                          )}
                          {isStuck(upload) && (
                            <button
                              onClick={() => handleReset(upload.upload_id)}
                              disabled={resettingId === upload.upload_id}
                              style={{
                                padding: "0.25rem 0.5rem",
                                fontSize: "0.75rem",
                                background: "var(--warning-text, #fd7e14)",
                                color: "#fff",
                                border: "none",
                                borderRadius: "4px",
                              }}
                            >
                              {resettingId === upload.upload_id ? "Resetting..." : "Reset"}
                            </button>
                          )}
                          {(upload.status === "completed" || upload.status === "failed" || upload.status === "expired" || isStuck(upload)) && (
                            <button
                              onClick={() => handleDelete(upload.upload_id)}
                              disabled={deletingId === upload.upload_id}
                              title="Remove from list"
                              style={{
                                padding: "0.25rem 0.5rem",
                                fontSize: "0.75rem",
                                background: "transparent",
                                color: "var(--danger-text, #dc3545)",
                                border: "1px solid var(--danger-text, #dc3545)",
                                borderRadius: "4px",
                                cursor: "pointer",
                              }}
                            >
                              {deletingId === upload.upload_id ? "..." : "\u2715"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isExpanded && hasDetail && (
                      <tr>
                        <td colSpan={10} style={{ padding: "0.75rem 1rem", background: "var(--bg-secondary, #f8f9fa)" }}>
                          {upload.status === "completed" && upload.post_processing_results && (
                            <div>
                              <strong style={{ fontSize: "0.8rem" }}>Linking results:</strong>
                              <div style={{ display: "flex", gap: "1.5rem", marginTop: "0.5rem", flexWrap: "wrap" }}>
                                {Object.entries(upload.post_processing_results).map(([key, value]) => (
                                  <div key={key} style={{ fontSize: "0.8rem" }}>
                                    <span className="text-muted">{key.replace(/_/g, " ")}:</span>{" "}
                                    <strong>{String(value)}</strong>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {upload.status === "failed" && upload.error_message && (
                            <div>
                              <strong style={{ fontSize: "0.8rem", color: "var(--danger-text, #dc3545)" }}>Error:</strong>
                              <pre style={{
                                margin: "0.5rem 0 0",
                                fontSize: "0.75rem",
                                whiteSpace: "pre-wrap",
                                color: "var(--danger-text, #dc3545)",
                                background: "var(--card-bg, #fff)",
                                padding: "0.5rem",
                                borderRadius: "4px",
                              }}>
                                {upload.error_message}
                              </pre>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
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
          <div style={{ color: "var(--danger-text, #dc3545)", marginBottom: "0.75rem", fontSize: "0.875rem" }}>
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
                        <span style={{ color: "var(--warning-text, #ffc107)" }}>{status.pending_processing}</span>
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
                              ? "var(--success-text, #28a745)"
                              : status.sync_health === "stale"
                              ? "var(--warning-bg, #ffc107)"
                              : status.sync_health === "never"
                              ? "var(--muted, #6c757d)"
                              : "var(--danger-text, #dc3545)",
                          color: status.sync_health === "stale" ? "var(--foreground, #000)" : "#fff",
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

      {/* MIG_971: ClinicHQ Batch Upload Section */}
      <div className="card" style={{ marginTop: "2rem", padding: "1.25rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <h3 style={{ margin: 0, fontSize: "1rem" }}>ClinicHQ Batch Upload</h3>
          {clinichqBatchId && batchStatus?.status === "completed" && (
            <button
              onClick={handleStartNewBatch}
              style={{ padding: "0.25rem 0.75rem", fontSize: "0.75rem" }}
            >
              Start New Batch
            </button>
          )}
        </div>

        {!clinichqBatchId ? (
          <div>
            <p className="text-muted" style={{ fontSize: "0.875rem", marginBottom: "0.75rem" }}>
              Upload ClinicHQ files above with source &quot;ClinicHQ&quot;. A batch will be created automatically.
            </p>
            <p style={{ fontSize: "0.875rem" }}>
              <strong>Required files:</strong> cat_info, owner_info, appointment_info
            </p>
          </div>
        ) : (
          <div>
            {/* Batch Status Display */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: "0.75rem",
              marginBottom: "1rem"
            }}>
              {[
                { key: "cat_info", label: "cat_info", done: batchStatus?.has_cat_info },
                { key: "owner_info", label: "owner_info", done: batchStatus?.has_owner_info },
                { key: "appointment_info", label: "appointment_info", done: batchStatus?.has_appointment_info },
              ].map((file) => (
                <div
                  key={file.key}
                  style={{
                    padding: "0.75rem",
                    borderRadius: "8px",
                    textAlign: "center",
                    background: file.done
                      ? "var(--success-bg, rgba(40, 167, 69, 0.1))"
                      : "var(--bg-secondary, #f8f9fa)",
                    border: file.done
                      ? "1px solid var(--success-text, #28a745)"
                      : "1px solid var(--border-default, #e5e7eb)",
                  }}
                >
                  <div style={{ fontSize: "1.25rem", marginBottom: "0.25rem" }}>
                    {file.done ? "\u2713" : "\u25CB"}
                  </div>
                  <div style={{ fontSize: "0.8rem", fontWeight: 500 }}>{file.label}</div>
                </div>
              ))}
            </div>

            {/* Status Message */}
            <div style={{ marginBottom: "1rem" }}>
              {batchStatus?.is_complete ? (
                <div style={{
                  padding: "0.5rem 0.75rem",
                  background: "var(--success-bg, rgba(40, 167, 69, 0.1))",
                  borderRadius: "6px",
                  fontSize: "0.875rem",
                  color: "var(--success-text, #28a745)",
                }}>
                  All 3 files uploaded! Ready to process.
                </div>
              ) : (
                <div style={{
                  padding: "0.5rem 0.75rem",
                  background: "var(--warning-bg, rgba(255, 193, 7, 0.1))",
                  borderRadius: "6px",
                  fontSize: "0.875rem",
                  color: "var(--warning-text, #856404)",
                }}>
                  {batchStatus?.files_uploaded || 0}/3 files uploaded.
                  {batchStatus?.missing_files && batchStatus.missing_files.length > 0 && (
                    <> Missing: {batchStatus.missing_files.join(", ")}</>
                  )}
                </div>
              )}
            </div>

            {/* Process Button */}
            {batchStatus?.is_complete && batchStatus?.status !== "completed" && (
              <button
                onClick={handleProcessBatch}
                disabled={batchProcessing}
                style={{
                  width: "100%",
                  padding: "0.75rem",
                  fontSize: "1rem",
                  fontWeight: 600,
                  background: batchProcessing ? "var(--muted, #6c757d)" : "var(--success-text, #28a745)",
                  color: "#fff",
                  border: "none",
                  borderRadius: "8px",
                  cursor: batchProcessing ? "not-allowed" : "pointer",
                }}
              >
                {batchProcessing ? "Processing All 3 Files..." : "Process All 3 Files"}
              </button>
            )}

            {/* Batch Results */}
            {batchResult && (
              <div style={{
                marginTop: "1rem",
                padding: "0.75rem",
                background: batchResult.success
                  ? "var(--success-bg, rgba(40, 167, 69, 0.1))"
                  : "var(--danger-bg, rgba(220, 53, 69, 0.1))",
                borderRadius: "6px",
                fontSize: "0.875rem",
              }}>
                <strong>{String(batchResult.message || "")}</strong>
                {Array.isArray(batchResult.results) && batchResult.results.length > 0 && (
                  <div style={{ marginTop: "0.5rem" }}>
                    {batchResult.results.map((r: { source_table: string; success: boolean; error?: string }) => (
                      <div key={r.source_table} style={{ fontSize: "0.8rem", marginTop: "0.25rem" }}>
                        {r.success ? "\u2713" : "\u2717"} {r.source_table}
                        {r.error && <span style={{ color: "var(--danger-text, #dc3545)" }}> - {r.error}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Batch ID for reference */}
            <div style={{ marginTop: "0.75rem", fontSize: "0.7rem" }} className="text-muted">
              Batch ID: {clinichqBatchId}
            </div>
          </div>
        )}

        {/* Instructions */}
        <div style={{
          marginTop: "1rem",
          paddingTop: "1rem",
          borderTop: "1px solid var(--border-default, #e5e7eb)",
          fontSize: "0.8rem",
        }} className="text-muted">
          <strong>Processing order:</strong> cat_info → owner_info → appointment_info.
          Entity linking runs once after all 3 files are processed.
        </div>
      </div>

      {/* Processing Progress Overlay */}
      {pollingUploadId && (
        <div style={{
          position: 'fixed',
          bottom: '2rem',
          right: '2rem',
          width: '380px',
          background: 'var(--card-bg, #fff)',
          border: '1px solid var(--border-default, #e5e7eb)',
          borderRadius: '12px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
          padding: '1.25rem',
          zIndex: 1000,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <strong style={{ fontSize: '0.875rem' }}>Processing Upload</strong>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
              {Math.floor(elapsedSeconds / 60)}:{String(elapsedSeconds % 60).padStart(2, '0')}
            </span>
          </div>

          {processingProgress ? (
            <div style={{ fontSize: '0.8rem' }}>
              {typeof processingProgress._current_step === 'string' && (
                <div style={{
                  padding: '0.5rem 0.75rem',
                  background: 'rgba(13, 110, 253, 0.08)',
                  borderRadius: '6px',
                  marginBottom: '0.75rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}>
                  <span className="spinner" style={{ width: '14px', height: '14px', borderWidth: '2px' }} />
                  <span>{String(processingProgress._current_step)}</span>
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                {Object.entries(processingProgress)
                  .filter(([k]) => !k.startsWith('_'))
                  .map(([key, value]) => (
                    <div key={key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                      <span style={{ color: 'var(--text-muted)' }}>{key.replace(/_/g, ' ')}</span>
                      <strong>{String(value)}</strong>
                    </div>
                  ))}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
              <span className="spinner" style={{ width: '14px', height: '14px', borderWidth: '2px' }} />
              Starting processing...
            </div>
          )}
        </div>
      )}
    </div>
  );
}
