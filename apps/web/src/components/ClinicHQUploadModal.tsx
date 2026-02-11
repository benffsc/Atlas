"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface ClinicHQUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

interface UploadedFile {
  filename: string;
  uploadId: string;
}

interface BatchStatus {
  status: string;
  files_uploaded: number;
  has_cat_info: boolean;
  has_owner_info: boolean;
  has_appointment_info: boolean;
  is_complete: boolean;
  missing_files: string[];
}

interface ProcessResult {
  success: boolean;
  partial_success?: boolean;
  message: string;
  files_processed: number;
  files_failed: number;
  results: Array<{
    source_table: string;
    success: boolean;
    error?: string;
    rows_total?: number;
    rows_inserted?: number;
    post_processing?: Record<string, unknown>;
  }>;
}

interface ProcessingProgress {
  _current_step?: string;
  _file_progress?: string;
  [key: string]: unknown;
}

const FILE_TYPES = [
  { key: "cat_info", label: "cat_info", description: "Cat details & sex" },
  { key: "owner_info", label: "owner_info", description: "Owner contacts" },
  { key: "appointment_info", label: "appointment_info", description: "Procedures" },
] as const;

type FileTypeKey = (typeof FILE_TYPES)[number]["key"];

export default function ClinicHQUploadModal({
  isOpen,
  onClose,
  onSuccess,
}: ClinicHQUploadModalProps) {
  const [batchId, setBatchId] = useState<string | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<Record<FileTypeKey, UploadedFile | null>>({
    cat_info: null,
    owner_info: null,
    appointment_info: null,
  });
  const [uploading, setUploading] = useState<FileTypeKey | null>(null);
  const [processing, setProcessing] = useState(false);
  const [processResult, setProcessResult] = useState<ProcessResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<FileTypeKey | null>(null);

  // Progress polling state
  const [processingProgress, setProcessingProgress] = useState<ProcessingProgress | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const fileInputRefs = useRef<Record<FileTypeKey, HTMLInputElement | null>>({
    cat_info: null,
    owner_info: null,
    appointment_info: null,
  });

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setBatchId(null);
      setUploadedFiles({ cat_info: null, owner_info: null, appointment_info: null });
      setUploading(null);
      setProcessing(false);
      setProcessResult(null);
      setError(null);
      setProcessingProgress(null);
      setElapsedSeconds(0);
      setCurrentFileIndex(0);
    }
  }, [isOpen]);

  // Cleanup polling and timer on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const filesUploaded = Object.values(uploadedFiles).filter(Boolean).length;
  const isComplete = filesUploaded === 3;
  const missingFiles = FILE_TYPES.filter((ft) => !uploadedFiles[ft.key]).map((ft) => ft.label);

  const handleFileUpload = useCallback(async (fileType: FileTypeKey, file: File) => {
    setError(null);
    setUploading(fileType);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("source_system", "clinichq");
      formData.append("source_table", fileType);
      if (batchId) {
        formData.append("batch_id", batchId);
      }

      const res = await fetch("/api/ingest/upload", {
        method: "POST",
        body: formData,
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || "Upload failed");
      }

      // Store batch ID from first upload
      if (result.batch_id && !batchId) {
        setBatchId(result.batch_id);
      }

      setUploadedFiles((prev) => ({
        ...prev,
        [fileType]: { filename: file.name, uploadId: result.upload_id },
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(null);
    }
  }, [batchId]);

  const handleDrop = useCallback((fileType: FileTypeKey, e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(null);
    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileUpload(fileType, file);
    }
  }, [handleFileUpload]);

  const handleDragOver = useCallback((fileType: FileTypeKey, e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(fileType);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(null);
  }, []);

  const handleFileInputChange = useCallback((fileType: FileTypeKey, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileUpload(fileType, file);
    }
    // Reset input
    e.target.value = "";
  }, [handleFileUpload]);

  // Poll for processing progress
  const startProgressPolling = useCallback((batchIdToPoll: string) => {
    // Clear any existing polling
    if (pollingRef.current) clearInterval(pollingRef.current);
    if (timerRef.current) clearInterval(timerRef.current);

    setElapsedSeconds(0);
    setProcessingProgress({ _current_step: "Starting batch processing..." });
    setCurrentFileIndex(0);

    // Start elapsed time counter
    timerRef.current = setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);

    // Poll for progress
    pollingRef.current = setInterval(async () => {
      try {
        // Check batch status for completion
        const batchRes = await fetch(`/api/ingest/batch/${batchIdToPoll}`);
        if (!batchRes.ok) return;
        const batchData = await batchRes.json();

        // Also get individual upload statuses for more detail
        const uploadsRes = await fetch("/api/ingest/uploads");
        if (uploadsRes.ok) {
          const uploadsData = await uploadsRes.json();
          const batchUploads = uploadsData.uploads?.filter(
            (u: { batch_id?: string }) => u.batch_id === batchIdToPoll
          ) || [];

          // Find which file is currently processing
          const processingFile = batchUploads.find(
            (u: { status: string }) => u.status === "processing"
          );
          const completedCount = batchUploads.filter(
            (u: { status: string }) => u.status === "completed"
          ).length;

          if (processingFile) {
            setCurrentFileIndex(completedCount);
            setProcessingProgress({
              _current_step: `Processing ${processingFile.source_table}...`,
              _file_progress: `File ${completedCount + 1} of 3`,
              ...((processingFile.post_processing_results as Record<string, unknown>) || {}),
            });
          } else if (completedCount === 3) {
            setProcessingProgress({
              _current_step: "Running entity linking...",
              _file_progress: "All files processed",
            });
          }
        }

        // Check if batch is done
        if (batchData.status === "completed" || batchData.status === "failed") {
          // Stop polling
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }

          // Fetch final results
          const resultRes = await fetch(`/api/ingest/batch/${batchIdToPoll}`);
          const finalResult = await resultRes.json();

          setProcessing(false);
          setProcessingProgress(null);

          if (batchData.status === "completed") {
            setProcessResult({
              success: true,
              message: "All 3 files processed successfully!",
              files_processed: 3,
              files_failed: 0,
              results: finalResult.file_results || [],
            });
            onSuccess?.();
          } else {
            setProcessResult({
              success: false,
              message: finalResult.error || "Processing failed",
              files_processed: 0,
              files_failed: 3,
              results: finalResult.file_results || [],
            });
          }
        }
      } catch (err) {
        console.error("Polling error:", err);
      }
    }, 1500);
  }, [onSuccess]);

  const handleProcess = async () => {
    if (!batchId || !isComplete) return;

    setProcessing(true);
    setError(null);
    setProcessResult(null);

    // Start polling for progress
    startProgressPolling(batchId);

    try {
      // Fire-and-forget: kick off processing
      const res = await fetch(`/api/ingest/batch/${batchId}/process`, {
        method: "POST",
      });

      const result = await res.json();

      if (!res.ok) {
        // Stop polling on immediate error
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        setProcessing(false);
        setProcessingProgress(null);
        throw new Error(result.error || "Processing failed");
      }

      // If we got an immediate response (non-async), use it
      if (result.success !== undefined) {
        // Stop polling
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        setProcessing(false);
        setProcessingProgress(null);
        setProcessResult(result);
        if (result.success) {
          onSuccess?.();
        }
      }
      // Otherwise let polling handle it
    } catch (err) {
      setError(err instanceof Error ? err.message : "Processing failed");
      setProcessing(false);
      setProcessingProgress(null);
    }
  };

  const handleClose = () => {
    if (!uploading && !processing) {
      // Cleanup polling
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      onClose();
    }
  };

  const handleStartNewBatch = () => {
    setBatchId(null);
    setUploadedFiles({ cat_info: null, owner_info: null, appointment_info: null });
    setProcessResult(null);
    setError(null);
    setProcessingProgress(null);
    setElapsedSeconds(0);
    setCurrentFileIndex(0);
  };

  if (!isOpen) return null;

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${String(secs).padStart(2, "0")}`;
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1100,
        padding: "16px",
      }}
      onClick={handleClose}
    >
      <div
        style={{
          background: "var(--card-bg, #fff)",
          borderRadius: "12px",
          width: "100%",
          maxWidth: "640px",
          maxHeight: "90vh",
          overflow: "auto",
          boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: "20px 24px",
            borderBottom: "1px solid var(--border, #e5e5e5)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 600 }}>
              ClinicHQ Batch Upload
            </h2>
            <p style={{ margin: "4px 0 0", fontSize: "0.85rem", color: "var(--muted, #737373)" }}>
              Upload all 3 files to process together
            </p>
          </div>
          <button
            onClick={handleClose}
            disabled={uploading !== null || processing}
            style={{
              background: "none",
              border: "none",
              fontSize: "1.5rem",
              cursor: uploading || processing ? "not-allowed" : "pointer",
              color: "var(--muted, #737373)",
              lineHeight: 1,
            }}
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "20px 24px" }}>
          {/* File Upload Zones */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: "12px",
              marginBottom: "20px",
            }}
          >
            {FILE_TYPES.map((fileType) => {
              const uploaded = uploadedFiles[fileType.key];
              const isUploading = uploading === fileType.key;
              const isDraggedOver = dragOver === fileType.key;

              return (
                <div
                  key={fileType.key}
                  onDrop={(e) => handleDrop(fileType.key, e)}
                  onDragOver={(e) => handleDragOver(fileType.key, e)}
                  onDragLeave={handleDragLeave}
                  onClick={() => !uploaded && !isUploading && !processing && fileInputRefs.current[fileType.key]?.click()}
                  style={{
                    padding: "16px 12px",
                    borderRadius: "8px",
                    textAlign: "center",
                    cursor: uploaded || isUploading || processing ? "default" : "pointer",
                    transition: "all 0.15s ease",
                    background: uploaded
                      ? "var(--success-bg, rgba(40, 167, 69, 0.1))"
                      : isDraggedOver
                      ? "var(--primary-bg, rgba(37, 99, 235, 0.1))"
                      : "var(--bg-secondary, #f3f4f6)",
                    border: uploaded
                      ? "2px solid var(--success-text, #28a745)"
                      : isDraggedOver
                      ? "2px dashed var(--primary, #2563eb)"
                      : "2px dashed var(--border, #e5e7eb)",
                    opacity: processing ? 0.7 : 1,
                  }}
                >
                  <input
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    ref={(el) => { fileInputRefs.current[fileType.key] = el; }}
                    onChange={(e) => handleFileInputChange(fileType.key, e)}
                    style={{ display: "none" }}
                    disabled={processing}
                  />

                  {/* Status Icon */}
                  <div style={{ fontSize: "1.5rem", marginBottom: "8px" }}>
                    {isUploading ? (
                      <span style={{ color: "var(--primary, #2563eb)" }}>...</span>
                    ) : uploaded ? (
                      <span style={{ color: "var(--success-text, #28a745)" }}>&#10003;</span>
                    ) : (
                      <span style={{ color: "var(--muted, #737373)" }}>&#9675;</span>
                    )}
                  </div>

                  {/* File Type Label */}
                  <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "4px" }}>
                    {fileType.label}
                  </div>

                  {/* Status Text */}
                  <div style={{ fontSize: "0.75rem", color: "var(--muted, #737373)" }}>
                    {isUploading ? (
                      "Uploading..."
                    ) : uploaded ? (
                      <span style={{ wordBreak: "break-all" }}>{uploaded.filename}</span>
                    ) : (
                      fileType.description
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Status Message */}
          {!processing && !processResult && (
            <div
              style={{
                padding: "12px 16px",
                borderRadius: "8px",
                marginBottom: "16px",
                background: isComplete
                  ? "var(--success-bg, rgba(40, 167, 69, 0.1))"
                  : "var(--warning-bg, rgba(255, 193, 7, 0.1))",
                border: isComplete
                  ? "1px solid var(--success-text, #28a745)"
                  : "1px solid var(--warning-text, #d4a106)",
              }}
            >
              <div
                style={{
                  fontSize: "0.9rem",
                  fontWeight: 500,
                  color: isComplete
                    ? "var(--success-text, #28a745)"
                    : "var(--warning-text, #856404)",
                }}
              >
                {isComplete
                  ? "All 3 files uploaded! Ready to process."
                  : `${filesUploaded}/3 files uploaded. Missing: ${missingFiles.join(", ")}`}
              </div>
            </div>
          )}

          {/* Processing Progress */}
          {processing && processingProgress && (
            <div
              style={{
                padding: "16px",
                borderRadius: "8px",
                marginBottom: "16px",
                background: "var(--primary-bg, rgba(37, 99, 235, 0.08))",
                border: "1px solid var(--primary, rgba(37, 99, 235, 0.3))",
              }}
            >
              {/* Header with timer */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "12px",
                }}
              >
                <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>
                  Processing...
                </div>
                <div
                  style={{
                    fontSize: "0.8rem",
                    color: "var(--muted, #737373)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {formatTime(elapsedSeconds)}
                </div>
              </div>

              {/* Current step */}
              {processingProgress._current_step && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "8px 12px",
                    background: "var(--card-bg, #fff)",
                    borderRadius: "6px",
                    marginBottom: "12px",
                  }}
                >
                  <div
                    className="spinner"
                    style={{
                      width: "14px",
                      height: "14px",
                      borderWidth: "2px",
                    }}
                  />
                  <span style={{ fontSize: "0.85rem" }}>
                    {processingProgress._current_step}
                  </span>
                </div>
              )}

              {/* File progress indicator */}
              <div
                style={{
                  display: "flex",
                  gap: "8px",
                  marginBottom: "12px",
                }}
              >
                {FILE_TYPES.map((ft, idx) => (
                  <div
                    key={ft.key}
                    style={{
                      flex: 1,
                      height: "4px",
                      borderRadius: "2px",
                      background:
                        idx < currentFileIndex
                          ? "var(--success-text, #28a745)"
                          : idx === currentFileIndex
                          ? "var(--primary, #2563eb)"
                          : "var(--border, #e5e7eb)",
                      transition: "background 0.3s ease",
                    }}
                  />
                ))}
              </div>

              {/* Progress details */}
              {Object.keys(processingProgress).filter((k) => !k.startsWith("_")).length > 0 && (
                <div style={{ fontSize: "0.75rem" }}>
                  {Object.entries(processingProgress)
                    .filter(([k]) => !k.startsWith("_"))
                    .map(([key, value]) => (
                      <div
                        key={key}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          marginTop: "4px",
                        }}
                      >
                        <span style={{ color: "var(--muted, #737373)" }}>
                          {key.replace(/_/g, " ")}
                        </span>
                        <strong>{String(value)}</strong>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div
              style={{
                padding: "12px 16px",
                background: "var(--danger-bg, #f8d7da)",
                border: "1px solid var(--danger-text, #dc3545)",
                borderRadius: "8px",
                marginBottom: "16px",
              }}
            >
              <p style={{ margin: 0, fontSize: "0.9rem", color: "var(--danger-text, #721c24)" }}>
                {error}
              </p>
            </div>
          )}

          {/* Process Result */}
          {processResult && (
            <div
              style={{
                padding: "16px",
                borderRadius: "8px",
                marginBottom: "16px",
                background: processResult.success
                  ? "var(--success-bg, rgba(40, 167, 69, 0.1))"
                  : "var(--danger-bg, rgba(220, 53, 69, 0.1))",
                border: processResult.success
                  ? "1px solid var(--success-text, #28a745)"
                  : "1px solid var(--danger-text, #dc3545)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "12px",
                }}
              >
                <div style={{ fontSize: "0.95rem", fontWeight: 600 }}>
                  {processResult.message}
                </div>
                {elapsedSeconds > 0 && (
                  <div style={{ fontSize: "0.75rem", color: "var(--muted, #737373)" }}>
                    Completed in {formatTime(elapsedSeconds)}
                  </div>
                )}
              </div>

              {/* File results */}
              <div style={{ fontSize: "0.85rem" }}>
                {processResult.results.map((r) => (
                  <div key={r.source_table} style={{ marginTop: "8px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      {r.success ? (
                        <span style={{ color: "var(--success-text, #28a745)" }}>&#10003;</span>
                      ) : (
                        <span style={{ color: "var(--danger-text, #dc3545)" }}>&#10007;</span>
                      )}
                      <strong>{r.source_table}</strong>
                      {r.rows_inserted !== undefined && (
                        <span style={{ color: "var(--muted, #737373)", fontSize: "0.8rem" }}>
                          ({r.rows_inserted} rows)
                        </span>
                      )}
                    </div>
                    {r.error && (
                      <div style={{ color: "var(--danger-text, #dc3545)", marginLeft: "20px", fontSize: "0.8rem" }}>
                        {r.error}
                      </div>
                    )}
                    {r.post_processing && Object.keys(r.post_processing).length > 0 && (
                      <div style={{ marginLeft: "20px", marginTop: "4px", fontSize: "0.75rem" }}>
                        {Object.entries(r.post_processing)
                          .filter(([k]) => !k.startsWith("_"))
                          .map(([key, value]) => (
                            <div key={key} style={{ color: "var(--muted, #737373)" }}>
                              {key.replace(/_/g, " ")}: <strong>{String(value)}</strong>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "16px 24px",
            borderTop: "1px solid var(--border, #e5e5e5)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          {/* Left side: Batch ID */}
          <div style={{ fontSize: "0.7rem", color: "var(--muted, #737373)" }}>
            {batchId ? `Batch: ${batchId.slice(0, 8)}...` : ""}
          </div>

          {/* Right side: Actions */}
          <div style={{ display: "flex", gap: "12px" }}>
            {processResult?.success ? (
              <>
                <button
                  onClick={handleStartNewBatch}
                  style={{
                    padding: "10px 20px",
                    border: "1px solid var(--border, #e5e5e5)",
                    borderRadius: "8px",
                    background: "var(--card-bg, #fff)",
                    fontSize: "0.9rem",
                    cursor: "pointer",
                  }}
                >
                  New Batch
                </button>
                <button
                  onClick={handleClose}
                  style={{
                    padding: "10px 20px",
                    border: "none",
                    borderRadius: "8px",
                    background: "var(--primary, #2563eb)",
                    color: "var(--primary-foreground, #fff)",
                    fontSize: "0.9rem",
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  Done
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={handleClose}
                  disabled={uploading !== null || processing}
                  style={{
                    padding: "10px 20px",
                    border: "1px solid var(--border, #e5e5e5)",
                    borderRadius: "8px",
                    background: "var(--card-bg, #fff)",
                    fontSize: "0.9rem",
                    cursor: uploading || processing ? "not-allowed" : "pointer",
                    opacity: uploading || processing ? 0.6 : 1,
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleProcess}
                  disabled={!isComplete || processing}
                  style={{
                    padding: "10px 20px",
                    border: "none",
                    borderRadius: "8px",
                    background: isComplete && !processing
                      ? "var(--success-text, #28a745)"
                      : "var(--muted, #9ca3af)",
                    color: "#fff",
                    fontSize: "0.9rem",
                    fontWeight: 500,
                    cursor: isComplete && !processing ? "pointer" : "not-allowed",
                    opacity: processing ? 0.6 : 1,
                  }}
                >
                  {processing ? "Processing..." : `Process All Files (${filesUploaded}/3)`}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
