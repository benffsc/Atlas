"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/feedback/Toast";
import { compressImage } from "@/lib/image-utils";
import { fetchApi, postApi } from "@/lib/api-client";
import { getCameraOffset, getCameraOffsetLabel, applyOffset } from "@/lib/camera-offsets";
import { EvidencePoolSummary } from "./EvidencePoolSummary";

/**
 * BatchEvidenceUpload — Desktop batch photo upload for clinic days.
 *
 * Handles 200-400 photos from Canon/iPhone folders:
 * 1. Select files via standard file picker
 * 2. Extract EXIF timestamps + camera model (parallel, concurrency=10)
 * 3. Apply known camera clock offsets (Canon G7 X = -1 day)
 * 4. Sort by adjusted EXIF time
 * 5. Upload in chunks of 20 with progress
 * 6. "Classify Now" triggers CDS-AI pipeline
 * 7. Poll classification progress
 *
 * Linear: FFS-1197
 */

interface Props {
  clinicDate: string;
  onUploadComplete?: () => void;
  onClassifyComplete?: () => void;
}

interface FileEntry {
  file: File;
  exifTakenAt: string | null;
  adjustedTakenAt: string | null;
  cameraMake: string | null;
  cameraModel: string | null;
  offsetApplied: number;
}

interface CameraSummary {
  label: string;
  count: number;
  offsetNote: string | null;
}

interface ClassifyProgress {
  total: number;
  processed: number;
  pct: number;
}

interface DateValidation {
  waiver_dates: string[];
  expected: string;
  mismatches: number;
  consensus_date: string | null;
}

const CHUNK_SIZE = 20;
const EXIF_CONCURRENCY = 10;

