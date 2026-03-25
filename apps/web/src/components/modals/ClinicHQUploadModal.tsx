"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { fetchApi, ApiError } from "@/lib/api-client";
import * as XLSX from "xlsx";

interface ClinicHQUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

interface DetectedFile {
  file: File;
  detectedType: FileTypeKey;
  confidence: "high" | "low";
  signatureColumns: string[];
}

interface UploadedFile {
  filename: string;
  uploadId: string;
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

type FileTypeKey = "cat_info" | "owner_info" | "appointment_info";

// Column signatures that uniquely identify each ClinicHQ export file.
// Only need 2+ matches from the signature set to classify with high confidence.
const FILE_SIGNATURES: Record<FileTypeKey, { columns: string[]; label: string; icon: string }> = {
  cat_info: {
    columns: ["Breed", "Primary Color", "Secondary Color", "Sex", "Weight", "Age Years", "Spay Neuter Status"],
    label: "Cat Info",
    icon: "🐱",
  },
  owner_info: {
    columns: ["Owner First Name", "Owner Last Name", "Owner Email", "Owner Phone", "Owner Cell Phone", "Owner Address"],
    label: "Owner Info",
    icon: "👤",
  },
  appointment_info: {
    columns: ["Service / Subsidy", "Spay", "Neuter", "Vet Name", "Technician", "Felv Test", "Temperature"],
    label: "Appointment Info",
    icon: "📋",
  },
};

const FILE_TYPE_ORDER: FileTypeKey[] = ["cat_info", "owner_info", "appointment_info"];

/**
 * Detect file type by reading XLSX/CSV headers and matching against known column signatures.
 */
async function detectFileType(file: File): Promise<{ type: FileTypeKey; confidence: "high" | "low"; matched: string[] } | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array", sheetRows: 2 });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });

        if (rows.length === 0) { resolve(null); return; }

        const headers = new Set((rows[0] as string[]).map((h) => String(h).trim()));

        // Score each file type by matching columns
        let bestType: FileTypeKey | null = null;
        let bestScore = 0;
        let bestMatched: string[] = [];

        for (const [fileType, sig] of Object.entries(FILE_SIGNATURES) as [FileTypeKey, typeof FILE_SIGNATURES[FileTypeKey]][]) {
          const matched = sig.columns.filter((col) => headers.has(col));
          if (matched.length > bestScore) {
            bestScore = matched.length;
            bestType = fileType;
            bestMatched = matched;
          }
        }

        if (bestType && bestScore >= 2) {
          resolve({ type: bestType, confidence: bestScore >= 3 ? "high" : "low", matched: bestMatched });
        } else {
          resolve(null);
        }
      } catch {
        resolve(null);
      }
    };
    reader.onerror = () => resolve(null);
    reader.readAsArrayBuffer(file);
  });
}

