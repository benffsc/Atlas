"use client";

import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/feedback/Toast";
import { useIsMobile } from "@/hooks/useIsMobile";
import { compressImage } from "@/lib/image-utils";
import { postApi } from "@/lib/api-client";
import { EvidencePoolSummary } from "./EvidencePoolSummary";

/**
 * ClinicDayEvidenceUpload — Phone-friendly batch photo upload for clinic days.
 *
 * Staff select photos from their camera roll, client extracts EXIF timestamps
 * for sequence ordering, compresses images, then uploads sequentially to
 * preserve order. After upload, shows evidence pool summary inline.
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
  preview: string;
  status: "pending" | "uploading" | "done" | "error";
}

export function ClinicDayEvidenceUpload({ clinicDate, onUploadComplete, onClassifyComplete }: Props) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{
    uploaded: number;
    skipped: number;
    errors: number;
    batch_id: string;
  } | null>(null);
  const [classifying, setClassifying] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const isMobile = useIsMobile();
  const { addToast } = useToast();

  // ── EXIF extraction ──────────────────────────────────────

  const extractExif = useCallback(async (file: File): Promise<string | null> => {
    try {
      // Dynamic import to avoid bundling exifr for non-upload pages
      const exifr = await import("exifr");
      const arrayBuf = await file.arrayBuffer();
      const exif = await exifr.parse(arrayBuf, {
        pick: ["DateTimeOriginal", "CreateDate"],
      });
      if (exif?.DateTimeOriginal) {
        return new Date(exif.DateTimeOriginal).toISOString();
      }
      if (exif?.CreateDate) {
        return new Date(exif.CreateDate).toISOString();
      }
    } catch {
      // EXIF extraction failed — not critical
    }
    return null;
  }, []);

  // ── File selection ───────────────────────────────────────

  const handleFilesSelected = useCallback(
    async (selectedFiles: FileList | null) => {
      if (!selectedFiles || selectedFiles.length === 0) return;

      const entries: FileEntry[] = [];

      const imageExtensions = new Set(["jpg", "jpeg", "png", "heic", "heif", "webp", "gif"]);
      for (const file of Array.from(selectedFiles)) {
        const ext = file.name.split(".").pop()?.toLowerCase();
        if (!file.type.startsWith("image/") && !(ext && imageExtensions.has(ext))) continue;

        const exifTakenAt = await extractExif(file);
        const preview = URL.createObjectURL(file);
        entries.push({ file, exifTakenAt, preview, status: "pending" });
      }

      // Sort by EXIF time, then by filename for ties / no-EXIF
      const withExif = entries.filter((e) => e.exifTakenAt);
      const withoutExif = entries.filter((e) => !e.exifTakenAt);

      withExif.sort((a, b) => {
        const timeDiff =
          new Date(a.exifTakenAt!).getTime() - new Date(b.exifTakenAt!).getTime();
        if (timeDiff !== 0) return timeDiff;
        return a.file.name.localeCompare(b.file.name, undefined, { numeric: true });
      });

      withoutExif.sort((a, b) =>
        a.file.name.localeCompare(b.file.name, undefined, { numeric: true })
      );

      setFiles([...withExif, ...withoutExif]);
      setUploadResult(null);
    },
    [extractExif]
  );

  // ── Upload ───────────────────────────────────────────────

  const handleUpload = useCallback(async () => {
    if (files.length === 0) return;
    setUploading(true);

    try {
      // Compress all files first
      const compressed: File[] = [];
      for (const entry of files) {
        const c = await compressImage(entry.file);
        compressed.push(c);
      }

      // Build sequence_data from EXIF timestamps
      const sequenceData = files.map((entry, idx) => ({
        index: idx,
        exif_taken_at: entry.exifTakenAt,
      }));

      // Upload in a single multipart request
      const formData = new FormData();
      for (const file of compressed) {
        formData.append("files[]", file);
      }
      formData.append("sequence_data", JSON.stringify(sequenceData));

      const response = await fetch(
        `/api/admin/clinic-days/${clinicDate}/evidence/ingest`,
        { method: "POST", body: formData }
      );

      const json = await response.json();
      if (!response.ok) {
        throw new Error(json.error?.message || "Upload failed");
      }

      const data = json.data || json;
      setUploadResult(data);

      // Mark all files as done
      setFiles((prev) => prev.map((f) => ({ ...f, status: "done" as const })));

      addToast({
        type: "success",
        message: `${data.uploaded} photo${data.uploaded !== 1 ? "s" : ""} uploaded${data.skipped ? `, ${data.skipped} skipped (duplicates)` : ""}`,
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

  // ── Classify Now ─────────────────────────────────────────

  const handleClassifyNow = useCallback(async () => {
    setClassifying(true);
    try {
      const result = await postApi<{
        date: string;
        classified: number;
        chunks_formed: number;
        matched: number;
        unmatched: number;
      }>(`/api/admin/clinic-days/${clinicDate}/cds?pipeline=ai`, {});

      addToast({
        type: "success",
        message: `Classified ${result.classified} photos, ${result.matched} matched, ${result.chunks_formed} chunks`,
      });

      setRefreshKey((k) => k + 1);
      onClassifyComplete?.();
    } catch (err) {
      addToast({
        type: "error",
        message: err instanceof Error ? err.message : "Classification failed",
      });
    } finally {
      setClassifying(false);
    }
  }, [clinicDate, addToast, onClassifyComplete]);

  // ── Clear selection ──────────────────────────────────────

  const handleClear = useCallback(() => {
    files.forEach((f) => URL.revokeObjectURL(f.preview));
    setFiles([]);
    setUploadResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";
  }, [files]);

  // ── Render ───────────────────────────────────────────────

  const hasFiles = files.length > 0;
  const allDone = files.every((f) => f.status === "done");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Upload zone */}
      <div
        style={{
          border: "2px dashed var(--card-border)",
          borderRadius: "12px",
          padding: hasFiles ? "16px" : "32px",
          textAlign: "center",
          background: "var(--section-bg)",
        }}
      >
        {!hasFiles ? (
          <>
            <div style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "8px" }}>
              Upload Clinic Day Photos
            </div>
            <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginBottom: "16px" }}>
              Select all photos from today&apos;s clinic. EXIF timestamps will be used
              to preserve the original capture order.
            </p>
            <div style={{ display: "flex", gap: "8px", justifyContent: "center", flexWrap: "wrap" }}>
              {isMobile && (
                <>
                  <input
                    ref={cameraInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={(e) => handleFilesSelected(e.target.files)}
                    style={{ display: "none" }}
                  />
                  <Button
                    variant="secondary"
                    onClick={() => cameraInputRef.current?.click()}
                  >
                    Take Photo
                  </Button>
                </>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => handleFilesSelected(e.target.files)}
                style={{ display: "none" }}
              />
              <Button
                variant="primary"
                onClick={() => fileInputRef.current?.click()}
              >
                {isMobile ? "Choose from Gallery" : "Select Photos"}
              </Button>
            </div>
          </>
        ) : (
          <>
            {/* Thumbnail strip */}
            <div style={{
              display: "flex",
              gap: "4px",
              overflowX: "auto",
              paddingBottom: "8px",
              marginBottom: "12px",
            }}>
              {files.slice(0, 50).map((entry, idx) => (
                <div
                  key={idx}
                  style={{
                    width: "48px",
                    height: "48px",
                    borderRadius: "4px",
                    overflow: "hidden",
                    flexShrink: 0,
                    border: entry.status === "done"
                      ? "2px solid var(--success-text)"
                      : entry.status === "error"
                      ? "2px solid var(--danger-text)"
                      : "1px solid var(--card-border)",
                    opacity: entry.status === "done" ? 0.7 : 1,
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={entry.preview}
                    alt={`Photo ${idx + 1}`}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                    }}
                  />
                </div>
              ))}
              {files.length > 50 && (
                <div style={{
                  width: "48px",
                  height: "48px",
                  borderRadius: "4px",
                  background: "var(--section-bg)",
                  border: "1px solid var(--card-border)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "0.7rem",
                  color: "var(--muted)",
                  flexShrink: 0,
                }}>
                  +{files.length - 50}
                </div>
              )}
            </div>

            {/* Progress / status */}
            <div style={{
              fontSize: "0.9rem",
              fontWeight: 500,
              marginBottom: "8px",
            }}>
              {uploading ? (
                <>Uploading {files.length} photos...</>
              ) : allDone ? (
                <span style={{ color: "var(--success-text)" }}>
                  {uploadResult?.uploaded ?? files.length} photos uploaded
                  {(uploadResult?.skipped ?? 0) > 0 && (
                    <span style={{ color: "var(--muted)" }}>
                      {" "}({uploadResult!.skipped} duplicates skipped)
                    </span>
                  )}
                </span>
              ) : (
                <>{files.length} photos selected</>
              )}
            </div>

            {/* Progress bar */}
            {uploading && (
              <div style={{
                height: "6px",
                background: "var(--section-bg)",
                borderRadius: "3px",
                overflow: "hidden",
                marginBottom: "12px",
              }}>
                <div style={{
                  height: "100%",
                  width: "100%",
                  background: "var(--primary)",
                  borderRadius: "3px",
                  animation: "indeterminate 1.5s infinite ease-in-out",
                }} />
              </div>
            )}

            {/* Actions */}
            <div style={{ display: "flex", gap: "8px", justifyContent: "center" }}>
              {!allDone && (
                <>
                  <Button
                    variant="primary"
                    onClick={handleUpload}
                    loading={uploading}
                    disabled={uploading}
                  >
                    Upload {files.length} Photos
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={handleClear}
                    disabled={uploading}
                  >
                    Clear
                  </Button>
                </>
              )}
              {allDone && (
                <>
                  <Button
                    variant="primary"
                    onClick={handleClassifyNow}
                    loading={classifying}
                  >
                    Classify Now
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={handleClear}
                  >
                    Upload More
                  </Button>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* Evidence summary (refreshes after upload/classify) */}
      <EvidencePoolSummary key={refreshKey} date={clinicDate} />

      {/* CSS for indeterminate progress bar */}
      <style>{`
        @keyframes indeterminate {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(0%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
}