export function BatchEvidenceUpload({ clinicDate, onUploadComplete, onClassifyComplete }: Props) {
  // Selection phase
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [exifProgress, setExifProgress] = useState<{ done: number; total: number } | null>(null);

  // Upload phase
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [uploadComplete, setUploadComplete] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);

  // Classify phase
  const [classifying, setClassifying] = useState(false);
  const [classifyProgress, setClassifyProgress] = useState<ClassifyProgress | null>(null);
  const [classifyResult, setClassifyResult] = useState<{
    classified: number;
    matched: number;
    unmatched: number;
    chunks_formed: number;
    date_validation?: DateValidation;
  } | null>(null);

  // Refresh key for evidence summary
  const [refreshKey, setRefreshKey] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { addToast } = useToast();

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // ── EXIF extraction with concurrency ──────────────────────

  const extractExifBatch = useCallback(async (fileList: File[]): Promise<FileEntry[]> => {
    const entries: FileEntry[] = [];
    let done = 0;
    setExifProgress({ done: 0, total: fileList.length });

    // Process in batches of EXIF_CONCURRENCY
    for (let i = 0; i < fileList.length; i += EXIF_CONCURRENCY) {
      const batch = fileList.slice(i, i + EXIF_CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (file) => {
          let exifTakenAt: string | null = null;
          let cameraMake: string | null = null;
          let cameraModel: string | null = null;

          try {
            const exifr = await import("exifr");
            const arrayBuf = await file.arrayBuffer();
            const exif = await exifr.parse(arrayBuf, {
              pick: ["DateTimeOriginal", "CreateDate", "Make", "Model"],
            });
            if (exif?.DateTimeOriginal) {
              exifTakenAt = new Date(exif.DateTimeOriginal).toISOString();
            } else if (exif?.CreateDate) {
              exifTakenAt = new Date(exif.CreateDate).toISOString();
            }
            cameraMake = exif?.Make || null;
            cameraModel = exif?.Model || null;
          } catch {
            // EXIF extraction not critical
          }

          const offsetMs = getCameraOffset(cameraMake, cameraModel);
          const adjustedTakenAt = exifTakenAt ? applyOffset(exifTakenAt, offsetMs) : null;

          return {
            file,
            exifTakenAt,
            adjustedTakenAt,
            cameraMake,
            cameraModel,
            offsetApplied: offsetMs,
          } satisfies FileEntry;
        })
      );

      entries.push(...results);
      done += batch.length;
      setExifProgress({ done, total: fileList.length });
    }

    setExifProgress(null);
    return entries;
  }, []);

  // ── File selection ────────────────────────────────────────

  const handleFilesSelected = useCallback(
    async (selectedFiles: FileList | null) => {
      if (!selectedFiles || selectedFiles.length === 0) return;

      const imageExtensions = new Set(["jpg", "jpeg", "png", "heic", "heif", "webp", "gif"]);
      const imageFiles: File[] = [];

      for (const file of Array.from(selectedFiles)) {
        const ext = file.name.split(".").pop()?.toLowerCase();
        if (file.type.startsWith("image/") || (ext && imageExtensions.has(ext))) {
          imageFiles.push(file);
        }
      }

      if (imageFiles.length === 0) {
        addToast({ type: "error", message: "No image files found in selection" });
        return;
      }

      const entries = await extractExifBatch(imageFiles);

      // Sort by adjusted EXIF time, then filename
      const withExif = entries.filter((e) => e.adjustedTakenAt);
      const withoutExif = entries.filter((e) => !e.adjustedTakenAt);

      withExif.sort((a, b) => {
        const timeDiff = new Date(a.adjustedTakenAt!).getTime() - new Date(b.adjustedTakenAt!).getTime();
        if (timeDiff !== 0) return timeDiff;
        return a.file.name.localeCompare(b.file.name, undefined, { numeric: true });
      });

      withoutExif.sort((a, b) =>
        a.file.name.localeCompare(b.file.name, undefined, { numeric: true })
      );

      setFiles([...withExif, ...withoutExif]);
      setUploadComplete(false);
      setClassifyResult(null);
      setBatchId(null);
    },
    [extractExifBatch, addToast]
  );

  // ── Camera summary ────────────────────────────────────────

  const cameraSummary: CameraSummary[] = (() => {
    const counts = new Map<string, { count: number; make: string | null; model: string | null }>();
    for (const f of files) {
      const label = f.cameraModel || "Unknown Camera";
      const existing = counts.get(label);
      if (existing) {
        existing.count++;
      } else {
        counts.set(label, { count: 1, make: f.cameraMake, model: f.cameraModel });
      }
    }
    return Array.from(counts.entries()).map(([label, data]) => ({
      label,
      count: data.count,
      offsetNote: getCameraOffsetLabel(data.make, data.model),
    }));
  })();

  // ── Chunked upload ────────────────────────────────────────

  const handleUpload = useCallback(async () => {
    if (files.length === 0) return;
    setUploading(true);
    setUploadProgress({ done: 0, total: files.length });

    const newBatchId = crypto.randomUUID();
    setBatchId(newBatchId);
    const totalChunks = Math.ceil(files.length / CHUNK_SIZE);

    let totalUploaded = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    try {
      for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
        const start = chunkIdx * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, files.length);
        const chunkFiles = files.slice(start, end);

        // Compress all files in this chunk
        const compressed: File[] = [];
        for (const entry of chunkFiles) {
          const c = await compressImage(entry.file);
          compressed.push(c);
        }

        // Build sequence data
        const sequenceData = chunkFiles.map((entry, idx) => ({
          index: idx,
          exif_taken_at: entry.adjustedTakenAt,
          camera_make: entry.cameraMake,
          camera_model: entry.cameraModel,
        }));

        const formData = new FormData();
        for (const file of compressed) {
          formData.append("files[]", file);
        }
        formData.append("batch_id", newBatchId);
        formData.append("chunk_index", String(chunkIdx));
        formData.append("total_chunks", String(totalChunks));
        formData.append("sequence_offset", String(start));
        formData.append("sequence_data", JSON.stringify(sequenceData));

        const response = await fetch(
          `/api/admin/clinic-days/${clinicDate}/evidence/ingest-batch`,
          { method: "POST", body: formData }
        );

        const json = await response.json();
        if (!response.ok) {
          throw new Error(json.error?.message || `Chunk ${chunkIdx + 1} failed`);
        }

        const data = json.data || json;
        totalUploaded += data.uploaded;
        totalSkipped += data.skipped;
        totalErrors += data.errors;

        setUploadProgress({ done: end, total: files.length });
      }

      setUploadComplete(true);
      addToast({
        type: "success",
        message: `${totalUploaded} photos uploaded${totalSkipped ? `, ${totalSkipped} duplicates skipped` : ""}${totalErrors ? `, ${totalErrors} errors` : ""}`,
      });

      setRefreshKey((k) => k + 1);
      onUploadComplete?.();
    } catch (err) {
      addToast({
        type: "error",
        message: err instanceof Error ? err.message : "Upload failed",
      });
    } finally {
      setUploading(false);
    }
  }, [files, clinicDate, addToast, onUploadComplete]);

  // ── Classify with progress polling ────────────────────────

  const startProgressPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const progress = await fetchApi<{
          total: number;
          processed: number;
          pct: number;
        }>(`/api/admin/clinic-days/${clinicDate}/evidence/progress`);
        setClassifyProgress(progress);
      } catch {
        // Polling failure is non-fatal
      }
    }, 5000);
  }, [clinicDate]);

  const stopProgressPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const handleClassifyNow = useCallback(async () => {
    setClassifying(true);
    setClassifyProgress(null);
    startProgressPolling();

    try {
      const result = await postApi<{
        classified: number;
        chunks_formed: number;
        matched: number;
        unmatched: number;
        date_validation?: DateValidation;
      }>(`/api/admin/clinic-days/${clinicDate}/cds?pipeline=ai`, {});

      setClassifyResult(result);
      addToast({
        type: "success",
        message: `Classified ${result.classified} photos, ${result.matched} matched to cats`,
      });

      setRefreshKey((k) => k + 1);
      onClassifyComplete?.();
    } catch (err) {
      addToast({
        type: "error",
        message: err instanceof Error ? err.message : "Classification failed",
      });
    } finally {
      stopProgressPolling();
      setClassifying(false);
    }
  }, [clinicDate, addToast, onClassifyComplete, startProgressPolling, stopProgressPolling]);

  // ── Clear ─────────────────────────────────────────────────

  const handleClear = useCallback(() => {
    setFiles([]);
    setUploadComplete(false);
    setUploadProgress(null);
    setClassifyResult(null);
    setBatchId(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  // ── Render ────────────────────────────────────────────────

  const uploadPct = uploadProgress
    ? Math.round((uploadProgress.done / uploadProgress.total) * 100)
    : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* File selection zone */}
      <div
        style={{
          border: "2px dashed var(--card-border)",
          borderRadius: "12px",
          padding: files.length > 0 ? "16px" : "32px",
          textAlign: "center",
          background: "var(--section-bg)",
        }}
      >
        {files.length === 0 && !exifProgress ? (
          <>
            <div style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "8px" }}>
              Batch Upload (Desktop)
            </div>
            <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginBottom: "16px" }}>
              Select all photos from a clinic day folder. EXIF timestamps + camera models
              are extracted for ordering. Canon G7 X clock offset is auto-corrected.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => handleFilesSelected(e.target.files)}
              style={{ display: "none" }}
            />
            <Button variant="primary" onClick={() => fileInputRef.current?.click()}>
              Select Photos
            </Button>
          </>
        ) : exifProgress ? (
          /* EXIF extraction in progress */
          <div>
            <div style={{ fontSize: "0.9rem", fontWeight: 500, marginBottom: "8px" }}>
              Reading metadata: {exifProgress.done}/{exifProgress.total}
            </div>
            <ProgressBar pct={Math.round((exifProgress.done / exifProgress.total) * 100)} />
          </div>
        ) : (
          /* Files selected — show summary + actions */
          <>
            {/* Camera summary */}
            <div style={{
              display: "flex",
              gap: "12px",
              justifyContent: "center",
              flexWrap: "wrap",
              marginBottom: "12px",
            }}>
              <span style={{ fontWeight: 600 }}>{files.length} photos</span>
              {cameraSummary.map((cam) => (
                <span
                  key={cam.label}
                  style={{
                    fontSize: "0.85rem",
                    color: "var(--muted)",
                    background: "var(--card-bg)",
                    padding: "2px 8px",
                    borderRadius: "4px",
                    border: "1px solid var(--card-border)",
                  }}
                >
                  {cam.label}: {cam.count}
                  {cam.offsetNote && (
                    <span style={{ color: "var(--warning-text)", marginLeft: "4px" }}>
                      ({cam.offsetNote} applied)
                    </span>
                  )}
                </span>
              ))}
            </div>

            {/* Upload progress */}
            {uploading && uploadProgress && (
              <div style={{ marginBottom: "12px" }}>
                <div style={{ fontSize: "0.9rem", fontWeight: 500, marginBottom: "6px" }}>
                  Uploading: {uploadProgress.done}/{uploadProgress.total} ({uploadPct}%)
                </div>
                <ProgressBar pct={uploadPct} />
              </div>
            )}

            {/* Upload complete status */}
            {uploadComplete && !classifying && !classifyResult && (
              <div style={{
                color: "var(--success-text)",
                fontSize: "0.9rem",
                fontWeight: 500,
                marginBottom: "12px",
              }}>
                Upload complete. Ready to classify.
              </div>
            )}

            {/* Classification progress */}
            {classifying && (
              <div style={{ marginBottom: "12px" }}>
                <div style={{ fontSize: "0.9rem", fontWeight: 500, marginBottom: "6px" }}>
                  Classifying...{classifyProgress
                    ? ` ${classifyProgress.processed}/${classifyProgress.total} (${classifyProgress.pct}%)`
                    : " starting"}
                </div>
                <ProgressBar pct={classifyProgress?.pct ?? 0} indeterminate={!classifyProgress} />
              </div>
            )}

            {/* Classification result */}
            {classifyResult && (
              <div style={{
                fontSize: "0.85rem",
                color: "var(--muted)",
                marginBottom: "12px",
              }}>
                {classifyResult.classified} classified, {classifyResult.chunks_formed} chunks,{" "}
                {classifyResult.matched} matched, {classifyResult.unmatched} unmatched
              </div>
            )}

            {/* Date mismatch warning (Phase 3) */}
            {classifyResult?.date_validation && classifyResult.date_validation.mismatches > 0 && (
              <div style={{
                padding: "12px 16px",
                borderRadius: "8px",
                background: "var(--warning-bg)",
                border: "1px solid var(--warning-text)",
                color: "var(--warning-text)",
                fontSize: "0.85rem",
                textAlign: "left",
                marginBottom: "12px",
              }}>
                <strong>Date mismatch detected:</strong> Waivers show{" "}
                {classifyResult.date_validation.consensus_date
                  ? `Surgery Date "${classifyResult.date_validation.consensus_date}"`
                  : `${classifyResult.date_validation.mismatches} dates that don't match`}
                {" "}but this clinic day is {clinicDate}.
                {" "}Camera clock may be offset, or photos may be from a different date.
              </div>
            )}

            {/* Actions */}
            <div style={{ display: "flex", gap: "8px", justifyContent: "center" }}>
              {!uploadComplete && (
                <>
                  <Button
                    variant="primary"
                    onClick={handleUpload}
                    loading={uploading}
                    disabled={uploading}
                  >
                    Upload {files.length} Photos
                  </Button>
                  <Button variant="ghost" onClick={handleClear} disabled={uploading}>
                    Clear
                  </Button>
                </>
              )}
              {uploadComplete && !classifyResult && (
                <>
                  <Button
                    variant="primary"
                    onClick={handleClassifyNow}
                    loading={classifying}
                    disabled={classifying}
                  >
                    Classify Now
                  </Button>
                  <Button variant="secondary" onClick={handleClear} disabled={classifying}>
                    Upload More
                  </Button>
                </>
              )}
              {classifyResult && (
                <Button variant="secondary" onClick={handleClear}>
                  Start New Batch
                </Button>
              )}
            </div>
          </>
        )}
      </div>

      {/* Evidence summary */}
      <EvidencePoolSummary key={refreshKey} date={clinicDate} />
    </div>
  );
}

// ── Progress bar sub-component ────────────────────────────────

function ProgressBar({ pct, indeterminate }: { pct: number; indeterminate?: boolean }) {
  return (
    <>
      <div style={{
        height: "6px",
        background: "var(--section-bg)",
        borderRadius: "3px",
        overflow: "hidden",
        border: "1px solid var(--card-border)",
      }}>
        <div style={{
          height: "100%",
          width: indeterminate ? "100%" : `${pct}%`,
          background: "var(--primary)",
          borderRadius: "3px",
          transition: indeterminate ? "none" : "width 0.3s ease",
          animation: indeterminate ? "indeterminate 1.5s infinite ease-in-out" : "none",
        }} />
      </div>
      <style>{`
        @keyframes indeterminate {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(0%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </>
  );
}