export default function ClinicHQUploadModal({
  isOpen,
  onClose,
  onSuccess,
}: ClinicHQUploadModalProps) {
  const router = useRouter();
  const [batchId, setBatchId] = useState<string | null>(null);
  const [detectedFiles, setDetectedFiles] = useState<Record<FileTypeKey, DetectedFile | null>>({
    cat_info: null,
    owner_info: null,
    appointment_info: null,
  });
  const [uploadedFiles, setUploadedFiles] = useState<Record<FileTypeKey, UploadedFile | null>>({
    cat_info: null,
    owner_info: null,
    appointment_info: null,
  });
  const [detecting, setDetecting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [processResult, setProcessResult] = useState<ProcessResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Progress polling state
  const [processingProgress, setProcessingProgress] = useState<ProcessingProgress | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setBatchId(null);
      setDetectedFiles({ cat_info: null, owner_info: null, appointment_info: null });
      setUploadedFiles({ cat_info: null, owner_info: null, appointment_info: null });
      setDetecting(false);
      setUploading(false);
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

  const detectedCount = Object.values(detectedFiles).filter(Boolean).length;
  const uploadedCount = Object.values(uploadedFiles).filter(Boolean).length;
  const allDetected = detectedCount === 3;
  const allUploaded = uploadedCount === 3;

  // Handle files dropped or selected — auto-detect each one
  const handleFiles = useCallback(async (files: FileList | File[]) => {
    setError(null);
    setDetecting(true);

    const fileArray = Array.from(files).filter(
      (f) => f.name.endsWith(".xlsx") || f.name.endsWith(".csv") || f.name.endsWith(".xls")
    );

    if (fileArray.length === 0) {
      setError("Please upload .xlsx or .csv files exported from ClinicHQ.");
      setDetecting(false);
      return;
    }

    const newDetected = { ...detectedFiles };
    const conflicts: string[] = [];

    for (const file of fileArray) {
      const result = await detectFileType(file);
      if (!result) {
        conflicts.push(`"${file.name}" — could not identify file type from column headers`);
        continue;
      }

      // Check for duplicate type detection
      const existing = newDetected[result.type];
      if (existing && existing.file !== file) {
        conflicts.push(
          `"${file.name}" detected as ${FILE_SIGNATURES[result.type].label}, but "${existing.file.name}" was already assigned to that slot`
        );
        continue;
      }

      newDetected[result.type] = {
        file,
        detectedType: result.type,
        confidence: result.confidence,
        signatureColumns: result.matched,
      };
    }

    setDetectedFiles(newDetected);
    setDetecting(false);

    if (conflicts.length > 0) {
      setError(conflicts.join("\n"));
    }
  }, [detectedFiles]);

  // Upload all detected files
  const handleUploadAll = useCallback(async () => {
    if (!allDetected) return;
    setError(null);
    setUploading(true);

    let currentBatchId = batchId;

    try {
      for (const fileType of FILE_TYPE_ORDER) {
        const detected = detectedFiles[fileType];
        if (!detected) continue;

        const formData = new FormData();
        formData.append("file", detected.file);
        formData.append("source_system", "clinichq");
        formData.append("source_table", fileType);
        if (currentBatchId) {
          formData.append("batch_id", currentBatchId);
        }

        const data = await fetchApi<{ batch_id: string; upload_id: string }>("/api/ingest/upload", {
          method: "POST",
          body: formData,
        });

        if (data.batch_id && !currentBatchId) {
          currentBatchId = data.batch_id;
          setBatchId(data.batch_id);
        }

        setUploadedFiles((prev) => ({
          ...prev,
          [fileType]: { filename: detected.file.name, uploadId: data.upload_id },
        }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }, [allDetected, batchId, detectedFiles]);

  // Remove a detected file
  const removeFile = useCallback((fileType: FileTypeKey) => {
    setDetectedFiles((prev) => ({ ...prev, [fileType]: null }));
    setUploadedFiles((prev) => ({ ...prev, [fileType]: null }));
  }, []);

  // Poll for processing progress
  const startProgressPolling = useCallback((batchIdToPoll: string) => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    if (timerRef.current) clearInterval(timerRef.current);

    setElapsedSeconds(0);
    setProcessingProgress({ _current_step: "Starting batch processing..." });
    setCurrentFileIndex(0);

    timerRef.current = setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);

    pollingRef.current = setInterval(async () => {
      try {
        const batchData = await fetchApi<{ status: string; error?: string; file_results?: Array<{ source_table: string; success: boolean; error?: string; rows_total?: number; rows_inserted?: number; post_processing?: Record<string, unknown> }> }>(`/api/ingest/batch/${batchIdToPoll}`);

        try {
          const uploadsData = await fetchApi<{ uploads: Array<{ batch_id?: string; status: string; source_table: string; post_processing_results?: Record<string, unknown> }> }>("/api/ingest/uploads");
          const batchUploads = uploadsData.uploads?.filter((u) => u.batch_id === batchIdToPoll) || [];
          const processingFile = batchUploads.find((u) => u.status === "processing");
          const completedCount = batchUploads.filter((u) => u.status === "completed").length;

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
        } catch {
          // Ignore upload status errors during polling
        }

        if (batchData.status === "completed" || batchData.status === "failed") {
          if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
          if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }

          const finalResult = await fetchApi<{ status: string; error?: string; file_results?: Array<{ source_table: string; success: boolean; error?: string; rows_total?: number; rows_inserted?: number; post_processing?: Record<string, unknown> }> }>(`/api/ingest/batch/${batchIdToPoll}`);

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
    if (!batchId || !allUploaded) return;

    setProcessing(true);
    setError(null);
    setProcessResult(null);
    startProgressPolling(batchId);

    try {
      const res = await fetch(`/api/ingest/batch/${batchId}/process`, { method: "POST" });

      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        const text = await res.text();
        console.error("Non-JSON response:", text.substring(0, 200));
        throw new Error(
          res.status === 504 || res.status === 502
            ? "TIMEOUT:Processing continues in the background."
            : `Server error (${res.status}). Please retry.`
        );
      }

      const result = await res.json();

      if (!res.ok) {
        if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        setProcessing(false);
        setProcessingProgress(null);
        const errorMsg = typeof result.error === "string" ? result.error : result.error?.message || "Processing failed";
        throw new Error(errorMsg);
      }

      const processData = (result.success === true && "data" in result) ? result.data : result;

      if (processData.success !== undefined) {
        if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        setProcessing(false);
        setProcessingProgress(null);
        setProcessResult(processData);
        if (processData.success) onSuccess?.();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Processing failed");
      setProcessing(false);
      setProcessingProgress(null);
    }
  };

  const handleClose = () => {
    if (!uploading && !processing) {
      if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      onClose();
    }
  };

  const handleStartNewBatch = () => {
    setBatchId(null);
    setDetectedFiles({ cat_info: null, owner_info: null, appointment_info: null });
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

  const showDropZone = !allUploaded && !processing && !processResult;

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
          maxWidth: "560px",
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
            <h2 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 600 }}>ClinicHQ Batch Upload</h2>
            <p style={{ margin: "4px 0 0", fontSize: "0.85rem", color: "var(--muted, #737373)" }}>
              Drop all 3 files — auto-detected from column headers
            </p>
          </div>
          <button
            onClick={handleClose}
            disabled={uploading || processing}
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
          {/* Single Drop Zone */}
          {showDropZone && (
            <div
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                handleFiles(e.dataTransfer.files);
              }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onClick={() => !detecting && !uploading && fileInputRef.current?.click()}
              style={{
                padding: "32px 24px",
                borderRadius: "10px",
                textAlign: "center",
                cursor: detecting || uploading ? "default" : "pointer",
                transition: "all 0.15s ease",
                background: dragOver
                  ? "var(--info-bg, rgba(37, 99, 235, 0.08))"
                  : "var(--bg-secondary, #f3f4f6)",
                border: dragOver
                  ? "2px dashed var(--primary, #2563eb)"
                  : "2px dashed var(--border, #e5e7eb)",
                marginBottom: "16px",
              }}
            >
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                multiple
                ref={fileInputRef}
                onChange={(e) => {
                  if (e.target.files) handleFiles(e.target.files);
                  e.target.value = "";
                }}
                style={{ display: "none" }}
              />
              <div style={{ fontSize: "2rem", marginBottom: "8px", opacity: 0.6 }}>
                {detecting ? "..." : "📂"}
              </div>
              <div style={{ fontSize: "0.95rem", fontWeight: 500, marginBottom: "4px" }}>
                {detecting ? "Identifying files..." : "Drop all 3 ClinicHQ exports here"}
              </div>
              <div style={{ fontSize: "0.8rem", color: "var(--muted, #737373)" }}>
                or click to browse — file types are auto-detected from columns
              </div>
            </div>
          )}

          {/* Detected Files List */}
          {(detectedCount > 0 || uploadedCount > 0) && !processResult && (
            <div style={{ marginBottom: "16px" }}>
              {FILE_TYPE_ORDER.map((fileType) => {
                const detected = detectedFiles[fileType];
                const uploaded = uploadedFiles[fileType];
                const sig = FILE_SIGNATURES[fileType];

                return (
                  <div
                    key={fileType}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      padding: "10px 12px",
                      borderRadius: "8px",
                      marginBottom: "6px",
                      background: uploaded
                        ? "var(--success-bg, rgba(40, 167, 69, 0.08))"
                        : detected
                        ? "var(--card-bg, #fff)"
                        : "var(--bg-secondary, #f3f4f6)",
                      border: uploaded
                        ? "1px solid var(--success-border, #c3e6cb)"
                        : detected
                        ? "1px solid var(--border, #e5e7eb)"
                        : "1px dashed var(--border, #e5e7eb)",
                      opacity: !detected && !uploaded ? 0.5 : 1,
                    }}
                  >
                    {/* Icon */}
                    <span style={{ fontSize: "1.1rem", width: "24px", textAlign: "center" }}>
                      {uploaded ? <span style={{ color: "var(--success-text, #28a745)" }}>&#10003;</span>
                        : detected ? sig.icon
                        : <span style={{ color: "var(--muted, #737373)" }}>&#9675;</span>}
                    </span>

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "0.85rem", fontWeight: 600 }}>{sig.label}</div>
                      <div style={{ fontSize: "0.75rem", color: "var(--muted, #737373)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {detected
                          ? detected.file.name
                          : "Waiting for file..."}
                      </div>
                    </div>

                    {/* Confidence badge */}
                    {detected && !uploaded && (
                      <span
                        style={{
                          fontSize: "0.65rem",
                          padding: "2px 6px",
                          borderRadius: "4px",
                          background: detected.confidence === "high" ? "var(--success-bg)" : "var(--warning-bg)",
                          color: detected.confidence === "high" ? "var(--success-text)" : "var(--warning-text)",
                          fontWeight: 500,
                        }}
                      >
                        {detected.signatureColumns.length} cols matched
                      </span>
                    )}

                    {/* Remove button */}
                    {detected && !uploaded && !uploading && !processing && (
                      <button
                        onClick={() => removeFile(fileType)}
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          color: "var(--muted, #737373)",
                          fontSize: "1rem",
                          padding: "2px 6px",
                          lineHeight: 1,
                        }}
                        title="Remove"
                      >
                        &times;
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Upload + Process Button (combined for simplicity) */}
          {allDetected && !allUploaded && !processing && !processResult && (
            <button
              onClick={handleUploadAll}
              disabled={uploading}
              style={{
                width: "100%",
                padding: "12px",
                border: "none",
                borderRadius: "8px",
                background: uploading ? "var(--muted, #9ca3af)" : "var(--success-text, #28a745)",
                color: "#fff",
                fontSize: "0.95rem",
                fontWeight: 600,
                cursor: uploading ? "not-allowed" : "pointer",
                marginBottom: "16px",
              }}
            >
              {uploading ? "Uploading files..." : "Upload & Process All 3 Files"}
            </button>
          )}

          {/* Auto-trigger processing after upload */}
          {allUploaded && !processing && !processResult && !error && (
            <AutoProcess onProcess={handleProcess} />
          )}

          {/* Processing Progress */}
          {processing && processingProgress && (
            <div
              style={{
                padding: "16px",
                borderRadius: "8px",
                marginBottom: "16px",
                background: "var(--info-bg, rgba(37, 99, 235, 0.08))",
                border: "1px solid var(--info-border, rgba(37, 99, 235, 0.3))",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>Processing...</div>
                <div style={{ fontSize: "0.8rem", color: "var(--muted, #737373)", fontVariantNumeric: "tabular-nums" }}>
                  {formatTime(elapsedSeconds)}
                </div>
              </div>

              {processingProgress._current_step && (
                <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 12px", background: "var(--card-bg, #fff)", borderRadius: "6px", marginBottom: "12px" }}>
                  <div className="spinner" style={{ width: "14px", height: "14px", borderWidth: "2px" }} />
                  <span style={{ fontSize: "0.85rem" }}>{processingProgress._current_step}</span>
                </div>
              )}

              {/* File progress bars */}
              <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
                {FILE_TYPE_ORDER.map((ft, idx) => (
                  <div
                    key={ft}
                    style={{
                      flex: 1,
                      height: "4px",
                      borderRadius: "2px",
                      background:
                        idx < currentFileIndex ? "var(--success-text, #28a745)"
                        : idx === currentFileIndex ? "var(--primary, #2563eb)"
                        : "var(--border, #e5e7eb)",
                      transition: "background 0.3s ease",
                    }}
                  />
                ))}
              </div>

              {/* Stats */}
              {Object.keys(processingProgress).filter((k) => !k.startsWith("_")).length > 0 && (
                <div style={{ fontSize: "0.75rem" }}>
                  {Object.entries(processingProgress)
                    .filter(([k, v]) => !k.startsWith("_") && typeof v !== "object")
                    .map(([key, value]) => (
                      <div key={key} style={{ display: "flex", justifyContent: "space-between", marginTop: "4px" }}>
                        <span style={{ color: "var(--muted, #737373)" }}>{key.replace(/_/g, " ")}</span>
                        <strong>{String(value)}</strong>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{ padding: "12px 16px", background: error.startsWith("TIMEOUT:") ? "var(--info-bg, rgba(37, 99, 235, 0.08))" : "var(--danger-bg, #f8d7da)", border: error.startsWith("TIMEOUT:") ? "1px solid var(--info-border, rgba(37, 99, 235, 0.3))" : "1px solid var(--danger-border, #f5c6cb)", borderRadius: "8px", marginBottom: "16px" }}>
              <p style={{ margin: 0, fontSize: "0.85rem", color: error.startsWith("TIMEOUT:") ? "var(--text, #111)" : "var(--danger-text, #721c24)" }}>
                {error.startsWith("TIMEOUT:") ? error.slice(8) : error}
              </p>
              {error.startsWith("TIMEOUT:") && batchId && (
                <button
                  onClick={() => {
                    onClose();
                    router.push(`/admin/ingest?batch=${batchId}`);
                  }}
                  style={{
                    marginTop: "8px",
                    padding: "6px 14px",
                    border: "1px solid var(--primary, #2563eb)",
                    borderRadius: "6px",
                    background: "var(--card-bg, #fff)",
                    color: "var(--primary, #2563eb)",
                    fontSize: "0.8rem",
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  Check Ingest Dashboard
                </button>
              )}
            </div>
          )}

          {/* Process Result */}
          {processResult && (
            <div
              style={{
                padding: "16px",
                borderRadius: "8px",
                marginBottom: "16px",
                background: processResult.success ? "var(--success-bg, rgba(40, 167, 69, 0.1))" : "var(--danger-bg, rgba(220, 53, 69, 0.1))",
                border: processResult.success ? "1px solid var(--success-border, #c3e6cb)" : "1px solid var(--danger-border, #f5c6cb)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                <div style={{ fontSize: "0.95rem", fontWeight: 600 }}>{processResult.message}</div>
                {elapsedSeconds > 0 && (
                  <div style={{ fontSize: "0.75rem", color: "var(--muted, #737373)" }}>Completed in {formatTime(elapsedSeconds)}</div>
                )}
              </div>

              <div style={{ fontSize: "0.85rem" }}>
                {processResult.results.map((r) => (
                  <div key={r.source_table} style={{ marginTop: "8px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      {r.success
                        ? <span style={{ color: "var(--success-text, #28a745)" }}>&#10003;</span>
                        : <span style={{ color: "var(--danger-text, #dc3545)" }}>&#10007;</span>}
                      <strong>{r.source_table}</strong>
                      {r.rows_inserted !== undefined && (
                        <span style={{ color: "var(--muted, #737373)", fontSize: "0.8rem" }}>({r.rows_inserted} rows)</span>
                      )}
                    </div>
                    {r.error && (
                      <div style={{ color: "var(--danger-text, #dc3545)", marginLeft: "20px", fontSize: "0.8rem" }}>{r.error}</div>
                    )}
                    {r.post_processing && Object.keys(r.post_processing).length > 0 && (
                      <div style={{ marginLeft: "20px", marginTop: "4px", fontSize: "0.75rem" }}>
                        {Object.entries(r.post_processing)
                          .filter(([k, v]) => !k.startsWith("_") && typeof v !== "object")
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
          <div style={{ fontSize: "0.7rem", color: "var(--muted, #737373)" }}>
            {batchId ? `Batch: ${batchId.slice(0, 8)}...` : ""}
          </div>

          <div style={{ display: "flex", gap: "12px" }}>
            {processResult?.success ? (
              <>
                <button
                  onClick={handleStartNewBatch}
                  style={{ padding: "10px 20px", border: "1px solid var(--border, #e5e5e5)", borderRadius: "8px", background: "var(--card-bg, #fff)", fontSize: "0.9rem", cursor: "pointer" }}
                >
                  New Batch
                </button>
                {batchId && (
                  <button
                    onClick={() => {
                      onClose();
                      router.push(`/admin/ingest?batch=${batchId}`);
                    }}
                    style={{ padding: "10px 20px", border: "1px solid var(--primary, #2563eb)", borderRadius: "8px", background: "var(--card-bg, #fff)", color: "var(--primary, #2563eb)", fontSize: "0.9rem", fontWeight: 500, cursor: "pointer" }}
                  >
                    View Details
                  </button>
                )}
                <button
                  onClick={handleClose}
                  style={{ padding: "10px 20px", border: "none", borderRadius: "8px", background: "var(--primary, #2563eb)", color: "var(--primary-foreground, #fff)", fontSize: "0.9rem", fontWeight: 500, cursor: "pointer" }}
                >
                  Done
                </button>
              </>
            ) : (
              <button
                onClick={handleClose}
                disabled={uploading || processing}
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
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Auto-trigger processing after all files are uploaded */
function AutoProcess({ onProcess }: { onProcess: () => void }) {
  const triggered = useRef(false);
  useEffect(() => {
    if (!triggered.current) {
      triggered.current = true;
      onProcess();
    }
  }, [onProcess]);
  return null;
}
