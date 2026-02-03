"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";

export interface MediaItem {
  media_id: string;
  media_type: string;
  original_filename: string;
  storage_path: string;
  caption: string | null;
  cat_description: string | null;
  uploaded_by: string;
  uploaded_at: string;
  cat_identification_confidence?: string;
  photo_group_id?: string;
  is_hero?: boolean;
}

type ConfidenceLevel = "confirmed" | "likely" | "uncertain" | "unidentified";

interface SelectedFile {
  file: File;
  previewUrl: string | null;
  id: string; // For tracking in the grid
}

interface UploadProgress {
  total: number;
  completed: number;
  failed: number;
  current: string | null;
}

interface MediaUploaderProps {
  entityType: "cat" | "place" | "request" | "person";
  entityId: string;
  onUploadComplete?: (media: MediaItem | MediaItem[]) => void;
  onCancel?: () => void;
  allowedMediaTypes?: string[];
  showCatDescription?: boolean;
  defaultMediaType?: string;
  // New props for batch upload
  allowMultiple?: boolean;
  showConfidenceSelector?: boolean;
  autoGroupMultiple?: boolean;
  defaultConfidence?: ConfidenceLevel;
}

export function MediaUploader({
  entityType,
  entityId,
  onUploadComplete,
  onCancel,
  allowedMediaTypes = ["cat_photo", "site_photo", "evidence"],
  showCatDescription = false,
  defaultMediaType = "site_photo",
  allowMultiple = false,
  showConfidenceSelector = false,
  autoGroupMultiple = false,
  defaultConfidence = "unidentified",
}: MediaUploaderProps) {
  const isMobile = useIsMobile();
  const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([]);
  const [mediaType, setMediaType] = useState(defaultMediaType);
  const [caption, setCaption] = useState("");
  const [catDescription, setCatDescription] = useState("");
  const [confidence, setConfidence] = useState<ConfidenceLevel>(defaultConfidence);
  const [groupPhotos, setGroupPhotos] = useState(autoGroupMultiple);
  const [groupName, setGroupName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  // Generate unique ID for file tracking
  const generateFileId = () => `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Create preview URL for a file
  const createPreviewUrl = (file: File): Promise<string | null> => {
    return new Promise((resolve) => {
      if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
      } else {
        resolve(null);
      }
    });
  };

  // Handle file selection
  const handleFilesSelect = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const validFiles = fileArray.filter(
      (f) => f.type.startsWith("image/") || f.type.startsWith("application/pdf")
    );

    if (validFiles.length === 0) {
      setError("Please select image or PDF files");
      return;
    }

    if (!allowMultiple && validFiles.length > 1) {
      // Only take the first file if multi-select is not allowed
      validFiles.splice(1);
    }

    setError(null);

    // Create preview URLs for all files
    const newSelectedFiles: SelectedFile[] = await Promise.all(
      validFiles.map(async (file) => ({
        file,
        previewUrl: await createPreviewUrl(file),
        id: generateFileId(),
      }))
    );

    if (allowMultiple) {
      setSelectedFiles((prev) => [...prev, ...newSelectedFiles]);
    } else {
      // Clear previous selections for single file mode
      selectedFiles.forEach((sf) => sf.previewUrl && URL.revokeObjectURL(sf.previewUrl));
      setSelectedFiles(newSelectedFiles);
    }
  }, [allowMultiple, selectedFiles]);

  // Handle paste from clipboard (Cmd+V / Ctrl+V)
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const imageFiles: File[] = [];
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            const namedFile = new File([file], `pasted-image-${Date.now()}.png`, {
              type: file.type,
            });
            imageFiles.push(namedFile);
          }
        }
      }
      if (imageFiles.length > 0) {
        handleFilesSelect(imageFiles);
      }
    };

    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [handleFilesSelect]);

  // Handle drag and drop
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFilesSelect(files);
    }
  };

  // Remove a selected file
  const removeFile = (fileId: string) => {
    setSelectedFiles((prev) => {
      const file = prev.find((f) => f.id === fileId);
      if (file?.previewUrl) {
        URL.revokeObjectURL(file.previewUrl);
      }
      return prev.filter((f) => f.id !== fileId);
    });
  };

  // Clear all selected files
  const clearAllFiles = () => {
    selectedFiles.forEach((sf) => sf.previewUrl && URL.revokeObjectURL(sf.previewUrl));
    setSelectedFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Handle upload
  const handleUpload = async () => {
    if (selectedFiles.length === 0) return;

    setUploading(true);
    setError(null);
    setProgress({
      total: selectedFiles.length,
      completed: 0,
      failed: 0,
      current: selectedFiles[0].file.name,
    });

    try {
      const formData = new FormData();

      // Add files
      if (selectedFiles.length === 1) {
        formData.append("file", selectedFiles[0].file);
      } else {
        selectedFiles.forEach((sf) => {
          formData.append("files[]", sf.file);
        });
      }

      formData.append("entity_type", entityType);
      formData.append("entity_id", entityId);
      formData.append("media_type", mediaType);
      formData.append("uploaded_by", "app_user");
      formData.append("cat_identification_confidence", confidence);

      if (caption) formData.append("caption", caption);
      if (catDescription) formData.append("cat_description", catDescription);

      // Photo grouping options
      if (groupPhotos && selectedFiles.length > 1 && entityType === "request") {
        formData.append("create_photo_group", "true");
        if (groupName) formData.append("photo_group_name", groupName);
      }

      const response = await fetch("/api/media/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Upload failed");
      }

      const result = await response.json();

      // Handle response based on single vs batch
      if (selectedFiles.length === 1) {
        // Single file response
        const mediaItem: MediaItem = {
          media_id: result.media_id,
          media_type: mediaType,
          original_filename: selectedFiles[0].file.name,
          storage_path: result.storage_path,
          caption: caption || null,
          cat_description: catDescription || null,
          uploaded_by: "app_user",
          uploaded_at: new Date().toISOString(),
          cat_identification_confidence: confidence,
          photo_group_id: result.photo_group_id,
        };

        setProgress({ total: 1, completed: 1, failed: 0, current: null });
        clearAllFiles();
        setCaption("");
        setCatDescription("");
        setGroupName("");
        onUploadComplete?.(mediaItem);
      } else {
        // Batch response
        const uploadedCount = result.results?.length || 0;
        const failedCount = result.failed?.length || 0;

        setProgress({
          total: selectedFiles.length,
          completed: uploadedCount,
          failed: failedCount,
          current: null,
        });

        if (failedCount > 0 && uploadedCount === 0) {
          throw new Error(`All ${failedCount} uploads failed`);
        }

        const mediaItems: MediaItem[] = (result.results || []).map((r: { media_id: string; storage_path: string; stored_filename: string }, index: number) => ({
          media_id: r.media_id,
          media_type: mediaType,
          original_filename: selectedFiles[index]?.file.name || r.stored_filename,
          storage_path: r.storage_path,
          caption: caption || null,
          cat_description: catDescription || null,
          uploaded_by: "app_user",
          uploaded_at: new Date().toISOString(),
          cat_identification_confidence: confidence,
          photo_group_id: result.photo_group_id,
        }));

        if (failedCount > 0) {
          setError(`${uploadedCount} uploaded, ${failedCount} failed`);
        }

        clearAllFiles();
        setCaption("");
        setCatDescription("");
        setGroupName("");
        onUploadComplete?.(mediaItems);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      setProgress(null);
    }
  };

  const mediaTypeLabels: Record<string, string> = {
    cat_photo: "Cat Photo",
    site_photo: "Site Photo",
    evidence: "Evidence",
    document: "Document",
    other: "Other",
  };

  const confidenceLabels: Record<ConfidenceLevel, { label: string; color: string }> = {
    confirmed: { label: "Confirmed", color: "#198754" },
    likely: { label: "Likely", color: "#0d6efd" },
    uncertain: { label: "Uncertain", color: "#ffc107" },
    unidentified: { label: "Unidentified", color: "#6c757d" },
  };

  return (
    <div style={{
      background: "#f8f9fa",
      borderRadius: "8px",
      padding: "1rem",
      border: "1px solid #dee2e6",
    }}>
      {/* Drop zone */}
      <div
        ref={dropZoneRef}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${isDragging ? "#0d6efd" : "#adb5bd"}`,
          borderRadius: "8px",
          padding: selectedFiles.length > 0 ? "1rem" : "2rem",
          textAlign: "center",
          cursor: "pointer",
          background: isDragging ? "#e7f1ff" : "white",
          transition: "all 0.2s ease",
          marginBottom: "1rem",
          minHeight: selectedFiles.length > 0 ? "auto" : "120px",
        }}
      >
        {selectedFiles.length > 0 ? (
          <div>
            {/* Preview grid for selected files */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))",
              gap: "0.75rem",
              maxHeight: "300px",
              overflowY: "auto",
              padding: "0.5rem",
            }}>
              {selectedFiles.map((sf) => (
                <div
                  key={sf.id}
                  style={{
                    position: "relative",
                    borderRadius: "4px",
                    overflow: "hidden",
                    border: "1px solid #dee2e6",
                    background: "#fff",
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {sf.previewUrl ? (
                    <img
                      src={sf.previewUrl}
                      alt={sf.file.name}
                      style={{
                        width: "100%",
                        height: "80px",
                        objectFit: "cover",
                      }}
                    />
                  ) : (
                    <div style={{
                      width: "100%",
                      height: "80px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "#e9ecef",
                      fontSize: "1.5rem",
                    }}>
                      📄
                    </div>
                  )}
                  <div style={{
                    fontSize: "0.65rem",
                    padding: "0.25rem",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    color: "#495057",
                  }}>
                    {sf.file.name}
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFile(sf.id);
                    }}
                    style={{
                      position: "absolute",
                      top: "2px",
                      right: "2px",
                      width: "20px",
                      height: "20px",
                      borderRadius: "50%",
                      background: "#dc3545",
                      color: "white",
                      border: "none",
                      cursor: "pointer",
                      fontSize: "0.75rem",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      lineHeight: 1,
                    }}
                  >
                    x
                  </button>
                </div>
              ))}
            </div>

            {/* Summary and clear button */}
            <div style={{
              marginTop: "0.75rem",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}>
              <span style={{ fontSize: "0.875rem", color: "#6c757d" }}>
                {selectedFiles.length} file{selectedFiles.length !== 1 ? "s" : ""} selected
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  clearAllFiles();
                }}
                style={{
                  padding: "0.25rem 0.5rem",
                  fontSize: "0.75rem",
                  background: "#dc3545",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                Clear All
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>📷</div>
            <div style={{ fontWeight: 500, marginBottom: "0.25rem" }}>
              {allowMultiple
                ? "Drop images here, click to select multiple, or paste (Cmd+V)"
                : "Drop image here, click to select, or paste (Cmd+V)"}
            </div>
            <div style={{ fontSize: "0.875rem", color: "#6c757d" }}>
              Supports JPG, PNG, GIF, WebP, HEIC
              {allowMultiple && " (select multiple files)"}
            </div>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.pdf"
          multiple={allowMultiple}
          capture={isMobile ? "environment" : undefined}
          onChange={(e) => e.target.files && handleFilesSelect(e.target.files)}
          style={{ display: "none" }}
        />
        {isMobile && (
          <button
            type="button"
            onClick={() => {
              // Reset capture for gallery pick if they want non-camera
              if (fileInputRef.current) {
                fileInputRef.current.removeAttribute("capture");
                fileInputRef.current.click();
              }
            }}
            style={{
              marginTop: "0.5rem",
              padding: "0.5rem 1rem",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              cursor: "pointer",
              fontSize: "0.85rem",
              width: "100%",
            }}
          >
            Choose from Gallery
          </button>
        )}
      </div>

      {/* Media type selector */}
      {allowedMediaTypes.length > 1 && (
        <div style={{ marginBottom: "1rem" }}>
          <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.875rem", fontWeight: 500 }}>
            Photo Type
          </label>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {allowedMediaTypes.map((type) => (
              <button
                key={type}
                onClick={() => setMediaType(type)}
                style={{
                  padding: "0.375rem 0.75rem",
                  fontSize: "0.875rem",
                  border: "1px solid",
                  borderColor: mediaType === type ? "#0d6efd" : "#dee2e6",
                  borderRadius: "4px",
                  background: mediaType === type ? "#0d6efd" : "white",
                  color: mediaType === type ? "white" : "#495057",
                  cursor: "pointer",
                }}
              >
                {mediaTypeLabels[type] || type}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Confidence selector */}
      {showConfidenceSelector && (
        <div style={{ marginBottom: "1rem" }}>
          <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.875rem", fontWeight: 500 }}>
            Identification Confidence
          </label>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {(Object.keys(confidenceLabels) as ConfidenceLevel[]).map((level) => (
              <button
                key={level}
                onClick={() => setConfidence(level)}
                style={{
                  padding: "0.375rem 0.75rem",
                  fontSize: "0.875rem",
                  border: "2px solid",
                  borderColor: confidence === level ? confidenceLabels[level].color : "#dee2e6",
                  borderRadius: "4px",
                  background: confidence === level ? confidenceLabels[level].color : "white",
                  color: confidence === level ? "white" : "#495057",
                  cursor: "pointer",
                }}
              >
                {confidenceLabels[level].label}
              </button>
            ))}
          </div>
          <div style={{ fontSize: "0.75rem", color: "#6c757d", marginTop: "0.25rem" }}>
            How certain are you these photos show the same cat?
          </div>
        </div>
      )}

      {/* Photo grouping option (for multiple files + requests) */}
      {allowMultiple && selectedFiles.length > 1 && entityType === "request" && (
        <div style={{
          marginBottom: "1rem",
          padding: "0.75rem",
          background: "#e7f1ff",
          borderRadius: "4px",
          border: "1px solid #b6d4fe",
        }}>
          <label style={{ display: "flex", alignItems: "center", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={groupPhotos}
              onChange={(e) => setGroupPhotos(e.target.checked)}
              style={{ marginRight: "0.5rem" }}
            />
            <span style={{ fontWeight: 500 }}>Group as same cat</span>
          </label>
          {groupPhotos && (
            <div style={{ marginTop: "0.5rem" }}>
              <input
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Group name (e.g., 'Orange tabby', 'Black male')"
                style={{
                  width: "100%",
                  padding: "0.375rem 0.5rem",
                  border: "1px solid #dee2e6",
                  borderRadius: "4px",
                  fontSize: "0.875rem",
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* Cat description (for pre-identification) */}
      {(showCatDescription || mediaType === "cat_photo") && (
        <div style={{ marginBottom: "1rem" }}>
          <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.875rem", fontWeight: 500 }}>
            Cat Description (optional)
          </label>
          <input
            type="text"
            value={catDescription}
            onChange={(e) => setCatDescription(e.target.value)}
            placeholder="e.g., orange tabby, black male, calico female"
            style={{
              width: "100%",
              padding: "0.5rem",
              border: "1px solid #dee2e6",
              borderRadius: "4px",
              fontSize: "0.875rem",
            }}
          />
          <div style={{ fontSize: "0.75rem", color: "#6c757d", marginTop: "0.25rem" }}>
            Helps identify the cat later when microchip is known
          </div>
        </div>
      )}

      {/* Caption */}
      <div style={{ marginBottom: "1rem" }}>
        <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.875rem", fontWeight: 500 }}>
          Caption (optional)
        </label>
        <input
          type="text"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Add a description..."
          style={{
            width: "100%",
            padding: "0.5rem",
            border: "1px solid #dee2e6",
            borderRadius: "4px",
            fontSize: "0.875rem",
          }}
        />
      </div>

      {/* Upload progress */}
      {progress && (
        <div style={{ marginBottom: "1rem" }}>
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: "0.25rem",
            fontSize: "0.875rem",
          }}>
            <span>Uploading...</span>
            <span>{progress.completed} / {progress.total}</span>
          </div>
          <div style={{
            height: "8px",
            background: "#e9ecef",
            borderRadius: "4px",
            overflow: "hidden",
          }}>
            <div style={{
              height: "100%",
              width: `${(progress.completed / progress.total) * 100}%`,
              background: "#0d6efd",
              transition: "width 0.3s ease",
            }} />
          </div>
          {progress.current && (
            <div style={{ fontSize: "0.75rem", color: "#6c757d", marginTop: "0.25rem" }}>
              {progress.current}
            </div>
          )}
        </div>
      )}

      {/* Error message */}
      {error && (
        <div style={{
          padding: "0.5rem",
          marginBottom: "1rem",
          background: "#f8d7da",
          color: "#842029",
          borderRadius: "4px",
          fontSize: "0.875rem",
        }}>
          {error}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
        {onCancel && (
          <button
            onClick={onCancel}
            disabled={uploading}
            style={{
              padding: "0.5rem 1rem",
              background: "#6c757d",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: uploading ? "not-allowed" : "pointer",
              opacity: uploading ? 0.7 : 1,
            }}
          >
            Cancel
          </button>
        )}
        <button
          onClick={handleUpload}
          disabled={selectedFiles.length === 0 || uploading}
          style={{
            padding: "0.5rem 1rem",
            background: selectedFiles.length === 0 || uploading ? "#6c757d" : "#0d6efd",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: selectedFiles.length === 0 || uploading ? "not-allowed" : "pointer",
          }}
        >
          {uploading
            ? "Uploading..."
            : selectedFiles.length > 1
            ? `Upload ${selectedFiles.length} Photos`
            : "Upload"}
        </button>
      </div>
    </div>
  );
}
